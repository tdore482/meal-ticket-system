# Meal Ticket System - Testing Guide

## Complete Testing Checklist

This guide provides step-by-step instructions to verify all system functionality.

---

## Prerequisites

1. **Server Running**
   ```bash
   cd c:\Users\Theodore Michongwe\Documents\Missing\meal-ticket
   npm start
   ```

2. **Browser Open**
   - Navigate to: `http://localhost:3000`

3. **Test Credentials**
   - Admin: `admin` / `admin123`
   - Test User: `REG001` / `1234`
   - Test Vendor: `cafe_a`

---

## Test Suite 1: User Functionality (10 tests)

### Test 1.1: User Registration ✅
**Steps:**
1. Click "Register" tab
2. Enter:
   - Name: "Test Student"
   - Registration Number: "TEST001"
   - PIN: "9999"
3. Click "Register"

**Expected:**
- ✅ Success message appears
- ✅ Automatically switches to login tab
- ✅ Fields pre-filled with TEST001 / 9999

**Status:** [ ] Pass [ ] Fail

---

### Test 1.2: User Login ✅
**Steps:**
1. Enter: `TEST001` / `9999`
2. Click "Login"

**Expected:**
- ✅ Dashboard loads
- ✅ Welcome message shows "Test Student"
- ✅ 3 meal cards displayed (Breakfast, Lunch, Dinner)
- ✅ Each shows "20" remaining

**Status:** [ ] Pass [ ] Fail

---

### Test 1.3: Active Meal Detection ✅
**Steps:**
1. Check current time
2. Observe meal status indicator

**Expected:**
- ✅ If 07:00-09:00: "Active Now" badge, Breakfast highlighted
- ✅ If 12:00-14:00: "Active Now" badge, Lunch highlighted
- ✅ If 18:00-20:00: "Active Now" badge, Dinner highlighted
- ✅ Otherwise: "Inactive" badge, no highlight

**Status:** [ ] Pass [ ] Fail

---

### Test 1.4: QR Code Generation (Active Period) ✅
**Steps:**
1. During active meal period (e.g., 07:00-09:00)
2. Click "Get Ticket Code"

**Expected:**
- ✅ QR code appears
- ✅ Token string displayed (format: `REG:TEST001|TOKEN:...`)
- ✅ Button changes to "Hide Code"
- ✅ Copy button works

**Status:** [ ] Pass [ ] Fail

---

### Test 1.5: QR Code Generation (Inactive Period) ✅
**Steps:**
1. Outside meal periods (e.g., 10:00)
2. Check "Get Ticket Code" button

**Expected:**
- ✅ Button is disabled OR
- ✅ QR section is hidden
- ✅ Message indicates no active meal

**Status:** [ ] Pass [ ] Fail

---

### Test 1.6: Real-Time Dashboard Update ✅
**Steps:**
1. Note current "Breakfast" remaining count
2. Have vendor scan your QR (see Vendor tests)
3. Refresh dashboard or wait

**Expected:**
- ✅ Breakfast count decreases by 1
- ✅ Total meals decreases by 1
- ✅ Update happens within 5 seconds

**Status:** [ ] Pass [ ] Fail

---

### Test 1.7: Token Expiry ✅
**Steps:**
1. Generate QR code
2. Wait 11 minutes
3. Try to use expired token with vendor

**Expected:**
- ✅ Vendor scan shows "Denied"
- ✅ Error message: "Token expired"

**Status:** [ ] Pass [ ] Fail

---

### Test 1.8: Insufficient Meals ✅
**Steps:**
1. Use QR code 20 times for Breakfast
2. Try to generate 21st QR for Breakfast

**Expected:**
- ✅ QR generation fails OR
- ✅ Vendor scan shows "No meals remaining"

**Status:** [ ] Pass [ ] Fail

---

### Test 1.9: Logout ✅
**Steps:**
1. Click "Logout" button

**Expected:**
- ✅ Returns to login page
- ✅ Session cleared
- ✅ Cannot access dashboard without re-login

**Status:** [ ] Pass [ ] Fail

---

