# Meal Tracking System: Dashboard & Real-Time Data Update Diagnostic & Resolution Prompt

## Executive Summary

The meal-ticket system has critical issues preventing accurate dashboard updates and live feed reporting across all three user roles (Admin, Vendor, User). This document provides a comprehensive diagnostic prompt and resolution strategy to restore system integrity and data accuracy.

---

## Identified Issues

### **ISSUE 1: Dashboard Data Staleness (Critical)**

**Problem:** Dashboard endpoints return cached or stale data that doesn't reflect real-time transaction updates.

**Root Causes:**
1. **No Real-Time Sync Mechanism** — Dashboards use simple GET endpoints without WebSocket or polling
2. **Stale Allocation Data** — `meal_allocations.remaining` may not sync with actual transactions
3. **Missing Live Feed Updates** — Admin dashboard shows only top 20 transactions (LIMIT 20) without pagination or real-time updates
4. **Time Window Calculation Issues** — Active meal detection uses string comparison (HH:MM) which can be off-by-minute

**Affected Endpoints:**
- `GET /api/user/dashboard` — User doesn't see accurate remaining meals
- `GET /api/vendor/dashboard` — Vendor sees outdated active meal period
- `GET /api/admin/dashboard` — Admin sees incomplete transaction history
- `GET /api/admin/daily-breakdown` — Limited visibility into daily operations

---

### **ISSUE 2: Dual Meal Tracking Systems Not Synchronized (Critical)**

**Problem:** Legacy mode and event mode operate independently with NO cross-referencing.

**Root Causes:**
1. **Separate Tracking Tables:**
   - Legacy: `meal_allocations` (user → meal_type_id) + `transactions` (meal_type_id)
   - Event: `event_consumptions` (user → meal_type_id → event_id)
   - NO relationship between the two systems

2. **No Duplicate Prevention Across Modes** — A user could consume the same meal in both legacy and event modes

3. **Admin Dashboard Only Queries Legacy Mode** — Event consumptions are invisible to admin

4. **Schema Duplication** — Tables `events`, `event_registrations`, `event_qr_tokens`, `event_consumptions` are duplicated in schema.sql (lines 94-139 AND 141-186)

---

### **ISSUE 3: Event Consumption Reporting Missing (Critical)**

**Problem:** No dashboard endpoints report event-based meal consumption.

**Root Causes:**
1. **Admin Event Dashboard Missing** — No endpoint to view which users consumed which meals at an event
2. **Event-to-Legacy Reporting Gap** — Cannot see event meals in daily breakdowns
3. **Consumption Verification Missing** — No endpoint to verify meal redemption counts per event

---

### **ISSUE 4: Allocation Reconciliation Issues (High)**

**Problem:** `meal_allocations.remaining` can diverge from actual consumed meals.

**Root Causes:**
1. **No Validation on Update** — When transaction is recorded, no check that remaining count matches transaction count
2. **Orphaned Transactions** — Transactions recorded without updating allocations (potential code path)
3. **No Audit Trail** — Cannot determine if discrepancy is from code bug or data corruption
4. **Missing Constraint** — No unique constraint preventing double-redemption in event mode

---

### **ISSUE 5: Time Window Calculation Unreliable (Medium)**

**Problem:** Active meal detection can fail due to edge cases.

**Root Causes:**
1. **String Comparison:** Current implementation uses:
   ```javascript
   const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
   const activeMeal = meals.find(m => currentTime >= m.start_time && currentTime < m.end_time);
   ```
   - Fails at exact boundary times (e.g., 12:00:00 when start_time = "12:00")
   - Seconds are ignored, causing false negatives at millisecond precision

2. **No Timezone Handling** — Times stored as TEXT (HH:MM) with no timezone info
3. **Meal Period Overlap Not Detected** — Multiple active meals can exist simultaneously

---

### **ISSUE 6: Live Feed Pagination Missing (Medium)**

**Problem:** Admin dashboard hardcodes `LIMIT 20` transactions with no way to see older data.

