#!/usr/bin/env node
'use strict';
/**
 * Usage: node scripts/reset-password.js <username>
 *
 * The password is typed in, not passed as an argument: an argument lands in
 * the shell history and is visible in `ps` to anyone else on the machine for
 * as long as the process runs. Piping also works, for a script that has its
 * own safe way of holding the value:
 *
 *   printf '%s' "$NEW_PASSWORD" | node scripts/reset-password.js alice
 */
const readline = require('node:readline');
const users = require('../src/lib/users');

const MIN = 8;
const [username] = process.argv.slice(2);

if (!username) {
  console.error('用法: node scripts/reset-password.js <账号>');
  process.exit(1);
}

const user = users.q.byUsername.get(username);
if (!user) {
  console.error(`没有这个账号: ${username}`);
  process.exit(1);
}

function apply(password) {
  if (password.length < MIN) {
    console.error(`密码至少需要 ${MIN} 位。`);
    process.exit(1);
  }
  users.q.setPassword.run(users.hashPassword(password), user.id);
  console.log(`✓ 已重置 "${user.username}" 的密码。`);
  // setPassword bumps session_epoch, so anything already signed in as this
  // account is signed out — which is the point of resetting it.
  console.log('  该账号已登录的会话全部失效，需要用新密码重新登录。');
}

if (!process.stdin.isTTY) {
  let piped = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { piped += d; });
  process.stdin.on('end', () => apply(piped.replace(/\r?\n$/, '')));
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Prompt written once, then every echoed keystroke suppressed.
  let muted = false;
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (s) => { if (!muted) write(s); };
  rl.question(`为 "${user.username}" 设置新密码（输入时不显示）: `, (password) => {
    muted = false;
    rl.output.write('\n');
    rl.close();
    apply(password);
  });
  muted = true;
}
