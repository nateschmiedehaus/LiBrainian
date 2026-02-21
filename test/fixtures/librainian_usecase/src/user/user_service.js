/**
 * User service module.
 * Handles user CRUD operations and business logic.
 */

const { validateEmail, validateName } = require('../utils/validators');
const { formatDate } = require('../utils/date_helpers');
const { query } = require('../db/client');

/**
 * Processes and creates a new user.
 * Validates input data before persisting.
 *
 * @param {object} userData - User data to process
 * @param {string} userData.email - User email
 * @param {string} userData.name - User name
 * @param {string} userData.password - User password
 * @returns {Promise<object>} Created user object
 * @throws {Error} If validation fails
 */
async function processUser(userData) {
  // Validate email
  if (!validateEmail(userData.email)) {
    throw new Error('Invalid email format');
  }

  // Validate name
  if (!validateName(userData.name)) {
    throw new Error('Invalid name');
  }

  // Check if email exists
  const existing = await getUserByEmail(userData.email);
  if (existing) {
    throw new Error('Email already registered');
  }

  // Create user
  const result = await query(
    'INSERT INTO users (email, name, password_hash, created_at) VALUES ($1, $2, $3, $4) RETURNING *',
    [userData.email, userData.name, userData.password, new Date()]
  );

  const user = result.rows[0];
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: formatDate(user.created_at)
  };
}

/**
 * Retrieves a user by their ID.
 * @param {string} id - User ID
 * @returns {Promise<object|null>} User object or null if not found
 */
async function getUserById(id) {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  if (result.rows.length === 0) {
    return null;
  }

  const user = result.rows[0];
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: formatDate(user.created_at)
  };
}

/**
 * Retrieves a user by their email address.
 * @param {string} email - User email
 * @returns {Promise<object|null>} User object or null if not found
 */
async function getUserByEmail(email) {
  const result = await query('SELECT * FROM users WHERE email = $1', [email]);
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

/**
 * Updates a user's profile information.
 * @param {string} id - User ID
 * @param {object} updates - Fields to update
 * @returns {Promise<object>} Updated user object
 */
async function updateUser(id, updates) {
  const fields = [];
  const values = [];
  let paramIndex = 1;

  if (updates.name) {
    if (!validateName(updates.name)) {
      throw new Error('Invalid name');
    }
    fields.push(`name = $${paramIndex}`);
    values.push(updates.name);
    paramIndex++;
  }

  if (fields.length === 0) {
    return getUserById(id);
  }

  values.push(id);
  const result = await query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  return result.rows[0];
}

module.exports = {
  processUser,
  getUserById,
  getUserByEmail,
  updateUser
};