**Root Causes:**
1. **No Pagination Parameters** — `/api/admin/dashboard` endpoint doesn't accept `offset` or `page`
2. **No Sorting Options** — Cannot sort by user, vendor, meal type, or date
3. **No Filtering** — Cannot filter by date range, meal type, or vendor
4. **Incomplete Transaction Context** — Missing metadata like approval time, redemption status

---

### **ISSUE 7: Missing Event-Mode Dashboard Endpoints**

**Problem:** Event mode has no dashboard or reporting endpoints for admins or vendors.

**Missing Endpoints:**
- `GET /api/admin/events/:eventId/consumption-report` — Event meal redemption summary
- `GET /api/admin/events/:eventId/live-feed` — Real-time event transaction feed
- `GET /api/vendor/events/:eventId/consumption-status` — Current meal consumption state for event
- `GET /api/admin/events/:eventId/reconciliation` — Verify all registrations have consumed expected meals

---

### **ISSUE 8: No Data Integrity Checks**

**Problem:** System doesn't validate data consistency across transactions.

**Root Causes:**
1. **No Check:** Is a user registered for an event before consuming?
2. **No Check:** Has a user already consumed this meal type in this event?
3. **No Check:** Do transaction counts match allocation deltas?
4. **No Validation:** Are all registered users accounted for in consumption?

---

## Comprehensive Resolution Prompt

### **Phase 1: Data Integrity & Validation (IMMEDIATE)**

**1.1 Fix Schema Duplication**
```sql
-- Removed lines 141-186 in schema.sql (duplicate table definitions)
-- Verify only one definition per table exists:
-- - events
-- - event_registrations
-- - event_qr_tokens
-- - event_consumptions
```

**1.2 Add Reconciliation Constraints**
```sql
-- Ensure unique meal consumption per user/meal/event
-- event_consumptions already has UNIQUE(event_id, user_id, meal_type_id) ✓

-- Add constraint to prevent double-redemption in legacy mode
-- meal_allocations should track: allocated vs. consumed
-- Create new column: consumed_count (tracks actual transaction count)
ALTER TABLE meal_allocations ADD COLUMN consumed_count INTEGER DEFAULT 0;

-- Add integrity check trigger
CREATE TRIGGER update_consumed_count
AFTER INSERT ON transactions
BEGIN
  UPDATE meal_allocations
  SET consumed_count = (
    SELECT COUNT(*) FROM transactions 
    WHERE user_id = NEW.user_id AND meal_type_id = NEW.meal_type_id
  )
  WHERE user_id = NEW.user_id AND meal_type_id = NEW.meal_type_id;
END;
```

**1.3 Implement Reconciliation Endpoint**
```javascript
/**
 * GET /api/admin/reconciliation/validate
 * Checks data consistency across all tables
 * Returns discrepancies and warnings
 */
app.get('/api/admin/reconciliation/validate', authenticateSession, async (req, res) => {
  const issues = [];
  
  // Check 1: meal_allocations vs transactions
  const discrepancies = await dbAll(`
    SELECT 
      ma.user_id, ma.meal_type_id,
      ma.allocated, ma.remaining,
      COUNT(t.id) as actual_consumed,
      ma.allocated - COUNT(t.id) as expected_remaining,
      ABS((ma.allocated - COUNT(t.id)) - ma.remaining) as discrepancy
    FROM meal_allocations ma
    LEFT JOIN transactions t ON ma.user_id = t.user_id AND ma.meal_type_id = t.meal_type_id
    GROUP BY ma.user_id, ma.meal_type_id
    HAVING discrepancy > 0
  `);
  
  if (discrepancies.length > 0) {
    issues.push({
      severity: 'HIGH',
      type: 'allocation_discrepancy',
      count: discrepancies.length,
      details: discrepancies
    });
  }
  
  // Check 2: Event registrations vs consumptions
  const unconfirmed = await dbAll(`
    SELECT er.event_id, er.user_id, COUNT(ec.id) as meals_consumed
    FROM event_registrations er
    LEFT JOIN event_consumptions ec ON er.event_id = ec.event_id AND er.user_id = ec.user_id
    GROUP BY er.event_id, er.user_id
    HAVING meals_consumed = 0
  `);
  
  if (unconfirmed.length > 0) {
    issues.push({
      severity: 'MEDIUM',
      type: 'unconfirmed_event_registrations',
      count: unconfirmed.length,
      details: unconfirmed
    });
  }
  
  // Check 3: Users without meal_allocations
  const unallocated = await dbAll(`
    SELECT u.id, u.registration_number, u.name
    FROM users u
    WHERE u.active = 1
    AND NOT EXISTS (SELECT 1 FROM meal_allocations WHERE user_id = u.id)
  `);
  
  if (unallocated.length > 0) {
    issues.push({
      severity: 'MEDIUM',
      type: 'no_meal_allocations',
      count: unallocated.length,
      details: unallocated
    });
  }
  
  res.json({
    timestamp: new Date().toISOString(),
    isHealthy: issues.length === 0,
    issueCount: issues.length,
    issues
  });
});
```

