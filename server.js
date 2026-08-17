/**
 * Meal Ticket Management System - Backend API
 * Express.js + PostgreSQL (Supabase)
 * Run: npm install && node setup-db.js && npm start
 */

// Expand the libuv threadpool so CPU-bound work (bcrypt, QR, ZIP) is faster
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '12';

const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const JSZip = require('jszip');
require('dotenv').config();

const { dbRun, dbGet, dbAll, getClient, closePool } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '20mb' }));
app.use(express.static('public', {
  setHeaders: (res, filePath) => {
    // Long-lived cache for hashed/unversioned assets, revalidate HTML
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

// Input Sanitization & Validation
const sanitizeString = (str, maxLen = 100) => {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen).replace(/[<>'";&]/g, '');
};

const sanitizeAlphanumeric = (str, maxLen = 50) => {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen).replace(/[^a-zA-Z0-9_-]/g, '');
};

const sanitizeNumeric = (str) => {
  if (typeof str === 'number') return str;
  if (typeof str !== 'string') return null;
  const num = parseInt(str, 10);
  return isNaN(num) ? null : num;
};

const validateRegistrationNumber = (regNum) => {
  if (!regNum || typeof regNum !== 'string') return false;
  return /^[A-Za-z0-9_-]{3,20}$/.test(regNum.trim());
};

const validatePin = (pin) => {
  if (!pin || typeof pin !== 'string') return false;
  return /^\d{4,6}$/.test(pin);
};

const validatePassword = (password) => {
  if (!password || typeof password !== 'string') return false;
  return password.length >= 4 && password.length <= 50;
};

const validateName = (name) => {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 100 && /^[a-zA-Z\s'-]+$/.test(trimmed);
};

// ===== TIME UTILITY FUNCTIONS =====

// Meal schedules are entered in the school's local timezone (Africa/Harare,
// UTC+2, no DST). Evaluate "now" in that timezone regardless of where the
// server runs (local dev vs Vercel regions).
const APP_TIMEZONE = process.env.TIMEZONE || 'Africa/Harare';

function timeStringToSeconds(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return null;
  return (hours * 3600) + (minutes * 60);
}

function getCurrentTimeInSeconds() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());

  const get = (type) => {
    const part = parts.find(p => p.type === type);
    return part ? parseInt(part.value, 10) : 0;
  };

  return (get('hour') * 3600) + (get('minute') * 60) + get('second');
}

function isTimeInRange(currentSeconds, startTime, endTime) {
  const startSeconds = timeStringToSeconds(startTime);
  const endSeconds = timeStringToSeconds(endTime);

  if (startSeconds === null || endSeconds === null) {
    return false;
  }

  if (startSeconds < endSeconds) {
    return currentSeconds >= startSeconds && currentSeconds < endSeconds;
  } else {
    return currentSeconds >= startSeconds || currentSeconds < endSeconds;
  }
}

function findActiveMeal(mealTypes) {
  const currentSeconds = getCurrentTimeInSeconds();
  return mealTypes.find(m => isTimeInRange(currentSeconds, m.start_time, m.end_time)) || null;
}

// ===== END TIME UTILITY FUNCTIONS =====

// Utilities
function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

function generateToken() {
  return crypto.randomBytes(10).toString('hex').toUpperCase();
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Middleware: Verify Session Token
const authenticateSession = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No session token provided' });
  }

  try {
    const session = await dbGet(
      `SELECT * FROM sessions 
       WHERE session_token = ? AND expires_at > NOW()`,
      [token]
    );

    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    req.session = session;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Authentication failed' });
  }
};

// ===== AUTHENTICATION ROUTES =====

/**
 * POST /api/auth/register
 */
app.post('/api/auth/register', async (req, res) => {
  try {
    const rawName = req.body.name;
    const rawRegNum = req.body.registrationNumber;
    const rawPin = req.body.pin;
    const accommodation = (req.body.accommodation || 'Y').toString().trim().toUpperCase();
    const isAccom = accommodation === 'Y';
    const mealAllocation = isAccom ? 12 : 4;

    if (!rawName || !rawRegNum || !rawPin) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const name = sanitizeString(rawName, 100);
    const registrationNumber = sanitizeAlphanumeric(rawRegNum, 20);
    const pin = sanitizeString(rawPin, 6);

    if (!validateName(rawName)) {
      return res.status(400).json({ error: 'Invalid name format' });
    }
    if (!validateRegistrationNumber(rawRegNum)) {
      return res.status(400).json({ error: 'Invalid registration number format' });
    }
    if (!validatePin(rawPin)) {
      return res.status(400).json({ error: 'Invalid PIN format (4-6 digits)' });
    }

    const existing = await dbGet(
      'SELECT id FROM users WHERE registration_number = ?',
      [registrationNumber]
    );

    if (existing) {
      return res.status(400).json({ error: 'Registration number already exists' });
    }

    const userId = generateId();
    const pinHash = await hashPassword(pin);

    await dbRun(
      `INSERT INTO users (id, registration_number, name, pin_hash, accommodation, active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [userId, registrationNumber, name, pinHash, accommodation]
    );

    const mealTypes = await dbAll('SELECT id FROM meal_types WHERE active = 1');

    for (const mealType of mealTypes) {
      const allocId = generateId();
      await dbRun(
        `INSERT INTO meal_allocations (id, user_id, meal_type_id, allocated, remaining)
         VALUES (?, ?, ?, ?, ?)`,
        [allocId, userId, mealType.id, mealAllocation, mealAllocation]
      );
    }

    res.json({
      success: true,
      message: 'User registered successfully',
      userId,
      registrationNumber
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * POST /api/auth/login
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const rawRole = req.body.role;
    const rawRegNum = req.body.registrationNumber;
    const rawPin = req.body.pin;
    const rawVendorCode = req.body.vendorCode;
    const rawUsername = req.body.username;
    const rawPassword = req.body.password;

    if (!rawRole) {
      return res.status(400).json({ error: 'Role required' });
    }

    const role = sanitizeAlphanumeric(rawRole, 20);
    if (!['user', 'vendor', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    let userId, vendorId, adminId, sessionData = {};

    if (role === 'user') {
      const registrationNumber = sanitizeAlphanumeric(rawRegNum, 20);
      const pin = sanitizeString(rawPin, 6);

      if (!validateRegistrationNumber(rawRegNum) || !validatePin(rawPin)) {
        return res.status(400).json({ error: 'Invalid input format' });
      }

      const user = await dbGet(
        'SELECT * FROM users WHERE registration_number = ?',
        [registrationNumber]
      );

      if (!user || !(await verifyPassword(pin, user.pin_hash))) {
        return res.status(401).json({ error: 'Invalid registration number or PIN' });
      }

      if (!user.active) {
        return res.status(403).json({ error: 'Account suspended' });
      }

      userId = user.id;
      sessionData = { userId, name: user.name, regNum: user.registration_number };
    } else if (role === 'vendor') {
      const vendorCode = sanitizeAlphanumeric(rawVendorCode, 30);

      if (!vendorCode) {
        return res.status(400).json({ error: 'Vendor code required' });
      }

      const vendor = await dbGet(
        'SELECT * FROM vendors WHERE vendor_code = ?',
        [vendorCode]
      );

      if (!vendor || !vendor.active) {
        return res.status(401).json({ error: 'Invalid vendor code' });
      }

      vendorId = vendor.id;
      sessionData = { vendorId, name: vendor.name };
    } else if (role === 'admin') {
      const username = sanitizeString(rawUsername, 50);
      const password = sanitizeString(rawPassword, 50);

      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
      }

      const admin = await dbGet(
        'SELECT * FROM admins WHERE username = ?',
        [username]
      );

      if (!admin || !(await verifyPassword(password, admin.password_hash))) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      if (!admin.active) {
        return res.status(403).json({ error: 'Admin account disabled' });
      }

      adminId = admin.id;
      sessionData = { adminId, username: admin.username };
    } else {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Create session
    const sessionId = generateId();
    const sessionToken = generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await dbRun(
      `INSERT INTO sessions (id, user_id, vendor_id, admin_id, session_token, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionId, userId || null, vendorId || null, adminId || null, sessionToken, expiresAt]
    );

    res.json({
      success: true,
      token: sessionToken,
      role,
      ...sessionData
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /api/auth/logout
 */
app.post('/api/auth/logout', authenticateSession, async (req, res) => {
  try {
    await dbRun('DELETE FROM sessions WHERE id = ?', [req.session.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ===== USER ROUTES =====

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

    // Get meals with accurate remaining count (calculated from transactions + event_consumptions)
    const meals = await dbAll(`
      SELECT 
        mt.id, 
        mt.name, 
        mt.start_time, 
        mt.end_time,
        ma.id as allocation_id,
        COALESCE(ma.allocated, 0) as allocated,
        (COALESCE(ma.allocated, 0) - (
          COALESCE((SELECT COUNT(*) FROM transactions t WHERE t.user_id = ? AND t.meal_type_id = mt.id), 0) +
          COALESCE((SELECT COUNT(*) FROM event_consumptions ec WHERE ec.user_id = ? AND ec.meal_type_id = mt.id), 0)
        )) as remaining,
        (
          COALESCE((SELECT COUNT(*) FROM transactions t WHERE t.user_id = ? AND t.meal_type_id = mt.id), 0) +
          COALESCE((SELECT COUNT(*) FROM event_consumptions ec WHERE ec.user_id = ? AND ec.meal_type_id = mt.id), 0)
        ) as consumed
      FROM meal_types mt
      LEFT JOIN meal_allocations ma ON mt.id = ma.meal_type_id AND ma.user_id = ?
      WHERE mt.active = 1
      ORDER BY mt.start_time
    `, [req.session.user_id, req.session.user_id, req.session.user_id, req.session.user_id, req.session.user_id]);

    // Find active meal using new time utility
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

/**
 * POST /api/user/generate-qr
 */
app.post('/api/user/generate-qr', authenticateSession, async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(403).json({ error: 'Not a user session' });
    }

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.session.user_id]);

    // Use new time utility functions
    const allMeals = await dbAll(
      'SELECT id, start_time, end_time FROM meal_types WHERE active = 1',
      []
    );

    const activeMeal = findActiveMeal(allMeals);
    if (!activeMeal) {
      return res.status(400).json({ error: 'No active meal period' });
    }

    const tokenId = generateId();
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await dbRun(
      `INSERT INTO qr_tokens (id, user_id, token, expires_at)
       VALUES (?, ?, ?, ?)`,
      [tokenId, req.session.user_id, token, expiresAt]
    );

    res.json({
      success: true,
      token,
      expiresAt,
      qrData: `REG:${user.registration_number}|TOKEN:${token}`
    });
  } catch (err) {
    console.error('QR generation error:', err);
    res.status(500).json({ error: 'Failed to generate QR token' });
  }
});

// ===== VENDOR ROUTES =====

/**
 * GET /api/vendor/dashboard
 * UPDATED: Real-time active meal detection and accurate meal counts (Legacy + Event)
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

    // Find active meal using new time utility
    const activeMeal = findActiveMeal(mealTypes) || null;

    // Get consumption stats for each meal type (today)
    const today = new Date().toISOString().split('T')[0];
    const mealStats = await Promise.all(mealTypes.map(async (meal) => {
      // Legacy Stats
      const legacyStats = await dbGet(`
        SELECT 
          COUNT(DISTINCT t.user_id) as users_consumed,
          COUNT(*) as total_redemptions
        FROM transactions t
        WHERE t.meal_type_id = ? AND t.transaction_date = ?
      `, [meal.id, today]);

      // Event Stats
      const eventStats = await dbGet(`
        SELECT 
          COUNT(DISTINCT ec.user_id) as users_consumed,
          COUNT(*) as total_redemptions
        FROM event_consumptions ec
        WHERE ec.meal_type_id = ? AND DATE(ec.consumed_at) = ?
      `, [meal.id, today]);

      return {
        ...meal,
        stats: {
          usersConsumed: (legacyStats?.users_consumed || 0) + (eventStats?.users_consumed || 0),
          totalRedemptions: (legacyStats?.total_redemptions || 0) + (eventStats?.total_redemptions || 0)
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

/**
 * POST /api/vendor/validate-qr
 * Supports both legacy (REG:|TOKEN:) and event (EVT:|REG:|TOKEN:) QR formats.
 * For event mode: pass mealTypeId in body. For legacy: meal type inferred from current time.
 */
app.post('/api/vendor/validate-qr', authenticateSession, async (req, res) => {
  try {
    if (!req.session.vendor_id) {
      return res.status(403).json({ error: 'Not a vendor session' });
    }

    let qrData = (req.body.qrData || '').toString().trim().replace(/[\r\n]+/g, '').replace(/\s+/g, ' ');
    qrData = qrData.slice(0, 500);
    const rawMealTypeId = req.body.mealTypeId;
    const mealTypeId = rawMealTypeId ? sanitizeAlphanumeric(rawMealTypeId, 50) : null;

    if (!qrData) {
      return res.status(400).json({ error: 'QR data required' });
    }

    console.log(`🔍 Processing Scan: [${qrData}] (MealType: ${mealTypeId})`);

    // Event mode: EVT:{eventId}|REG:{regNum}|TOKEN:{token}
    const evtMatch = qrData.match(/EVT:([A-Za-z0-9_-]+).*REG:([A-Za-z0-9_-]+).*TOKEN:([A-Za-z0-9]+)/i);
    if (evtMatch) {
      const [, eventId, regNum, tokenStr] = evtMatch;
      return await handleEventValidation(req, res, { eventId, regNum, tokenStr, mealTypeId });
    }

    // Legacy mode: REG:{regNum}|TOKEN:{token}
    const regMatch = qrData.match(/REG:([A-Za-z0-9_\-]+)/i);
    const tokenMatch = qrData.match(/TOKEN:([A-Za-z0-9]+)/i);

    if (!regMatch || !tokenMatch) {
      return res.status(400).json({
        status: 'denied',
        message: 'Invalid QR Format'
      });
    }

    const regNum = regMatch[1];
    const tokenStr = tokenMatch[1];

    const user = await dbGet(
      'SELECT * FROM users WHERE registration_number = ?',
      [regNum]
    );

    if (!user) {
      return res.status(400).json({
        status: 'denied',
        error: 'User Not Found',
        message: 'User Not Found'
      });
    }

    if (!user.active) {
      return res.status(400).json({
        status: 'denied',
        error: 'Account Suspended',
        message: 'Account Suspended'
      });
    }

    // Fixed: Case-insensitive token comparison
    const qrToken = await dbGet(
      `SELECT * FROM qr_tokens
       WHERE user_id = ? 
       AND UPPER(TRIM(token)) = UPPER(TRIM(?)) 
       AND used = 0
       AND expires_at > NOW()`,
      [user.id, tokenStr]
    );

    if (!qrToken) {
      return res.status(400).json({
        status: 'denied',
        message: 'Invalid or Expired Token'
      });
    }

    // Use new time utility functions for active meal detection
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

    const allocation = await dbGet(
      `SELECT * FROM meal_allocations
       WHERE user_id = ? AND meal_type_id = ?`,
      [user.id, activeMeal.id]
    );

    if (!allocation || allocation.remaining <= 0) {
      const mealType = await dbGet(
        'SELECT name FROM meal_types WHERE id = ?',
        [activeMeal.id]
      );
      return res.status(400).json({
        status: 'denied',
        message: `No ${mealType.name} Remaining`
      });
    }

    // Check if user already redeemed this meal type today
    const todayDate = new Date().toISOString().split('T')[0];
    const existingTodayTx = await dbGet(
      `SELECT id FROM transactions
       WHERE user_id = ? AND meal_type_id = ? AND transaction_date = ?`,
      [user.id, activeMeal.id, todayDate]
    );
    if (existingTodayTx) {
      const mealType = await dbGet(
        'SELECT name FROM meal_types WHERE id = ?',
        [activeMeal.id]
      );
      return res.status(400).json({
        status: 'denied',
        message: `Already redeemed ${mealType.name} today`
      });
    }

    const newRemaining = allocation.remaining - 1;
    const txId = generateId();
    const txDate = new Date().toISOString().split('T')[0];

    try {
      const client = await getClient();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE qr_tokens SET used = 1 WHERE id = $1', [qrToken.id]);
        await client.query(
          'UPDATE meal_allocations SET remaining = $1, updated_at = NOW() WHERE id = $2',
          [newRemaining, allocation.id]
        );
        await client.query(
          'INSERT INTO transactions (id, user_id, vendor_id, meal_type_id, qr_token_id, meal_remaining_after, transaction_date, transaction_time) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())',
          [txId, user.id, req.session.vendor_id, activeMeal.id, qrToken.id, newRemaining, txDate]
        );
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      res.json({
        status: 'approved',
        message: `Authorized: ${user.name}`,
        remaining: newRemaining
      });
    } catch (txErr) {
      console.error('Transaction error:', txErr);
      res.status(500).json({
        status: 'denied',
        message: 'Transaction failed: ' + txErr.message
      });
      return;
    }
  } catch (err) {
    console.error('QR validation error:', err);
    res.status(500).json({
      status: 'denied',
      message: 'Transaction failed: ' + err.message
    });
  }
});

// Event validation handler
async function handleEventValidation(req, res, { eventId, regNum, tokenStr, mealTypeId }) {
  const event = await dbGet('SELECT * FROM events WHERE id = ? AND active = 1', [eventId]);
  if (!event) {
    return res.status(400).json({ status: 'denied', message: 'Event Not Found or Inactive' });
  }

  const today = new Date().toISOString().split('T')[0];
  if (today < event.start_date || today > event.end_date) {
    return res.status(400).json({ status: 'denied', message: 'Event Not Active for This Date' });
  }

  const user = await dbGet('SELECT * FROM users WHERE registration_number = ?', [regNum]);
  if (!user) {
    return res.status(400).json({ status: 'denied', message: 'User Not Found' });
  }
  if (!user.active) {
    return res.status(400).json({ status: 'denied', message: 'Account Suspended' });
  }

  const eventToken = await dbGet(
    `SELECT * FROM event_qr_tokens
     WHERE event_id = ? AND user_id = ? AND UPPER(TRIM(token)) = UPPER(TRIM(?))`,
    [eventId, user.id, tokenStr]
  );
  if (!eventToken) {
    return res.status(400).json({
      status: 'denied',
      error: 'Invalid Event Token',
      message: 'Invalid Event QR Token'
    });
  }

  // Check total meal limit based on accommodation (Y=12, N=4)
  const userInfo = await dbGet('SELECT accommodation FROM users WHERE id = ?', [user.id]);
  const mealLimit = (userInfo && userInfo.accommodation === 'N') ? 4 : 12;
  const currentConsumptions = await dbAll(
    `SELECT id FROM event_consumptions WHERE event_id = ? AND user_id = ?`,
    [eventId, user.id]
  );
  if (currentConsumptions.length >= mealLimit) {
    return res.status(400).json({
      status: 'denied',
      error: 'Event Meal Limit Reached',
      message: `Event Meal Limit Reached (Max ${mealLimit})`
    });
  }

  let mealType;
  if (mealTypeId) {
    mealType = await dbGet('SELECT * FROM meal_types WHERE id = ? AND active = 1', [mealTypeId]);
  }
  if (!mealType) {
    // Attempt real-time detection first
    const allMealTypes = await dbAll('SELECT * FROM meal_types WHERE active = 1');
    mealType = findActiveMeal(allMealTypes);

    // Fallback: If no strict time match, pick the NEXT upcoming or most recent meal 
    // to prevent vendor frustration during transitions
    if (!mealType && allMealTypes.length > 0) {
      // Sort by distance to current time if needed, but for now just pick the first available
      // active meal type to allow redemption
      mealType = allMealTypes[0];
    }
  }
  if (!mealType) {
    return res.status(400).json({ status: 'denied', message: 'No active meal types configured' });
  }

  // Check if user already redeemed this meal type today
  const todayConsumed = await dbGet(
    `SELECT id FROM event_consumptions
     WHERE event_id = ? AND user_id = ? AND meal_type_id = ? AND consumed_at::date = CURRENT_DATE`,
    [eventId, user.id, mealType.id]
  );
  if (todayConsumed) {
    return res.status(400).json({
      status: 'denied',
      message: `Already redeemed ${mealType.name} today`
    });
  }

  const consumptionId = generateId();
  await dbRun(
    `INSERT INTO event_consumptions (id, event_id, user_id, meal_type_id, vendor_id)
     VALUES (?, ?, ?, ?, ?)`,
    [consumptionId, eventId, user.id, mealType.id, req.session.vendor_id]
  );

  const consumptions = await dbAll(
    `SELECT meal_type_id FROM event_consumptions WHERE event_id = ? AND user_id = ?`,
    [eventId, user.id]
  );
  const remainingCount = 10 - consumptions.length;

  res.json({
    status: 'approved',
    message: `Authorized: ${user.name} - ${mealType.name} redeemed`,
    remaining: remainingCount,
    consumed: consumptions.length
  });
}

// ===== ADMIN ROUTES =====

/**
 * POST /api/admin/fix-database
 * Emergency database repair to allow multi-day redemptions
 */
app.post('/api/admin/fix-database', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    console.log('🛠️ Manual database repair triggered...');
    await dbRun(`CREATE TABLE IF NOT EXISTS event_consumptions_backup AS SELECT * FROM event_consumptions`);
    await dbRun(`DROP TABLE IF EXISTS event_consumptions`);
    await dbRun(`
      CREATE TABLE event_consumptions (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        meal_type_id TEXT NOT NULL,
        consumed_at TIMESTAMPTZ DEFAULT NOW(),
        vendor_id TEXT,
        FOREIGN KEY (event_id) REFERENCES events(id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (meal_type_id) REFERENCES meal_types(id),
        FOREIGN KEY (vendor_id) REFERENCES vendors(id)
      )
    `);
    await dbRun(`INSERT INTO event_consumptions SELECT * FROM event_consumptions_backup`);
    await dbRun(`DROP TABLE IF EXISTS event_consumptions_backup`);
    await dbRun(`UPDATE meal_allocations SET allocated = 10, remaining = 10`);
    console.log('✅ Manual repair complete.');

    res.json({ success: true, message: 'Database constraint removed. Multi-day meals now allowed.' });
  } catch (err) {
    console.error('Repair failed:', err);
    res.status(500).json({ error: 'Repair failed: ' + err.message });
  }
});

/**
 * GET /api/admin/dashboard
 * UPDATED: Real-time stats with pagination and filtering (Legacy + Event)
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

    // Build dynamic WHERE clause for Legacy
    let legacyWhere = ['t.transaction_date = ?'];
    let legacyParams = [filterDate];

    // Build dynamic WHERE clause for Event
    let eventWhere = ['DATE(ec.consumed_at) = ?'];
    let eventParams = [filterDate];

    if (mealTypeId && mealTypeId !== 'all' && mealTypeId.trim().length > 0) {
      legacyWhere.push('t.meal_type_id = ?');
      legacyParams.push(mealTypeId);

      eventWhere.push('ec.meal_type_id = ?');
      eventParams.push(mealTypeId);
    }

    if (vendorId && vendorId !== 'all' && vendorId.trim().length > 0) {
      legacyWhere.push('t.vendor_id = ?');
      legacyParams.push(vendorId);

      eventWhere.push('ec.vendor_id = ?');
      eventParams.push(vendorId);
    }

    const legacyWhereStr = legacyWhere.join(' AND ');
    const eventWhereStr = eventWhere.join(' AND ');

    // Get summary stats by meal type (Combined)
    const legacyStats = await dbAll(`
      SELECT mt.id, mt.name, COALESCE(COUNT(t.id), 0) as count
      FROM meal_types mt
      LEFT JOIN transactions t ON mt.id = t.meal_type_id AND ${legacyWhereStr}
      WHERE mt.active = 1
      GROUP BY mt.id, mt.name
      ORDER BY mt.start_time
    `, legacyParams);

    const eventStats = await dbAll(`
      SELECT mt.id, mt.name, COALESCE(COUNT(ec.id), 0) as count
      FROM meal_types mt
      LEFT JOIN event_consumptions ec ON mt.id = ec.meal_type_id AND ${eventWhereStr}
      WHERE mt.active = 1
      GROUP BY mt.id, mt.name
      ORDER BY mt.start_time
    `, eventParams);

    // Combine stats
    const stats = legacyStats.map(ls => {
      const es = eventStats.find(e => e.id === ls.id);
      return {
        id: ls.id,
        name: ls.name,
        count: (ls.count || 0) + (es?.count || 0)
      };
    });

    const total = stats.reduce((sum, s) => sum + (s.count || 0), 0);

    // Get paginated transactions with detailed info (Combined)
    // We fetch everything matching the filter and sort/paginate in SQL via UNION
    const combinedParams = [...legacyParams, ...eventParams, limitNum, offsetNum];

    const transactions = await dbAll(`
      SELECT * FROM (
        SELECT 
          t.id,
          t.transaction_date,
          TO_CHAR(t.transaction_time, 'HH24:MI:SS') as transaction_time,
          u.id as user_id,
          u.name as user_name,
          u.registration_number,
          v.id as vendor_id,
          v.name as vendor_name,
          mt.id as meal_type_id,
          mt.name as meal_name,
          t.meal_remaining_after,
          'legacy' as mode
        FROM transactions t
        JOIN users u ON t.user_id = u.id
        JOIN vendors v ON t.vendor_id = v.id
        JOIN meal_types mt ON t.meal_type_id = mt.id
        WHERE ${legacyWhereStr}
        
        UNION ALL
        
        SELECT 
          ec.id,
          DATE(ec.consumed_at)::text as transaction_date,
          TO_CHAR(ec.consumed_at, 'HH24:MI:SS') as transaction_time,
          u.id as user_id,
          u.name as user_name,
          u.registration_number,
          COALESCE(v.id, '') as vendor_id,
          COALESCE(v.name, 'N/A') as vendor_name,
          mt.id as meal_type_id,
          mt.name as meal_name,
          NULL as meal_remaining_after,
          'event' as mode
        FROM event_consumptions ec
        JOIN users u ON ec.user_id = u.id
        JOIN meal_types mt ON ec.meal_type_id = mt.id
        LEFT JOIN vendors v ON ec.vendor_id = v.id
        WHERE ${eventWhereStr}
      ) combined
      ORDER BY transaction_time DESC
      LIMIT ? OFFSET ?
    `, combinedParams);

    // Get total count for pagination info
    const legacyCountResult = await dbGet(`
      SELECT COUNT(*) as total FROM transactions t WHERE ${legacyWhereStr}
    `, legacyParams);

    const eventCountResult = await dbGet(`
      SELECT COUNT(*) as total FROM event_consumptions ec WHERE ${eventWhereStr}
    `, eventParams);

    const totalCount = (legacyCountResult?.total || 0) + (eventCountResult?.total || 0);

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

/**
 * GET /api/admin/daily-summary
 * Comprehensive daily summary combining legacy transactions and event consumptions
 * Supports filtering by date, event, and user
 */
app.get('/api/admin/daily-summary', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const today = new Date().toISOString().split('T')[0];
    const { date = today, eventId, userId, mealTypeId, offset = '0', limit = '50' } = req.query;
    const offsetNum = Math.max(0, parseInt(offset) || 0);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));

    // Get all active events for the date
    const events = await dbAll(`
      SELECT id, name, start_date, end_date 
      FROM events 
      WHERE active = 1 AND start_date <= ? AND end_date >= ?
      ORDER BY start_date DESC
    `, [date, date]);

    // Summary by meal type (combined legacy + event)
    const summaryByMealType = await dbAll(`
      SELECT 
        mt.id,
        mt.name,
        mt.start_time,
        COALESCE((
          SELECT COUNT(*) FROM transactions t 
          WHERE t.meal_type_id = mt.id AND t.transaction_date = ?
        ), 0) as legacy_count,
        COALESCE((
          SELECT COUNT(*) FROM event_consumptions ec 
          JOIN events e ON ec.event_id = e.id
          WHERE ec.meal_type_id = mt.id AND DATE(ec.consumed_at) = ? 
          AND e.start_date <= ? AND e.end_date >= ?
        ), 0) as event_count
      FROM meal_types mt
      WHERE mt.active = 1
      ORDER BY mt.start_time
    `, [date, date, date, date]);

    const legacyTotal = summaryByMealType.reduce((sum, m) => sum + (m.legacy_count || 0), 0);
    const eventTotal = summaryByMealType.reduce((sum, m) => sum + (m.event_count || 0), 0);
    const grandTotal = legacyTotal + eventTotal;

    // Summary by event
    const summaryByEvent = await dbAll(`
      SELECT 
        e.id as event_id,
        e.name as event_name,
        COUNT(ec.id) as meal_count,
        COUNT(DISTINCT ec.user_id) as unique_users
      FROM events e
      LEFT JOIN event_consumptions ec ON e.id = ec.event_id AND DATE(ec.consumed_at) = ?
      WHERE e.active = 1 AND e.start_date <= ? AND e.end_date >= ?
      GROUP BY e.id, e.name
      ORDER BY e.start_date DESC
    `, [date, date, date]);

    // Get combined transactions (legacy + event) with details
    let legacyQuery = `
      SELECT 
        t.id,
        t.transaction_date,
        TO_CHAR(t.transaction_time, 'HH24:MI:SS') as transaction_time,
        u.id as user_id,
        u.name as user_name,
        u.registration_number,
        v.id as vendor_id,
        v.name as vendor_name,
        mt.id as meal_type_id,
        mt.name as meal_name,
        t.meal_remaining_after as remaining_after,
        NULL as event_id,
        NULL as event_name,
        'legacy' as mode
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      JOIN vendors v ON t.vendor_id = v.id
      JOIN meal_types mt ON t.meal_type_id = mt.id
      WHERE t.transaction_date = ?
    `;

    let eventQuery = `
      SELECT 
        ec.id,
        DATE(ec.consumed_at) as transaction_date,
        TO_CHAR(ec.consumed_at, 'HH24:MI:SS') as transaction_time,
        u.id as user_id,
        u.name as user_name,
        u.registration_number,
        COALESCE(v.id, '') as vendor_id,
        COALESCE(v.name, 'N/A') as vendor_name,
        mt.id as meal_type_id,
        mt.name as meal_name,
        NULL as remaining_after,
        e.id as event_id,
        e.name as event_name,
        'event' as mode
      FROM event_consumptions ec
      JOIN users u ON ec.user_id = u.id
      JOIN meal_types mt ON ec.meal_type_id = mt.id
      JOIN events e ON ec.event_id = e.id
      LEFT JOIN vendors v ON ec.vendor_id = v.id
      WHERE DATE(ec.consumed_at) = ?
    `;

    let params = [date];
    let eventParams = [date];

    if (userId && userId !== 'all') {
      legacyQuery += ` AND t.user_id = ?`;
      eventQuery += ` AND ec.user_id = ?`;
      params.push(userId);
      eventParams.push(userId);
    }

    if (mealTypeId && mealTypeId !== 'all') {
      legacyQuery += ` AND t.meal_type_id = ?`;
      eventQuery += ` AND ec.meal_type_id = ?`;
      params.push(mealTypeId);
      eventParams.push(mealTypeId);
    }

    if (eventId && eventId !== 'all') {
      // Only show event mode if eventId specified
      legacyQuery = 'SELECT * FROM (SELECT 1) WHERE 1=0'; // Empty result
      params = [];
      eventQuery += ` AND ec.event_id = ?`;
      eventParams.push(eventId);
    }

    // Combine results
    const legacyResults = eventId && eventId !== 'all' ? [] : await dbAll(legacyQuery, params);
    const eventResults = await dbAll(eventQuery, eventParams);

    let combinedResults = [...legacyResults, ...eventResults];

    // Sort by transaction_time descending
    combinedResults.sort((a, b) => {
      const timeA = a.transaction_date + ' ' + a.transaction_time;
      const timeB = b.transaction_date + ' ' + b.transaction_time;
      return new Date(timeB) - new Date(timeA);
    });

    // Paginate
    const paginatedResults = combinedResults.slice(offsetNum, offsetNum + limitNum);
    const totalCount = combinedResults.length;

    res.json({
      date,
      summary: {
        byMealType: summaryByMealType.map(m => ({
          ...m,
          total: (m.legacy_count || 0) + (m.event_count || 0)
        })),
        byEvent: summaryByEvent,
        totals: {
          legacy: legacyTotal,
          event: eventTotal,
          grandTotal
        }
      },
      transactions: paginatedResults,
      pagination: {
        offset: offsetNum,
        limit: limitNum,
        total: totalCount,
        hasMore: (offsetNum + limitNum) < totalCount,
        pages: Math.ceil(totalCount / limitNum)
      },
      filters: {
        date,
        eventId: eventId || 'all',
        userId: userId || 'all',
        mealTypeId: mealTypeId || 'all'
      },
      events,
      mealTypes: summaryByMealType,
      lastUpdated: new Date().toISOString()
    });
  } catch (err) {
    console.error('Daily summary error:', err);
    res.status(500).json({ error: 'Failed to fetch daily summary' });
  }
});

/**
 * GET /api/admin/reports
 * Comprehensive reports endpoint with full filtering capabilities
 */
app.get('/api/admin/reports', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const {
      startDate,
      endDate,
      eventId = 'all',
      userId = 'all',
      mealTypeId = 'all',
      offset = '0',
      limit = '50'
    } = req.query;

    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 30);
    const defaultEnd = new Date().toISOString().split('T')[0];

    const start = (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) ? startDate : defaultStart.toISOString().split('T')[0];
    const end = (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) ? endDate : defaultEnd;
    const offsetNum = Math.max(0, parseInt(offset) || 0);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));

    // Get all events for filter dropdown
    const events = await dbAll(`
      SELECT id, name, start_date, end_date 
      FROM events 
      WHERE active = 1
      ORDER BY start_date DESC
      LIMIT 50
    `);

    // Get all users for filter dropdown
    const users = await dbAll(`
      SELECT id, name, registration_number 
      FROM users 
      WHERE active = 1
      ORDER BY name
      LIMIT 100
    `);

    // Get all meal types for filter dropdown
    const mealTypes = await dbAll(`
      SELECT id, name, start_time, end_time
      FROM meal_types 
      WHERE active = 1
      ORDER BY start_time
    `);

    // Build query for legacy transactions
    let legacyWhere = 't.transaction_date >= ? AND t.transaction_date <= ?';
    let legacyParams = [start, end];

    if (userId && userId !== 'all') {
      legacyWhere += ' AND t.user_id = ?';
      legacyParams.push(userId);
    }

    if (mealTypeId && mealTypeId !== 'all') {
      legacyWhere += ' AND t.meal_type_id = ?';
      legacyParams.push(mealTypeId);
    }

    const legacyQuery = `
      SELECT 
        t.id,
        t.transaction_date,
        TO_CHAR(t.transaction_time, 'HH24:MI:SS') as transaction_time,
        u.id as user_id,
        u.name as user_name,
        u.registration_number,
        v.id as vendor_id,
        v.name as vendor_name,
        mt.id as meal_type_id,
        mt.name as meal_name,
        t.meal_remaining_after as remaining_after,
        NULL as event_id,
        NULL as event_name,
        'legacy' as mode
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      JOIN vendors v ON t.vendor_id = v.id
      JOIN meal_types mt ON t.meal_type_id = mt.id
      WHERE ${legacyWhere}
    `;

    // Build query for event consumptions
    let eventWhere = 'DATE(ec.consumed_at) >= ? AND DATE(ec.consumed_at) <= ?';
    let eventParams = [start, end];

    if (eventId && eventId !== 'all') {
      eventWhere += ' AND ec.event_id = ?';
      eventParams.push(eventId);
    }

    if (userId && userId !== 'all') {
      eventWhere += ' AND ec.user_id = ?';
      eventParams.push(userId);
    }

    if (mealTypeId && mealTypeId !== 'all') {
      eventWhere += ' AND ec.meal_type_id = ?';
      eventParams.push(mealTypeId);
    }

    const eventQuery = `
      SELECT 
        ec.id,
        DATE(ec.consumed_at) as transaction_date,
        TO_CHAR(ec.consumed_at, 'HH24:MI:SS') as transaction_time,
        u.id as user_id,
        u.name as user_name,
        u.registration_number,
        COALESCE(v.id, '') as vendor_id,
        COALESCE(v.name, 'N/A') as vendor_name,
        mt.id as meal_type_id,
        mt.name as meal_name,
        NULL as remaining_after,
        e.id as event_id,
        e.name as event_name,
        'event' as mode
      FROM event_consumptions ec
      JOIN users u ON ec.user_id = u.id
      JOIN meal_types mt ON ec.meal_type_id = mt.id
      JOIN events e ON ec.event_id = e.id
      LEFT JOIN vendors v ON ec.vendor_id = v.id
      WHERE ${eventWhere}
    `;

    const legacyResults = eventId && eventId !== 'all' ? [] : await dbAll(legacyQuery, legacyParams);
    const eventResults = await dbAll(eventQuery, eventParams);

    let combinedResults = [...legacyResults, ...eventResults];

    combinedResults.sort((a, b) => {
      const timeA = a.transaction_date + ' ' + a.transaction_time;
      const timeB = b.transaction_date + ' ' + b.transaction_time;
      return new Date(timeB) - new Date(timeA);
    });

    const paginatedResults = combinedResults.slice(offsetNum, offsetNum + limitNum);
    const totalCount = combinedResults.length;

    // Summary stats
    const stats = {
      totalRedemptions: totalCount,
      byMode: {
        legacy: legacyResults.length,
        event: eventResults.length
      },
      byMealType: {},
      byEvent: {},
      byUser: {}
    };

    const mealTypeMap = new Map();

    combinedResults.forEach(r => {
      // By Meal Type (Map for Summary)
      if (!mealTypeMap.has(r.meal_type_id)) {
        mealTypeMap.set(r.meal_type_id, { id: r.meal_type_id, name: r.meal_name, count: 0 });
      }
      mealTypeMap.get(r.meal_type_id).count++;

      // Stats Objects
      stats.byMealType[r.meal_name] = (stats.byMealType[r.meal_name] || 0) + 1;

      if (r.event_name) {
        stats.byEvent[r.event_name] = (stats.byEvent[r.event_name] || 0) + 1;
      }
      stats.byUser[r.user_name] = (stats.byUser[r.user_name] || 0) + 1;
    });

    res.json({
      dateRange: { start, end },
      filters: {
        startDate: start,
        endDate: end,
        eventId,
        userId,
        mealTypeId
      },
      stats,
      summary: {
        total: totalCount,
        stats: Array.from(mealTypeMap.values())
      },
      transactions: paginatedResults,
      pagination: {
        offset: offsetNum,
        limit: limitNum,
        total: totalCount,
        hasMore: (offsetNum + limitNum) < totalCount,
        pages: Math.ceil(totalCount / limitNum)
      },
      filterOptions: {
        events: events.map(e => ({ id: e.id, name: e.name })),
        users: users.map(u => ({ id: u.id, name: u.name, regNumber: u.registration_number })),
        mealTypes: mealTypes.map(m => ({ id: m.id, name: m.name }))
      },
      lastUpdated: new Date().toISOString()
    });
  } catch (err) {
    console.error('Reports error:', err);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

/**
 * GET /api/admin/consolidated-report
 * Returns ALL transactions in the system, grouped by meal periods
 */
app.get('/api/admin/consolidated-report', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const { eventId } = req.query;
    const eventFilter = eventId ? sanitizeAlphanumeric(eventId, 50) : null;

    // Get all active meal types
    const mealTypes = await dbAll(`
      SELECT id, name, start_time, end_time 
      FROM meal_types 
      ORDER BY start_time
    `);

    // Get available events (for filter dropdown)
    const events = await dbAll(
      'SELECT id, name, start_date, end_date FROM events WHERE active = 1 ORDER BY start_date DESC'
    );

    let allTransactions = [];
    let selectedEvent = null;

    if (eventFilter) {
      // When filtering by event, only show event consumptions (legacy transactions have no event_id)
      selectedEvent = await dbGet('SELECT id, name FROM events WHERE id = ?', [eventFilter]);
      const eventConsumptions = await dbAll(`
        SELECT 
          ec.id,
          DATE(ec.consumed_at) as transaction_date,
          TO_CHAR(ec.consumed_at, 'HH24:MI:SS') as transaction_time,
          u.name as user_name,
          u.registration_number,
          COALESCE(v.name, 'N/A') as vendor_name,
          mt.id as meal_type_id,
          mt.name as meal_name,
          e.name as event_name,
          'event' as mode
        FROM event_consumptions ec
        JOIN users u ON ec.user_id = u.id
        JOIN meal_types mt ON ec.meal_type_id = mt.id
        JOIN events e ON ec.event_id = e.id
        LEFT JOIN vendors v ON ec.vendor_id = v.id
        WHERE ec.event_id = ?
        ORDER BY ec.consumed_at DESC
      `, [eventFilter]);
      allTransactions = eventConsumptions;
    } else {
      // No event filter: show all legacy transactions + all event consumptions
      const legacyTransactions = await dbAll(`
        SELECT 
          t.id,
          t.transaction_date,
          TO_CHAR(t.transaction_time, 'HH24:MI:SS') as transaction_time,
          u.name as user_name,
          u.registration_number,
          v.name as vendor_name,
          mt.id as meal_type_id,
          mt.name as meal_name,
          'legacy' as mode
        FROM transactions t
        JOIN users u ON t.user_id = u.id
        JOIN vendors v ON t.vendor_id = v.id
        JOIN meal_types mt ON t.meal_type_id = mt.id
        ORDER BY t.transaction_date DESC, t.transaction_time DESC
      `);

      const eventConsumptions = await dbAll(`
        SELECT 
          ec.id,
          DATE(ec.consumed_at) as transaction_date,
          TO_CHAR(ec.consumed_at, 'HH24:MI:SS') as transaction_time,
          u.name as user_name,
          u.registration_number,
          COALESCE(v.name, 'N/A') as vendor_name,
          mt.id as meal_type_id,
          mt.name as meal_name,
          e.name as event_name,
          'event' as mode
        FROM event_consumptions ec
        JOIN users u ON ec.user_id = u.id
        JOIN meal_types mt ON ec.meal_type_id = mt.id
        JOIN events e ON ec.event_id = e.id
        LEFT JOIN vendors v ON ec.vendor_id = v.id
        ORDER BY ec.consumed_at DESC
      `);

      allTransactions = [...legacyTransactions, ...eventConsumptions];
    }

    // Grouping by meal type
    const grouped = {};
    mealTypes.forEach(mt => {
      grouped[mt.id] = {
        meal_type: mt.name,
        time_range: `${mt.start_time} - ${mt.end_time}`,
        transactions: []
      };
    });

    allTransactions.forEach(tx => {
      if (grouped[tx.meal_type_id]) {
        grouped[tx.meal_type_id].transactions.push(tx);
      }
    });

    res.json({
      success: true,
      mealTypes,
      grouped,
      totalCount: allTransactions.length,
      events,
      selectedEvent,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Consolidated report error:', err);
    res.status(500).json({ error: 'Failed to fetch consolidated report' });
  }
});

/**
 * GET /api/admin/stats/meals-per-day
 * Returns meals served per day for a date range
 */
app.get('/api/admin/stats/meals-per-day', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const { startDate, endDate } = req.query;
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 30);
    const defaultEnd = new Date().toISOString().split('T')[0];

    const start = (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) ? startDate : defaultStart.toISOString().split('T')[0];
    const end = (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) ? endDate : defaultEnd;

    // Legacy transactions
    const legacyStats = await dbAll(
      `SELECT 
        t.transaction_date as date,
        mt.name as meal_type,
        mt.id as meal_type_id,
        COUNT(t.id) as count,
        'legacy' as mode
       FROM transactions t
       JOIN meal_types mt ON t.meal_type_id = mt.id
       WHERE t.transaction_date >= ? AND t.transaction_date <= ?
       GROUP BY t.transaction_date, mt.id, mt.name
       ORDER BY t.transaction_date DESC, mt.start_time`,
      [start, end]
    );

    // Event consumptions
    const eventStats = await dbAll(
      `SELECT 
        DATE(ec.consumed_at)::text as date,
        mt.name as meal_type,
        mt.id as meal_type_id,
        COUNT(ec.id) as count,
        'event' as mode
       FROM event_consumptions ec
       JOIN meal_types mt ON ec.meal_type_id = mt.id
       WHERE DATE(ec.consumed_at) >= ? AND DATE(ec.consumed_at) <= ?
       GROUP BY DATE(ec.consumed_at), mt.id, mt.name
       ORDER BY date DESC, mt.start_time`,
      [start, end]
    );

    // Combine and deduplicate by date and meal type
    const combinedMap = new Map();

    legacyStats.forEach(s => {
      const key = `${s.date}|${s.meal_type_id}`;
      combinedMap.set(key, { ...s, count: s.count || 0 });
    });

    eventStats.forEach(s => {
      const key = `${s.date}|${s.meal_type_id}`;
      if (combinedMap.has(key)) {
        const existing = combinedMap.get(key);
        combinedMap.set(key, { ...existing, count: existing.count + s.count, mode: 'combined' });
      } else {
        combinedMap.set(key, { ...s, count: s.count || 0, mode: 'combined' });
      }
    });

    const stats = Array.from(combinedMap.values()).sort((a, b) => b.date.localeCompare(a.date));

    // Daily totals (combined)
    const dailyTotalsMap = new Map();
    stats.forEach(s => {
      const current = dailyTotalsMap.get(s.date) || 0;
      dailyTotalsMap.set(s.date, current + s.count);
    });

    const dailyTotals = Array.from(dailyTotalsMap.entries())
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => b.date.localeCompare(a.date));

    res.json({
      startDate: start,
      endDate: end,
      mealsPerDay: stats,
      dailyTotals,
      summary: {
        totalMeals: dailyTotals.reduce((sum, d) => sum + d.total, 0),
        totalDays: dailyTotals.length,
        legacyMeals: legacyStats.reduce((sum, s) => sum + s.count, 0),
        eventMeals: eventStats.reduce((sum, s) => sum + s.count, 0)
      }
    });
  } catch (err) {
    console.error('Meals per day error:', err);
    res.status(500).json({ error: 'Failed to fetch meals per day' });
  }
});

