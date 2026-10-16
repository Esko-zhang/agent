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
 *
 * Sales accounts are also kept to their own book of business: a sales account
 * sees only the customers it issued, and their inquiries and intent. An
 * administrator sees everyone's.
 */
const ROLES = [
  { key: 'admin', zh: '管理员', hint: '可进入全部后台功能，并管理业务员账号' },
  { key: 'sales', zh: '业务员', hint: '可管理自己创建的用户账号，并查看这些客户的询盘、意向与访问记录' },
  { key: 'user', zh: '用户', hint: '仅浏览前台产品，看不到管理后台' },
];
const ROLE_KEYS = ROLES.map((r) => r.key);
const ROLE_LABELS = Object.fromEntries(ROLES.map((r) => [r.key, r.zh]));

/** Backend sections, and which roles may open each one. */
const SECTIONS = [
  { key: 'dashboard', path: '/admin', zh: '概览', roles: ['admin', 'sales'] },
  // Sales may draft and edit products; only an administrator publishes one,
  // deletes one, or runs the Excel import. See canPublishProducts below.
  { key: 'products', path: '/admin/products', zh: '产品管理', roles: ['admin', 'sales'] },
  { key: 'inquiries', path: '/admin/inquiries', zh: '询盘管理', roles: ['admin', 'sales'] },
  { key: 'staff', path: '/admin/staff', zh: '业务员名片', roles: ['admin'] },
  { key: 'users', path: '/admin/users', zh: '账号管理', roles: ['admin', 'sales'] },
  { key: 'intent', path: '/admin/intent', zh: '客户意向', roles: ['admin', 'sales'] },
  // Sales may read the log, but only rows belonging to their own customers;
  // the scoping lives in routes/admin/logs.js.
  { key: 'logs', path: '/admin/logs', zh: '访问记录', roles: ['admin', 'sales'] },
  // The whole customer book in one place, so it is administrators only: a
  // sales account must not read another rep's customers' contact details.
  { key: 'contacts', path: '/admin/contacts', zh: '联系方式汇总', roles: ['admin'] },
  // Who changed which product, and what it said before. Administrators only:
  // it is the record used to review what the sales accounts did.
  { key: 'changes', path: '/admin/changes', zh: '产品变更记录', roles: ['admin'] },
  { key: 'settings', path: '/admin/settings', zh: '网站设置', roles: ['admin'] },
];

const isAdmin = (user) => !!user && user.role === 'admin';
/**
 * The catalogue is one shared list facing every customer, so the irreversible
 * half of product management stays with administrators: putting a product in
 * front of customers, removing one for good, deleting an attached document,
 * and the bulk Excel import that can rewrite many rows at once. A sales
 * account drafts and edits; the administrator reviews and publishes.
 */
const canPublishProducts = (user) => isAdmin(user);
const canDeleteProducts = (user) => isAdmin(user);
const canImportProducts = (user) => isAdmin(user);
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
 * Whether `actor` may modify `target`. Sales may only touch the customers it
 * issued itself; an administrator may touch anyone.
 */
function canManageAccount(actor, target) {
  if (!actor || !target) return false;
  if (isAdmin(actor)) return true;
  if (isSales(actor)) return target.role === 'user' && target.created_by === actor.id;
  return false;
}

/** Filters a list of accounts down to the ones `actor` is responsible for. */
function ownedAccounts(actor, accounts) {
  if (isAdmin(actor)) return accounts;
  if (isSales(actor)) {
    return accounts.filter((u) => u.role === 'user' && u.created_by === actor.id);
  }
  return [];
}

/**
 * True when `actor` may look at records belonging to the account named
 * `username` — used by the inquiry inbox and the intent view, which are keyed
 * by username rather than id.
 */
function canSeeCustomer(actor, username, accountsByName) {
  if (isAdmin(actor)) return true;
  if (!isSales(actor)) return false;
  const u = accountsByName[String(username || '').toLowerCase()];
  return !!u && u.role === 'user' && u.created_by === actor.id;
}

module.exports = {
  canPublishProducts,
  canDeleteProducts,
  canImportProducts,
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
  ownedAccounts,
  canSeeCustomer,
};
