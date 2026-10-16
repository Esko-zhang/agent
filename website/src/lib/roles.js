'use strict';

/**
 * Three roles, from the owner's brief:
 *
 *   admin 管理员  — the whole backend. Creates and manages sales accounts.
 *   sales 业务员  — creates and manages customer accounts, and works the
 *                   inquiries and intent those customers generate.
 *   user  用户    — the catalogue only. Never sees the backend, and the
 *                   "管理后台" button is not rendered for them at all.
 *
 * A sales account must never be able to widen its own reach, so it cannot
 * create, edit, or delete anything but customer accounts, and cannot hand out
 * the admin or sales role.
 */
const ROLES = [
  { key: 'admin', zh: '管理员', hint: '可进入全部后台功能，并管理业务员账号' },
  { key: 'sales', zh: '业务员', hint: '可管理用户账号，查看询盘与客户意向' },
  { key: 'user', zh: '用户', hint: '仅浏览前台产品，看不到管理后台' },
];
const ROLE_KEYS = ROLES.map((r) => r.key);
const ROLE_LABELS = Object.fromEntries(ROLES.map((r) => [r.key, r.zh]));

/** Backend sections, and which roles may open each one. */
const SECTIONS = [
  { key: 'dashboard', path: '/admin', zh: '概览', roles: ['admin', 'sales'] },
  { key: 'products', path: '/admin/products', zh: '产品管理', roles: ['admin'] },
  { key: 'inquiries', path: '/admin/inquiries', zh: '询盘管理', roles: ['admin', 'sales'] },
  { key: 'staff', path: '/admin/staff', zh: '业务员名片', roles: ['admin'] },
  { key: 'users', path: '/admin/users', zh: '账号管理', roles: ['admin', 'sales'] },
  { key: 'intent', path: '/admin/intent', zh: '客户意向', roles: ['admin', 'sales'] },
  { key: 'logs', path: '/admin/logs', zh: '访问记录', roles: ['admin'] },
  { key: 'settings', path: '/admin/settings', zh: '网站设置', roles: ['admin'] },
];

const isAdmin = (user) => !!user && user.role === 'admin';
const isSales = (user) => !!user && user.role === 'sales';
/** Anyone who may open the backend at all. */
const hasBackend = (user) => isAdmin(user) || isSales(user);

function canSee(user, sectionKey) {
  const s = SECTIONS.find((x) => x.key === sectionKey);
  return !!s && !!user && s.roles.includes(user.role);
}

function sectionsFor(user) {
  return SECTIONS.filter((s) => user && s.roles.includes(user.role));
}

/** Which roles this account is allowed to hand out when creating an account. */
function assignableRoles(user) {
  if (isAdmin(user)) return ROLE_KEYS;
  if (isSales(user)) return ['user'];
  return [];
}

/** Which accounts this one may see and act on in 账号管理. */
function managedRoles(user) {
  if (isAdmin(user)) return ROLE_KEYS;
  if (isSales(user)) return ['user'];
  return [];
}

/**
 * Whether `actor` may modify `target`. Sales may only touch customers, and
 * nobody may act on an account whose role they could not create.
 */
function canManageAccount(actor, target) {
  if (!actor || !target) return false;
  if (isAdmin(actor)) return true;
  if (isSales(actor)) return target.role === 'user';
  return false;
}

module.exports = {
  ROLES,
  ROLE_KEYS,
  ROLE_LABELS,
  SECTIONS,
  isAdmin,
  isSales,
  hasBackend,
  canSee,
  sectionsFor,
  assignableRoles,
  managedRoles,
  canManageAccount,
};
