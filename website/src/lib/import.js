'use strict';
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { db } = require('../db');
const config = require('../config');
const categories = require('./categories');
const products = require('./products');

/**
 * Column headers accepted in an uploaded sheet. Chinese and English are both
 * recognised so the file can come straight out of the team's own workbook.
 */
const COLUMNS = [
  { key: 'category', zh: '分类', aliases: ['分类', '类别', 'category', '产品分类'] },
  { key: 'name_en', zh: '产品英文名字', aliases: ['产品英文名字', '产品名称', '英文名', 'name', 'product name', 'name_en'] },
  { key: 'name_zh', zh: '中文品名', aliases: ['中文品名', '中文名', '中文名称', '品名', 'name_zh', 'chinese name'] },
  { key: 'dosage_form', zh: '剂型', aliases: ['剂型', 'dosage form', 'dosage_form', 'form'] },
  { key: 'spec', zh: '规格', aliases: ['规格', 'specification', 'spec'] },
  { key: 'tags', zh: '产品标签', aliases: ['产品标签', '标签', 'tags', 'product tags'] },
  { key: 'content', zh: '含量', aliases: ['含量', 'content', 'assay'] },
  { key: 'ratio', zh: '比例', aliases: ['比例', 'ratio'] },
  { key: 'cas_no', zh: 'CAS号', aliases: ['cas号', 'cas', 'cas no', 'cas no.', 'cas_no'] },
  { key: 'remark', zh: '备注', aliases: ['备注', 'remark', 'remarks', 'note'] },
  { key: 'sort_order', zh: '排序', aliases: ['排序', '排序值', 'sort', 'sort order', 'sort_order'] },
  { key: 'is_active', zh: '上架', aliases: ['上架', '状态', 'active', 'is_active', 'status'] },
];

/** Category cells may hold the Chinese name, the English name or the key. */
function parseCategory(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  const known = categories.all();
  for (const c of known) {
    if (v === c.key || v === c.zh.toLowerCase() || v === c.en.toLowerCase()) return c.key;
  }
  // Tolerate partial names like "OEM" or "添加剂".
  for (const c of known) {
    if (c.zh.toLowerCase().includes(v) || v.includes(c.zh.toLowerCase())) return c.key;
    if (c.en.toLowerCase().includes(v) || v.includes(c.key)) return c.key;
  }
  return '';
}

function parseActive(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (v === '') return 1;
  if (['0', 'false', 'no', 'n', '否', '下架', '隐藏'].includes(v)) return 0;
  return 1;
}

function headerKey(text) {
  const v = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  for (const col of COLUMNS) {
    if (col.aliases.some((a) => a.toLowerCase() === v)) return col.key;
  }
  return null;
}

function cellText(cell) {
  if (cell == null) return '';
  const v = cell.value ?? cell;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v);
}

/** Reads the first worksheet of an .xlsx, or a CSV, into header-keyed rows. */
async function readRows(filePath, originalName) {
  const wb = new ExcelJS.Workbook();
  const isCsv = /\.csv$/i.test(originalName || filePath);
  const sheet = isCsv
    ? await wb.csv.readFile(filePath)
    : (await wb.xlsx.readFile(filePath), wb.worksheets[0]);
  if (!sheet) throw new Error('文件里没有找到任何工作表。');

  const headerRow = sheet.getRow(1);
  const map = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const key = headerKey(cellText(cell));
    if (key && !(key in map)) map[key] = col;
  });

  if (!map.name_en) {
    throw new Error('没有找到「产品英文名字」这一列。请先下载模板，按模板的表头填写。');
  }

  const out = [];
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const rec = { _row: i };
    let blank = true;
    for (const [key, col] of Object.entries(map)) {
      const text = cellText(row.getCell(col)).trim();
      rec[key] = text;
      if (text) blank = false;
    }
    if (!blank) out.push(rec);
  }
  return out;
}

/**
 * Classifies every row against the current catalogue without writing anything.
 * Matching is by category + English name, which is how the team identifies a
 * product in their own sheet.
 */
function analyse(rawRows) {
  // readRows only writes keys for headers it actually found, so an absent
  // 中文品名 column is distinguishable from one whose cells are blank. It
  // matters because every sheet written before this column existed has no
  // such header, and importing one to update products must not wipe the
  // Chinese names already entered by hand. A blank cell still clears it —
  // that is how every other column behaves.
  const hasNameZh = rawRows.some((r) => 'name_zh' in r);
  const existing = products.q.listAll.all();
  const index = new Map(
    existing.map((p) => [p.category + '\u0000' + p.name_en.trim().toLowerCase(), p])
  );

  const seen = new Set();
  const results = [];

  for (const r of rawRows) {
    const name = String(r.name_en || '').trim();
    const category = parseCategory(r.category);
    const problems = [];

    if (!name) problems.push('缺少产品英文名字');
    if (!category) {
      problems.push(
        r.category ? `分类「${r.category}」无法识别` : '缺少分类'
      );
    }

    const key = category + '\u0000' + name.toLowerCase();
    if (!problems.length && seen.has(key)) problems.push('文件内重复出现');
    if (!problems.length) seen.add(key);

    const match = problems.length ? null : index.get(key);
    const row = {
      _row: r._row,
      category,
      name_en: name,
      name_zh: (r.name_zh || '').trim(),
      dosage_form: (r.dosage_form || '').trim(),
      spec: (r.spec || '').trim(),
      tags: (r.tags || '').trim(),
      content: (r.content || '').trim(),
      ratio: (r.ratio || '').trim(),
      cas_no: (r.cas_no || '').trim(),
      remark: (r.remark || '').trim(),
      sort_order: Number.parseInt(r.sort_order, 10) || 0,
      is_active: parseActive(r.is_active),
    };

    results.push({
      row,
      problems,
      action: problems.length ? 'error' : match ? 'update' : 'create',
      existingId: match ? match.id : null,
      existingName: match ? match.name_en : '',
    });
  }

  return {
    rows: results,
    hasNameZh,
    summary: {
      create: results.filter((r) => r.action === 'create').length,
      update: results.filter((r) => r.action === 'update').length,
      error: results.filter((r) => r.action === 'error').length,
      total: results.length,
    },
  };
}

