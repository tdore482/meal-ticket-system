const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./meal_system.db');

const indexes = [
  // Sessions - used for every authenticated request
  `CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
  
  // QR Tokens - used for validation
  `CREATE INDEX IF NOT EXISTS idx_qr_tokens_user ON qr_tokens(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_qr_tokens_token ON qr_tokens(token)`,
  `CREATE INDEX IF NOT EXISTS idx_qr_tokens_used ON qr_tokens(used, expires_at)`,
  
  // Event QR Tokens
  `CREATE INDEX IF NOT EXISTS idx_event_qr_tokens_event_user ON event_qr_tokens(event_id, user_id)`,
  
  // Transactions - used for daily reports
  `CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_vendor ON transactions(vendor_id)`,
  
  // Event Consumptions
  `CREATE INDEX IF NOT EXISTS idx_event_consumptions_event_user_meal ON event_consumptions(event_id, user_id, meal_type_id)`,
  
  // Users - login lookups
  `CREATE INDEX IF NOT EXISTS idx_users_reg_number ON users(registration_number)`,
  
  // Vendors - login lookups
  `CREATE INDEX IF NOT EXISTS idx_vendors_code ON vendors(vendor_code)`,
  
  // Meal Allocations
  `CREATE INDEX IF NOT EXISTS idx_meal_allocations_user ON meal_allocations(user_id)`,
  
  // Event Registrations
  `CREATE INDEX IF NOT EXISTS idx_event_registrations_event ON event_registrations(event_id)`,
  `CREATE INDEX IF NOT EXISTS idx_event_registrations_user ON event_registrations(user_id)`,
];

console.log('🔧 Adding database indexes...\n');

let completed = 0;
indexes.forEach(sql => {
  db.run(sql, (err) => {
    if (err) {
      console.error('❌ Index error:', err.message);
    } else {
      const idxName = sql.match(/idx_[a-z_]+/)[0];
      console.log(`✅ Created index: ${idxName}`);
    }
    completed++;
    if (completed === indexes.length) {
      console.log('\n✅ All indexes created successfully');
      db.close();
    }
  });
});