---

### **Phase 2: Real-Time Dashboard Updates**

**2.1 Fix Time Window Calculation**
```javascript
// Replace string-based time comparison with numeric comparison
function getCurrentActiveTime() {
  const now = new Date();
  return {
    hours: now.getHours(),
    minutes: now.getMinutes(),
    seconds: now.getSeconds(),
    totalSeconds: (now.getHours() * 3600) + (now.getMinutes() * 60) + now.getSeconds()
  };
}

function timeStringToSeconds(timeStr) {
  // Convert "HH:MM" to seconds
  const [h, m] = timeStr.split(':').map(Number);
  return (h * 3600) + (m * 60);
}

function isTimeInRange(currentSeconds, startTime, endTime) {
  const start = timeStringToSeconds(startTime);
  const end = timeStringToSeconds(endTime);
  return currentSeconds >= start && currentSeconds < end;
}

// Usage in endpoints:
const activeTime = getCurrentActiveTime();
const activeMeal = meals.find(m => 
  isTimeInRange(activeTime.totalSeconds, m.start_time, m.end_time)
);
```

**2.2 Implement Real-Time Dashboard Endpoints**
```javascript
/**
 * GET /api/user/dashboard
 * UPDATED: Returns real-time allocation data with accurate remaining counts
 */
app.get('/api/user/dashboard', authenticateSession, async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(403).json({ error: 'Not a user session' });
    }

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.session.user_id]);

    // Get meals with accurate remaining count (calculated from transactions)
    const meals = await dbAll(`
      SELECT 
        mt.id, 
        mt.name, 
        mt.start_time, 
        mt.end_time,
        ma.allocated,
        COALESCE(ma.allocated - COUNT(t.id), ma.allocated) as remaining,
        COUNT(t.id) as consumed
      FROM meal_types mt
      LEFT JOIN meal_allocations ma ON mt.id = ma.meal_type_id AND ma.user_id = ?
      LEFT JOIN transactions t ON ma.user_id = t.user_id AND mt.id = t.meal_type_id
      WHERE mt.active = 1
      GROUP BY mt.id, mt.name, mt.start_time, mt.end_time, ma.allocated
      ORDER BY mt.start_time
    `, [req.session.user_id]);

    const activeTime = getCurrentActiveTime();
    const activeMeal = meals.find(m => 
      isTimeInRange(activeTime.totalSeconds, m.start_time, m.end_time)
    ) || null;

    const totalRemaining = meals.reduce((sum, m) => sum + (m.remaining || 0), 0);
    const totalConsumed = meals.reduce((sum, m) => sum + (m.consumed || 0), 0);

    res.json({
      user: { id: user.id, name: user.name, regNum: user.registration_number },
      meals,
      activeMeal,
      summary: {
        totalAllocated: meals.reduce((sum, m) => sum + (m.allocated || 0), 0),
        totalConsumed,
        totalRemaining,
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

/**
 * GET /api/vendor/dashboard
 * UPDATED: Real-time active meal detection and accurate meal counts
 */
app.get('/api/vendor/dashboard', authenticateSession, async (req, res) => {
  try {
    if (!req.session.vendor_id) {
      return res.status(403).json({ error: 'Not a vendor session' });
    }

    const vendor = await dbGet('SELECT * FROM vendors WHERE id = ?', [req.session.vendor_id]);
    const mealTypes = await dbAll('SELECT * FROM meal_types WHERE active = 1 ORDER BY start_time');

    const activeTime = getCurrentActiveTime();
    const activeMeal = mealTypes.find(m => 
      isTimeInRange(activeTime.totalSeconds, m.start_time, m.end_time)
    ) || null;

    // Get consumption stats for each meal type
    const mealStats = await Promise.all(mealTypes.map(async (meal) => {
      const stats = await dbGet(`
        SELECT 
          COUNT(DISTINCT t.user_id) as users_consumed,
          COUNT(*) as total_redemptions
        FROM transactions t
        WHERE t.meal_type_id = ? AND DATE(t.transaction_date) = DATE('now')
      `, [meal.id]);
      
      return {
        ...meal,
        stats: {
          usersConsumed: stats?.users_consumed || 0,
          totalRedemptions: stats?.total_redemptions || 0
        }
      };
    }));

    res.json({
      vendor: { id: vendor.id, name: vendor.name },
      activeMeal,
      mealTypes: mealStats,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Vendor dashboard error:', err);
    res.status(500).json({ error: 'Failed to load vendor dashboard' });
  }
});

/**
 * GET /api/admin/dashboard
 * UPDATED: Real-time stats with pagination and filtering
 */
app.get('/api/admin/dashboard', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const today = new Date().toISOString().split('T')[0];
    const { offset = 0, limit = 20, mealTypeId, vendorId, dateFilter } = req.query;
    const offsetNum = Math.max(0, parseInt(offset) || 0);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));

    // Build dynamic WHERE clause
    let whereConditions = ['t.transaction_date = ?'];
    let params = [dateFilter || today];

    if (mealTypeId && mealTypeId !== 'all') {
      whereConditions.push('t.meal_type_id = ?');
      params.push(mealTypeId);
    }

    if (vendorId && vendorId !== 'all') {
      whereConditions.push('t.vendor_id = ?');
      params.push(vendorId);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get summary stats
    const stats = await dbAll(`
      SELECT mt.name, mt.id, COUNT(t.id) as count
      FROM meal_types mt
      LEFT JOIN transactions t ON mt.id = t.meal_type_id AND ${whereClause}
      WHERE mt.active = 1
      GROUP BY mt.id, mt.name
      ORDER BY mt.start_time
    `, params);

    const total = stats.reduce((sum, s) => sum + (s.count || 0), 0);

    // Get paginated transactions
    const transactions = await dbAll(`
      SELECT 
        t.*,
        u.name as user_name,
        u.registration_number,
        v.name as vendor_name,
        mt.name as meal_name,
        strftime('%H:%M:%S', t.transaction_time) as time
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      JOIN vendors v ON t.vendor_id = v.id
      JOIN meal_types mt ON t.meal_type_id = mt.id
      WHERE ${whereClause}
      ORDER BY t.transaction_time DESC
      LIMIT ? OFFSET ?
    `, [...params, limitNum, offsetNum]);

    // Get total count for pagination
    const countResult = await dbGet(`
      SELECT COUNT(*) as total FROM transactions t WHERE ${whereClause}
    `, params);

    res.json({
      summary: { 
        stats, 
        total, 
        date: dateFilter || today,
        lastUpdated: new Date().toISOString()
      },
      transactions,
      pagination: {
        offset: offsetNum,
        limit: limitNum,
        total: countResult?.total || 0,
        hasMore: (offsetNum + limitNum) < (countResult?.total || 0)
      }
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).json({ error: 'Failed to load admin dashboard' });
  }
});
```

