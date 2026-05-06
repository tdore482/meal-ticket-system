# Meal Tracking System: Implementation Guide & Code Patches

## Overview

This document provides ready-to-use code patches for implementing the fixes outlined in the diagnostic prompt. Apply changes in the order specified.

---

## PATCH 1: Fix Schema & Add Utility Functions

### File: `schema.sql`

**Remove duplicate table definitions (lines 141-186):**

```sql
-- DELETE THESE DUPLICATE LINES (141-186):
-- -- Events (e.g. "Annual Conference 2025", "Day 1")
-- CREATE TABLE IF NOT EXISTS events (
--   id TEXT PRIMARY KEY,
--   name TEXT NOT NULL,
--   start_date TEXT NOT NULL,
--   end_date TEXT NOT NULL,
--   active INTEGER DEFAULT 1,
--   created_at DATETIME DEFAULT CURRENT_TIMESTAMP
-- );
-- 
-- -- Users registered for an event
-- CREATE TABLE IF NOT EXISTS event_registrations (
--   id TEXT PRIMARY KEY,
--   event_id TEXT NOT NULL,
--   user_id TEXT NOT NULL,
--   UNIQUE(event_id, user_id),
--   FOREIGN KEY (event_id) REFERENCES events(id),
--   FOREIGN KEY (user_id) REFERENCES users(id)
-- );
-- 
-- -- One QR token per user per event (long-lived, valid for event duration)
-- CREATE TABLE IF NOT EXISTS event_qr_tokens (
--   id TEXT PRIMARY KEY,
--   event_id TEXT NOT NULL,
--   user_id TEXT NOT NULL,
--   token TEXT UNIQUE NOT NULL,
--   created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
--   UNIQUE(event_id, user_id),
--   FOREIGN KEY (event_id) REFERENCES events(id),
--   FOREIGN KEY (user_id) REFERENCES users(id)
-- );
-- 
-- -- Tracks which meal types user has consumed in this event
-- CREATE TABLE IF NOT EXISTS event_consumptions (
--   id TEXT PRIMARY KEY,
--   event_id TEXT NOT NULL,
--   user_id TEXT NOT NULL,
--   meal_type_id TEXT NOT NULL,
--   consumed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
--   vendor_id TEXT,
--   UNIQUE(event_id, user_id, meal_type_id),
--   FOREIGN KEY (event_id) REFERENCES events(id),
--   FOREIGN KEY (user_id) REFERENCES users(id),
--   FOREIGN KEY (meal_type_id) REFERENCES meal_types(id),
--   FOREIGN KEY (vendor_id) REFERENCES vendors(id)
-- );
```

**Add new column to meal_allocations:**

```sql
-- Add at the end of schema.sql before any transaction statements:
ALTER TABLE meal_allocations ADD COLUMN consumed_count INTEGER DEFAULT 0;

-- Add trigger to automatically update consumed_count when transaction is inserted
CREATE TRIGGER IF NOT EXISTS update_allocation_consumed_count
AFTER INSERT ON transactions
FOR EACH ROW
BEGIN
  UPDATE meal_allocations
  SET consumed_count = (
    SELECT COUNT(*) FROM transactions 
    WHERE user_id = NEW.user_id AND meal_type_id = NEW.meal_type_id
  ),
  updated_at = datetime('now')
  WHERE user_id = NEW.user_id AND meal_type_id = NEW.meal_type_id;
END;
```

---

## PATCH 2: Add Utility Functions to server.js

### File: `server.js`

**Add these functions after the input sanitization section (after line 95):**

