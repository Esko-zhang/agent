'use strict';
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { ROLE_KEYS } = require('./roles');

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
                        created_by, created_by_name, staff_id)
     VALUES (@username, @password_hash, @display_name, @role, @is_active,
             @created_by, @created_by_name, @staff_id)`
  ),
  update: db.prepare(
    `UPDATE users SET display_name = @display_name, role = @role,
            is_active = @is_active, staff_id = @staff_id
     WHERE id = @id`
  ),
  // Customers issued by one sales account, for its own view and for the
  // "who looks after this customer" lookup on the inquiry page.
  createdBy: db.prepare('SELECT * FROM users WHERE created_by = ? ORDER BY username COLLATE NOCASE'),
  setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
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

function create({
  username,
  password,
  display_name = '',
  role = 'user',
  is_active = 1,
  createdBy = null,
  staff_id = null,
}) {
  return q.insert.run({
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
  wouldRemoveLastAdmin,
  accountManagerOf,
  BCRYPT_ROUNDS,
};
