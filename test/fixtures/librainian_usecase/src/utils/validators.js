/**
 * Validation utilities.
 * Provides common validation functions used across the application.
 */

/**
 * Validates an email address format.
 * Uses a standard email regex pattern.
 *
 * @param {string} email - Email address to validate
 * @returns {boolean} True if valid email format
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * Validates a user name.
 * Names must be 2-100 characters, letters and spaces only.
 *
 * @param {string} name - Name to validate
 * @returns {boolean} True if valid name
 */
function validateName(name) {
  if (!name || typeof name !== 'string') {
    return false;
  }

  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 100) {
    return false;
  }

  const nameRegex = /^[a-zA-Z\s]+$/;
  return nameRegex.test(trimmed);
}

/**
 * Validates a password meets security requirements.
 * Must be at least 8 characters with mixed case and numbers.
 *
 * @param {string} password - Password to validate
 * @returns {boolean} True if password meets requirements
 */
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return false;
  }

  if (password.length < 8) {
    return false;
  }

  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);

  return hasUppercase && hasLowercase && hasNumber;
}

/**
 * Validates a UUID format.
 * @param {string} uuid - UUID to validate
 * @returns {boolean} True if valid UUID format
 */
function validateUuid(uuid) {
  if (!uuid || typeof uuid !== 'string') {
    return false;
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

module.exports = {
  validateEmail,
  validateName,
  validatePassword,
  validateUuid
};