/**
 * GET /api/admin/stats/daily-matrix
 * Returns a matrix of dates and meal types with counts
 */
app.get('/api/admin/stats/daily-matrix', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const { startDate, endDate, eventId } = req.query;
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 30);
    const defaultEnd = new Date().toISOString().split('T')[0];

    const start = (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) ? startDate : defaultStart.toISOString().split('T')[0];
    const end = (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) ? endDate : defaultEnd;
    const eventFilter = eventId ? sanitizeAlphanumeric(eventId, 50) : null;

    // Get all active meal types to use as columns
    const mealTypes = await dbAll('SELECT id, name FROM meal_types WHERE active = 1 ORDER BY start_time');

    // Get available events (for filter dropdown)
    const events = await dbAll(
      'SELECT id, name, start_date, end_date FROM events WHERE active = 1 ORDER BY start_date DESC'
    );

    let selectedEvent = null;
    let stats;

    if (eventFilter) {
      selectedEvent = await dbGet('SELECT id, name FROM events WHERE id = ?', [eventFilter]);
      // When filtering by event, only event_consumptions have an event_id
      stats = await dbAll(`
        SELECT DATE(consumed_at)::text as date, meal_type_id, COUNT(*) as total_count
        FROM event_consumptions
        WHERE event_id = ? AND DATE(consumed_at) >= ? AND DATE(consumed_at) <= ?
        GROUP BY DATE(consumed_at), meal_type_id
        ORDER BY date DESC
      `, [eventFilter, start, end]);
    } else {
      // No filter: combine legacy + event consumptions
      stats = await dbAll(`
        SELECT date, meal_type_id, SUM(count) as total_count
        FROM (
          SELECT transaction_date as date, meal_type_id, COUNT(*) as count
          FROM transactions
          WHERE transaction_date >= ? AND transaction_date <= ?
          GROUP BY transaction_date, meal_type_id
          
          UNION ALL
          
          SELECT DATE(consumed_at)::text as date, meal_type_id, COUNT(*) as count
          FROM event_consumptions
          WHERE DATE(consumed_at) >= ? AND DATE(consumed_at) <= ?
          GROUP BY DATE(consumed_at), meal_type_id
        )
        GROUP BY date, meal_type_id
        ORDER BY date DESC
      `, [start, end, start, end]);
    }

    // Pivot the data
    const matrix = {};
    stats.forEach(s => {
      if (!matrix[s.date]) {
        matrix[s.date] = { date: s.date, totals: {}, dailyTotal: 0 };
        mealTypes.forEach(mt => matrix[s.date].totals[mt.id] = 0);
      }
      matrix[s.date].totals[s.meal_type_id] = s.total_count;
      matrix[s.date].dailyTotal += s.total_count;
    });

    const rows = Object.values(matrix).sort((a, b) => b.date.localeCompare(a.date));

    res.json({
      startDate: start,
      endDate: end,
      mealTypes,
      rows,
      events,
      selectedEvent,
      summary: {
        totalMeals: rows.reduce((sum, r) => sum + r.dailyTotal, 0),
        totalDays: rows.length
      }
    });
  } catch (err) {
    console.error('Daily matrix error:', err);
    res.status(500).json({ error: 'Failed to fetch daily matrix' });
  }
});

