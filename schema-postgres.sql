-- Meal Types
CREATE TABLE IF NOT EXISTS meal_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  registration_number TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vendors
CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vendor_code TEXT UNIQUE NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Admins
CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Meal Allocations
CREATE TABLE IF NOT EXISTS meal_allocations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  meal_type_id TEXT NOT NULL,
  allocated INTEGER NOT NULL DEFAULT 0,
  remaining INTEGER NOT NULL DEFAULT 0,
  consumed_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (meal_type_id) REFERENCES meal_types(id)
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  vendor_id TEXT,
  admin_id TEXT,
  session_token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  FOREIGN KEY (admin_id) REFERENCES admins(id)
);

-- QR Tokens
CREATE TABLE IF NOT EXISTS qr_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  used INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  meal_type_id TEXT NOT NULL,
  qr_token_id TEXT,
  meal_remaining_after INTEGER,
  transaction_date TEXT NOT NULL,
  transaction_time TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  FOREIGN KEY (meal_type_id) REFERENCES meal_types(id),
  FOREIGN KEY (qr_token_id) REFERENCES qr_tokens(id)
);

-- Events
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users registered for an event
CREATE TABLE IF NOT EXISTS event_registrations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  UNIQUE(event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- One QR token per user per event
CREATE TABLE IF NOT EXISTS event_qr_tokens (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Tracks which meal types user has consumed in this event
CREATE TABLE IF NOT EXISTS event_consumptions (
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
);

-- Trigger function to auto-update consumed_count
CREATE OR REPLACE FUNCTION update_consumed_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE meal_allocations
  SET consumed_count = (
    SELECT COUNT(*) FROM transactions
    WHERE user_id = NEW.user_id AND meal_type_id = NEW.meal_type_id
  ),
  updated_at = NOW()
  WHERE user_id = NEW.user_id AND meal_type_id = NEW.meal_type_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop old trigger if exists, then create
DROP TRIGGER IF EXISTS update_allocation_consumed_count ON transactions;
CREATE TRIGGER update_allocation_consumed_count
AFTER INSERT ON transactions
FOR EACH ROW
EXECUTE FUNCTION update_consumed_count();
