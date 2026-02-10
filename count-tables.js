const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./meal_system.db');

db.all(`SELECT name FROM sqlite_master WHERE type='table'`, (err, tables) => {
  if (err) {
    console.error(err);
    db.close();
    return;
  }

  console.log(`\nTotal tables: ${tables.length}\n`);
  
  tables.forEach((table, index) => {
    console.log(`${index + 1}. ${table.name}`);
  });

  console.log('');
  db.close();
});