---

### **Phase 3: Event Mode Live Reporting**

**3.1 Add Event Consumption Report**
```javascript
/**
 * GET /api/admin/events/:eventId/consumption-report
 * Shows which users have consumed which meals at an event
 */
app.get('/api/admin/events/:eventId/consumption-report', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const { eventId } = req.params;
    const event = await dbGet('SELECT * FROM events WHERE id = ?', [eventId]);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Get all registrations and their consumptions
    const report = await dbAll(`
      SELECT 
        er.user_id,
        u.registration_number,
        u.name,
        mt.id as meal_type_id,
        mt.name as meal_type_name,
        CASE WHEN ec.id IS NOT NULL THEN 1 ELSE 0 END as consumed,
        ec.consumed_at,
        v.name as vendor_name
      FROM event_registrations er
      JOIN users u ON er.user_id = u.id
      CROSS JOIN meal_types mt
      LEFT JOIN event_consumptions ec ON 
        er.event_id = ec.event_id AND 
        er.user_id = ec.user_id AND 
        mt.id = ec.meal_type_id
      LEFT JOIN vendors v ON ec.vendor_id = v.id
      WHERE er.event_id = ? AND mt.active = 1
      ORDER BY u.name, mt.start_time
    `, [eventId]);

    // Summarize by meal type
    const summary = await dbAll(`
      SELECT 
        mt.id,
        mt.name,
        COUNT(DISTINCT er.user_id) as total_registered,
        COUNT(DISTINCT ec.user_id) as total_consumed,
        COUNT(DISTINCT er.user_id) - COUNT(DISTINCT ec.user_id) as pending
      FROM event_registrations er
      JOIN meal_types mt ON mt.active = 1
      LEFT JOIN event_consumptions ec ON 
        er.event_id = ec.event_id AND 
        mt.id = ec.meal_type_id
      WHERE er.event_id = ?
      GROUP BY mt.id, mt.name
      ORDER BY mt.start_time
    `, [eventId]);

    res.json({
      event,
      summary,
      detail: report,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Event consumption report error:', err);
    res.status(500).json({ error: 'Failed to fetch event report' });
  }
});

/**
 * GET /api/admin/events/:eventId/live-feed
 * Real-time transaction feed for an event
 */
app.get('/api/admin/events/:eventId/live-feed', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const { eventId } = req.params;
    const { offset = 0, limit = 50 } = req.query;
    const offsetNum = Math.max(0, parseInt(offset) || 0);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));

    const event = await dbGet('SELECT * FROM events WHERE id = ?', [eventId]);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const feed = await dbAll(`
      SELECT 
        ec.id,
        ec.consumed_at,
        u.name as user_name,
        u.registration_number,
        mt.name as meal_type,
        v.name as vendor_name
      FROM event_consumptions ec
      JOIN users u ON ec.user_id = u.id
      JOIN meal_types mt ON ec.meal_type_id = mt.id
      LEFT JOIN vendors v ON ec.vendor_id = v.id
      WHERE ec.event_id = ?
      ORDER BY ec.consumed_at DESC
      LIMIT ? OFFSET ?
    `, [eventId, limitNum, offsetNum]);

    const countResult = await dbGet(`
      SELECT COUNT(*) as total FROM event_consumptions WHERE event_id = ?
    `, [eventId]);

    res.json({
      event,
      feed,
      pagination: {
        offset: offsetNum,
        limit: limitNum,
        total: countResult?.total || 0,
        hasMore: (offsetNum + limitNum) < (countResult?.total || 0)
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Event live feed error:', err);
    res.status(500).json({ error: 'Failed to fetch live feed' });
  }
});
```

