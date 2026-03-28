const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./meal_system.db');

console.log('🛠️ Emergency Database Repair Starting...');

db.serialize(() => {
    // 1. Check if backup/temp table exists and cleanup
    db.run("DROP TABLE IF EXISTS event_consumptions_temp");

    // 2. Safely backup existing data if table exists
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='event_consumptions'", (err, row) => {
        if (row) {
            console.log('📦 Backing up existing event_consumptions data...');
            db.run("CREATE TABLE event_consumptions_temp AS SELECT * FROM event_consumptions", () => {
                db.run("DROP TABLE event_consumptions", createTable);
            });
        } else {
            console.log('❓ event_consumptions table missing. Creating fresh...');
            createTable();
        }
    });
});

function createTable() {
    console.log('🏗️ Creating event_consumptions table without restrictive unique constraint...');
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
    `, (err) => {
        if (err) {
            console.error('❌ Error creating table:', err.message);
            return;
        }

        // Restore data if backup exists
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='event_consumptions_temp'", (err, row) => {
            if (row) {
                console.log('🔄 Restoring data from backup...');
                db.run("INSERT OR IGNORE INTO event_consumptions SELECT * FROM event_consumptions_temp", (err) => {
                    if (err) console.error('❌ Error restoring data:', err.message);
                    db.run("DROP TABLE event_consumptions_temp");
                    finish();
                });
            } else {
                finish();
            }
        });
    });
}

function finish() {
    console.log('✅ Database repaired successfully!');
    db.close();
}