```javascript
// ===== TIME UTILITY FUNCTIONS =====

/**
 * Convert HH:MM time string to total seconds
 * @param {string} timeStr - Time in format "HH:MM" (e.g., "14:30")
 * @returns {number} Total seconds since midnight
 */
function timeStringToSeconds(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return null;
  return (hours * 3600) + (minutes * 60);
}

/**
 * Get current time in seconds
 * @returns {number} Current seconds since midnight
 */
function getCurrentTimeInSeconds() {
  const now = new Date();
  return (now.getHours() * 3600) + (now.getMinutes() * 60) + now.getSeconds();
}

/**
 * Check if a given time falls within a range
 * @param {number} currentSeconds - Current time in seconds
 * @param {string} startTime - Start time in "HH:MM" format
 * @param {string} endTime - End time in "HH:MM" format
 * @returns {boolean} True if current time is within range
 */
function isTimeInRange(currentSeconds, startTime, endTime) {
  const startSeconds = timeStringToSeconds(startTime);
  const endSeconds = timeStringToSeconds(endTime);
  
  if (startSeconds === null || endSeconds === null) {
    return false;
  }
  
  // Handle cross-midnight ranges (e.g., 23:00 to 01:00)
  if (startSeconds < endSeconds) {
    return currentSeconds >= startSeconds && currentSeconds < endSeconds;
  } else {
    return currentSeconds >= startSeconds || currentSeconds < endSeconds;
  }
}

/**
 * Find active meal period
 * @param {Array} mealTypes - Array of meal type objects with start_time, end_time
 * @returns {Object|null} Active meal type or null
 */
function findActiveMeal(mealTypes) {
  const currentSeconds = getCurrentTimeInSeconds();
  return mealTypes.find(m => isTimeInRange(currentSeconds, m.start_time, m.end_time)) || null;
}

// ===== END TIME UTILITY FUNCTIONS =====
```

---

## PATCH 3: Update User Dashboard Endpoint

### File: `server.js`

**Replace the existing `/api/user/dashboard` endpoint (around line 341):**

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
        ma.id as allocation_id,
        COALESCE(ma.allocated, 0) as allocated,
        COALESCE(ma.allocated - COUNT(t.id), COALESCE(ma.allocated, 0)) as remaining,
        COUNT(t.id) as consumed
      FROM meal_types mt
      LEFT JOIN meal_allocations ma ON mt.id = ma.meal_type_id AND ma.user_id = ?
      LEFT JOIN transactions t ON ma.user_id = t.user_id AND mt.id = t.meal_type_id
      WHERE mt.active = 1
      GROUP BY mt.id, mt.name, mt.start_time, mt.end_time, ma.id, ma.allocated
      ORDER BY mt.start_time
    `, [req.session.user_id]);

    // Find active meal
    const activeMeal = findActiveMeal(meals) || null;

    // Calculate totals
    const totalAllocated = meals.reduce((sum, m) => sum + (m.allocated || 0), 0);
    const totalConsumed = meals.reduce((sum, m) => sum + (m.consumed || 0), 0);
    const totalRemaining = meals.reduce((sum, m) => sum + (m.remaining || 0), 0);

    res.json({
      user: { 
        id: user.id, 
        name: user.name, 
        regNum: user.registration_number 
      },
      meals,
      activeMeal,
      summary: {
        totalAllocated,
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
```

---

## PATCH 4: Update Vendor Dashboard Endpoint

### File: `server.js`

**Replace the existing `/api/vendor/dashboard` endpoint (around line 429):**

```javascript
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
    const mealTypes = await dbAll(
      'SELECT id, name, start_time, end_time, active FROM meal_types WHERE active = 1 ORDER BY start_time',
      []
    );

    // Find active meal
    const activeMeal = findActiveMeal(mealTypes) || null;

    // Get consumption stats for each meal type (today)
    const today = new Date().toISOString().split('T')[0];
    const mealStats = await Promise.all(mealTypes.map(async (meal) => {
      const stats = await dbGet(`
        SELECT 
          COUNT(DISTINCT t.user_id) as users_consumed,
          COUNT(*) as total_redemptions
        FROM transactions t
        WHERE t.meal_type_id = ? AND t.transaction_date = ?
      `, [meal.id, today]);
      
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
      today,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Vendor dashboard error:', err);
    res.status(500).json({ error: 'Failed to load vendor dashboard' });
  }
});
```

---

## PATCH 5: Update Admin Dashboard Endpoint with Pagination

### File: `server.js`

**Replace the existing `/api/admin/dashboard` endpoint (around line 699):**

