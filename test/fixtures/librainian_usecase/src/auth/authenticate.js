/**
 * Authentication module for user login and token generation.
 * Uses JWT tokens with configurable expiry.
 */

const jwt = require('jsonwebtoken');
const { validateEmail } = require('../utils/validators');
const { getUserByEmail } = require('../user/user_service');
const { loadConfig } = require('../config/config');

/**
 * Authenticates a user with email and password.
 * Returns a JWT token on success.
 *
 * @param {string} email - User's email address
 * @param {string} password - User's password
 * @returns {Promise<{token: string, user: object}>}
 * @throws {Error} If authentication fails
 */
async function authenticateUser(email, password) {
  // Validate email format first
  if (!validateEmail(email)) {
    throw new Error('Invalid email format');
  }

  // Look up user
  const user = await getUserByEmail(email);
  if (!user) {
    throw new Error('User not found');
  }

  // Verify password (simplified for demo)
  if (!verifyPassword(password, user.passwordHash)) {
    throw new Error('Invalid password');
  }

  // Generate token
  const config = loadConfig();
  const token = jwt.sign(
    { userId: user.id, email: user.email },
    config.jwtSecret,
    { expiresIn: config.tokenExpiry }
  );

  return {
    token,
    user: { id: user.id, email: user.email, name: user.name }
  };
}

/**
 * Verifies a password against a hash.
 * @param {string} password - Plain text password
 * @param {string} hash - Stored password hash
 * @returns {boolean}
 */
function verifyPassword(password, hash) {
  // Simplified - real implementation would use bcrypt
  return password === hash;
}

/**
 * Validates a JWT token and returns the decoded payload.
 * @param {string} token - JWT token to validate
 * @returns {object} Decoded token payload
 * @throws {Error} If token is invalid
 */
function validateToken(token) {
  const config = loadConfig();
  return jwt.verify(token, config.jwtSecret);
}

module.exports = {
  authenticateUser,
  verifyPassword,
  validateToken
};
