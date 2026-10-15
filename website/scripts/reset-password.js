#!/usr/bin/env node
'use strict';
/** Usage: node scripts/reset-password.js <username> <new-password> */
const users = require('../src/lib/users');

const [username, password] = process.argv.slice(2);

if (!username || !password) {
  console.error('Usage: node scripts/reset-password.js <username> <new-password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const user = users.q.byUsername.get(username);
if (!user) {
  console.error(`No such account: ${username}`);
  process.exit(1);
}

users.q.setPassword.run(users.hashPassword(password), user.id);
console.log(`✓ Password updated for "${user.username}".`);
