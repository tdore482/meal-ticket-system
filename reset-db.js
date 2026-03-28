const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./meal_system.db');

db.serialize(() => {
  console.log('🔄 Resetting database (keeping admin account)...\n');

  db.run("DELETE FROM users", (err) => {
    if (err) console.error('Error deleting users:', err);
    else console.log('✅ Deleted all users');
  });

  db.run("DELETE FROM vendors", (err) => {
    if (err) console.error('Error deleting vendors:', err);
    else console.log('✅ Deleted all vendors');
  });

  db.run("DELETE FROM meal_allocations", (err) => {
    if (err) console.error('Error deleting meal_allocations:', err);
    else console.log('✅ Deleted all meal_allocations');
  });

  db.run("DELETE FROM sessions", (err) => {
    if (err) console.error('Error deleting sessions:', err);
    else console.log('✅ Deleted all sessions');
  });

  db.run("DELETE FROM qr_tokens", (err) => {
    if (err) console.error('Error deleting qr_tokens:', err);
    else console.log('✅ Deleted all qr_tokens');
  });

  db.run("DELETE FROM transactions", (err) => {
    if (err) console.error('Error deleting transactions:', err);
    else console.log('✅ Deleted all transactions');
  });

  db.run("DELETE FROM events", (err) => {
    if (err) console.error('Error deleting events:', err);
    else console.log('✅ Deleted all events');
  });

  db.run("DELETE FROM event_registrations", (err) => {
    if (err) console.error('Error deleting event_registrations:', err);
    else console.log('✅ Deleted all event_registrations');
  });

  db.run("DELETE FROM event_qr_tokens", (err) => {
    if (err) console.error('Error deleting event_qr_tokens:', err);
    else console.log('✅ Deleted all event_qr_tokens');
  });

  db.run("DELETE FROM event_consumptions", (err) => {
    if (err) console.error('Error deleting event_consumptions:', err);
    else console.log('✅ Deleted all event_consumptions');
  });

  db.get("SELECT COUNT(*) as count FROM admins", [], (err, row) => {
    console.log(`\n👤 Admins remaining: ${row.count}`);
  });

  db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
    console.log(`👤 Users remaining: ${row.count}`);
  });

  db.get("SELECT COUNT(*) as count FROM meal_types", [], (err, row) => {
    console.log(`🍽️ Meal types remaining: ${row.count}`);
    db.close(() => console.log('\n✅ Database reset complete!'));
  });
});
