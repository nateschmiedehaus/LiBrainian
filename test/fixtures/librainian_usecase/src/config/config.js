/**
 * Configuration management module.
 * Loads settings from environment variables and config files.
 */

const fs = require('fs');
const path = require('path');

let cachedConfig = null;

/**
 * Loads and returns the application configuration.
 * Merges default config with environment variables.
 *
 * @returns {object} Configuration object
 */
function loadConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  // Load default config
  const defaultConfigPath = path.join(__dirname, '../../config/default.json');
  const defaultConfig = JSON.parse(fs.readFileSync(defaultConfigPath, 'utf8'));

  // Merge with environment variables
  cachedConfig = {
    port: process.env.PORT || defaultConfig.server.port,
    host: process.env.HOST || defaultConfig.server.host,
    databaseUrl: process.env.DATABASE_URL || buildDatabaseUrl(defaultConfig.database),
    jwtSecret: process.env.JWT_SECRET || 'default-dev-secret',
    tokenExpiry: process.env.JWT_EXPIRY || defaultConfig.auth.tokenExpiry,
    nodeEnv: process.env.NODE_ENV || 'development'
  };

  return cachedConfig;
}

/**
 * Builds a database connection URL from config object.
 * @param {object} dbConfig - Database configuration
 * @returns {string} Database URL
 */
function buildDatabaseUrl(dbConfig) {
  return `postgres://${dbConfig.host}:${dbConfig.port}/${dbConfig.name}`;
}

/**
 * Resets the cached configuration (useful for testing).
 */
function resetConfig() {
  cachedConfig = null;
}

module.exports = {
  loadConfig,
  buildDatabaseUrl,
  resetConfig
};
