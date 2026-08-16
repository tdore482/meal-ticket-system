/**
 * Scrub user database: remove all accounts except Admin, designated Test
 * accounts, and active Vendor accounts.
 *
 * Backup affected rows to db-backup/ before deleting, then delete in
 * FK-safe order. Run: node scrub-users.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { dbAll, dbGet, getClient, closePool } = require('./db');

const BACKUP_DIR = path.join(__dirname, 'db-backup');
const KEEP_TEST_PREFIXES = ['TESTACC', 'FINALTEST'];

async function backup(name, rows) {
  const file = path.join(BACKUP_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
  console.log(`  backup ${name}: ${rows.length} rows -> ${file}`);
}

async function run() {
  const users = await dbAll('SELECT * FROM users ORDER BY registration_number');

  const keepUsers = users.filter(u =>
    KEEP_TEST_PREFIXES.some(p => String(u.registration_number).toUpperCase().startsWith(p))
  );
  const keepIds = new Set(keepUsers.map(u => u.id));

  const toDelete = users.filter(u => !keepIds.has(u.id));
  const toDeleteIds = toDelete.map(u => u.id);

  console.log(`Users total: ${users.length}`);
  console.log(`  keep (test accounts): ${keepUsers.map(u => u.registration_number).join(', ') || 'none'}`);
  console.log(`  to delete: ${toDelete.length}`);
  toDelete.forEach(u => console.log(`    ${u.registration_number} | ${u.name}`));

  if (toDelete.length === 0) {
    console.log('Nothing to delete.');
    await closePool();
    return;
  }

  await backup('users_deleted', toDelete);

  const related = {};
  for (const table of ['meal_allocations', 'sessions', 'qr_tokens', 'transactions', 'event_registrations', 'event_qr_tokens', 'event_consumptions']) {
    const rows = await dbAll(`SELECT * FROM ${table} WHERE user_id = ANY($1)`, [toDeleteIds]);
    related[table] = rows;
    await backup(`users_deleted_${table}`, rows);
  }

  const keepAdmin = await dbAll('SELECT * FROM admins');
  await backup('admins_kept', keepAdmin);
  const keepVendors = await dbAll('SELECT * FROM vendors WHERE active = 1');
  await backup('vendors_active_kept', keepVendors);
  const keepUsersBackup = await dbAll('SELECT * FROM users WHERE id = ANY($1)', [[...keepIds]]);
  await backup('users_kept', keepUsersBackup);

  console.log('\nBackups written to', BACKUP_DIR);
  console.log('Performing deletes...');

  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const table of ['event_consumptions', 'event_qr_tokens', 'event_registrations', 'transactions', 'qr_tokens', 'sessions', 'meal_allocations']) {
      const res = await client.query(`DELETE FROM ${table} WHERE user_id = ANY($1)`, [toDeleteIds]);
      console.log(`  deleted ${table}: ${res.rowCount}`);
    }
    const del = await client.query('DELETE FROM users WHERE id = ANY($1)', [toDeleteIds]);
    console.log(`  deleted users: ${del.rowCount}`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const after = await dbGet('SELECT COUNT(*) AS cnt FROM users');
  console.log(`\nUsers remaining: ${after.cnt}`);
  const remaining = await dbAll('SELECT registration_number FROM users ORDER BY registration_number');
  remaining.forEach(u => console.log(`  ${u.registration_number}`));
  await closePool();
}

run().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
