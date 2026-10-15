'use strict';
const { db } = require('../db');

const q = {
  byId: db.prepare('SELECT * FROM staff WHERE id = ?'),
  listAll: db.prepare('SELECT * FROM staff ORDER BY sort_order, id'),
  listActive: db.prepare('SELECT * FROM staff WHERE is_active = 1 ORDER BY sort_order, id'),
  insert: db.prepare(
    `INSERT INTO staff (name, title, photo_path, phone, whatsapp, email, sort_order, is_active)
     VALUES (@name, @title, @photo_path, @phone, @whatsapp, @email, @sort_order, @is_active)`
  ),
  update: db.prepare(
    `UPDATE staff SET name = @name, title = @title, photo_path = @photo_path, phone = @phone,
            whatsapp = @whatsapp, email = @email, sort_order = @sort_order, is_active = @is_active
     WHERE id = @id`
  ),
  remove: db.prepare('DELETE FROM staff WHERE id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM staff'),
  maxSort: db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM staff'),
};

function fromForm(body) {
  return {
    name: String(body.name || '').trim(),
    title: String(body.title || '').trim(),
    phone: String(body.phone || '').trim(),
    whatsapp: String(body.whatsapp || '').trim(),
    email: String(body.email || '').trim(),
    sort_order: Number.parseInt(body.sort_order, 10) || 0,
    is_active: body.is_active ? 1 : 0,
  };
}

/** Digits-only form of a WhatsApp number, for wa.me links. */
function waLink(whatsapp) {
  const digits = String(whatsapp || '').replace(/\D/g, '');
  return digits ? 'https://wa.me/' + digits : '';
}

function nextSortOrder() {
  return q.maxSort.get().m + 10;
}

module.exports = { q, fromForm, waLink, nextSortOrder };
