'use strict';
const bcrypt = require('bcryptjs');
const { db } = require('../db');

const BCRYPT_ROUNDS = 12;

const q = {
  byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  byUsername: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
  list: db.prepare('SELECT * FROM users ORDER BY role DESC, username COLLATE NOCASE'),
  countActiveAdmins: db.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1"
  ),
  insert: db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role, is_active)
     VALUES (@username, @password_hash, @display_name, @role, @is_active)`
  ),
  update: db.prepare(
    `UPDATE users SET display_name = @display_name, role = @role, is_active = @is_active
     WHERE id = @id`
  ),
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

function create({ username, password, display_name = '', role = 'user', is_active = 1 }) {
  return q.insert.run({
    username: String(username).trim(),
    password_hash: hashPassword(password),
    display_name: display_name || '',
    role: role === 'admin' ? 'admin' : 'user',
    is_active: is_active ? 1 : 0,
  });
}

/** Guards against locking everyone out of the backend. */
function wouldRemoveLastAdmin(userId, { role, is_active }) {
  const current = q.byId.get(userId);
  if (!current || current.role !== 'admin' || !current.is_active) return false;
  const stillAdmin = role === 'admin' && is_active;
  if (stillAdmin) return false;
  return q.countActiveAdmins.get().n <= 1;
}

module.exports = { q, hashPassword, verifyLogin, create, wouldRemoveLastAdmin, BCRYPT_ROUNDS };
