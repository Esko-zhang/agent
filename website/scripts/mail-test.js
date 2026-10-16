#!/usr/bin/env node
'use strict';
/**
 * Checks the SMTP settings in .env without going anywhere near a real
 * inquiry: it prints what is configured, opens the connection, authenticates,
 * and — unless told not to — sends one test message.
 *
 *   npm run mail-test                 发给业务员名片上的邮箱（和 INQUIRY_NOTIFY_TO）
 *   npm run mail-test -- you@x.com    只发给指定地址
 *   npm run mail-test -- --check      只检查连接和登录，不发信
 *
 * Every failure is mapped back to the thing to go and change, because the
 * SMTP error alone ("Invalid login") rarely says which of the three usual
 * causes it is.
 */
require('dotenv').config();
const mailer = require('../src/lib/mailer');
const staff = require('../src/lib/staff');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const explicit = args.filter((a) => a.indexOf('--') !== 0);

/** Turns an SMTP failure into the thing to actually go and fix. */
function explain(result) {
  const code = String(result.code || '');
  const text = (String(result.message || '') + ' ' + String(result.response || '')).toLowerCase();

  if (code === 'DISABLED') {
    return ['.env 里 SMTP_HOST 或 SMTP_USER 还是空的，邮件通知处于关闭状态。',
            '询盘仍然会正常保存并显示在后台，只是不发邮件。'];
  }
  if (code === 'EAUTH' || text.indexOf('invalid login') !== -1 || text.indexOf('authentication') !== -1) {
    return ['登录被拒绝。阿里云企业邮箱上按顺序确认三件事：',
            '  1. 管理员在后台为这个账号开启了「SMTP 服务 / 三方客户端」——新开通的租户默认是关的；',
            '  2. SMTP_PASS 填的是「三方客户端安全密码」（邮箱设置 → 账户安全里生成），不是网页版登录密码；',
            '  3. SMTP_USER 是完整邮箱地址，不是只填前缀。'];
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET' ||
      text.indexOf('timeout') !== -1 || text.indexOf('econnrefused') !== -1) {
    return ['连不上发信服务器。多半是端口被挡：',
            '  - 阿里云 ECS 默认封禁 25 端口出站，所以要用 465 + SSL（SMTP_PORT=465、SMTP_SECURE=1）；',
            '  - 服务器安全组 / 防火墙要放行 465 出站；',
            '  - 用 `nc -vz ' + (process.env.SMTP_HOST || 'smtp.qiye.aliyun.com') + ' ' +
              (Number(process.env.SMTP_PORT) || 465) + '` 可以单独验证通不通。'];
  }
  if (text.indexOf('spf') !== -1) {
    return ['对方按 SPF 拒收。域名的 DNS 需要一条 TXT 记录：',
            '  v=spf1 include:spf.qiye.aliyun.com -all'];
  }
  if (text.indexOf('not owned') !== -1 || text.indexOf('sender') !== -1 || text.indexOf('550') !== -1) {
    return ['发件人地址被拒。SMTP_FROM 必须和 SMTP_USER 是同一个地址（带显示名可以，',
            '例如 Durlevel <' + (process.env.SMTP_USER || 'sales@yourdomain.com') + '>）。'];
  }
  if (code === 'EENVELOPE') {
    return ['收件人地址有问题：检查「业务员名片」里的邮箱，或 INQUIRY_NOTIFY_TO 的写法（逗号分隔）。'];
  }
  return ['没有匹配到已知原因，请把上面的原始报错贴给我。'];
}

function line(label, value) {
  console.log('  ' + label.padEnd(14) + (value === '' || value == null ? '（未填）' : value));
}

/**
 * The trap that costs the most time: a key written twice in .env.
 *
 * dotenv keeps the LAST occurrence, so appending a working SMTP block above an
 * older empty one leaves the empty one winning, and every value silently reads
 * as blank. Nothing about the resulting "SMTP 未配置" says why, so this looks
 * for it directly and points at the line to delete.
 */
