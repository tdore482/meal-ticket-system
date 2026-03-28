const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./meal_system.db');

db.all("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL", [], (err, rows) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('=== EXISTING INDEXES ===');
    if (rows.length === 0) {
      console.log('No custom indexes found (only primary keys)');
    } else {
      rows.forEach(r => console.log(r.name + ': ' + r.sql));
    }
  }
  
  console.log('\n=== TABLE SIZES ===');
  const tables = ['users', 'vendors', 'admins', 'meal_types', 'meal_allocations', 'sessions', 'qr_tokens', 'transactions', 'events', 'event_registrations', 'event_qr_tokens', 'event_consumptions'];
  
  let pending = tables.length;
  tables.forEach(table => {
    db.get(`SELECT COUNT(*) as count FROM ${table}`, [], (err, row) => {
      console.log(`${table}: ${row.count} rows`);
      if (--pending === 0) db.close();
    });
  });
});