```javascript
/**
 * GET /api/admin/dashboard
 * UPDATED: Real-time stats with pagination and filtering
 * Query params: offset, limit, mealTypeId, vendorId, dateFilter
 */
app.get('/api/admin/dashboard', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const today = new Date().toISOString().split('T')[0];
    const { offset = '0', limit = '20', mealTypeId, vendorId, dateFilter } = req.query;
    const offsetNum = Math.max(0, parseInt(offset) || 0);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const filterDate = dateFilter || today;

    // Build dynamic WHERE clause for filtering
    let whereConditions = ['t.transaction_date = ?'];
    let params = [filterDate];

    if (mealTypeId && mealTypeId !== 'all' && mealTypeId.trim().length > 0) {
      whereConditions.push('t.meal_type_id = ?');
      params.push(mealTypeId);
    }

    if (vendorId && vendorId !== 'all' && vendorId.trim().length > 0) {
      whereConditions.push('t.vendor_id = ?');
      params.push(vendorId);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get summary stats by meal type
    const stats = await dbAll(`
      SELECT mt.id, mt.name, COALESCE(COUNT(t.id), 0) as count
      FROM meal_types mt
      LEFT JOIN transactions t ON mt.id = t.meal_type_id AND ${whereClause}
      WHERE mt.active = 1
      GROUP BY mt.id, mt.name
      ORDER BY mt.start_time
    `, params);

    const total = stats.reduce((sum, s) => sum + (s.count || 0), 0);

    // Get paginated transactions with detailed info
    const paramsForTx = [...params, limitNum, offsetNum];
    const transactions = await dbAll(`
      SELECT 
        t.id,
        t.transaction_date,
        strftime('%H:%M:%S', t.transaction_time) as transaction_time,
        u.id as user_id,
        u.name as user_name,
        u.registration_number,
        v.id as vendor_id,
        v.name as vendor_name,
        mt.id as meal_type_id,
        mt.name as meal_name,
        t.meal_remaining_after
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      JOIN vendors v ON t.vendor_id = v.id
      JOIN meal_types mt ON t.meal_type_id = mt.id
      WHERE ${whereClause}
      ORDER BY t.transaction_time DESC
      LIMIT ? OFFSET ?
    `, paramsForTx);

    // Get total count for pagination info
    const countResult = await dbGet(`
      SELECT COUNT(*) as total FROM transactions t WHERE ${whereClause}
    `, params);

    const totalCount = countResult?.total || 0;

    res.json({
      summary: { 
        stats, 
        total, 
        date: filterDate,
        lastUpdated: new Date().toISOString()
      },
      transactions,
      pagination: {
        offset: offsetNum,
        limit: limitNum,
        total: totalCount,
        hasMore: (offsetNum + limitNum) < totalCount,
        pages: Math.ceil(totalCount / limitNum)
      },
      filters: {
        dateFilter,
        mealTypeId: mealTypeId || 'all',
        vendorId: vendorId || 'all'
      }
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).json({ error: 'Failed to load admin dashboard' });
  }
});
```

---

## PATCH 6: Update Daily Breakdown (Combined Mode)

### File: `server.js`

**Replace the existing `/api/admin/daily-breakdown` endpoint (around line 743):**

