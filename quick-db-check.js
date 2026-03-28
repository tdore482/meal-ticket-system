const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./meal_system.db');

console.log('\n📊 DATABASE STATUS CHECK\n');
console.log('='.repeat(50));

// Check users
db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
  if (err) {
    console.log('❌ Error checking users:', err.message);
  } else {
    console.log(`👥 Users: ${row.count}`);
  }
});

// Check transactions for today
const today = new Date().toISOString().split('T')[0];
db.get('SELECT COUNT(*) as count FROM transactions WHERE transaction_date = ?', [today], (err, row) => {
  if (err) {
    console.log('❌ Error checking transactions:', err.message);
  } else {
    console.log(`📝 Transactions today (${today}): ${row.count}`);
  }
});

// Check all transactions
db.get('SELECT COUNT(*) as count FROM transactions', (err, row) => {
  if (err) {
    console.log('❌ Error checking all transactions:', err.message);
  } else {
    console.log(`📝 Total transactions (all time): ${row.count}`);
  }
});

// Check recent transactions
db.all('SELECT * FROM transactions ORDER BY transaction_time DESC LIMIT 5', (err, rows) => {
  if (err) {
    console.log('❌ Error checking recent transactions:', err.message);
  } else {
    console.log(`\n📋 Recent Transactions (last 5):`);
    if (rows.length === 0) {
      console.log('   No transactions found');
    } else {
      rows.forEach((row, i) => {
        console.log(`   ${i + 1}. Date: ${row.transaction_date}, Time: ${row.transaction_time}`);
      });
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('\n✅ Check complete!\n');
  db.close();
});
