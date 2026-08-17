const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./meal_system.db');
const crypto = require('crypto');

function generateId() {
    return crypto.randomBytes(8).toString('hex');
}

function generateToken() {
    return crypto.randomBytes(10).toString('hex').toUpperCase();
}

db.serialize(async () => {
    console.log('🚀 Starting "Maximum Redemptions" Optimization...\n');

    // 0. MIGRATE: Remove UNIQUE constraint from event_consumptions
    // This allows users to eat e.g. Breakfast on Day 1, 2, and 3.
    console.log('🔄 Relaxing table constraints...');
    await new Promise((resolve) => {
        db.run(`CREATE TABLE IF NOT EXISTS event_consumptions_old AS SELECT * FROM event_consumptions`, () => {
            db.run(`DROP TABLE IF EXISTS event_consumptions`, () => {
                db.run(`
                    CREATE TABLE event_consumptions (
                      id TEXT PRIMARY KEY,
                      event_id TEXT NOT NULL,
                      user_id TEXT NOT NULL,
                      meal_type_id TEXT NOT NULL,
                      consumed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                      vendor_id TEXT,
                      FOREIGN KEY (event_id) REFERENCES events(id),
                      FOREIGN KEY (user_id) REFERENCES users(id),
                      FOREIGN KEY (meal_type_id) REFERENCES meal_types(id),
                      FOREIGN KEY (vendor_id) REFERENCES vendors(id)
                    )
                `, () => {
                    db.run(`INSERT OR IGNORE INTO event_consumptions SELECT * FROM event_consumptions_old`, () => {
                        db.run(`DROP TABLE IF EXISTS event_consumptions_old`, () => {
                            console.log('  - TABLE MIGRATED: You can now redeem same meal types multiple times.');
                            resolve();
                        });
                    });
                });
            });
        });
    });

    // 1. Ensure all users have allocations for all active meal types
    console.log('📦 Synchronizing meal allocations...');
    db.all('SELECT id FROM meal_types WHERE active = 1', [], (err, mealTypes) => {
        if (err) return console.error(err);

        db.all('SELECT id FROM users WHERE active = 1', [], async (err, users) => {
            if (err) return console.error(err);

            let addedAlloc = 0;
            for (const user of users) {
                for (const mt of mealTypes) {
                    await new Promise((resolve) => {
                        db.run(`INSERT OR IGNORE INTO meal_allocations (id, user_id, meal_type_id, allocated, remaining) VALUES (?, ?, ?, 12, 12)`,
                            [generateId(), user.id, mt.id], function (err) {
                                if (!err && this.changes > 0) addedAlloc++;
                                resolve();
                            });
                    });
                }
            }
            console.log(`  - Added ${addedAlloc} missing meal allocations.`);

            // 2. Set ALL allocations to 12 (as requested for "maximum redemptions")
            db.run(`UPDATE meal_allocations SET allocated = 12, remaining = 12, updated_at = datetime('now')`, function (err) {
                console.log(`  - Set all ${this.changes} allocation records to 12/12.`);
            });

            // 3. Register everyone for current events
            console.log('\n📅 Registering all users for active events...');
            db.all('SELECT id FROM events WHERE active = 1', [], async (err, events) => {
                if (err) return console.error(err);

                for (const event of events) {
                    let regCount = 0;
                    for (const user of users) {
                        await new Promise((resolve) => {
                            db.run(`INSERT OR IGNORE INTO event_registrations (id, event_id, user_id) VALUES (?, ?, ?)`,
                                [generateId(), event.id, user.id], function (err) {
                                    if (!err && this.changes > 0) regCount++;
                                    resolve();
                                });
                        });
                    }
                    console.log(`  - Event ${event.id}: Registered ${regCount} new users.`);

                    // 4. Generate QR tokens for event
                    console.log(`  - Generating QR tokens for event ${event.id}...`);
                    let tokenCount = 0;
                    for (const user of users) {
                        await new Promise((resolve) => {
                            db.run(`INSERT OR IGNORE INTO event_qr_tokens (id, event_id, user_id, token) VALUES (?, ?, ?, ?)`,
                                [generateId(), event.id, user.id, generateToken()], function (err) {
                                    if (!err && this.changes > 0) tokenCount++;
                                    resolve();
                                });
                        });
                    }
                    console.log(`  - Event ${event.id}: Generated ${tokenCount} new tokens.`);
                }

                console.log('\n✅ System optimized for Maximum Redemptions.');
                console.log('   Users now have 12 legacy meals per type and are registered for all events.');
                db.close();
            });
        });
    });
});