```javascript
/**
 * GET /api/admin/daily-breakdown
 * UPDATED: Combines legacy transactions AND event consumptions
 * Shows meal consumption across both modes
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

    // Legacy mode transactions for this date
    const legacyBreakdown = await dbAll(`
      SELECT 
        mt.id,
        mt.name, 
        COALESCE(COUNT(t.id), 0) as count,
        'legacy' as mode
      FROM meal_types mt
      LEFT JOIN transactions t ON mt.id = t.meal_type_id AND t.transaction_date = ?
      WHERE mt.active = 1
      GROUP BY mt.id, mt.name
      ORDER BY mt.start_time
    `, [date]);

    // Event mode consumptions for this date
    const eventBreakdown = await dbAll(`
      SELECT 
        mt.id,
        mt.name, 
        COALESCE(COUNT(ec.id), 0) as count,
        'event' as mode
      FROM meal_types mt
      LEFT JOIN event_consumptions ec ON mt.id = ec.meal_type_id 
        AND DATE(ec.consumed_at) = ?
      WHERE mt.active = 1
      GROUP BY mt.id, mt.name
      ORDER BY mt.start_time
    `, [date]);

    // Combined view
    const combined = await dbAll(`
      SELECT 
        mt.id, 
        mt.name,
        COALESCE((
          SELECT COUNT(*) FROM transactions t 
          WHERE t.meal_type_id = mt.id AND t.transaction_date = ?
        ), 0) as legacy_count,
        COALESCE((
          SELECT COUNT(*) FROM event_consumptions ec 
          WHERE ec.meal_type_id = mt.id AND DATE(ec.consumed_at) = ?
        ), 0) as event_count
      FROM meal_types mt
      WHERE mt.active = 1
      ORDER BY mt.start_time
    `, [date, date]);

    const legacyTotal = legacyBreakdown.reduce((sum, b) => sum + (b.count || 0), 0);
    const eventTotal = eventBreakdown.reduce((sum, b) => sum + (b.count || 0), 0);
    const grandTotal = combined.reduce((sum, c) => sum + (c.legacy_count || 0) + (c.event_count || 0), 0);

    res.json({
      date,
      breakdown: {
        legacy: legacyBreakdown,
        event: eventBreakdown,
        combined: combined
      },
      totals: {
        legacy: legacyTotal,
        event: eventTotal,
        grand_total: grandTotal
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

## PATCH 7: Add Event Consumption Report Endpoint

### File: `server.js`

**Add this endpoint after the existing event endpoints (around line 1400):**

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

    // Get all registrations crossed with meal types and their consumptions
    const report = await dbAll(`
      SELECT 
        er.id as registration_id,
        er.user_id,
        u.registration_number,
        u.name as user_name,
        mt.id as meal_type_id,
        mt.name as meal_type_name,
        mt.start_time,
        CASE WHEN ec.id IS NOT NULL THEN 1 ELSE 0 END as consumed,
        ec.id as consumption_id,
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
        mt.start_time,
        COUNT(DISTINCT er.user_id) as total_registered,
        COUNT(DISTINCT ec.user_id) as total_consumed,
        COUNT(DISTINCT er.user_id) - COUNT(DISTINCT ec.user_id) as pending,
        ROUND(100.0 * COUNT(DISTINCT ec.user_id) / COUNT(DISTINCT er.user_id), 1) as completion_percentage
      FROM event_registrations er
      JOIN meal_types mt ON mt.active = 1
      LEFT JOIN event_consumptions ec ON 
        er.event_id = ec.event_id AND 
        mt.id = ec.meal_type_id AND
        er.user_id = ec.user_id
      WHERE er.event_id = ?
      GROUP BY mt.id, mt.name, mt.start_time
      ORDER BY mt.start_time
    `, [eventId]);

    res.json({
      event,
      summary,
      detail: report,
      totalRegistrations: report.length > 0 ? Math.max(...report.map(r => r.user_id).filter((v, i, a) => a.indexOf(v) === i).length) : 0,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Event consumption report error:', err);
    res.status(500).json({ error: 'Failed to fetch event report' });
  }
});
```

---

## PATCH 8: Add Event Live Feed Endpoint

### File: `server.js`

**Add this endpoint after the consumption report endpoint:**

```javascript
/**
 * GET /api/admin/events/:eventId/live-feed
 * Real-time transaction feed for an event
 * Query params: offset, limit
 */
app.get('/api/admin/events/:eventId/live-feed', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const { eventId } = req.params;
    const { offset = '0', limit = '50' } = req.query;
    const offsetNum = Math.max(0, parseInt(offset) || 0);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));

    const event = await dbGet('SELECT * FROM events WHERE id = ?', [eventId]);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Get paginated event consumptions
    const feed = await dbAll(`
      SELECT 
        ec.id,
        ec.consumed_at,
        u.id as user_id,
        u.name as user_name,
        u.registration_number,
        mt.id as meal_type_id,
        mt.name as meal_type,
        v.id as vendor_id,
        v.name as vendor_name,
        strftime('%H:%M:%S', ec.consumed_at) as consumption_time
      FROM event_consumptions ec
      JOIN users u ON ec.user_id = u.id
      JOIN meal_types mt ON ec.meal_type_id = mt.id
      LEFT JOIN vendors v ON ec.vendor_id = v.id
      WHERE ec.event_id = ?
      ORDER BY ec.consumed_at DESC
      LIMIT ? OFFSET ?
    `, [eventId, limitNum, offsetNum]);

    // Get total count
    const countResult = await dbGet(`
      SELECT COUNT(*) as total FROM event_consumptions WHERE event_id = ?
    `, [eventId]);

    const totalCount = countResult?.total || 0;

    res.json({
      event,
      feed,
      pagination: {
        offset: offsetNum,
        limit: limitNum,
        total: totalCount,
        hasMore: (offsetNum + limitNum) < totalCount,
        pages: Math.ceil(totalCount / limitNum)
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

## PATCH 9: Add Data Validation & Reconciliation Endpoints

### File: `server.js`

**Add these endpoints in the admin section (around line 1450):**

```javascript
/**
 * GET /api/admin/reconciliation/validate
 * Checks data consistency across all tables
 * Returns discrepancies and warnings
 */
