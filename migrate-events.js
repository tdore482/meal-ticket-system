/**
 * Migration: Add event tables to existing database.
 * Run: node migrate-events.js
 */
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const db = new sqlite3.Database('./meal_system.db');

const schemaAdditions = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_registrations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  UNIQUE(event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS event_qr_tokens (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS event_consumptions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  meal_type_id TEXT NOT NULL,
  consumed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  vendor_id TEXT,
  UNIQUE(event_id, user_id, meal_type_id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (meal_type_id) REFERENCES meal_types(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);
`;

const statements = schemaAdditions.split(';').filter(s => s.trim());

db.serialize(() => {
  statements.forEach(stmt => {
    if (stmt.trim()) {
      db.run(stmt, (err) => {
        if (err) console.error('Migration error:', err);
      });
    }
  });
  db.close(() => {
    console.log('✅ Event tables migration complete');
  });
});
