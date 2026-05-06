# Vendor Setup Instructions

## Quick Setup

Run this command in your terminal to set up both vendors:

```bash
node setup-vendors.js
```

This will:
1. Add **cafe_a** vendor (Cafe A)
2. Add **bagsc** vendor (BAGSC Cafeteria)
3. Ensure both are ACTIVE
4. Verify the setup

---

## Expected Output

You should see something like:

```
 VENDOR SETUP & VERIFICATION

======================================================================

 Step 1: Checking existing vendors...

Found X existing vendor(s):
   - Cafe A (cafe_a) - 🟢 Active
   - BAGSC Cafeteria (bagsc) - 🟢 Active

 Step 2: Setting up required vendors...

    Cafe A (cafe_a) - Set up successfully
    BAGSC Cafeteria (bagsc) - Set up successfully

 Step 3: Verifying vendor setup...

Active vendors: 2

1. BAGSC Cafeteria
   Vendor Code: bagsc
   ID: VEN_BAGSC
   Status: 🟢 ACTIVE
   Created: 2026-02-16 12:16:00

2. Cafe A
   Vendor Code: cafe_a
   ID: VEN_CAFE_A
   Status: 🟢 ACTIVE
   Created: 2026-02-16 12:16:00

======================================================================

 VENDOR SETUP COMPLETE!

 You can now login as vendor using these codes:

   • bagsc
   • cafe_a

 To login:
   1. Go to http://localhost:3000
   2. Click "Vendor" tab
   3. Enter vendor code (e.g., "cafe_a" or "bagsc")
   4. Click "Login"

======================================================================
```

---

## How to Login as Vendor

### Option 1: cafe_a
1. Open http://localhost:3000
2. Click **"Vendor"** tab
3. Enter: `cafe_a`
4. Click **"Login"**

### Option 2: bagsc
1. Open http://localhost:3000
2. Click **"Vendor"** tab
3. Enter: `bagsc`
4. Click **"Login"**

---

## Testing the Vendor Login

After running the setup script:

1. **Open browser**: http://localhost:3000
2. **Click "Vendor" tab**
3. **Try logging in with**: `cafe_a`
4. **You should see**: Vendor dashboard with scanner

---

## Troubleshooting

### "Vendor not found"
- Run the setup script again: `node setup-vendors.js`
- Check the output for any errors

### "Database locked"
- Make sure the server is not running
- Stop the server (Ctrl+C in the terminal where it's running)
- Run the setup script
- Restart the server

### Still not working?
Check the database directly:
```bash
node check-db.js
```

---

## Next Steps

After vendors are set up:

1. Vendors can login
2. Vendors can scan QR codes
3. Transactions will appear on admin dashboard

To create test transactions:
1. Register a user (or use existing)
2. User generates QR code
3. Vendor scans the QR code
4. Check admin dashboard for updates!

---

**Created**: 2026-02-16 
**Script**: setup-vendors.js