/**
 * GET /api/admin/stats/meals-per-time
 * Returns meals served per time (hourly breakdown)
 */
app.get('/api/admin/stats/meals-per-time', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const { date } = req.query;
    const targetDate = (date && /^\d{4}-\d{2}-\d{2}$/.test(date))
      ? date
      : new Date().toISOString().split('T')[0];

    // Legacy transactions
    const legacyStats = await dbAll(
      `SELECT 
        EXTRACT(HOUR FROM t.transaction_time)::text as hour,
        mt.name as meal_type,
        mt.id as meal_type_id,
        COUNT(t.id) as count,
        'legacy' as mode
       FROM transactions t
       JOIN meal_types mt ON t.meal_type_id = mt.id
       WHERE t.transaction_date = ?
       GROUP BY hour, mt.id, mt.name
       ORDER BY hour, mt.start_time`,
      [targetDate]
    );

    // Event consumptions
    const eventStats = await dbAll(
      `SELECT 
        EXTRACT(HOUR FROM ec.consumed_at)::text as hour,
        mt.name as meal_type,
        mt.id as meal_type_id,
        COUNT(ec.id) as count,
        'event' as mode
       FROM event_consumptions ec
       JOIN meal_types mt ON ec.meal_type_id = mt.id
       WHERE DATE(ec.consumed_at) = ?
       GROUP BY hour, mt.id, mt.name
       ORDER BY hour, mt.start_time`,
      [targetDate]
    );

    // Combine stats
    const combinedMap = new Map();

    legacyStats.forEach(s => {
      const key = `${s.hour}|${s.meal_type_id}`;
      combinedMap.set(key, { ...s, count: s.count || 0 });
    });

    eventStats.forEach(s => {
      const key = `${s.hour}|${s.meal_type_id}`;
      if (combinedMap.has(key)) {
        const existing = combinedMap.get(key);
        combinedMap.set(key, { ...existing, count: existing.count + s.count, mode: 'combined' });
      } else {
        combinedMap.set(key, { ...s, count: s.count || 0, mode: 'combined' });
      }
    });

    const stats = Array.from(combinedMap.values()).sort((a, b) => a.hour.localeCompare(b.hour));

    const hourlyTotalsMap = new Map();
    stats.forEach(s => {
      const current = hourlyTotalsMap.get(s.hour) || 0;
      hourlyTotalsMap.set(s.hour, current + s.count);
    });

    const hourlyTotals = Array.from(hourlyTotalsMap.entries())
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour.localeCompare(b.hour));

    const peakHour = hourlyTotals.length > 0
      ? hourlyTotals.reduce((max, curr) => curr.count > max.count ? curr : max)
      : null;

    res.json({
      date: targetDate,
      stats,
      hourlyTotals,
      peakHour,
      summary: {
        totalMeals: hourlyTotals.reduce((sum, h) => sum + h.count, 0),
        legacyMeals: legacyStats.reduce((sum, s) => sum + s.count, 0),
        eventMeals: eventStats.reduce((sum, s) => sum + s.count, 0)
      }
    });
  } catch (err) {
    console.error('Meals per time error:', err);
    res.status(500).json({ error: 'Failed to fetch meals per time' });
  }
});