### Test 1.10: Invalid Login ✅
**Steps:**
1. Enter: `TEST001` / `wrong_pin`
2. Click "Login"

**Expected:**
- ✅ Error message displayed
- ✅ Stays on login page
- ✅ No dashboard access

**Status:** [ ] Pass [ ] Fail

---

## Test Suite 2: Vendor Functionality (8 tests)

### Test 2.1: Vendor Login ✅
**Steps:**
1. Click "Vendor" tab
2. Enter: `cafe_a`
3. Click "Login"

**Expected:**
- ✅ Vendor dashboard loads
- ✅ Shows vendor name
- ✅ Scanner interface visible

**Status:** [ ] Pass [ ] Fail

---

### Test 2.2: Camera Scanner (if camera available) ✅
**Steps:**
1. Click "Start Camera"
2. Allow camera permission
3. Point at QR code

**Expected:**
- ✅ Camera feed appears
- ✅ QR code detected automatically
- ✅ Beep sound plays
- ✅ Result displayed

**Status:** [ ] Pass [ ] Fail [ ] N/A (no camera)

---

### Test 2.3: Manual Entry ✅
**Steps:**
1. Copy token from user QR: `REG:TEST001|TOKEN:ABC123...`
2. Paste into "Manual Entry" field
3. Click "Validate"

**Expected:**
- ✅ Validation processes
- ✅ Result displayed (approved/denied)

**Status:** [ ] Pass [ ] Fail

---

### Test 2.4: Valid QR Scan (Legacy Mode) ✅
**Steps:**
1. User generates fresh QR (< 10 min old)
2. Vendor scans it

**Expected:**
- ✅ Green "APPROVED" message
- ✅ Shows user name
- ✅ Shows remaining meals
- ✅ Message auto-hides after 3 seconds

**Status:** [ ] Pass [ ] Fail

---

### Test 2.5: Valid QR Scan (Event Mode) ✅
**Steps:**
1. Admin creates event and generates event QR
2. Vendor scans event QR
3. Select meal type (Breakfast/Lunch/Dinner)

**Expected:**
- ✅ Meal type selector appears
- ✅ After selection, validation proceeds
- ✅ "APPROVED" message if valid

**Status:** [ ] Pass [ ] Fail

---

### Test 2.6: Duplicate Scan Prevention ✅
**Steps:**
1. Scan valid QR code
2. Immediately scan same QR again

**Expected:**
- ✅ Second scan shows "DENIED"
- ✅ Error: "Token already used"

**Status:** [ ] Pass [ ] Fail

---

### Test 2.7: Invalid QR Format ✅
**Steps:**
1. Enter random text: `INVALID_QR_CODE`
2. Click "Validate"

**Expected:**
- ✅ Red "DENIED" message
- ✅ Error: "Invalid QR format"

**Status:** [ ] Pass [ ] Fail

---

### Test 2.8: Active Meal Period Check ✅
**Steps:**
1. Outside meal period (e.g., 10:00)
2. Try to scan valid QR

**Expected:**
- ✅ "DENIED" message
- ✅ Error: "No active meal period"

**Status:** [ ] Pass [ ] Fail

---

## Test Suite 3: Admin Functionality (17 tests)

### Test 3.1: Admin Login ✅
**Steps:**
1. Click "Admin" tab
2. Enter: `admin` / `admin123`
3. Click "Login"

**Expected:**
- ✅ Admin dashboard loads
- ✅ Multiple tabs visible
- ✅ Today's summary displayed

**Status:** [ ] Pass [ ] Fail

---

### Test 3.2: Dashboard - Today's Summary ✅
**Steps:**
1. View "Daily Summary" tab

**Expected:**
- ✅ Shows meal counts (Breakfast, Lunch, Dinner)
- ✅ Shows total served today
- ✅ Auto-refreshes every 10 seconds

**Status:** [ ] Pass [ ] Fail

---

### Test 3.3: Dashboard - Live Feed ✅
**Steps:**
1. Click "Live Feeds & Reports" tab
2. View transaction table

**Expected:**
- ✅ Recent transactions listed
- ✅ Shows time, user, vendor, meal
- ✅ Updates in real-time

