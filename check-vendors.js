const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./meal_system.db');

console.log('\n🔍 Quick Vendor Check\n');

db.all('SELECT * FROM vendors', (err, vendors) => {
    if (err) {
        console.log('❌ Error:', err.message);
    } else if (vendors.length === 0) {
        console.log('⚠️  No vendors found!');
        console.log('\n💡 Run: node setup-vendors.js');
    } else {
        console.log(`Found ${vendors.length} vendor(s):\n`);
        vendors.forEach(v => {
            const status = v.active ? '🟢 ACTIVE' : '🔴 INACTIVE';
            console.log(`${status} ${v.name} (${v.vendor_code})`);
        });

        const active = vendors.filter(v => v.active);
        console.log(`\n✅ ${active.length} active vendor(s) ready to use`);
    }
    console.log('');
    db.close();
});
