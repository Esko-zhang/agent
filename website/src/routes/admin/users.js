'use strict';
const express = require('express');
const users = require('../../lib/users');

const router = express.Router();
const MIN_PASSWORD = 8;

router.get('/', (_req, res) => {
  res.render('admin/users', { nav: 'users', rows: users.q.list.all(), error: null });
});

const reRender = (res, status, error) =>
  res.status(status).render('admin/users', { nav: 'users', rows: users.q.list.all(), error });

// Accounts are created here only — there is deliberately no self-registration.
router.post('/', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[A-Za-z0-9._@-]{3,32}$/.test(username)) {
    return reRender(res, 400, '账号需为 3-32 位字母、数字或 . _ @ - 符号。');
  }
  if (password.length < MIN_PASSWORD) {
    return reRender(res, 400, `密码至少需要 ${MIN_PASSWORD} 位。`);
  }
  if (users.q.byUsername.get(username)) {
    return reRender(res, 400, '该账号已存在。');
  }
  users.create({
    username,
    password,
    display_name: String(req.body.display_name || '').trim(),
    role: req.body.role === 'admin' ? 'admin' : 'user',
    is_active: req.body.is_active ? 1 : 0,
  });
  res.redirect('/admin/users?ok=' + encodeURIComponent('已创建账号 ' + username));
});

router.post('/:id', (req, res, next) => {
  const target = users.q.byId.get(req.params.id);
  if (!target) return next();

  const role = req.body.role === 'admin' ? 'admin' : 'user';
  const is_active = req.body.is_active ? 1 : 0;

  if (target.id === req.user.id && (role !== 'admin' || !is_active)) {
    return reRender(res, 400, '不能撤销自己的管理员权限或停用自己的账号。');
  }
  if (users.wouldRemoveLastAdmin(target.id, { role, is_active })) {
    return reRender(res, 400, '系统必须保留至少一个启用状态的管理员账号。');
  }

  users.q.update.run({
    id: target.id,
    display_name: String(req.body.display_name || '').trim(),
    role,
    is_active,
  });
  res.redirect('/admin/users?ok=' + encodeURIComponent('已更新账号 ' + target.username));
});

router.post('/:id/password', (req, res, next) => {
  const target = users.q.byId.get(req.params.id);
  if (!target) return next();
  const password = String(req.body.password || '');
  if (password.length < MIN_PASSWORD) {
    return reRender(res, 400, `密码至少需要 ${MIN_PASSWORD} 位。`);
  }
  users.q.setPassword.run(users.hashPassword(password), target.id);
  res.redirect('/admin/users?ok=' + encodeURIComponent('已重置 ' + target.username + ' 的密码'));
});

router.post('/:id/delete', (req, res, next) => {
  const target = users.q.byId.get(req.params.id);
  if (!target) return next();
  if (target.id === req.user.id) {
    return reRender(res, 400, '不能删除自己的账号。');
  }
  if (users.wouldRemoveLastAdmin(target.id, { role: 'user', is_active: 0 })) {
    return reRender(res, 400, '系统必须保留至少一个启用状态的管理员账号。');
  }
  users.q.remove.run(target.id);
  res.redirect('/admin/users?ok=' + encodeURIComponent('已删除账号 ' + target.username));
});

module.exports = router;