/**
 * POST /api/admin/allocate-meals
 * Intuitive meal allocation: bulk allocate meals to multiple users
 */
app.post('/api/admin/allocate-meals', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const { userIds, mealTypeId, amount, operation } = req.body;

    let targetUserIds = [];
    if (userIds === 'all') {
      const allUsers = await dbAll('SELECT id FROM users WHERE active = 1');
      targetUserIds = allUsers.map(u => u.id);
    } else if (Array.isArray(userIds)) {
      targetUserIds = userIds;
    } else {
      return res.status(400).json({ error: 'userIds array or "all" required' });
    }

    let targetMealTypeIds = [];
    if (mealTypeId === 'all') {
      const allMeals = await dbAll('SELECT id FROM meal_types WHERE active = 1');
      targetMealTypeIds = allMeals.map(m => m.id);
    } else if (mealTypeId) {
      targetMealTypeIds = [mealTypeId];
    } else {
      return res.status(400).json({ error: 'mealTypeId or "all" required' });
    }

    const validOperations = ['add', 'set', 'reset'];
    const op = validOperations.includes(operation) ? operation : 'add';
    const allocAmount = parseInt(amount, 10) || 0;

    let updated = 0;
    let errors = [];

    for (const userId of targetUserIds) {
      for (const mId of targetMealTypeIds) {
        try {
          let allocation = await dbGet(
            'SELECT id, allocated, remaining FROM meal_allocations WHERE user_id = ? AND meal_type_id = ?',
            [userId, mId]
          );

          if (!allocation) {
            const newId = generateId();
            const userAccom = await dbGet('SELECT accommodation FROM users WHERE id = ?', [userId]);
            const resetVal = (userAccom && userAccom.accommodation === 'N') ? 4 : 12;
            const val = op === 'reset' ? resetVal : allocAmount;
            await dbRun(
              `INSERT INTO meal_allocations (id, user_id, meal_type_id, allocated, remaining)
               VALUES (?, ?, ?, ?, ?)`,
              [newId, userId, mId, val, val]
            );
            updated++;
          } else {
            let newAllocated, newRemaining;
            if (op === 'add') {
              newAllocated = allocation.allocated + allocAmount;
              newRemaining = allocation.remaining + allocAmount;
            } else if (op === 'set') {
              newAllocated = allocAmount;
              newRemaining = allocAmount; // Force sync to the new total
            } else {
              const userAccom = await dbGet('SELECT accommodation FROM users WHERE id = ?', [userId]);
              const resetVal = (userAccom && userAccom.accommodation === 'N') ? 4 : 12;
              newAllocated = resetVal;
              newRemaining = resetVal;
            }

            await dbRun(
              `UPDATE meal_allocations SET allocated = ?, remaining = ?, updated_at = NOW() WHERE id = ?`,
              [newAllocated, newRemaining, allocation.id]
            );
            updated++;
          }
        } catch (err) {
          errors.push({ userId, mealTypeId: mId, error: err.message });
        }
      }
    }

    res.json({
      success: true,
      message: `Updated ${updated} allocation records.`,
      updated,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('Allocate meals error:', err);
    res.status(500).json({ error: 'Failed to allocate meals' });
  }
});