---

### **Phase 4: Daily Breakdown with Cross-Mode Support**

**4.1 Enhanced Daily Breakdown**
```javascript
/**
 * GET /api/admin/daily-breakdown
 * UPDATED: Combines legacy transactions AND event consumptions
 */
app.get('/api/admin/daily-breakdown', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const { date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format (YYYY-MM-DD)' });
    }

    // Legacy mode transactions
    const legacyBreakdown = await dbAll(`
      SELECT mt.name, COUNT(t.id) as count, 'legacy' as mode
      FROM meal_types mt
      LEFT JOIN transactions t ON mt.id = t.meal_type_id AND t.transaction_date = ?
      WHERE mt.active = 1
      GROUP BY mt.id, mt.name
      ORDER BY mt.start_time
    `, [date]);

    // Event mode consumptions
    const eventBreakdown = await dbAll(`
      SELECT mt.name, COUNT(ec.id) as count, 'event' as mode
      FROM meal_types mt
      LEFT JOIN event_consumptions ec ON mt.id = ec.meal_type_id 
        AND DATE(ec.consumed_at) = ?
      WHERE mt.active = 1
      GROUP BY mt.id, mt.name
      ORDER BY mt.start_time
    `, [date]);

    // Combined totals
    const combined = await dbAll(`
      SELECT mt.id, mt.name,
        COALESCE((SELECT COUNT(*) FROM transactions t 
          WHERE t.meal_type_id = mt.id AND t.transaction_date = ?), 0) as legacy_count,
        COALESCE((SELECT COUNT(*) FROM event_consumptions ec 
          WHERE ec.meal_type_id = mt.id AND DATE(ec.consumed_at) = ?), 0) as event_count
      FROM meal_types mt
      WHERE mt.active = 1
      ORDER BY mt.start_time
    `, [date, date]);

    res.json({
      date,
      breakdown: {
        legacy: legacyBreakdown,
        event: eventBreakdown,
        combined
      },
      totals: {
        legacy: legacyBreakdown.reduce((sum, b) => sum + (b.count || 0), 0),
        event: eventBreakdown.reduce((sum, b) => sum + (b.count || 0), 0),
        grand_total: combined.reduce((sum, c) => sum + (c.legacy_count || 0) + (c.event_count || 0), 0)
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Daily breakdown error:', err);
    res.status(500).json({ error: 'Failed to fetch daily breakdown' });
  }
});
```

