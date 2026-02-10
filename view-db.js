const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./meal_system.db');

// Get all tables
db.all(`SELECT name FROM sqlite_master WHERE type='table'`, (err, tables) => {
  if (err) {
    console.error(err);
    return;
  }

  console.log('\n=== DATABASE TABLES ===\n');
  
  tables.forEach(table => {
    console.log(`\n--- ${table.name.toUpperCase()} ---`);
    
    // Get table schema
    db.all(`PRAGMA table_info(${table.name})`, (err, columns) => {
      if (err) console.error(err);
      console.log('Columns:', columns.map(c => `${c.name} (${c.type})`).join(', '));
    });

    // Get table data
    db.all(`SELECT * FROM ${table.name}`, (err, rows) => {
      if (err) console.error(err);
      console.log('Rows:', rows.length);
      console.table(rows);
    });
  });

  // Close after a short delay to let queries complete
  setTimeout(() => {
    db.close();
    console.log('\n=== END ===\n');
  }, 1000);
});