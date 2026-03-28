# 🎯 Vendor Setup - Complete Guide

## 📋 Summary

I've created scripts to add and verify both vendors:
- ✅ **cafe_a** (Cafe A)
- ✅ **bagsc** (BAGSC Cafeteria)

---

## 🚀 Quick Setup (3 Steps)

### Step 1: Check Current Vendors
```bash
node check-vendors.js
```

This will show you what vendors currently exist in the database.

---

### Step 2: Set Up Vendors
```bash
node setup-vendors.js
```

This will:
- Add **cafe_a** vendor if it doesn't exist
- Add **bagsc** vendor if it doesn't exist
- Ensure both are **ACTIVE**
- Verify the setup

---

### Step 3: Test Vendor Login

1. Open browser: **http://localhost:3000**
2. Click **"Vendor"** tab
3. Try logging in with: **cafe_a**
4. Should see vendor dashboard with scanner

Then try with: **bagsc**

---

## 📝 What the Scripts Do

### `check-vendors.js`
- Quick check of current vendors
- Shows active/inactive status
- Takes 1 second to run

### `setup-vendors.js`
- Adds both vendors to database
- Uses UPSERT (insert or update)
- Ensures both are active
- Provides detailed output
- Takes 2-3 seconds to run

---

## 🎯 Expected Results

After running `setup-vendors.js`, you should have:

```
✅ 2 Active Vendors:
   1. BAGSC Cafeteria (bagsc)
   2. Cafe A (cafe_a)
```

Both vendors can now:
- ✅ Login to the system
- ✅ Scan QR codes
- ✅ Validate meal tickets
- ✅ Record transactions

---

## 🔧 Vendor Login Credentials

| Vendor Name | Login Code | Description |
|-------------|------------|-------------|
| Cafe A | `cafe_a` | Main cafeteria vendor |
| BAGSC Cafeteria | `bagsc` | BAGSC cafeteria vendor |

**Note**: Vendors don't need passwords, just the vendor code!

---

## 🧪 Testing Flow

### Complete Test (5 minutes):

1. **Register a user** (if not already done)
   - Go to http://localhost:3000
   - Click "Register"
   - Name: "Test Student"
   - Reg Number: "TEST001"
   - PIN: "1234"

2. **Login as user** (TEST001/1234)
   - Should see dashboard with meals

3. **Generate QR code**
   - Click "Get Ticket Code"
   - Copy the token (starts with "REG:")

4. **Open new browser tab/window**
   - Go to http://localhost:3000
   - Click "Vendor" tab
   - Enter: `cafe_a`
   - Click "Login"

5. **Scan the QR code**
   - Paste token in "Manual Entry"
   - Click "Validate"
   - Should see "✅ APPROVED"

6. **Check admin dashboard**
   - Login as admin (admin/admin123)
   - Should see transaction in the list
   - Counts should update (Breakfast: 1, Total: 1)

---

## 🐛 Troubleshooting

### Issue: "Vendor not found"
**Solution**: Run `node setup-vendors.js`

### Issue: "Database is locked"
**Solution**: 
1. Stop the server (Ctrl+C)
2. Run the setup script
3. Restart server (`npm start`)

### Issue: Can't run node commands
**Solution**: 
- Make sure you're in the project directory
- Check Node.js is installed: `node --version`
- If not installed, download from nodejs.org

### Issue: Vendors set up but can't login
**Solution**:
1. Check server is running
2. Clear browser cache
3. Try in incognito/private window
4. Check browser console for errors (F12)

---

## 📊 Database Structure

The vendors table has this structure:

```sql
CREATE TABLE vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vendor_code TEXT UNIQUE NOT NULL,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Our vendors:
- **ID**: VEN_CAFE_A, VEN_BAGSC
- **Name**: Cafe A, BAGSC Cafeteria
- **Code**: cafe_a, bagsc
- **Active**: 1 (yes)

---

## 🎓 How Vendor Login Works

1. User enters vendor code (e.g., "cafe_a")
2. System looks up vendor in database
3. If found and active → create session
4. Redirect to vendor dashboard
5. Vendor can now scan QR codes

**No password needed** - vendor code is the credential!

---

## 📱 Vendor Dashboard Features

Once logged in, vendors can:
- 🎥 **Start camera scanner** (if camera available)
- ⌨️ **Manual entry** (type/paste QR codes)
- ✅ **Validate tickets** (approve/deny)
- 📊 **See current meal period**
- 🔄 **Real-time validation**

---

## 🔐 Security Note

Vendor codes are simple for ease of use, but in production you might want to:
- Add password authentication
- Use more complex vendor codes
- Implement IP whitelisting
- Add audit logging

For now, the simple code system works well for testing and internal use.

---

## 📞 Next Steps

After setting up vendors:

1. ✅ Run `node setup-vendors.js`
2. ✅ Verify with `node check-vendors.js`
3. ✅ Test vendor login
4. ✅ Create test transaction
5. ✅ Check admin dashboard updates

Then you're ready to use the system! 🎉

---

## 📚 Related Documentation

- **TESTING_GUIDE.md** - Complete testing procedures
- **AUDIT_SUMMARY.md** - System overview
- **DOCUMENTATION_INDEX.md** - All documentation

---

**Created**: 2026-02-16 12:19:38  
**Status**: Ready to run  
**Estimated Time**: 5 minutes total