---

### **Phase 5: Data Validation & Sync Operations**

**5.1 Add Meal Allocation Sync Endpoint**
```javascript
/**
 * POST /api/admin/sync/meal-allocations
 * Recalculates all remaining meal counts from transactions
 * Use only if discrepancies detected
 */
app.post('/api/admin/sync/meal-allocations', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    // Get all meal allocations
    const allocations = await dbAll(`
      SELECT DISTINCT user_id, meal_type_id FROM meal_allocations
    `);

    let updated = 0;
    let errors = [];

    for (const alloc of allocations) {
      try {
        // Count actual transactions for this user/meal
        const consumed = await dbGet(`
          SELECT COUNT(*) as count FROM transactions 
          WHERE user_id = ? AND meal_type_id = ?
        `, [alloc.user_id, alloc.meal_type_id]);

        const consumedCount = consumed?.count || 0;

        // Get original allocation
        const original = await dbGet(`
          SELECT allocated FROM meal_allocations 
          WHERE user_id = ? AND meal_type_id = ?
        `, [alloc.user_id, alloc.meal_type_id]);

        const newRemaining = (original?.allocated || 0) - consumedCount;

        // Update
        await dbRun(`
          UPDATE meal_allocations 
          SET remaining = ?, consumed_count = ?, updated_at = datetime('now')
          WHERE user_id = ? AND meal_type_id = ?
        `, [newRemaining, consumedCount, alloc.user_id, alloc.meal_type_id]);

        updated++;
      } catch (err) {
        errors.push({
          user_id: alloc.user_id,
          meal_type_id: alloc.meal_type_id,
          error: err.message
        });
      }
    }

    res.json({
      success: true,
      updated,
      errors: errors.length > 0 ? errors : null,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ error: 'Failed to sync allocations' });
  }
});

/**
 * POST /api/admin/sync/event-consumptions
 * Validates all event consumptions are properly recorded
 */
app.post('/api/admin/sync/event-consumptions', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const { eventId } = req.body;
    if (!eventId) {
      return res.status(400).json({ error: 'eventId required' });
    }

    const event = await dbGet('SELECT * FROM events WHERE id = ?', [eventId]);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Verify all registrations have valid QR tokens
    const missingTokens = await dbAll(`
      SELECT er.user_id, u.registration_number, u.name
      FROM event_registrations er
      JOIN users u ON er.user_id = u.id
      WHERE er.event_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM event_qr_tokens 
        WHERE event_id = ? AND user_id = er.user_id
      )
    `, [eventId, eventId]);

    // Check for orphaned consumptions (user consumed but not registered)
    const orphanedConsumptions = await dbAll(`
      SELECT DISTINCT ec.user_id, u.registration_number, u.name
      FROM event_consumptions ec
      JOIN users u ON ec.user_id = u.id
      WHERE ec.event_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM event_registrations 
        WHERE event_id = ? AND user_id = ec.user_id
      )
    `, [eventId, eventId]);

    res.json({
      event,
      validation: {
        missingQRTokens: missingTokens.length,
        missingTokens: missingTokens.length > 0 ? missingTokens : null,
        orphanedConsumptions: orphanedConsumptions.length,
        orphaned: orphanedConsumptions.length > 0 ? orphanedConsumptions : null,
        isValid: missingTokens.length === 0 && orphanedConsumptions.length === 0
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Event sync error:', err);
    res.status(500).json({ error: 'Failed to validate event' });
  }
});
```

