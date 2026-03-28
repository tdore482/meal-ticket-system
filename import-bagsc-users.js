const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');

const db = new sqlite3.Database('./meal_system.db');

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

const content = fs.readFileSync('./participant_list.txt', 'utf8');
const lines = content.split('\n').filter(line => line.trim());

let processed = 0;
let errors = 0;

db.serialize(() => {
  const stmt = db.prepare(`INSERT OR IGNORE INTO users (id, registration_number, name, pin_hash, active) VALUES (?, ?, ?, ?, 1)`);

  lines.forEach(line => {
    const nameMatch = line.match(/Name:\s*(.+?)\s*\|/);
    const idMatch = line.match(/ID:\s*(BAGSC[X]?\d+)/i);
    const pinMatch = line.match(/PIN:\s*(\d+)/);

    if (nameMatch && idMatch && pinMatch) {
      const name = nameMatch[1].trim();
      const registrationNumber = idMatch[1].toUpperCase();
      const pin = pinMatch[1];
      const id = generateId();
      const pinHash = bcrypt.hashSync(pin, 10);

      stmt.run(id, registrationNumber, name, pinHash, (err) => {
        if (err) {
          console.error(`Error inserting ${registrationNumber}: ${err.message}`);
          errors++;
        } else {
          console.log(`✓ Added: ${name} (${registrationNumber})`);
        }
        processed++;
      });
    }
  });

  stmt.finalize((err) => {
    if (err) console.error('Finalize error:', err);
    
    setTimeout(() => {
      db.close(() => {
        console.log(`\n✅ Import complete: ${processed - errors} users added, ${errors} errors`);
      });
    }, 500);
  });
});
