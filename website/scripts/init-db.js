#!/usr/bin/env node
'use strict';
/**
 * Creates the database (if needed) and guarantees one admin account exists.
 * Safe to re-run: it never overwrites an existing account.
 */
const crypto = require('crypto');
const config = require('../src/config');
const { migrate } = require('../src/db');
const users = require('../src/lib/users');

migrate();

const { username } = config.bootstrapAdmin;
const existing = users.q.byUsername.get(username);

if (existing) {
  console.log(`✓ Admin account "${username}" already exists — nothing to do.`);
} else {
  const generated = !config.bootstrapAdmin.password;
  const password = config.bootstrapAdmin.password || crypto.randomBytes(9).toString('base64url');
  users.create({
    username,
    password,
    display_name: 'Administrator',
    role: 'admin',
    is_active: 1,
  });
  console.log(`✓ Created admin account "${username}".`);
  if (generated) {
    console.log(`  Generated password: ${password}`);
    console.log('  Store it now — it is not shown again. Change it after first sign-in.');
  } else {
    console.log('  Password taken from ADMIN_PASSWORD.');
  }
}

console.log(`Database: ${config.dbFile}`);
