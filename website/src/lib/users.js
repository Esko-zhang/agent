'use strict';
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { ROLE_KEYS } = require('./roles');
const geo = require('./geo');

const BCRYPT_ROUNDS = 12;

const q = {
  byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  byUsername: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
  list: db.prepare('SELECT * FROM users ORDER BY role DESC, username COLLATE NOCASE'),
  countActiveAdmins: db.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1"
  ),
  insert: db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role, is_active,
                        created_by, created_by_name, staff_id,
                        company, email, phone, whatsapp, country)
     VALUES (@username, @password_hash, @display_name, @role, @is_active,
             @created_by, @created_by_name, @staff_id,
             @company, @email, @phone, @whatsapp, @country)`
  ),
  update: db.prepare(
    `UPDATE users SET display_name = @display_name, role = @role,
            is_active = @is_active, staff_id = @staff_id,
            company = @company, email = @email, phone = @phone,
            whatsapp = @whatsapp, country = @country
     WHERE id = @id`
  ),
  // Customers issued by one sales account, for its own view and for the
  // "who looks after this customer" lookup on the inquiry page.
  createdBy: db.prepare('SELECT * FROM users WHERE created_by = ? ORDER BY username COLLATE NOCASE'),
  // Resetting a password must also end the sessions that password protected,
  // or the obvious response to a stolen account does nothing for 12 hours.
  setPassword: db.prepare(
    'UPDATE users SET password_hash = ?, session_epoch = session_epoch + 1 WHERE id = ?'
  ),
  setContact: db.prepare(
    `UPDATE users SET company = @company, email = @email, phone = @phone,
            whatsapp = @whatsapp, country = @country
     WHERE id = @id`
  ),
  touchLogin: db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?"),
  remove: db.prepare('DELETE FROM users WHERE id = ?'),
};

function hashPassword(plain) {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}

/** Returns the user row on success, or null. Inactive accounts cannot log in. */
function verifyLogin(username, password) {
  const user = q.byUsername.get(String(username || '').trim());
  if (!user) {
    // Equalise timing so a missing username is not faster than a wrong password.
    bcrypt.compareSync(String(password || ''), '$2b$12$' + 'x'.repeat(53));
    return null;
  }
  if (!bcrypt.compareSync(String(password || ''), user.password_hash)) return null;
  if (!user.is_active) return { blocked: true };
  return user;
}

/**
 * Contact details, normalised the same way whether they arrive from the
 * account form or from a backfill. The country is stored as an ISO code so the
 * directory can group by it and show a flag; free text that cannot be matched
 * to a country is dropped rather than stored as a guess.
 */
function contactFields(input = {}) {
  const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const country = text(input.country, 64);
  return {
    company: text(input.company, 120),
    email: text(input.email, 160).toLowerCase(),
    phone: text(input.phone, 40),
    whatsapp: text(input.whatsapp, 40),
    country: /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : geo.resolve(country),
  };
}

/**
 * A message when the contact details cannot be stored as typed, else null.
 * `raw` is the untouched form body, so a country name we failed to match can
 * be reported instead of quietly disappearing.
 */
function contactError(fields, raw = {}) {
  if (fields.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.email)) {
    return '邮箱格式不正确，请填写 name@example.com 这样的地址。';
  }
  for (const [key, label] of [['phone', '电话'], ['whatsapp', 'WhatsApp']]) {
    if (fields[key] && !/^[0-9+][0-9\s()\-]{4,}$/.test(fields[key])) {
      return `${label}号码只能包含数字、空格和 + ( ) - 符号，且至少 5 位。`;
    }
  }
  if (!fields.country && String(raw.country == null ? '' : raw.country).trim()) {
    return '无法识别填写的国家/地区，请从输入框的下拉建议中选择，或填写两位国家代码（如 US、BD）。';
  }
  return null;
}

/** Writes contact details only, leaving the account's role and status alone. */
function setContact(id, input) {
  const f = contactFields(input);
  q.setContact.run({ ...f, id });
  return f;
}

function create({
  username,
  password,
  display_name = '',
  role = 'user',
  is_active = 1,
  createdBy = null,
  staff_id = null,
  contact = {},
}) {
  return q.insert.run({
    ...contactFields(contact),
    username: String(username).trim(),
    password_hash: hashPassword(password),
    display_name: display_name || '',
    // Validate against the role list rather than a hardcoded pair — the old
    // `role === 'admin' ? 'admin' : 'user'` silently downgraded every sales
    // account to a customer.
    role: ROLE_KEYS.includes(role) ? role : 'user',
    is_active: is_active ? 1 : 0,
    created_by: createdBy ? createdBy.id : null,
    // Copied in so the record survives the issuing account being renamed.
    created_by_name: createdBy ? createdBy.display_name || createdBy.username : '',
    staff_id: staff_id || null,
  });
}

/**
 * The sales account that issued this customer's login, with its contact card
 * if one is linked. Returns null for accounts issued by an administrator or
 * created before ownership was tracked.
 */
function accountManagerOf(user) {
  if (!user || !user.created_by) return null;
  const owner = q.byId.get(user.created_by);
  if (!owner || owner.role !== 'sales' || !owner.is_active) return null;
  let card = null;
  if (owner.staff_id) {
    card = db.prepare('SELECT * FROM staff WHERE id = ? AND is_active = 1').get(owner.staff_id);
  }
  return { owner, card };
}

/** Guards against locking everyone out of the backend. */
function wouldRemoveLastAdmin(userId, { role, is_active }) {
  const current = q.byId.get(userId);
  if (!current || current.role !== 'admin' || !current.is_active) return false;
  const stillAdmin = role === 'admin' && is_active;
  if (stillAdmin) return false;
  return q.countActiveAdmins.get().n <= 1;
}

module.exports = {
  q,
  hashPassword,
  verifyLogin,
  create,
  contactFields,
  contactError,
  setContact,
  wouldRemoveLastAdmin,
  accountManagerOf,
  BCRYPT_ROUNDS,
};