app.get('/api/admin/reconciliation/validate', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const issues = [];
    
    // Check 1: meal_allocations vs transactions discrepancies
    const discrepancies = await dbAll(`
      SELECT 
        ma.user_id,
        u.registration_number,
        u.name,
        ma.meal_type_id,
        mt.name as meal_type_name,
        ma.allocated,
        ma.remaining,
        COUNT(t.id) as actual_consumed,
        ma.allocated - COUNT(t.id) as expected_remaining,
        ABS((ma.allocated - COUNT(t.id)) - ma.remaining) as discrepancy
      FROM meal_allocations ma
      JOIN users u ON ma.user_id = u.id
      JOIN meal_types mt ON ma.meal_type_id = mt.id
      LEFT JOIN transactions t ON ma.user_id = t.user_id AND ma.meal_type_id = t.meal_type_id
      GROUP BY ma.user_id, ma.meal_type_id, ma.allocated, ma.remaining
      HAVING discrepancy > 0
    `);
    
    if (discrepancies.length > 0) {
      issues.push({
        severity: 'HIGH',
        type: 'allocation_discrepancy',
        count: discrepancies.length,
        description: 'Remaining count does not match actual transactions',
        details: discrepancies.slice(0, 10) // Show first 10
      });
    }
    
    // Check 2: Event registrations vs consumptions
    const unconfirmed = await dbAll(`
      SELECT 
        er.event_id,
        e.name as event_name,
        er.user_id,
        u.registration_number,
        u.name as user_name,
        COUNT(ec.id) as meals_consumed,
        (SELECT COUNT(*) FROM meal_types WHERE active = 1) as total_meal_types
      FROM event_registrations er
      JOIN events e ON er.event_id = e.id
      JOIN users u ON er.user_id = u.id
      LEFT JOIN event_consumptions ec ON er.event_id = ec.event_id AND er.user_id = ec.user_id
      GROUP BY er.event_id, er.user_id
      HAVING meals_consumed < (SELECT COUNT(*) FROM meal_types WHERE active = 1)
      LIMIT 20
    `);
    
    if (unconfirmed.length > 0) {
      issues.push({
        severity: 'MEDIUM',
        type: 'incomplete_event_consumptions',
        count: unconfirmed.length,
        description: 'Registered users who have not consumed all meal types',
        details: unconfirmed.slice(0, 10)
      });
    }
    
    // Check 3: Users without meal allocations
    const unallocated = await dbAll(`
      SELECT u.id, u.registration_number, u.name
      FROM users u
      WHERE u.active = 1
      AND NOT EXISTS (SELECT 1 FROM meal_allocations WHERE user_id = u.id)
      LIMIT 20
    `);
    
    if (unallocated.length > 0) {
      issues.push({
        severity: 'MEDIUM',
        type: 'no_meal_allocations',
        count: unallocated.length,
        description: 'Active users without any meal allocations',
        details: unallocated
      });
    }

    // Check 4: Orphaned event consumptions
    const orphaned = await dbAll(`
      SELECT DISTINCT ec.event_id, ec.user_id, u.registration_number, u.name
      FROM event_consumptions ec
      JOIN users u ON ec.user_id = u.id
      WHERE NOT EXISTS (
        SELECT 1 FROM event_registrations 
        WHERE event_id = ec.event_id AND user_id = ec.user_id
      )
      LIMIT 20
    `);

    if (orphaned.length > 0) {
      issues.push({
        severity: 'HIGH',
        type: 'orphaned_consumptions',
        count: orphaned.length,
        description: 'Event consumptions for unregistered users',
        details: orphaned
      });
    }
    
    res.json({
      timestamp: new Date().toISOString(),
      isHealthy: issues.length === 0,
      issueCount: issues.length,
      issues
    });
  } catch (err) {
    console.error('Reconciliation validation error:', err);
    res.status(500).json({ error: 'Failed to validate system' });
  }
});

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

    const allocations = await dbAll(`
      SELECT DISTINCT ma.id, ma.user_id, ma.meal_type_id, ma.allocated 
      FROM meal_allocations ma
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
        const newRemaining = (alloc.allocated || 0) - consumedCount;

        // Update
        await dbRun(`
          UPDATE meal_allocations 
          SET remaining = ?, consumed_count = ?, updated_at = datetime('now')
          WHERE id = ?
        `, [newRemaining, consumedCount, alloc.id]);

        updated++;
      } catch (err) {
        errors.push({
          allocation_id: alloc.id,
          user_id: alloc.user_id,
          meal_type_id: alloc.meal_type_id,
          error: err.message
        });
      }
    }

    res.json({
      success: true,
      updated,
      totalAllocations: allocations.length,
      errorCount: errors.length,
      errors: errors.length > 0 ? errors : null,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Sync allocations error:', err);
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
      LIMIT 20
    `, [eventId, eventId]);

    // Check for orphaned consumptions
    const orphanedConsumptions = await dbAll(`
      SELECT DISTINCT ec.user_id, u.registration_number, u.name
      FROM event_consumptions ec
      JOIN users u ON ec.user_id = u.id
      WHERE ec.event_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM event_registrations 
        WHERE event_id = ? AND user_id = ec.user_id
      )
      LIMIT 20
    `, [eventId, eventId]);

    res.json({
      event,
      validation: {
        missingQRTokens: missingTokens.length,
        missingTokensDetail: missingTokens.length > 0 ? missingTokens : null,
        orphanedConsumptions: orphanedConsumptions.length,
        orphanedDetail: orphanedConsumptions.length > 0 ? orphanedConsumptions : null,
        isValid: missingTokens.length === 0 && orphanedConsumptions.length === 0
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Event sync validation error:', err);
    res.status(500).json({ error: 'Failed to validate event' });
  }
});
```

---

## PATCH 10: Update QR Validation to Use New Time Functions

### File: `server.js`

**In the `/api/vendor/validate-qr` endpoint, find the section that determines active meal (around line 532) and replace:**

```javascript
// OLD CODE (lines 532-539):
const now = new Date();
const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