/**
 * POST /api/admin/allocate-meals/all
 * Allocate meals to ALL active users
 */
app.post('/api/admin/allocate-meals/all', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const { mealTypeId, amount, operation } = req.body;

    if (!mealTypeId) {
      return res.status(400).json({ error: 'mealTypeId required' });
    }

    const mealType = await dbGet('SELECT id, name FROM meal_types WHERE id = ?', [mealTypeId]);
    if (!mealType) {
      return res.status(400).json({ error: 'Invalid meal type' });
    }

    const validOperations = ['add', 'set', 'reset'];
    const op = validOperations.includes(operation) ? operation : 'add';
    const allocAmount = parseInt(amount, 10) || 0;

    const users = await dbAll('SELECT id FROM users WHERE active = 1');

    let updated = 0;
    for (const user of users) {
      let allocation = await dbGet(
        'SELECT id, allocated, remaining FROM meal_allocations WHERE user_id = ? AND meal_type_id = ?',
        [user.id, mealTypeId]
      );

      if (!allocation) {
        const newId = generateId();
        if (op === 'set') {
          await dbRun(
            `INSERT INTO meal_allocations (id, user_id, meal_type_id, allocated, remaining)
             VALUES (?, ?, ?, ?, ?)`,
            [newId, user.id, mealTypeId, allocAmount, allocAmount]
          );
        } else if (op === 'reset') {
          const userAccom = await dbGet('SELECT accommodation FROM users WHERE id = ?', [user.id]);
          const resetVal = (userAccom && userAccom.accommodation === 'N') ? 4 : 12;
          await dbRun(
            `INSERT INTO meal_allocations (id, user_id, meal_type_id, allocated, remaining)
             VALUES (?, ?, ?, ?, ?)`,
            [newId, user.id, mealTypeId, resetVal, resetVal]
          );
        } else {
          await dbRun(
            `INSERT INTO meal_allocations (id, user_id, meal_type_id, allocated, remaining)
             VALUES (?, ?, ?, ?, ?)`,
            [newId, user.id, mealTypeId, allocAmount, allocAmount]
          );
        }
        updated++;
      } else {
        let newAllocated, newRemaining;
        if (op === 'add') {
          newAllocated = allocation.allocated + allocAmount;
          newRemaining = allocation.remaining + allocAmount;
        } else if (op === 'set') {
          newAllocated = allocAmount;
          newRemaining = Math.min(allocAmount, allocation.remaining + (allocAmount - allocation.allocated));
        } else {
          const userAccom = await dbGet('SELECT accommodation FROM users WHERE id = ?', [user.id]);
          const resetVal = (userAccom && userAccom.accommodation === 'N') ? 4 : 12;
          newAllocated = resetVal;
          newRemaining = resetVal;
        }

        await dbRun(
          `UPDATE meal_allocations SET allocated = ?, remaining = ?, updated_at = NOW() WHERE id = ?`,
          [newAllocated, newRemaining, allocation.id]
        );
        updated++;
      }
    }

    res.json({
      success: true,
      message: `Updated ${updated} user allocations for ${mealType.name}`,
      updated,
      totalUsers: users.length
    });
  } catch (err) {
    console.error('Allocate all meals error:', err);
    res.status(500).json({ error: 'Failed to allocate meals to all users' });
  }
});

