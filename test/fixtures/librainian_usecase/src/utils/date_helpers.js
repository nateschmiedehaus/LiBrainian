/**
 * Date utility functions.
 * Provides consistent date formatting across the application.
 */

/**
 * Formats a date into ISO 8601 string.
 * @param {Date|string} date - Date to format
 * @returns {string} ISO formatted date string
 */
function formatDate(date) {
  if (!date) {
    return null;
  }

  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString();
}

/**
 * Formats a date for display (human readable).
 * @param {Date|string} date - Date to format
 * @returns {string} Human readable date string
 */
function formatDisplayDate(date) {
  if (!date) {
    return '';
  }

  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Checks if a date is in the past.
 * @param {Date|string} date - Date to check
 * @returns {boolean} True if date is in the past
 */
function isPastDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d < new Date();
}

/**
 * Adds days to a date.
 * @param {Date} date - Starting date
 * @param {number} days - Number of days to add
 * @returns {Date} New date
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

module.exports = {
  formatDate,
  formatDisplayDate,
  isPastDate,
  addDays
};
