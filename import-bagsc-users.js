/**
 * Import users from participant_list.txt into Supabase/PostgreSQL
 * Run: node import-bagsc-users.js
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const { dbRun, dbGet, dbAll, closePool } = require('./db');

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

async function importUsers() {
  const content = fs.readFileSync('./participant_list.txt', 'utf8');
  const lines = content.split('\n').filter(line => line.trim());

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const line of lines) {
    const nameMatch = line.match(/Name:\s*(.+?)\s*\|/);
    const idMatch = line.match(/ID:\s*(BAGSC[X]?\d+)/i);
    const pinMatch = line.match(/PIN:\s*(\d+)/);

    if (nameMatch && idMatch && pinMatch) {
      const name = nameMatch[1].trim();
      const registrationNumber = idMatch[1].toUpperCase();
      const pin = pinMatch[1];
      const id = generateId();

      try {
        const existing = await dbGet(
          'SELECT id FROM users WHERE registration_number = ?',
          [registrationNumber]
        );

        if (existing) {
          console.log(`⏭ Skipped (exists): ${name} (${registrationNumber})`);
          skipped++;
          continue;
        }

        const pinHash = await bcrypt.hash(pin, 10);

        await dbRun(
          `INSERT INTO users (id, registration_number, name, pin_hash, accommodation, active)
           VALUES (?, ?, ?, ?, 'Y', 1)
           ON CONFLICT (registration_number) DO NOTHING`,
          [id, registrationNumber, name, pinHash]
        );

        // Create meal allocations for the user (Y=12 meals per type)
        const mealTypes = await dbAll('SELECT id FROM meal_types WHERE active = 1');
        for (const mt of mealTypes) {
          const allocId = generateId();
          try {
            await dbRun(
              `INSERT INTO meal_allocations (id, user_id, meal_type_id, allocated, remaining)
               VALUES (?, ?, ?, 12, 12)
               ON CONFLICT (user_id, meal_type_id) DO NOTHING`,
              [allocId, id, mt.id]
            );
          } catch (allocErr) {
            console.error(`  ⚠ Meal allocation failed for ${registrationNumber}/${mt.id}: ${allocErr.message}`);
          }
        }

        console.log(`✓ Added: ${name} (${registrationNumber})`);
        imported++;
      } catch (err) {
        console.error(`✗ Error inserting ${registrationNumber}: ${err.message}`);
        errors++;
      }
    }
  }

  console.log(`\n✅ Import complete: ${imported} users added, ${skipped} skipped, ${errors} errors`);
  await closePool();
}

importUsers().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