/**
 * GET /api/admin/users
 */
app.get('/api/admin/users', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const users = await dbAll(
      `SELECT 
        u.id,
        u.registration_number,
        u.name,
        u.active,
        u.accommodation,
        qt.token as latest_token,
        qt.expires_at as token_expiry
       FROM users u
       LEFT JOIN LATERAL (
         SELECT token, expires_at FROM qr_tokens
         WHERE user_id = u.id
         ORDER BY created_at DESC
         LIMIT 1
       ) qt ON true
       ORDER BY u.created_at DESC`,
      []
    );

    res.json(users);
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * GET /api/admin/users/:userId
 */
app.get('/api/admin/users/:userId', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const user = await dbGet(
      'SELECT id, registration_number, name, active, accommodation FROM users WHERE id = ?',
      [req.params.userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const meals = await dbAll(
      `SELECT mt.name, ma.allocated, ma.remaining, ma.id as allocationId
       FROM meal_allocations ma
       JOIN meal_types mt ON ma.meal_type_id = mt.id
       WHERE ma.user_id = ?
       ORDER BY mt.start_time`,
      [user.id]
    );

    res.json({ ...user, meals });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
});

/**
 * POST /api/admin/users/:userId/accommodation
 * Update user accommodation status and reset meal allocations accordingly
 */
app.post('/api/admin/users/:userId/accommodation', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const { accommodation } = req.body;
    const accommod = (accommodation || 'Y').toString().trim().toUpperCase();
    if (!['Y', 'N'].includes(accommod)) {
      return res.status(400).json({ error: 'Accommodation must be Y or N' });
    }

    const user = await dbGet('SELECT id, accommodation FROM users WHERE id = ?', [req.params.userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await dbRun('UPDATE users SET accommodation = ?, updated_at = NOW() WHERE id = ?', [accommod, user.id]);

    // Reset all meal allocations to match new accommodation
    const newAlloc = accommod === 'Y' ? 12 : 4;
    const allocations = await dbAll('SELECT id, remaining FROM meal_allocations WHERE user_id = ?', [user.id]);
    for (const alloc of allocations) {
      const consumed = alloc.remaining;
      // Keep consumed count: newRemaining = newAlloc - (oldAlloc - remaining)
      // But we don't track oldAlloc easily, so just set remaining to newAlloc (reset consumed)
      await dbRun('UPDATE meal_allocations SET allocated = ?, remaining = ?, updated_at = NOW() WHERE id = ?', [newAlloc, newAlloc, alloc.id]);
    }

    res.json({
      success: true,
      message: `Accommodation set to ${accommod}. Allocations reset to ${newAlloc} per meal type.`,
      accommodation: accommod,
      mealAllocation: newAlloc
    });
  } catch (err) {
    console.error('Update accommodation error:', err);
    res.status(500).json({ error: 'Failed to update accommodation' });
  }
});

/**
 * POST /api/admin/users/:userId/meals
 */
app.post('/api/admin/users/:userId/meals', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const { meals } = req.body;

    if (!meals || !Array.isArray(meals)) {
      return res.status(400).json({ error: 'Invalid meals data' });
    }

    const user = await dbGet(
      'SELECT id FROM users WHERE id = ?',
      [req.params.userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update each meal allocation
    for (const meal of meals) {
      const mealType = await dbGet(
        'SELECT id FROM meal_types WHERE name = ?',
        [meal.name]
      );

      if (mealType) {
        await dbRun(
          `UPDATE meal_allocations 
           SET allocated = ?, remaining = ?, updated_at = NOW()
           WHERE user_id = ? AND meal_type_id = ?`,
          [meal.allocated, meal.remaining, req.params.userId, mealType.id]
        );
      }
    }

    res.json({
      success: true,
      message: 'Meal allocations updated successfully'
    });
  } catch (err) {
    console.error('Update meals error:', err);
    res.status(500).json({ error: 'Failed to update meal allocations' });
  }
});

// ===== ADMIN EVENTS ROUTES =====

/**
 * GET /api/admin/events
 */
app.get('/api/admin/events', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }
    const events = await dbAll(
      'SELECT * FROM events ORDER BY start_date DESC',
      []
    );
    res.json(events);
  } catch (err) {
    console.error('Events list error:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

/**
 * POST /api/admin/events
 */
app.post('/api/admin/events', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }
    const { name, startDate, endDate } = req.body;
    if (!name || !startDate || !endDate) {
      return res.status(400).json({ error: 'Name, startDate, and endDate required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
    }
    const eventId = 'EV' + generateId().slice(0, 6).toUpperCase();
    await dbRun(
      `INSERT INTO events (id, name, start_date, end_date, active)
       VALUES (?, ?, ?, ?, 1)`,
      [eventId, name, startDate, endDate]
    );
    res.json({ success: true, eventId, name, startDate, endDate });
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

/**
 * GET /api/admin/events/:eventId
 */
app.get('/api/admin/events/:eventId', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }
    const event = await dbGet('SELECT * FROM events WHERE id = ?', [req.params.eventId]);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const registrations = await dbAll(
      `SELECT er.id, er.user_id, u.registration_number, u.name,
              eq.token as qr_token,
              COALESCE(ec.consumed, 0) as consumed_count,
              COALESCE(ma.total_allocated, 0) as allocated_total,
              COALESCE(ma.total_remaining, 0) as remaining_total
       FROM event_registrations er
       JOIN users u ON er.user_id = u.id
       LEFT JOIN event_qr_tokens eq ON eq.event_id = er.event_id AND eq.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) as consumed
         FROM event_consumptions
         WHERE event_id = er.event_id AND user_id = u.id
       ) ec ON true
       LEFT JOIN LATERAL (
         SELECT SUM(allocated) as total_allocated, SUM(remaining) as total_remaining
         FROM meal_allocations
         WHERE user_id = u.id
       ) ma ON true
       WHERE er.event_id = ?
       ORDER BY u.name`,
      [event.id]
    );
    res.json({ ...event, registrations });
  } catch (err) {
    console.error('Event details error:', err);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

/**
 * POST /api/admin/events/:eventId/registrations
 * Body: { userIds: string[] } - array of user IDs to add
 */
app.post('/api/admin/events/:eventId/registrations', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }
    const { eventId } = req.params;
    const { userIds } = req.body;
    if (!userIds || !Array.isArray(userIds)) {
      return res.status(400).json({ error: 'userIds array required' });
    }
    const event = await dbGet('SELECT id FROM events WHERE id = ?', [eventId]);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Batch insert registrations in a single query
    const values = [];
    const params = [];
    for (const userId of userIds) {
      params.push(generateId(), eventId, userId);
      values.push('(?, ?, ?)');
    }

    let added = 0;
    if (values.length > 0) {
      const result = await dbRun(
        `INSERT INTO event_registrations (id, event_id, user_id)
         VALUES ${values.join(', ')}
         ON CONFLICT (event_id, user_id) DO NOTHING`,
        params
      );
      added = result.changes || 0;
    }
    res.json({ success: true, added, total: userIds.length });
  } catch (err) {
    console.error('Add registrations error:', err);
    res.status(500).json({ error: 'Failed to add registrations' });
  }
});

/**
 * POST /api/admin/events/:eventId/registrations/all
 * Registers ALL users to an event
 */
app.post('/api/admin/events/:eventId/registrations/all', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }
    const { eventId } = req.params;
    const event = await dbGet('SELECT id FROM events WHERE id = ?', [eventId]);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const users = await dbAll('SELECT id FROM users WHERE active = 1');

    // Batch insert all registrations in a single query
    const values = [];
    const params = [];
    for (const user of users) {
      params.push(generateId(), eventId, user.id);
      values.push('(?, ?, ?)');
    }

    let added = 0;
    if (values.length > 0) {
      const result = await dbRun(
        `INSERT INTO event_registrations (id, event_id, user_id)
         VALUES ${values.join(', ')}
         ON CONFLICT (event_id, user_id) DO NOTHING`,
        params
      );
      added = result.changes || 0;
    }
    res.json({ success: true, added, total: users.length });
  } catch (err) {
    console.error('Add all registrations error:', err);
    res.status(500).json({ error: 'Failed to add registrations' });
  }
});

/**
 * DELETE /api/admin/events/:eventId/registrations
 * Body: { userId: string }
 */
app.delete('/api/admin/events/:eventId/registrations', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }
    const { eventId } = req.params;
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    await dbRun(
      'DELETE FROM event_registrations WHERE event_id = ? AND user_id = ?',
      [eventId, userId]
    );
    await dbRun(
      'DELETE FROM event_qr_tokens WHERE event_id = ? AND user_id = ?',
      [eventId, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Remove registration error:', err);
    res.status(500).json({ error: 'Failed to remove registration' });
  }
});

/**
 * POST /api/admin/events/:eventId/generate-qr
 * Generates event QR tokens for all registered users
 */
app.post('/api/admin/events/:eventId/generate-qr', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }
    const { eventId } = req.params;
    const event = await dbGet('SELECT * FROM events WHERE id = ?', [eventId]);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const registrations = await dbAll(
      'SELECT user_id FROM event_registrations WHERE event_id = ?',
      [eventId]
    );
    const existing = await dbAll(
      'SELECT user_id FROM event_qr_tokens WHERE event_id = ?',
      [eventId]
    );
    const existingSet = new Set(existing.map(r => r.user_id));
    const missing = registrations.filter(r => !existingSet.has(r.user_id));

    const values = [];
    const params = [];
    for (const reg of missing) {
      params.push(generateId(), eventId, reg.user_id, generateToken());
      values.push('(?, ?, ?, ?)');
    }

    let generated = 0;
    if (values.length > 0) {
      const result = await dbRun(
        `INSERT INTO event_qr_tokens (id, event_id, user_id, token)
         VALUES ${values.join(', ')}
         ON CONFLICT (event_id, user_id) DO NOTHING`,
        params
      );
      generated = result.changes;
    }
    res.json({ success: true, generated, total: registrations.length });
  } catch (err) {
    console.error('Generate QR error:', err);
    res.status(500).json({ error: 'Failed to generate QR tokens' });
  }
});

/**
 * GET /api/admin/events/:eventId/export-pdf
 * 6 tickets per page (2 columns x 3 rows)
 */