**Status:** [ ] Pass [ ] Fail

---

### Test 3.4: Dashboard - Pagination ✅
**Steps:**
1. If > 20 transactions exist
2. Check pagination controls

**Expected:**
- ✅ "Next" button appears
- ✅ Clicking loads next page
- ✅ Page numbers displayed

**Status:** [ ] Pass [ ] Fail [ ] N/A (< 20 transactions)

---

### Test 3.5: Dashboard - Filters ✅
**Steps:**
1. Select date filter
2. Select meal type filter
3. Apply filters

**Expected:**
- ✅ Results filtered correctly
- ✅ Count updates
- ✅ Can clear filters

**Status:** [ ] Pass [ ] Fail

---

### Test 3.6: Users - View List ✅
**Steps:**
1. Click "Users & Allocation" tab

**Expected:**
- ✅ All users listed
- ✅ Shows reg number, name, status
- ✅ Shows latest QR token
- ✅ Shows token expiry

**Status:** [ ] Pass [ ] Fail

---

### Test 3.7: Users - View Details ✅
**Steps:**
1. Click "View" on any user

**Expected:**
- ✅ Popup shows user info
- ✅ Shows meal allocations
- ✅ Shows remaining counts

**Status:** [ ] Pass [ ] Fail

---

### Test 3.8: Users - Edit Meals ✅
**Steps:**
1. Click "Edit" on any user
2. Change Breakfast allocated to 25
3. Change Breakfast remaining to 25
4. Click "Save"

**Expected:**
- ✅ Edit form appears
- ✅ Changes save successfully
- ✅ Returns to user list
- ✅ Changes reflected immediately

**Status:** [ ] Pass [ ] Fail

---

### Test 3.9: Bulk Allocation - Selected Users ✅
**Steps:**
1. Check 3 users
2. Select meal type: Breakfast
3. Operation: Add
4. Amount: 5
5. Click "Allocate to Selected"

**Expected:**
- ✅ Success message
- ✅ 3 users updated
- ✅ Each user has +5 Breakfast meals

**Status:** [ ] Pass [ ] Fail

---

### Test 3.10: Bulk Allocation - All Users ✅
**Steps:**
1. Select meal type: Lunch
2. Operation: Set
3. Amount: 30
4. Click "Allocate to All Users"
5. Confirm

**Expected:**
- ✅ Confirmation dialog
- ✅ Success message
- ✅ All users now have 30 Lunch meals

**Status:** [ ] Pass [ ] Fail

---

### Test 3.11: Events - Create Event ✅
**Steps:**
1. Click "Events" tab
2. Enter name: "Test Conference"
3. Start date: Tomorrow
4. End date: Tomorrow + 2 days
5. Click "Create Event"

**Expected:**
- ✅ Event created
- ✅ Appears in events list
- ✅ Success message

**Status:** [ ] Pass [ ] Fail

---

### Test 3.12: Events - Register Users ✅
**Steps:**
1. Click "View" on event
2. Click "Add All Users"
3. Confirm

**Expected:**
- ✅ All users registered
- ✅ Count displayed
- ✅ Users listed in table

**Status:** [ ] Pass [ ] Fail

---

### Test 3.13: Events - Generate QR Tokens ✅
**Steps:**
1. In event detail
2. Click "Generate QR Tokens"

**Expected:**
- ✅ Tokens generated for all registered users
- ✅ Success message with count
- ✅ Checkmarks appear in QR column

**Status:** [ ] Pass [ ] Fail

---

### Test 3.14: Events - Export PDF ✅
**Steps:**
1. Click "Export PDF"

**Expected:**
- ✅ PDF downloads
- ✅ 6 tickets per page
- ✅ QR codes visible
- ✅ User names and reg numbers shown

**Status:** [ ] Pass [ ] Fail

---

### Test 3.15: Events - Consumption Report ✅
**Steps:**
1. After some event QR scans
2. Access: `/api/admin/events/{eventId}/consumption-report`

**Expected:**
- ✅ Shows consumption by meal type
- ✅ Shows percentage completion
- ✅ Lists individual user consumptions

