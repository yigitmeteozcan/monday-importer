// Shared constants and utilities for monday-importer

const MAX_ROWS = 500;
const MAX_ITEM_NAME_LENGTH = 255;

/**
 * stripHtml — removes all HTML tags using regex.
 * No DOM, no external deps. Used to prevent injection into Monday comments.
 * Example: '<script>alert(1)</script>Hello' → 'Hello'
 */
function stripHtml(text) {
  return String(text).replace(/<[^>]*>/g, '');
}

/** Prefixed info logger — replaces all bare console.log calls. */
function log(msg) {
  console.log(`[monday-importer] ${msg}`);
}

/** Prefixed warning logger. */
function warn(msg) {
  console.warn(`[monday-importer] WARN: ${msg}`);
}

/**
 * validateEnv — reads and validates MONDAY_API_TOKEN and MONDAY_BOARD_ID
 * from process.env. Throws a descriptive Error on any misconfiguration.
 * Exported here (not import.js) so tests can import it without triggering main().
 */
function validateEnv() {
  const token = process.env.MONDAY_API_TOKEN;
  const boardId = process.env.MONDAY_BOARD_ID;

  if (!token || token.includes('your_') || token.includes('_here')) {
    throw new Error(
      'MONDAY_API_TOKEN is not set or still contains the placeholder value. ' +
      'Copy .env.example to .env and set a real token.'
    );
  }

  if (!boardId || !/^\d+$/.test(boardId)) {
    throw new Error('MONDAY_BOARD_ID must be numeric (e.g. 18146507025).');
  }

  return { token, boardId };
}

/**
 * defuseFormula — prefixes formula-injection strings with a single quote.
 * Prevents CSV/Excel formula injection when company names are written to log files.
 * Example: '=HYPERLINK("evil.com")' → "'=HYPERLINK(\"evil.com\")"
 */
function defuseFormula(str) {
  return /^[=+\-@]/.test(str) ? `'${str}` : str;
}

export { MAX_ROWS, MAX_ITEM_NAME_LENGTH, stripHtml, log, warn, validateEnv, defuseFormula };