const activeMeal = await dbGet(
  `SELECT id FROM meal_types
   WHERE ? >= start_time AND ? < end_time AND active = 1`,
  [currentTime, currentTime]
);

// NEW CODE:
const allMeals = await dbAll(
  'SELECT id, start_time, end_time FROM meal_types WHERE active = 1',
  []
);

const activeMeal = findActiveMeal(allMeals);
if (!activeMeal) {
  return res.status(400).json({
    status: 'denied',
    message: 'No Active Meal Period'
  });
}
```

---

## Testing Checklist

After applying all patches, test the following:

```bash
# 1. Test user dashboard accuracy
curl -X GET http://localhost:3000/api/user/dashboard \
  -H "Cookie: session_token=USER_SESSION_TOKEN" | jq '.summary'

# 2. Test vendor dashboard with stats
curl -X GET http://localhost:3000/api/vendor/dashboard \
  -H "Cookie: session_token=VENDOR_SESSION_TOKEN" | jq '.mealTypes[].stats'

# 3. Test admin dashboard pagination
curl -X GET 'http://localhost:3000/api/admin/dashboard?offset=0&limit=10' \
  -H "Cookie: session_token=ADMIN_SESSION_TOKEN" | jq '.pagination'

# 4. Test daily breakdown with combined mode
curl -X GET 'http://localhost:3000/api/admin/daily-breakdown?date=2025-02-16' \
  -H "Cookie: session_token=ADMIN_SESSION_TOKEN" | jq '.totals'

# 5. Test reconciliation
curl -X GET http://localhost:3000/api/admin/reconciliation/validate \
  -H "Cookie: session_token=ADMIN_SESSION_TOKEN" | jq '.isHealthy'

# 6. Test event consumption report
curl -X GET 'http://localhost:3000/api/admin/events/EV123456/consumption-report' \
  -H "Cookie: session_token=ADMIN_SESSION_TOKEN" | jq '.summary'

# 7. Test event live feed
curl -X GET 'http://localhost:3000/api/admin/events/EV123456/live-feed?offset=0&limit=20' \
  -H "Cookie: session_token=ADMIN_SESSION_TOKEN" | jq '.feed | length'
```

---

## Deployment Steps

1. **Backup database:** `cp meal_system.db meal_system.db.backup`
2. **Apply schema changes:** Run updated `schema.sql`
3. **Restart server:** `npm start`
4. **Run validation:** `GET /api/admin/reconciliation/validate`
5. **Run sync if needed:** `POST /api/admin/sync/meal-allocations`
6. **Verify dashboards:** Test all endpoints
7. **Monitor logs:** Watch for any data inconsistencies

---

## Rollback Plan

If issues occur:

```bash
# 1. Restore database
cp meal_system.db.backup meal_system.db

# 2. Restart with old code
git checkout HEAD -- server.js schema.sql
npm start

# 3. Investigate issue and retry
```