app.get('/api/admin/events/:eventId/export-pdf', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }
    const { eventId } = req.params;

    const event = await dbGet('SELECT * FROM events WHERE id = ?', [eventId]);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const rows = await dbAll(
      `SELECT u.id, u.name, u.registration_number, eq.token
       FROM event_registrations er
       JOIN users u ON er.user_id = u.id
       LEFT JOIN event_qr_tokens eq ON eq.event_id = er.event_id AND eq.user_id = u.id
       WHERE er.event_id = ?
       ORDER BY u.name`,
      [eventId]
    );

    const toGenerate = rows.filter(r => r.token);
    if (toGenerate.length === 0) {
      return res.status(400).json({ error: 'No QR tokens generated. Run "Generate QR" first.' });
    }

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="event-${eventId}-qr-codes.pdf"`);
    doc.pipe(res);

    const mealTypes = await dbAll('SELECT name FROM meal_types WHERE active = 1 ORDER BY start_time');

    const COLS = 2;
    const ROWS = 3;
    const TICKETS_PER_PAGE = COLS * ROWS;
    const PAGE_WIDTH = 595;
    const PAGE_HEIGHT = 842;
    const MARGIN = 40;
    const CELL_W = (PAGE_WIDTH - 2 * MARGIN) / COLS;
    const CELL_H = (PAGE_HEIGHT - 2 * MARGIN) / ROWS;
    const QR_SIZE = 110;

    for (let i = 0; i < toGenerate.length; i++) {
      const pageIndex = Math.floor(i / TICKETS_PER_PAGE);
      const indexOnPage = i % TICKETS_PER_PAGE;
      if (indexOnPage === 0 && i > 0) {
        doc.addPage();
      }

      const col = indexOnPage % COLS;
      const row = Math.floor(indexOnPage / COLS);
      const cellX = MARGIN + col * CELL_W;
      const cellY = MARGIN + row * CELL_H;
      const centerX = cellX + CELL_W / 2;

      const ticketRow = toGenerate[i];
      const qrData = `EVT:${eventId}|REG:${ticketRow.registration_number}|TOKEN:${ticketRow.token}`;
      const qrBuffer = await QRCode.toBuffer(qrData, { width: QR_SIZE, margin: 2, errorCorrectionLevel: 'M' });

      const qrX = centerX - QR_SIZE / 2;
      const qrY = cellY + 8;
      doc.image(qrBuffer, qrX, qrY, { width: QR_SIZE, height: QR_SIZE });

      const textLeft = cellX + 6;
      const textWidth = CELL_W - 12;
      let textY = qrY + QR_SIZE + 6;
      doc.fontSize(9).font('Helvetica-Bold').text(ticketRow.name, textLeft, textY, { align: 'center', width: textWidth });
      textY = doc.y + 2;
      doc.fontSize(8).font('Helvetica').fillColor('#333333').text(ticketRow.registration_number, textLeft, textY, { align: 'center', width: textWidth });
      textY = doc.y + 2;
      doc.fontSize(6).font('Helvetica').fillColor('#666666').text(
        mealTypes.map(m => `□ ${m.name}`).join('  '),
        textLeft, textY, { align: 'center', width: textWidth }
      );
    }

    doc.end();
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: 'Failed to export PDF: ' + err.message });
  }
});

/**
 * GET /api/admin/events/:eventId/qr-image/:userId
 * Returns a QR code PNG image for a single user
 * Query: ?size=300 (optional, default 300px)
 */
app.get('/api/admin/events/:eventId/qr-image/:userId', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const { eventId, userId } = req.params;
    const size = Math.min(1000, Math.max(100, parseInt(req.query.size) || 300));

    const event = await dbGet('SELECT * FROM events WHERE id = ?', [eventId]);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const user = await dbGet(
      'SELECT id, name, registration_number FROM users WHERE id = ?',
      [userId]
    );
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const tokenRow = await dbGet(
      'SELECT token FROM event_qr_tokens WHERE event_id = ? AND user_id = ?',
      [eventId, userId]
    );
    if (!tokenRow) {
      return res.status(400).json({ error: 'No QR token generated. Run "Generate QR" first.' });
    }

    const qrData = `EVT:${eventId}|REG:${user.registration_number}|TOKEN:${tokenRow.token}`;
    const qrBuffer = await QRCode.toBuffer(qrData, {
      width: size,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: { dark: '#000000', light: '#ffffff' }
    });

    const safeName = user.name.replace(/[^a-zA-Z0-9]/g, '_');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="QR_${user.registration_number}_${safeName}.png"`);
    res.send(qrBuffer);
  } catch (err) {
    console.error('QR image error:', err);
    res.status(500).json({ error: 'Failed to generate QR image: ' + err.message });
  }
});

/**
 * POST /api/admin/events/:eventId/qr-batch-zip
 * Body: { userIds: string[] }
 * Returns a ZIP file containing QR code PNG images for all specified users
 */
app.post('/api/admin/events/:eventId/qr-batch-zip', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const { eventId } = req.params;
    const { userIds } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds array required (at least 1 user)' });
    }

    const event = await dbGet('SELECT * FROM events WHERE id = ?', [eventId]);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const zip = new JSZip();
    let added = 0;

    const users = await dbAll(
      'SELECT id, name, registration_number FROM users WHERE id = ANY($1)',
      [userIds]
    );
    const tokens = await dbAll(
      'SELECT user_id, token FROM event_qr_tokens WHERE event_id = $1 AND user_id = ANY($2)',
      [eventId, userIds]
    );
    const tokenMap = new Map(tokens.map(t => [t.user_id, t.token]));

    for (const user of users) {
      const token = tokenMap.get(user.id);
      if (!token) continue;

      const qrData = `EVT:${eventId}|REG:${user.registration_number}|TOKEN:${token}`;
      const qrBuffer = await QRCode.toBuffer(qrData, {
        width: 400,
        margin: 2,
        errorCorrectionLevel: 'H',
        color: { dark: '#000000', light: '#ffffff' }
      });

      const safeName = user.name.replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `${user.registration_number}_${safeName}.png`;
      zip.file(filename, qrBuffer);
      added++;
    }

    if (added === 0) {
      return res.status(400).json({ error: 'No valid QR codes found for selected users. Generate QR tokens first.' });
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    const safeEventName = event.name.replace(/[^a-zA-Z0-9]/g, '_');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeEventName}_QR_Codes.zip"`);
    res.send(zipBuffer);
  } catch (err) {
    console.error('Batch QR zip error:', err);
    res.status(500).json({ error: 'Failed to generate zip: ' + err.message });
  }
});

/**
 * GET /api/admin/live-feed/export-pdf
 * Generates a PDF of all recent legacy transactions
 */
app.get('/api/admin/live-feed/export-pdf', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const transactions = await dbAll(`
      SELECT 
        u.name as user_name,
        v.name as vendor_name,
        mt.name as meal_name,
        t.transaction_time,
        t.meal_remaining_after
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      JOIN vendors v ON t.vendor_id = v.id
      JOIN meal_types mt ON t.meal_type_id = mt.id
      ORDER BY t.transaction_time DESC
      LIMIT 1000
    `);

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="live-feed-report.pdf"');
    doc.pipe(res);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('MEAL TICKETS SYSTEM', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text('Live Feed Transaction Report', { align: 'center' });
    doc.moveDown();

    const currentDate = new Date().toLocaleString();
    doc.fontSize(10).font('Helvetica-Bold').text('Report Metadata:');
    doc.font('Helvetica').text(`Generated: ${currentDate}`);
    doc.text(`Total Transactions: ${transactions.length}`);
    doc.moveDown();

    doc.moveDown();

    // Table Header
    const startY = doc.y;
    doc.rect(40, startY, 515, 20).fill('#1a1a1a');
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold');
    doc.text('Time', 50, startY + 5);
    doc.text('User', 150, startY + 5);
    doc.text('Vendor', 300, startY + 5);
    doc.text('Meal', 450, startY + 5);
    doc.text('Rem.', 520, startY + 5);

    let currentY = startY + 20;
    doc.fillColor('#1a1a1a').font('Helvetica').fontSize(9);

    transactions.forEach((tx, index) => {
      // Add page if needed
      if (currentY > 750) {
        doc.addPage();
        currentY = 40;
        // Repeat Header
        doc.rect(40, currentY, 515, 20).fill('#1a1a1a');
        doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold');
        doc.text('Time', 50, currentY + 5);
        doc.text('User', 150, currentY + 5);
        doc.text('Vendor', 300, currentY + 5);
        doc.text('Meal', 450, currentY + 5);
        doc.text('Rem.', 520, currentY + 5);
        currentY += 20;
        doc.fillColor('#1a1a1a').font('Helvetica').fontSize(9);
      }

      // Zebra striping
      if (index % 2 === 1) {
        doc.rect(40, currentY, 515, 18).fill('#fafafa');
        doc.fillColor('#1a1a1a');
      }

      const time = tx.transaction_time ? new Date(tx.transaction_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A';
      doc.text(time, 50, currentY + 5);
      doc.text(tx.user_name || 'N/A', 150, currentY + 5, { width: 140, ellipsis: true });
      doc.text(tx.vendor_name || 'N/A', 300, currentY + 5, { width: 140, ellipsis: true });
      doc.text(tx.meal_name || 'N/A', 450, currentY + 5);
      doc.text(tx.meal_remaining_after?.toString() || '0', 520, currentY + 5);

      currentY += 18;
    });

    doc.end();
  } catch (err) {
    console.error('Live feed PDF export error:', err);
    res.status(500).json({ error: 'Failed to export PDF: ' + err.message });
  }
});


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
      totalRegistrations: new Set(report.map(r => r.user_id)).size,
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
        TO_CHAR(ec.consumed_at, 'HH24:MI:SS') as consumption_time
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

// ===== RATE LIMITING =====
const requestCounts = new Map();
const RATE_WINDOW_MS = 60000;
const MAX_REQUESTS_PER_WINDOW = 500;
const HEALTH_MAX_REQUESTS = 2000;

const PUBLIC_ENDPOINTS = ['/api/health', '/api/auth/login', '/api/auth/register'];

