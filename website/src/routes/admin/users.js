'use strict';
const express = require('express');
const users = require('../../lib/users');
const roles = require('../../lib/roles');

const router = express.Router();
const MIN_PASSWORD = 8;

/** Only the accounts this role is allowed to see. */
function visibleTo(actor) {
  const allowed = roles.managedRoles(actor);
  return users.q.list.all().filter((u) => allowed.includes(u.role));
}

function view(req, res, status, error) {
  return res.status(status).render('admin/users', {
    nav: 'users',
    rows: visibleTo(req.user),
    error,
    assignable: roles.assignableRoles(req.user),
    roleLabels: roles.ROLE_LABELS,
    allRoles: roles.ROLES,
    canAssignRoles: roles.isAdmin(req.user),
  });
}

router.get('/', (req, res) => view(req, res, 200, null));

/** Accounts are created here only — there is deliberately no self-registration. */
router.post('/', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const assignable = roles.assignableRoles(req.user);
  // A sales account may only ever create customers, whatever the form posts.
  const role = assignable.includes(req.body.role) ? req.body.role : assignable[0];

  if (!role) return view(req, res, 403, '当前账号无权创建账号。');
  if (!/^[A-Za-z0-9._@-]{3,32}$/.test(username)) {
    return view(req, res, 400, '账号需为 3-32 位字母、数字或 . _ @ - 符号。');
  }
  if (password.length < MIN_PASSWORD) {
    return view(req, res, 400, `密码至少需要 ${MIN_PASSWORD} 位。`);
  }
  if (users.q.byUsername.get(username)) {
    return view(req, res, 400, '该账号已存在。');
  }

  users.create({
    username,
    password,
    display_name: String(req.body.display_name || '').trim(),
    role,
    is_active: req.body.is_active ? 1 : 0,
  });
  res.redirect(
    '/admin/users?ok=' +
      encodeURIComponent(`已创建${roles.ROLE_LABELS[role]}账号 ${username}`)
  );
});

router.post('/:id', (req, res, next) => {
  const target = users.q.byId.get(req.params.id);
  if (!target) return next();
  if (!roles.canManageAccount(req.user, target)) {
    return view(req, res, 403, '无权修改该账号。');
  }

  // Sales cannot change a role at all; admin may set any role.
  const assignable = roles.assignableRoles(req.user);
  const role = roles.isAdmin(req.user)
    ? (assignable.includes(req.body.role) ? req.body.role : target.role)
    : target.role;
  const is_active = req.body.is_active ? 1 : 0;

  if (target.id === req.user.id && (role !== req.user.role || !is_active)) {
    return view(req, res, 400, '不能修改自己的角色或停用自己的账号。');
  }
  if (users.wouldRemoveLastAdmin(target.id, { role, is_active })) {
    return view(req, res, 400, '系统必须保留至少一个启用状态的管理员账号。');
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
  if (!roles.canManageAccount(req.user, target)) {
    return view(req, res, 403, '无权重置该账号的密码。');
  }
  const password = String(req.body.password || '');
  if (password.length < MIN_PASSWORD) {
    return view(req, res, 400, `密码至少需要 ${MIN_PASSWORD} 位。`);
  }
  users.q.setPassword.run(users.hashPassword(password), target.id);
  res.redirect(
    '/admin/users?ok=' + encodeURIComponent('已重置 ' + target.username + ' 的密码')
  );
});

router.post('/:id/delete', (req, res, next) => {
  const target = users.q.byId.get(req.params.id);
  if (!target) return next();
  if (!roles.canManageAccount(req.user, target)) {
    return view(req, res, 403, '无权删除该账号。');
  }
  if (target.id === req.user.id) {
    return view(req, res, 400, '不能删除自己的账号。');
  }
  if (users.wouldRemoveLastAdmin(target.id, { role: 'user', is_active: 0 })) {
    return view(req, res, 400, '系统必须保留至少一个启用状态的管理员账号。');
  }
  users.q.remove.run(target.id);
  res.redirect('/admin/users?ok=' + encodeURIComponent('已删除账号 ' + target.username));
});

module.exports = router;
