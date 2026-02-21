/**
 * Database client module.
 * Manages PostgreSQL connection pool and provides query interface.
 */

const { Pool } = require('pg');
const { loadConfig } = require('../config/config');

let pool = null;

/**
 * Initializes the database connection pool.
 * @returns {Promise<void>}
 */
async function initializeDatabase() {
  if (pool) {
    return;
  }

  const config = loadConfig();
  pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10
  });

  // Test connection
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('Database connected successfully');
  } finally {
    client.release();
  }
}

/**
 * Executes a SQL query with optional parameters.
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @returns {Promise<object>} Query result
 */
async function query(text, params) {
  if (!pool) {
    throw new Error('Database not initialized');
  }
  return pool.query(text, params);
}

/**
 * Closes the database connection pool.
 * @returns {Promise<void>}
 */
async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  initializeDatabase,
  query,
  closeDatabase
};