**Status:** [ ] Pass [ ] Fail

---

### Test 3.16: Reports - Meals Per Day ✅
**Steps:**
1. Click "Live Feeds & Reports" tab
2. Select date range (last 7 days)
3. Click "Load"

**Expected:**
- ✅ Daily breakdown displayed
- ✅ Shows meals per day
- ✅ Total count shown

**Status:** [ ] Pass [ ] Fail

---

### Test 3.17: Reports - Meals Per Time ✅
**Steps:**
1. Select today's date
2. Click "Load"

**Expected:**
- ✅ Hourly breakdown displayed
- ✅ Bar chart visualization
- ✅ Peak hour highlighted

**Status:** [ ] Pass [ ] Fail

---

## Test Suite 4: Data Integrity (5 tests)

### Test 4.1: Real-Time Calculation ✅
**Steps:**
1. Note user's Breakfast count: X
2. Vendor scans user's QR
3. Refresh user dashboard

**Expected:**
- ✅ Count is now X-1
- ✅ Update within 5 seconds
- ✅ No manual sync needed

**Status:** [ ] Pass [ ] Fail

---

### Test 4.2: Reconciliation Check ✅
**Steps:**
1. Access: `GET /api/admin/reconciliation/validate`
2. Review response

**Expected:**
- ✅ `isHealthy: true` if no issues
- ✅ Lists any discrepancies found
- ✅ Provides severity levels

**Status:** [ ] Pass [ ] Fail

---

### Test 4.3: Cross-Midnight Meal Period ✅
**Steps:**
1. Create meal type: 23:00 - 01:00
2. Test at 23:30 (should be active)
3. Test at 00:30 (should be active)
4. Test at 01:30 (should be inactive)

**Expected:**
- ✅ 23:30: Active
- ✅ 00:30: Active
- ✅ 01:30: Inactive

