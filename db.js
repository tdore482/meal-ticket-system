/**
 * Database abstraction layer using pg (node-postgres)
 * Provides dbRun, dbGet, dbAll compatible API for migration from sqlite3
 * Converts ? placeholders to $1, $2... for PostgreSQL
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

/**
 * Convert ? placeholders to $1, $2... for pg
 */
function convertPlaceholders(sql, params = []) {
  let paramIndex = 0;
  const converted = sql.replace(/\?/g, () => `$${++paramIndex}`);
  return { text: converted, values: params };
}

/**
 * dbRun - Execute INSERT/UPDATE/DELETE, return { changes, lastID }
 */
async function dbRun(sql, params = []) {
  const { text, values } = convertPlaceholders(sql, params);
  const result = await pool.query(text, values);
  return {
    changes: result.rowCount,
    lastID: result.rows[0]?.id || null,
  };
}

/**
 * dbGet - Return single row or undefined
 */
async function dbGet(sql, params = []) {
  const { text, values } = convertPlaceholders(sql, params);
  const result = await pool.query(text, values);
  return result.rows[0] || undefined;
}

/**
 * dbAll - Return array of rows
 */
async function dbAll(sql, params = []) {
  const { text, values } = convertPlaceholders(sql, params);
  const result = await pool.query(text, values);
  return result.rows || [];
}

/**
 * Execute raw SQL without placeholder conversion (for setup scripts)
 */
async function rawQuery(sql, params = []) {
  const result = await pool.query(sql, params);
  return result;
}

/**
 * Get a client for transactions
 */
async function getClient() {
  return pool.connect();
}

/**
 * Close the pool
 */
async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  dbRun,
  dbGet,
  dbAll,
  rawQuery,
  getClient,
  closePool,
  convertPlaceholders,
};
