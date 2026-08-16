/**
 * PostgreSQL index creation script
 * Run: node add-indexes-postgres.js
 * Safe to run repeatedly - uses IF NOT EXISTS
 */
require('dotenv').config();

const { pool } = require('./db');

const indexes = [
  // Sessions - used for every authenticated request
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,

  // QR Tokens - user lookups and validation
  `CREATE INDEX IF NOT EXISTS idx_qr_tokens_user ON qr_tokens(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_qr_tokens_user_created ON qr_tokens(user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_qr_tokens_used ON qr_tokens(used, expires_at)`,

  // Transactions - used for daily reports and reconciliation
  `CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_vendor ON transactions(vendor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_user_meal ON transactions(user_id, meal_type_id)`,

  // Event Consumptions - event detail and consumption reports
  `CREATE INDEX IF NOT EXISTS idx_event_consumptions_event_user_meal ON event_consumptions(event_id, user_id, meal_type_id)`,
  `CREATE INDEX IF NOT EXISTS idx_event_consumptions_event_user ON event_consumptions(event_id, user_id)`,

  // Meal Allocations - user detail, bulk import, reconciliation
  `CREATE INDEX IF NOT EXISTS idx_meal_allocations_user ON meal_allocations(user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_meal_allocations_user_meal ON meal_allocations(user_id, meal_type_id)`,

  // Events - list ordering
  `CREATE INDEX IF NOT EXISTS idx_events_start_date ON events(start_date DESC)`,

  // Users - admin list ordering
  `CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC)`,

  // Event Registrations - user-side queries
  `CREATE INDEX IF NOT EXISTS idx_event_registrations_user ON event_registrations(user_id)`,
];

(async () => {
  console.log('Adding PostgreSQL indexes...\n');
  let ok = 0;
  let fail = 0;
  for (const sql of indexes) {
    try {
      await pool.query(sql);
      const nameMatch = sql.match(/(?:idx|uq)_[a-z_]+/);
      console.log(`OK   ${nameMatch ? nameMatch[0] : sql.slice(0, 50)}`);
      ok++;
    } catch (err) {
      console.log(`FAIL ${sql.slice(0, 60)}... -> ${err.message}`);
      fail++;
    }
  }
  console.log(`\nDone: ${ok} created/verified, ${fail} failed`);
  await pool.end();
})();