**Status:** [ ] Pass [ ] Fail [ ] N/A (can't test timing)

---

### Test 4.4: Concurrent Scans ✅
**Steps:**
1. Generate 1 QR code
2. Have 2 vendors scan simultaneously

**Expected:**
- ✅ First scan: Approved
- ✅ Second scan: Denied (already used)
- ✅ No double-counting

**Status:** [ ] Pass [ ] Fail

---

### Test 4.5: Event vs Legacy Isolation ✅
**Steps:**
1. User has 20 Breakfast (legacy)
2. User consumes Breakfast via event QR
3. Check legacy allocation

**Expected:**
- ✅ Legacy count unchanged (still 20)
- ✅ Event consumption recorded separately
- ✅ No cross-contamination

**Status:** [ ] Pass [ ] Fail

---

## Test Suite 5: Security (6 tests)

### Test 5.1: Unauthorized Access ✅
**Steps:**
1. Logout
2. Try to access: `/api/admin/dashboard`

**Expected:**
- ✅ 401 or 403 error
- ✅ No data returned

**Status:** [ ] Pass [ ] Fail

---

### Test 5.2: Role-Based Access ✅
**Steps:**
1. Login as user
2. Try to access admin endpoints

**Expected:**
- ✅ Access denied
- ✅ Error message

**Status:** [ ] Pass [ ] Fail

---

### Test 5.3: SQL Injection Prevention ✅
**Steps:**
1. Login with: `admin' OR '1'='1`
2. Try various SQL injection patterns

**Expected:**
- ✅ All attempts fail
- ✅ No unauthorized access
- ✅ No database errors

**Status:** [ ] Pass [ ] Fail

---

### Test 5.4: Rate Limiting ✅
**Steps:**
1. Make 600 requests to `/api/health` in 1 minute

**Expected:**
- ✅ After 500 requests: 429 error
- ✅ Error: "Too many requests"

**Status:** [ ] Pass [ ] Fail [ ] N/A (can't test)

---

### Test 5.5: Session Expiry ✅
**Steps:**
1. Login
2. Wait for session timeout (check server config)
3. Try to use expired session

**Expected:**
- ✅ Session invalid
- ✅ Forced to re-login

**Status:** [ ] Pass [ ] Fail

---

### Test 5.6: Password Security ✅
**Steps:**
1. Check database
2. View users table

**Expected:**
- ✅ Passwords are hashed (not plain text)
- ✅ Hashes look like: `$2b$10$...`

**Status:** [ ] Pass [ ] Fail

---

## Test Suite 6: Performance (4 tests)

### Test 6.1: Dashboard Load Time ✅
**Steps:**
1. Open browser dev tools (F12)
2. Go to Network tab
3. Load user dashboard
4. Check timing

**Expected:**
- ✅ Load time < 500ms
- ✅ No errors in console

**Status:** [ ] Pass [ ] Fail

---

### Test 6.2: QR Generation Speed ✅
**Steps:**
1. Click "Get Ticket Code"
2. Measure time to display

**Expected:**
- ✅ QR appears < 1 second
- ✅ No lag or freezing

**Status:** [ ] Pass [ ] Fail

---

### Test 6.3: Vendor Scan Speed ✅
**Steps:**
1. Scan QR code
2. Measure time to result

**Expected:**
- ✅ Result < 500ms
- ✅ Feels instant

**Status:** [ ] Pass [ ] Fail

---

### Test 6.4: Large Dataset Pagination ✅
**Steps:**
1. Create 100+ transactions
2. Load admin dashboard
3. Test pagination

**Expected:**
- ✅ Page loads quickly
- ✅ Pagination smooth
- ✅ No timeout errors

**Status:** [ ] Pass [ ] Fail [ ] N/A (< 100 transactions)

---

## Summary Scorecard

| Test Suite | Total Tests | Passed | Failed | N/A |
|------------|-------------|--------|--------|-----|
| User Functionality | 10 | ___ | ___ | ___ |
| Vendor Functionality | 8 | ___ | ___ | ___ |
| Admin Functionality | 17 | ___ | ___ | ___ |
| Data Integrity | 5 | ___ | ___ | ___ |
| Security | 6 | ___ | ___ | ___ |
| Performance | 4 | ___ | ___ | ___ |
| **TOTAL** | **50** | **___** | **___** | **___** |

---

## Pass Criteria

- ✅ **Production Ready**: 45+ tests pass (90%)
- ⚠️ **Needs Work**: 40-44 tests pass (80-89%)
- ❌ **Not Ready**: < 40 tests pass (< 80%)

---

## Common Issues & Solutions

### Issue: QR Scanner Not Working
**Solution:**
- Check camera permissions
- Try different browser (Chrome recommended)
- Use manual entry as fallback

### Issue: "No active meal period"
**Solution:**
- Check current time vs meal times
- Verify meal types are active in database
- Check time utility functions

### Issue: Dashboard Not Updating
**Solution:**
- Hard refresh (Ctrl+F5)
- Check browser console for errors
- Verify server is running

### Issue: PDF Export Fails
**Solution:**
- Ensure QR tokens generated first
- Check server has write permissions
- Verify pdfkit and qrcode packages installed

---

## Automated Testing (Future Enhancement)

### Suggested Tools:
- **Jest** - Unit testing
- **Supertest** - API testing
- **Puppeteer** - E2E testing
- **Artillery** - Load testing

### Sample Test Script:
```javascript
// test/user.test.js
const request = require('supertest');
const app = require('../server');

describe('User Dashboard', () => {
  it('should return 200 for authenticated user', async () => {
    const res = await request(app)
      .get('/api/user/dashboard')
      .set('Authorization', 'Bearer VALID_TOKEN');
    
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('meals');
  });
});
```

---

## Final Checklist

Before deploying to production:

- [ ] All critical tests pass (User, Vendor, Admin core features)
- [ ] Security tests pass
- [ ] Performance acceptable
- [ ] Reconciliation check shows healthy
- [ ] Documentation reviewed
- [ ] Backup database
- [ ] Environment variables configured
- [ ] SSL certificate installed (if production)
- [ ] Monitoring set up
- [ ] Support team trained

---

**Testing Completed**: ___________  
**Tested By**: ___________  
**Overall Status**: [ ] Pass [ ] Fail  
**Ready for Production**: [ ] Yes [ ] No