/** Applies a previously analysed batch. Error rows are skipped. */
const apply = db.transaction((analysed) => {
  let created = 0;
  let updated = 0;
  for (const item of analysed.rows) {
    if (item.action === 'error') continue;
    if (item.action === 'create') {
      products.q.insert.run({
        ...item.row,
        image_path: '',
        sort_order: item.row.sort_order || products.nextSortOrder(item.row.category),
      });
      created += 1;
    } else {
      const current = products.q.byId.get(item.existingId);
      if (!current) continue;
      products.q.update.run({
        ...item.row,
        id: current.id,
        image_path: current.image_path, // the sheet never carries images
        // A sheet without the column leaves the Chinese name alone.
        name_zh: analysed.hasNameZh ? item.row.name_zh : current.name_zh,
        sort_order: item.row.sort_order || current.sort_order,
      });
      updated += 1;
    }
  }
  return { created, updated };
});

/* ---------------------------------------------------------------------------
 * Parsed batches wait here between the preview and the confirmation, keyed by
 * a token handed to the admin. Nothing is written until they confirm.
 * ------------------------------------------------------------------------- */
const pending = new Map();
const PENDING_TTL_MS = 30 * 60 * 1000;

function stash(userId, analysed, meta) {
  const token = crypto.randomBytes(12).toString('hex');
  pending.set(token, { userId, analysed, meta, at: Date.now() });
  for (const [k, v] of pending) {
    if (Date.now() - v.at > PENDING_TTL_MS) pending.delete(k);
  }
  return token;
}

function take(token, userId) {
  const entry = pending.get(String(token || ''));
  if (!entry || entry.userId !== userId) return null;
  if (Date.now() - entry.at > PENDING_TTL_MS) {
    pending.delete(token);
    return null;
  }
  pending.delete(token);
  return entry;
}

function peek(token, userId) {
  const entry = pending.get(String(token || ''));
  if (!entry || entry.userId !== userId) return null;
  return entry;
}

/** Builds the .xlsx template, with one example row per category. */
async function buildTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Durlevel';
  const sheet = wb.addWorksheet('产品');

  sheet.columns = COLUMNS.map((c) => ({ header: c.zh, key: c.key, width: 22 }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE7F2EE' },
  };

  sheet.addRow({
    category: 'OEM成品', name_en: 'Vitamin C 1000mg Tablets', name_zh: '维生素C片 1000mg',
    dosage_form: 'Tablet',
    spec: '1000mg x 60 tablets', tags: 'Immune Support, Best Seller',
    remark: 'MOQ 5,000 bottles', sort_order: 1, is_active: '是',
  });
  sheet.addRow({
    category: '提取物', name_en: 'Green Tea Extract', name_zh: '绿茶提取物', content: 'EGCG 50%',
    ratio: '10:1', remark: 'Water soluble', sort_order: 1, is_active: '是',
  });
  sheet.addRow({
    category: '食品添加剂', name_en: 'Sodium Citrate', name_zh: '柠檬酸钠',
    dosage_form: 'Powder',
    cas_no: '68-04-2', remark: 'Food grade, FCC', sort_order: 1, is_active: '是',
  });

  const notes = wb.addWorksheet('填写说明');
  notes.columns = [{ width: 100 }];
  [
    '填写说明',
    '',
    '1.「分类」只能填：OEM成品 / 提取物 / 食品添加剂（也可填 oem / extract / additive）。',
    '2.「产品英文名字」必填，并且是识别产品的依据：',
    '   · 同一分类下名字已存在 → 更新这个产品；',
    '   · 名字不存在 → 新增产品。',
    '3. 不同分类用到的列不同，用不到的列留空即可：',
    '   · OEM成品：剂型、规格、产品标签',
    '   · 提取物：含量、比例',
    '   · 食品添加剂：剂型、CAS号',
    '4.「产品标签」多个标签之间用逗号分隔。',
    '5.「排序」数字越小越靠前；留空会自动排到最后。',
    '6.「上架」填 是 / 否（留空按「是」处理）。',
    '7. 产品图片和文档不能通过本表导入，请在后台逐个上传。',
    '8. 导入前会先显示「新增 / 更新 / 错误」的预览，确认后才会真正写入。',
  ].forEach((line) => notes.addRow([line]));
  notes.getRow(1).font = { bold: true, size: 14 };

  return wb.xlsx.writeBuffer();
}

module.exports = {
  COLUMNS,
  readRows,
  analyse,
  apply,
  stash,
  take,
  peek,
  buildTemplate,
  parseCategory,
};