---

## Implementation Checklist

- [ ] **Step 1:** Remove duplicate table definitions from `schema.sql` (lines 141-186)
- [ ] **Step 2:** Add `consumed_count` column to `meal_allocations` table
- [ ] **Step 3:** Add reconciliation trigger for transactions
- [ ] **Step 4:** Replace string-based time comparison with `timeStringToSeconds()` and `isTimeInRange()` functions
- [ ] **Step 5:** Update `/api/user/dashboard` with accurate remaining counts
- [ ] **Step 6:** Update `/api/vendor/dashboard` with real-time stats
- [ ] **Step 7:** Update `/api/admin/dashboard` with pagination and filtering
- [ ] **Step 8:** Add `/api/admin/events/:eventId/consumption-report`
- [ ] **Step 9:** Add `/api/admin/events/:eventId/live-feed`
- [ ] **Step 10:** Update `/api/admin/daily-breakdown` to combine both modes
- [ ] **Step 11:** Add `/api/admin/reconciliation/validate` endpoint
- [ ] **Step 12:** Add `/api/admin/sync/meal-allocations` endpoint
- [ ] **Step 13:** Add `/api/admin/sync/event-consumptions` endpoint
- [ ] **Step 14:** Test all endpoints with sample data
- [ ] **Step 15:** Monitor logs for any discrepancies

---

## Quick Verification Commands

After implementing the fixes, run these checks:

```bash
# 1. Verify schema consistency
node -e "const db = require('sqlite3'); const database = new db.Database('./meal_system.db'); database.all(\"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'event%'\", (e, rows) => { console.log('Event tables:', rows.length); database.close(); });"

# 2. Test reconciliation endpoint
curl -X GET http://localhost:3000/api/admin/reconciliation/validate \
  -H "Cookie: session_token=YOUR_TOKEN"

# 3. Verify no allocation discrepancies
curl -X GET http://localhost:3000/api/admin/dashboard \
  -H "Cookie: session_token=YOUR_TOKEN"
```

---

## Success Criteria

✅ **All dashboards show real-time data within 5 seconds of transaction**
✅ **No allocation discrepancies between remaining and transactions**
✅ **Event mode and legacy mode both visible in daily breakdowns**
✅ **Admin can view complete event consumption reports**
✅ **Live feed shows all transactions with pagination**
✅ **Reconciliation endpoint identifies and flags any issues**
✅ **Sync endpoints successfully correct discrepancies**
✅ **Time window detection is accurate within 1 second**

---

## Support & Troubleshooting

**Issue: Dashboard still shows stale data after updates**
- Check browser cache (Ctrl+Shift+Delete in Chrome)
- Verify the `/api/user/dashboard` query is using `LEFT JOIN` correctly
- Check that `transaction_time` is being set correctly in transactions table

**Issue: Time window detection failing**
- Verify meal_types start_time and end_time are in HH:MM format
- Check system time is correct on server
- Test `isTimeInRange()` function with known meal periods

**Issue: Event consumption not appearing in dashboards**
- Verify `event_registrations` entries exist
- Check `event_consumptions` records are being inserted
- Run `/api/admin/sync/event-consumptions` validation

**Issue: Reconciliation showing many discrepancies**
- Run `/api/admin/sync/meal-allocations` to recalculate
- Check transaction logs for any failed updates
- Verify no orphaned transactions exist
