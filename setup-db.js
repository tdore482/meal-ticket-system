/**
 * Setup database schema on Supabase/PostgreSQL
 * Run: node setup-db.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool, rawQuery, closePool } = require('./db');

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

async function setup() {
  console.log('🔧 Setting up database schema on Supabase...\n');

  try {
    const schemaSQL = fs.readFileSync(
      path.join(__dirname, 'schema-postgres.sql'),
      'utf8'
    );

    await rawQuery(schemaSQL);
    console.log('✅ Schema created successfully');

    // Seed meal types
    const mealTypes = [
      { id: 'MT001', name: 'Breakfast', start: '06:00', end: '10:00' },
      { id: 'MT002', name: 'Lunch', start: '11:00', end: '16:00' },
      { id: 'MT003', name: 'Supper', start: '20:00', end: '23:00' },
    ];

    for (const mt of mealTypes) {
      await rawQuery(
        `INSERT INTO meal_types (id, name, start_time, end_time, active)
         VALUES ($1, $2, $3, $4, 1)
         ON CONFLICT (id) DO NOTHING`,
        [mt.id, mt.name, mt.start, mt.end]
      );
    }
    console.log('✅ Meal types seeded');

    // Seed admin
    const adminId = generateId();
    const adminHash = await bcrypt.hash('admin123', 10);
    await rawQuery(
      `INSERT INTO admins (id, username, password_hash, active)
       VALUES ($1, 'admin', $2, 1)
       ON CONFLICT (username) DO NOTHING`,
      [adminId, adminHash]
    );
    console.log('✅ Admin account created (admin / admin123)');

    // Seed vendors
    const vendors = [
      { name: 'Koinonia', code: 'koinonia' },
      { name: 'BAGSC Catering', code: 'bagsc_catering' },
      { name: 'Cafeteria A', code: 'cafe_a' },
      { name: 'Food Court B', code: 'food_b' },
    ];

    for (const v of vendors) {
      const vId = generateId();
      await rawQuery(
        `INSERT INTO vendors (id, name, vendor_code, active)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (vendor_code) DO NOTHING`,
        [vId, v.name, v.code]
      );
    }
    console.log('✅ Vendors seeded');

    // Seed test events
    const events = [
      { id: 'EV' + generateId().slice(0, 6).toUpperCase(), name: 'BAGSC TESTING', start: '2026-02-16', end: '2026-02-20' },
      { id: 'EV' + generateId().slice(0, 6).toUpperCase(), name: 'BAGSC 2026', start: '2026-02-17', end: '2026-02-20' },
    ];

    for (const e of events) {
      await rawQuery(
        `INSERT INTO events (id, name, start_date, end_date, active)
         VALUES ($1, $2, $3, $4, 1)
         ON CONFLICT (id) DO NOTHING`,
        [e.id, e.name, e.start, e.end]
      );
    }
    console.log('✅ Test events seeded');

    console.log('\n✨ Database setup complete!');
  } catch (err) {
    console.error('❌ Setup failed:', err.message);
    process.exit(1);
  } finally {
    await closePool();
  }
}

setup();