function duplicateKeys() {
  const fs = require('fs');
  const path = require('path');
  const file = path.join(__dirname, '..', '.env');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];   // no .env at all: the environment is set some other way
  }
  const seen = new Map();
  text.split(/\r?\n/).forEach((raw, i) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(raw);
    if (!m) return;
    if (!/^(SMTP_|INQUIRY_NOTIFY_TO)/.test(m[1])) return;
    if (!seen.has(m[1])) seen.set(m[1], []);
    seen.get(m[1]).push({ line: i + 1, value: m[2].trim() });
  });
  return [...seen.entries()]
    .filter(([, hits]) => hits.length > 1)
    .map(([key, hits]) => ({ key, hits }));
}

(async () => {
  const s = mailer.status();

  const dupes = duplicateKeys();
  if (dupes.length) {
    console.log('\n⚠ .env 里有重复的键 —— 后面那行会覆盖前面那行');
    for (const d of dupes) {
      const last = d.hits[d.hits.length - 1];
      console.log('  ' + d.key + '  出现在第 ' +
        d.hits.map((h) => h.line).join('、') + ' 行；' +
        '生效的是第 ' + last.line + ' 行：' +
        (last.value === '' ? '（空值）' : last.value.slice(0, 40)));
    }
    console.log('  删掉多余的那几行（通常是文件底部留下的空模板）：');
    console.log("    sudo sed -i '/^SMTP_\\(HOST\\|PORT\\|SECURE\\|USER\\|PASS\\|FROM\\)=$/d' " +
                require('path').join(__dirname, '..', '.env'));
  }

  console.log('\n当前配置');
  line('发信服务器', (process.env.SMTP_HOST || '') +
       (process.env.SMTP_HOST ? ':' + (Number(process.env.SMTP_PORT) || 465) : ''));
  line('加密', process.env.SMTP_HOST
    ? (/^(0|false|no)$/i.test(String(process.env.SMTP_SECURE ?? '1')) ? 'STARTTLS / 无' : 'SSL')
    : '');
  line('发信账号', process.env.SMTP_USER || '');
  line('密码', process.env.SMTP_PASS ? '已填写（' + process.env.SMTP_PASS.length + ' 位）' : '');
  line('发件人', s.from);

  let recipients = explicit;
  if (!recipients.length) {
    const cards = staff.q.listActive.all().map((m) => m.email).filter(Boolean);
    recipients = cards.concat(s.to);
  }
  line('收件人', recipients.length ? recipients.join(', ') : '');

  if (process.env.SMTP_FROM && process.env.SMTP_USER &&
      process.env.SMTP_FROM.indexOf(process.env.SMTP_USER) === -1) {
    console.log('\n⚠ SMTP_FROM 里不包含 SMTP_USER 的地址，阿里云会拒绝这样的发信。');
  }

  console.log('\n[1/2] 连接并登录…');
  const v = await mailer.verify();
  if (!v.ok) {
    console.log('  ✗ 失败：' + (v.message || '') + (v.response ? '\n    原始响应：' + v.response : ''));
    console.log('\n怎么修：');
    explain(v).forEach((l) => console.log('  ' + l));
    process.exit(1);
  }
  console.log('  ✓ 服务器接受了这个账号和密码。');

  if (checkOnly) {
    console.log('\n--check：只检查不发信，到此结束。');
    return;
  }
  if (!recipients.length) {
    console.log('\n[2/2] 跳过：没有收件人。先在后台「业务员名片」里填邮箱，' +
                '或在 .env 里设 INQUIRY_NOTIFY_TO，或直接 `npm run mail-test -- you@example.com`。');
    process.exit(1);
  }

  console.log('\n[2/2] 发送测试邮件…');
  const r = await mailer.sendTest(recipients.join(','));
  if (!r.ok) {
    console.log('  ✗ 失败：' + (r.message || '') + (r.response ? '\n    原始响应：' + r.response : ''));
    console.log('\n怎么修：');
    explain(r).forEach((l) => console.log('  ' + l));
    process.exit(1);
  }
  console.log('  ✓ 已发出：' + (r.accepted || []).join(', '));
  if (r.rejected && r.rejected.length) console.log('  ⚠ 被拒收：' + r.rejected.join(', '));
  console.log('\n去收件箱确认一下（也看看垃圾箱）。收到了就说明询盘邮件通知可用了。\n');
})();
