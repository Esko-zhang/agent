#!/usr/bin/env node
'use strict';
/**
 * Loads demo products, sales reps and page copy so a fresh install can be
 * previewed with a populated catalogue instead of empty tables.
 *
 * This is sample data only — clear it before going live:
 *   node scripts/seed-demo.js --clear
 */
const { db } = require('../src/db');
const products = require('../src/lib/products');
const staff = require('../src/lib/staff');
const settings = require('../src/lib/settings');

const DEMO_PRODUCTS = [
  { category: 'oem', name_en: 'Vitamin C 1000mg Tablets', dosage_form: 'Tablet',
    spec: '1000mg x 60 tablets', tags: 'Immune Support, Best Seller, Private Label',
    remark: 'MOQ 5,000 bottles' },
  { category: 'oem', name_en: 'Collagen Peptide Gummies', dosage_form: 'Gummy',
    spec: '2g x 60 gummies', tags: 'Beauty, Sugar-Free',
    remark: 'Custom flavour and shape available' },
  { category: 'oem', name_en: 'Probiotic Capsules 10 Billion CFU', dosage_form: 'Capsule',
    spec: '500mg x 30 capsules', tags: 'Gut Health, Shelf-Stable',
    remark: 'Room-temperature stable for 24 months' },
  { category: 'extract', name_en: 'Green Tea Extract', content: 'EGCG 50%', ratio: '10:1',
    remark: 'Water soluble' },
  { category: 'extract', name_en: 'Turmeric Root Extract', content: 'Curcumin 95%', ratio: '20:1',
    remark: 'Solvent-free extraction' },
  { category: 'extract', name_en: 'Grape Seed Extract', content: 'OPC 95%', ratio: '100:1',
    remark: 'Low residual solvent' },
  { category: 'additive', name_en: 'Sodium Citrate', dosage_form: 'Powder', cas_no: '68-04-2',
    remark: 'Food grade, FCC' },
  { category: 'additive', name_en: 'Citric Acid Anhydrous', dosage_form: 'Granular',
    cas_no: '77-92-9', remark: 'Food grade, 25kg bags' },
  { category: 'additive', name_en: 'Xanthan Gum', dosage_form: 'Powder', cas_no: '11138-66-2',
    remark: '80 mesh, food grade' },
];

const DEMO_STAFF = [
  { name: 'Lisa Wang', title: 'Sales Manager', phone: '+86 138 0000 1111',
    whatsapp: '+86 138 0000 1111', email: 'lisa@example.com' },
  { name: 'Kevin Zhao', title: 'Export Sales', phone: '+86 139 2222 3333',
    whatsapp: '+86 139 2222 3333', email: 'kevin@example.com' },
  { name: 'Amy Chen', title: 'Technical Support', phone: '+86 137 4444 5555',
    whatsapp: '+86 137 4444 5555', email: 'amy@example.com' },
];

const clear = process.argv.includes('--clear');
const force = process.argv.includes('--force');

if (clear) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM products').run();
    db.prepare('DELETE FROM staff').run();
  });
  tx();
  console.log('✓ Demo products and sales reps removed. Accounts and settings kept.');
  return;
}

const existing =
  db.prepare('SELECT COUNT(*) AS n FROM products').get().n +
  db.prepare('SELECT COUNT(*) AS n FROM staff').get().n;

if (existing > 0 && !force) {
  console.log(`The database already holds ${existing} product/sales-rep record(s).`);
  console.log('Nothing was changed. Use --force to add the demo data anyway,');
  console.log('or --clear to remove all products and sales reps first.');
  return;
}

const seed = db.transaction(() => {
  DEMO_PRODUCTS.forEach((p, i) => {
    products.q.insert.run({
      ...products.fromForm({ ...p, is_active: '1' }),
      image_path: '',
      sort_order: (i + 1) * 10,
    });
  });
  DEMO_STAFF.forEach((m, i) => {
    staff.q.insert.run({
      ...staff.fromForm({ ...m, is_active: '1' }),
      photo_path: '',
      sort_order: (i + 1) * 10,
    });
  });
  settings.setMany({
    login_tagline: 'Health Ingredients & OEM Manufacturing',
    products_intro:
      'Browse our OEM finished products, plant extracts and food additives. Contact your sales representative for pricing.',
    contact_intro: 'Our export team replies within one business day.',
  });
});

seed();

console.log(`✓ Added ${DEMO_PRODUCTS.length} demo products and ${DEMO_STAFF.length} demo sales reps.`);
console.log('  These are samples for previewing the site. Remove them before going live:');
console.log('    node scripts/seed-demo.js --clear');
