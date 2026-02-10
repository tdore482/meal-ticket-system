/**
 * Meal Ticket Management System - Backend API
 * Express.js + SQLite
 * Run: npm install && npm run init-db && npm start
 */

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use(express.static('public'));

// Database
const db = new sqlite3.Database(process.env.DB_PATH || './meal_system.db', (err) => {
  if (err) console.error('Database error:', err);
  else console.log('✅ Connected to database');
});

// Promisify database operations
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

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
       WHERE session_token = ? AND expires_at > datetime('now')`,
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
    const { name, registrationNumber, pin } = req.body;

    if (!name || !registrationNumber || !pin) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if registration number already exists
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
      `INSERT INTO users (id, registration_number, name, pin_hash, active)
       VALUES (?, ?, ?, ?, 1)`,
      [userId, registrationNumber, name, pinHash]
    );

    // Create meal allocations for all meal types
    const mealTypes = await dbAll('SELECT id FROM meal_types WHERE active = 1');
    
    for (const mealType of mealTypes) {
      const allocId = generateId();
      await dbRun(
        `INSERT INTO meal_allocations (id, user_id, meal_type_id, allocated, remaining)
         VALUES (?, ?, ?, 20, 20)`,
        [allocId, userId, mealType.id]
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
    const { role, registrationNumber, pin, vendorCode, username, password } = req.body;

    if (!role) {
      return res.status(400).json({ error: 'Role required' });
    }

    let userId, vendorId, adminId, sessionData = {};

    if (role === 'user') {
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
 */
app.get('/api/user/dashboard', authenticateSession, async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(403).json({ error: 'Not a user session' });
    }

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.session.user_id]);

    const meals = await dbAll(
      `SELECT mt.id, mt.name, mt.start_time, mt.end_time, 
              COALESCE(ma.allocated, 0) as allocated, 
              COALESCE(ma.remaining, 0) as remaining
       FROM meal_types mt
       LEFT JOIN meal_allocations ma ON mt.id = ma.meal_type_id AND ma.user_id = ?
       WHERE mt.active = 1
       ORDER BY mt.start_time`,
      [req.session.user_id]
    );

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const activeMeal = meals.find(m => currentTime >= m.start_time && currentTime < m.end_time) || null;

    const totalRemaining = meals.reduce((sum, m) => sum + (m.remaining || 0), 0);

    res.json({
      user: { id: user.id, name: user.name, regNum: user.registration_number },
      meals,
      activeMeal,
      totalRemaining
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

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    const activeMeal = await dbGet(
      `SELECT id FROM meal_types
       WHERE ? >= start_time AND ? < end_time AND active = 1`,
      [currentTime, currentTime]
    );

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
 */
app.get('/api/vendor/dashboard', authenticateSession, async (req, res) => {
  try {
    if (!req.session.vendor_id) {
      return res.status(403).json({ error: 'Not a vendor session' });
    }

    const vendor = await dbGet('SELECT * FROM vendors WHERE id = ?', [req.session.vendor_id]);
    const mealTypes = await dbAll('SELECT * FROM meal_types WHERE active = 1 ORDER BY start_time');

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    const activeMeal = await dbGet(
      `SELECT * FROM meal_types
       WHERE ? >= start_time AND ? < end_time AND active = 1`,
      [currentTime, currentTime]
    );

    res.json({
      vendor: { id: vendor.id, name: vendor.name },
      activeMeal,
      mealTypes
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

    const { qrData, mealTypeId } = req.body;

    if (!qrData) {
      return res.status(400).json({ error: 'QR data required' });
    }

    // Event mode: EVT:{eventId}|REG:{regNum}|TOKEN:{token}
    const evtMatch = qrData.match(/EVT:([A-Za-z0-9_-]+)\|REG:([A-Za-z0-9_-]+)\|TOKEN:([A-Z0-9]+)/);
    if (evtMatch) {
      const [, eventId, regNum, tokenStr] = evtMatch;
      return handleEventValidation(req, res, { eventId, regNum, tokenStr, mealTypeId });
    }

    // Legacy mode: REG:{regNum}|TOKEN:{token}
    const regMatch = qrData.match(/REG:([A-Za-z0-9]+)/);
    const tokenMatch = qrData.match(/TOKEN:([A-Z0-9]+)/);

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
        message: 'User Not Found'
      });
    }

    if (!user.active) {
      return res.status(400).json({
        status: 'denied',
        message: 'Account Suspended'
      });
    }

    const qrToken = await dbGet(
      `SELECT * FROM qr_tokens
       WHERE user_id = ? AND token = ? AND used = 0
       AND expires_at > datetime('now')`,
      [user.id, tokenStr]
    );

    if (!qrToken) {
      return res.status(400).json({
        status: 'denied',
        message: 'Invalid or Expired Token'
      });
    }

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    const activeMeal = await dbGet(
      `SELECT id FROM meal_types
       WHERE ? >= start_time AND ? < end_time AND active = 1`,
      [currentTime, currentTime]
    );

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

    // === ATOMIC TRANSACTION ===
    await dbRun('UPDATE qr_tokens SET used = 1 WHERE id = ?', [qrToken.id]);

    const newRemaining = allocation.remaining - 1;
    await dbRun(
      `UPDATE meal_allocations SET remaining = ?, updated_at = datetime('now') WHERE id = ?`,
      [newRemaining, allocation.id]
    );

    const txId = generateId();
    const txDate = new Date().toISOString().split('T')[0];
    await dbRun(
      `INSERT INTO transactions
       (id, user_id, vendor_id, meal_type_id, qr_token_id, meal_remaining_after, transaction_date, transaction_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [txId, user.id, req.session.vendor_id, activeMeal.id, qrToken.id, newRemaining, txDate]
    );

    res.json({
      status: 'approved',
      message: `Authorized: ${user.name}`,
      remaining: newRemaining
    });
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
     WHERE event_id = ? AND user_id = ? AND token = ?`,
    [eventId, user.id, tokenStr]
  );
  if (!eventToken) {
    return res.status(400).json({ status: 'denied', message: 'Invalid Event QR Token' });
  }

  let mealType;
  if (mealTypeId) {
    mealType = await dbGet('SELECT * FROM meal_types WHERE id = ? AND active = 1', [mealTypeId]);
  }
  if (!mealType) {
    const currentTime = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
    mealType = await dbGet(
      `SELECT * FROM meal_types WHERE ? >= start_time AND ? < end_time AND active = 1`,
      [currentTime, currentTime]
    );
  }
  if (!mealType) {
    return res.status(400).json({ status: 'denied', message: 'Please select a meal type' });
  }

  const alreadyConsumed = await dbGet(
    `SELECT id FROM event_consumptions
     WHERE event_id = ? AND user_id = ? AND meal_type_id = ?`,
    [eventId, user.id, mealType.id]
  );
  if (alreadyConsumed) {
    return res.status(400).json({
      status: 'denied',
      message: `Already redeemed ${mealType.name} for this event`
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
  const remainingCount = 3 - consumptions.length;

  res.json({
    status: 'approved',
    message: `Authorized: ${user.name} - ${mealType.name} redeemed`,
    remaining: remainingCount,
    consumed: consumptions.length
  });
}

// ===== ADMIN ROUTES =====

/**
 * GET /api/admin/dashboard
 */
app.get('/api/admin/dashboard', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const today = new Date().toISOString().split('T')[0];

    const stats = await dbAll(
      `SELECT mt.name, COUNT(t.id) as count
       FROM meal_types mt
       LEFT JOIN transactions t ON mt.id = t.meal_type_id AND t.transaction_date = ?
       WHERE mt.active = 1
       GROUP BY mt.id, mt.name
       ORDER BY mt.start_time`,
      [today]
    );

    const total = stats.reduce((sum, s) => sum + (s.count || 0), 0);

    const transactions = await dbAll(
      `SELECT t.*, u.name as user_name, v.name as vendor_name, mt.name as meal_name
       FROM transactions t
       JOIN users u ON t.user_id = u.id
       JOIN vendors v ON t.vendor_id = v.id
       JOIN meal_types mt ON t.meal_type_id = mt.id
       ORDER BY t.transaction_time DESC
       LIMIT 20`,
      []
    );

    res.json({
      summary: { stats, total, date: today },
      transactions
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).json({ error: 'Failed to load admin dashboard' });
  }
});

/**
 * GET /api/admin/daily-breakdown
 */
app.get('/api/admin/daily-breakdown', authenticateSession, async (req, res) => {
  try {
    if (!req.session.admin_id) {
      return res.status(403).json({ error: 'Not an admin session' });
    }

    const { date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    const breakdown = await dbAll(
      `SELECT mt.name, COUNT(t.id) as count
       FROM meal_types mt
       LEFT JOIN transactions t ON mt.id = t.meal_type_id AND t.transaction_date = ?
       WHERE mt.active = 1
       GROUP BY mt.id, mt.name
       ORDER BY mt.start_time`,
      [date]
    );

    res.json({ date, breakdown });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch daily breakdown' });
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
        (SELECT token FROM qr_tokens WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as latest_token,
        (SELECT expires_at FROM qr_tokens WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as token_expiry
       FROM users u
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
      'SELECT id, registration_number, name, active FROM users WHERE id = ?',
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
           SET allocated = ?, remaining = ?, updated_at = datetime('now')
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
              (SELECT token FROM event_qr_tokens WHERE event_id = ? AND user_id = u.id) as qr_token,
              (SELECT COUNT(*) FROM event_consumptions WHERE event_id = ? AND user_id = u.id) as consumed_count
       FROM event_registrations er
       JOIN users u ON er.user_id = u.id
       WHERE er.event_id = ?`,
      [event.id, event.id, event.id]
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
    let added = 0;
    for (const userId of userIds) {
      const result = await dbRun(
        `INSERT OR IGNORE INTO event_registrations (id, event_id, user_id)
         VALUES (?, ?, ?)`,
        [generateId(), eventId, userId]
      );
      if (result && result.changes > 0) added++;
    }
    res.json({ success: true, added, total: userIds.length });
  } catch (err) {
    console.error('Add registrations error:', err);
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
    let generated = 0;
    for (const reg of registrations) {
      const existing = await dbGet(
        'SELECT id FROM event_qr_tokens WHERE event_id = ? AND user_id = ?',
        [eventId, reg.user_id]
      );
      if (!existing) {
        const tokenId = generateId();
        const token = generateToken();
        await dbRun(
          `INSERT INTO event_qr_tokens (id, event_id, user_id, token)
           VALUES (?, ?, ?, ?)`,
          [tokenId, eventId, reg.user_id, token]
        );
        generated++;
      }
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
    const QR_SIZE = 95;

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
      const qrBuffer = await QRCode.toBuffer(qrData, { width: QR_SIZE, margin: 1, errorCorrectionLevel: 'H' });

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

// ===== HEALTH CHECK =====

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ===== START SERVER =====

app.listen(PORT, () => {
  console.log(`\n🚀 Meal Ticket API running on http://localhost:${PORT}`);
  console.log(`📚 API docs: http://localhost:${PORT}/api/health\n`);
});