const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const db = new sqlite3.Database('./meal_system.db');

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

console.log('🔧 Creating meal allocations for users without them...\n');

db.all('SELECT id FROM meal_types WHERE active = 1', [], async (err, mealTypes) => {
  if (err) {
    console.error('Error:', err);
    process.exit(1);
  }

  if (mealTypes.length === 0) {
    console.log('No active meal types found. Please add meal types first.');
    db.close();
    process.exit(1);
  }

  const usersWithoutAllocations = await new Promise((resolve, reject) => {
    db.all(`
      SELECT u.id 
      FROM users u
      LEFT JOIN meal_allocations ma ON u.id = ma.user_id
      WHERE ma.id IS NULL
    `, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  console.log(`Found ${usersWithoutAllocations.length} users without meal allocations`);

  if (usersWithoutAllocations.length === 0) {
    console.log('✅ All users already have meal allocations');
    db.close();
    process.exit(0);
  }

  let created = 0;
  for (const user of usersWithoutAllocations) {
    for (const mealType of mealTypes) {
      const allocId = generateId();
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO meal_allocations (id, user_id, meal_type_id, allocated, remaining)
           VALUES (?, ?, ?, 20, 20)`,
          [allocId, user.id, mealType.id],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      created++;
    }
  }

  console.log(`✅ Created ${created} meal allocations for ${usersWithoutAllocations.length} users`);
  
  db.all('SELECT COUNT(*) as total FROM meal_allocations', [], (err, r) => {
    console.log(`Total meal allocations in database: ${r[0].total}`);
    db.close();
    process.exit(0);
  });
});