const rateLimit = (req, res, next) => {
  const path = req.path || req.url;

  if (PUBLIC_ENDPOINTS.some(p => path.startsWith(p))) {
    if (path.includes('/api/health')) {
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      const now = Date.now();
      const key = `health:${ip}`;

      let record = requestCounts.get(key);
      if (!record || now - record.windowStart > RATE_WINDOW_MS) {
        record = { windowStart: now, count: 0 };
        requestCounts.set(key, record);
      }

      record.count++;

      if (record.count > HEALTH_MAX_REQUESTS) {
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
      }
    }
    return next();
  }

  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const key = `${ip}:${path}`;

  let record = requestCounts.get(key);
  if (!record || now - record.windowStart > RATE_WINDOW_MS) {
    record = { windowStart: now, count: 0 };
    requestCounts.set(key, record);
  }

  record.count++;

  if (record.count > MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  next();
};

app.use(rateLimit);

// ===== ERROR HANDLING & RESILIENCE =====

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

setInterval(() => {
  const now = Date.now();
  const windowStart = now - 120000;
  for (const [key, value] of requestCounts.entries()) {
    if (value.windowStart < windowStart) {
      requestCounts.delete(key);
    }
  }
}, 60000);

// ===== DATABASE OPTIMIZATIONS =====
let dbConnected = false;

async function initDatabase() {
  try {
    const { pool } = require('./db');
    await pool.query('SELECT 1');
    dbConnected = true;
    console.log('✅ Connected to PostgreSQL database');
  } catch (err) {
    console.error('Database connection failed:', err.message);
    dbConnected = false;
  }
}

initDatabase();

// ===== ADMIN RECONCILIATION & SYNC ENDPOINTS =====

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
      GROUP BY ma.user_id, u.registration_number, u.name, ma.meal_type_id, mt.name, ma.allocated, ma.remaining
      HAVING ABS((ma.allocated - COUNT(t.id)) - ma.remaining) > 0
    `);

    if (discrepancies.length > 0) {
      issues.push({
        severity: 'HIGH',
        type: 'allocation_discrepancy',
        count: discrepancies.length,
        description: 'Remaining count does not match actual transactions',
        details: discrepancies.slice(0, 10)
      });
    }

    // Check 2: Event registrations vs consumptions
    const unconfirmed = await dbAll(`
      SELECT 
        er.event_id,
        MAX(e.name) as event_name,
        er.user_id,
        MAX(u.registration_number) as registration_number,
        MAX(u.name) as user_name,
        COUNT(ec.id) as meals_consumed,
        (SELECT COUNT(*) FROM meal_types WHERE active = 1) as total_meal_types
      FROM event_registrations er
      JOIN events e ON er.event_id = e.id
      JOIN users u ON er.user_id = u.id
      LEFT JOIN event_consumptions ec ON er.event_id = ec.event_id AND er.user_id = ec.user_id
      GROUP BY er.event_id, er.user_id
      HAVING COUNT(ec.id) < (SELECT COUNT(*) FROM meal_types WHERE active = 1)
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

    let updated = 0;
    let errors = [];

    try {
      // Set-based recalculation - allocations that have transactions
      const withTx = await dbRun(`
        UPDATE meal_allocations ma
        SET remaining = ma.allocated - COALESCE(t.count, 0),
            consumed_count = COALESCE(t.count, 0),
            updated_at = NOW()
        FROM (
          SELECT user_id, meal_type_id, COUNT(*) as count
          FROM transactions
          GROUP BY user_id, meal_type_id
        ) t
        WHERE ma.user_id = t.user_id AND ma.meal_type_id = t.meal_type_id
      `);
      updated += withTx.changes || 0;

      // Allocations with no transactions - reset to full balance
      const noTx = await dbRun(`
        UPDATE meal_allocations ma
        SET remaining = ma.allocated,
            consumed_count = 0,
            updated_at = NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM transactions t
          WHERE t.user_id = ma.user_id AND t.meal_type_id = ma.meal_type_id
        )
      `);
      updated += noTx.changes || 0;
    } catch (err) {
      errors.push({ error: err.message });
    }

    const totalAllocations = await dbGet('SELECT COUNT(*) as count FROM meal_allocations');

    res.json({
      success: true,
      updated,
      totalAllocations: totalAllocations?.count || 0,
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

// ===== BULK USER IMPORT =====

const { parseUserFile } = require('./csv-parser');

/**
 * POST /api/admin/users/bulk-import
 * Accepts:
 *   { text: "CSV or pipe-delimited content" }
 *   { users: [{ registrationNumber, name, pin }] }
 *   { file: "base64-encoded-content", filename: "users.csv" }
 * Auto-detects format: CSV, TSV, pipe-delimited, Excel export, or "Name: X | ID: Y | PIN: Z"
 */
app.post('/api/admin/users/bulk-import', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const createAllocations = req.body.allocateMeals !== false;
    let fileContent = '';

    if (req.body.users && Array.isArray(req.body.users)) {
      // Direct user array - convert to our normalized format
      const parsed = { users: req.body.users, errors: [], stats: { total: req.body.users.length, imported: 0, duplicates: 0, invalid: 0 } };
      fileContent = null; // Skip CSV parsing
      var preParsed = parsed;
    } else if (req.body.text && typeof req.body.text === 'string') {
      fileContent = req.body.text;
    } else if (req.body.file && typeof req.body.file === 'string') {
      fileContent = Buffer.from(req.body.file, 'base64').toString('utf8');
    } else {
      return res.status(400).json({ error: 'Provide text content, base64 file, or users array' });
    }

    let parseResult;
    if (preParsed) {
      parseResult = preParsed;
      // Normalize pre-parsed users
      parseResult.users = parseResult.users.map(u => {
        if (u.name && u.registrationNumber) return { name: u.name, registrationNumber: u.registrationNumber, pin: u.pin || '1234' };
        return null;
      }).filter(Boolean);
      parseResult.stats.imported = parseResult.users.length;
    } else {
      parseResult = parseUserFile(fileContent);
    }

    const { users, errors: parseErrors, stats } = parseResult;

    if (users.length === 0) {
      return res.status(400).json({
        error: 'No valid users found',
        parseStats: stats,
        parseErrors: parseErrors.slice(0, 20),
      });
    }

    // Batch insert for performance - collect all users, hash PINs, then bulk insert
    let imported = 0;
    let skipped = 0;
    const importErrors = [];

    // Pre-fetch existing registration numbers in one query
    const existingUsers = await dbAll('SELECT registration_number FROM users');
    const existingRegNums = new Set(existingUsers.map(u => u.registration_number));

    // Get meal types once
    const mealTypes = createAllocations ? await dbAll('SELECT id FROM meal_types WHERE active = 1') : [];

    // Process in batches - large batches minimize DB round trips
    const BATCH_SIZE = 200;
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);

      // Hash all PINs in parallel
      const hashedUsers = await Promise.all(
        batch.map(async (u) => {
          const pinHash = await hashPassword(u.pin.toString());
          return { ...u, pinHash };
        })
      );

      const toInsert = hashedUsers.filter(u => !existingRegNums.has(u.registrationNumber));
      if (toInsert.length === 0) {
        skipped += hashedUsers.length;
        continue;
      }

      try {
        // Multi-row user insert - returns only rows actually inserted
        const userValues = [];
        const userParams = [];
        for (const u of toInsert) {
          userParams.push(generateId(), u.registrationNumber, u.name, u.pinHash, u.accommodation || 'Y');
          userValues.push('(?, ?, ?, ?, ?, 1)');
        }

        const inserted = await dbAll(
          `INSERT INTO users (id, registration_number, name, pin_hash, accommodation, active)
           VALUES ${userValues.join(', ')}
           ON CONFLICT (registration_number) DO NOTHING
           RETURNING id, registration_number`,
          userParams
        );

        const insertedRegNums = new Set(inserted.map(r => r.registration_number));
        insertedRegNums.forEach(regNum => existingRegNums.add(regNum));
        imported += inserted.length;
        skipped += (toInsert.length - inserted.length);

        if (createAllocations && mealTypes.length > 0 && inserted.length > 0) {
          // Multi-row meal allocation insert - Y=12, N=4
          const allocValues = [];
          const allocParams = [];
          for (const row of inserted) {
            const acc = hashedUsers.find(u => u.registrationNumber === row.registration_number)?.accommodation;
            const mealAllocation = (acc === 'N') ? 4 : 12;
            for (const mt of mealTypes) {
              allocParams.push(generateId(), row.id, mt.id, mealAllocation, mealAllocation);
              allocValues.push('(?, ?, ?, ?, ?)');
            }
          }
          await dbRun(
            `INSERT INTO meal_allocations (id, user_id, meal_type_id, allocated, remaining)
             VALUES ${allocValues.join(', ')}
             ON CONFLICT (user_id, meal_type_id) DO NOTHING`,
            allocParams
          );
        }
      } catch (err) {
        // Fall back to per-user inserts if the batch insert fails (e.g. size limits)
        for (const u of toInsert) {
          try {
            const userId = generateId();
            const result = await dbRun(
              `INSERT INTO users (id, registration_number, name, pin_hash, accommodation, active)
               VALUES (?, ?, ?, ?, ?, 1)
               ON CONFLICT (registration_number) DO NOTHING`,
              [userId, u.registrationNumber, u.name, u.pinHash, u.accommodation || 'Y']
            );
            if (!result || result.changes === 0) {
              // User already exists (likely inserted in the batch above) - don't double-count
              continue;
            }

            existingRegNums.add(u.registrationNumber);
            imported++;

            if (createAllocations && mealTypes.length > 0) {
              const mealAllocation = (u.accommodation === 'N') ? 4 : 12;
              for (const mt of mealTypes) {
                try {
                  await dbRun(
                    `INSERT INTO meal_allocations (id, user_id, meal_type_id, allocated, remaining)
                     VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT (user_id, meal_type_id) DO NOTHING`,
                    [generateId(), userId, mt.id, mealAllocation, mealAllocation]
                  );
                } catch (allocErr) {
                  // Log but don't fail the user import over meal allocation issues
                  importErrors.push({ user: u.registrationNumber, error: 'Meal allocation: ' + allocErr.message });
                }
              }
            }
          } catch (err2) {
            importErrors.push({ user: u.registrationNumber, error: err2.message });
            skipped++;
          }
        }
      }
    }

    res.json({
      success: true,
      message: `Imported ${imported} users, skipped ${skipped}`,
      imported,
      skipped,
      parseStats: stats,
      parseErrors: parseErrors.length > 0 ? parseErrors.slice(0, 20) : undefined,
      importErrors: importErrors.length > 0 ? importErrors.slice(0, 50) : undefined,
      totalProcessed: users.length,
    });
  } catch (err) {
    console.error('Bulk import error:', err);
    res.status(500).json({ error: 'Bulk import failed: ' + err.message });
  }
});

// ===== MEAL TYPE MANAGEMENT =====

/**
 * GET /api/admin/meal-types
 * List all meal types
 */
app.get('/api/admin/meal-types', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }
    const mealTypes = await dbAll('SELECT * FROM meal_types ORDER BY start_time');
    res.json(mealTypes);
  } catch (err) {
    console.error('Get meal types error:', err);
    res.status(500).json({ error: 'Failed to fetch meal types' });
  }
});

/**
 * PUT /api/admin/meal-types/:id
 * Update a meal type's name, start_time, end_time, active
 */
app.put('/api/admin/meal-types/:id', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const { name, startTime, endTime, active } = req.body;
    const mealType = await dbGet('SELECT * FROM meal_types WHERE id = ?', [req.params.id]);
    if (!mealType) {
      return res.status(404).json({ error: 'Meal type not found' });
    }

    // Validate times
    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (startTime && !timeRegex.test(startTime)) {
      return res.status(400).json({ error: 'Invalid start time format (use HH:MM)' });
    }
    if (endTime && !timeRegex.test(endTime)) {
      return res.status(400).json({ error: 'Invalid end time format (use HH:MM)' });
    }

    await dbRun(
      `UPDATE meal_types SET name = ?, start_time = ?, end_time = ?, active = ? WHERE id = ?`,
      [
        name || mealType.name,
        startTime || mealType.start_time,
        endTime || mealType.end_time,
        active !== undefined ? (active ? 1 : 0) : mealType.active,
        req.params.id
      ]
    );

    const updated = await dbGet('SELECT * FROM meal_types WHERE id = ?', [req.params.id]);
    res.json({ success: true, mealType: updated });
  } catch (err) {
    console.error('Update meal type error:', err);
    res.status(500).json({ error: 'Failed to update meal type' });
  }
});

// ===== HEALTH CHECK =====

app.get('/api/health', async (req, res) => {
  if (!dbConnected) {
    try { await initDatabase(); } catch (e) { /* retry */ }
  }
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: dbConnected ? 'connected' : 'disconnected'
  });
});

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  await closePool();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down...');
  await closePool();
  process.exit(0);
});

// ===== START SERVER =====

const server = app.listen(PORT, () => {
  console.log(`\n🚀 Meal Ticket API running on http://localhost:${PORT}`);
  console.log(`📚 API docs: http://localhost:${PORT}/api/health\n`);
});

module.exports = app;