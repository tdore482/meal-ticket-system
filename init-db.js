const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const db = new sqlite3.Database('./meal_system.db');

function generateId() {
        return crypto.randomBytes(8).toString('hex');
}

// Read and execute schema
const schema = fs.readFileSync('./schema.sql', 'utf8');
const statements = schema.split(';').filter(s => s.trim());

statements.forEach(stmt => {
        if (stmt.trim()) {
                db.run(stmt, (err) => {
                        if (err) console.error('Schema error:', err);
                });
        }
});

// Insert default data
db.serialize(() => {
        // Create meal types
        db.run(`INSERT OR IGNORE INTO meal_types (id, name, start_time, end_time, active) 
          VALUES ('MT001', 'Breakfast', '06:00', '10:00', 1)`);
        db.run(`INSERT OR IGNORE INTO meal_types (id, name, start_time, end_time, active) 
          VALUES ('MT002', 'Lunch', '11:00', '16:00', 1)`);
        db.run(`INSERT OR IGNORE INTO meal_types (id, name, start_time, end_time, active) 
          VALUES ('MT003', 'Supper', '20:00', '23:00', 1)`);

        // Create users
        const pinHash1 = bcrypt.hashSync('1234', 10);
        const pinHash2 = bcrypt.hashSync('5678', 10);

        db.run(`INSERT OR IGNORE INTO users (id, registration_number, name, pin_hash, active) 
          VALUES (?, 'REG001', 'John Doe', ?, 1)`, [generateId(), pinHash1]);
        db.run(`INSERT OR IGNORE INTO users (id, registration_number, name, pin_hash, active) 
          VALUES (?, 'REG002', 'Jane Smith', ?, 1)`, [generateId(), pinHash2]);

        // Create vendors
        db.run(`INSERT OR IGNORE INTO vendors (id, name, vendor_code, active) 
          VALUES (?, 'Cafeteria A', 'cafe_a', 1)`, [generateId()]);
        db.run(`INSERT OR IGNORE INTO vendors (id, name, vendor_code, active) 
          VALUES (?, 'Food Court B', 'food_b', 1)`, [generateId()]);

        // Create admin
        const adminHash = bcrypt.hashSync('TheRealAdmin1', 10);
        db.run(`INSERT OR IGNORE INTO admins (id, username, password_hash, active) 
          VALUES (?, 'admin', ?, 1)`, [generateId(), adminHash]);

        db.close(() => {
                console.log('✅ Database initialized successfully');
                console.log('\n📋 Default Credentials:');
                console.log('  User: REG001 / PIN: 1234');
                console.log('  User: REG002 / PIN: 5678');
                console.log('  Vendor: cafe_a');
                console.log('  Admin: admin / password: TheRealAdmin1\n');
        });
});