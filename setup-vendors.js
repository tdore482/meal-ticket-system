const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./meal_system.db');

console.log('\n🏪 VENDOR SETUP & VERIFICATION\n');
console.log('='.repeat(70));

// Step 1: Check current vendors
console.log('\n📋 Step 1: Checking existing vendors...\n');

db.all('SELECT * FROM vendors', (err, vendors) => {
    if (err) {
        console.log('❌ Error:', err.message);
        db.close();
        return;
    }

    if (vendors.length > 0) {
        console.log(`Found ${vendors.length} existing vendor(s):`);
        vendors.forEach(v => {
            console.log(`   - ${v.name} (${v.vendor_code}) - ${v.active ? '🟢 Active' : '🔴 Inactive'}`);
        });
    } else {
        console.log('   No vendors found in database');
    }

    // Step 2: Add/Update vendors
    console.log('\n📝 Step 2: Setting up required vendors...\n');

    const vendorsToSetup = [
        {
            id: 'VEN_CAFE_A',
            name: 'Cafe A',
            vendor_code: 'cafe_a',
            description: 'Main cafeteria vendor'
        },
        {
            id: 'VEN_BAGSC',
            name: 'BAGSC Cafeteria',
            vendor_code: 'bagsc',
            description: 'BAGSC cafeteria vendor'
        }
    ];

    let processed = 0;
    const results = [];

    vendorsToSetup.forEach(vendor => {
        // Try to insert, if exists, update
        db.run(
            `INSERT INTO vendors (id, name, vendor_code, active, created_at, updated_at)
       VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
       ON CONFLICT(vendor_code) DO UPDATE SET 
         active = 1,
         name = excluded.name,
         updated_at = datetime('now')`,
            [vendor.id, vendor.name, vendor.vendor_code],
            function (err) {
                if (err) {
                    console.log(`   ❌ ${vendor.name}: ${err.message}`);
                    results.push({ vendor: vendor.name, status: 'error', message: err.message });
                } else {
                    if (this.changes > 0) {
                        console.log(`   ✅ ${vendor.name} (${vendor.vendor_code}) - Set up successfully`);
                        results.push({ vendor: vendor.name, status: 'success', code: vendor.vendor_code });
                    } else {
                        console.log(`   ℹ️  ${vendor.name} (${vendor.vendor_code}) - Already configured`);
                        results.push({ vendor: vendor.name, status: 'exists', code: vendor.vendor_code });
                    }
                }

                processed++;
                if (processed === vendorsToSetup.length) {
                    verifySetup();
                }
            }
        );
    });

    function verifySetup() {
        console.log('\n🔍 Step 3: Verifying vendor setup...\n');

        db.all('SELECT * FROM vendors WHERE active = 1 ORDER BY name', (err, activeVendors) => {
            if (err) {
                console.log('❌ Error verifying:', err.message);
                db.close();
                return;
            }

            console.log(`Active vendors: ${activeVendors.length}\n`);

            activeVendors.forEach((v, i) => {
                console.log(`${i + 1}. ${v.name}`);
                console.log(`   Vendor Code: ${v.vendor_code}`);
                console.log(`   ID: ${v.id}`);
                console.log(`   Status: 🟢 ACTIVE`);
                console.log(`   Created: ${v.created_at}`);
                console.log('');
            });

            console.log('='.repeat(70));
            console.log('\n✅ VENDOR SETUP COMPLETE!\n');
            console.log('📱 You can now login as vendor using these codes:\n');

            activeVendors.forEach(v => {
                console.log(`   • ${v.vendor_code}`);
            });

            console.log('\n💡 To login:');
            console.log('   1. Go to http://localhost:3000');
            console.log('   2. Click "Vendor" tab');
            console.log('   3. Enter vendor code (e.g., "cafe_a" or "bagsc")');
            console.log('   4. Click "Login"\n');

            console.log('='.repeat(70));
            console.log('');

            db.close();
        });
    }
});
