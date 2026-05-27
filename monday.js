// SAFETY: this file can only CREATE new items and comments.
// It cannot delete, archive, move, or edit any existing data.
// Your existing Monday pipeline is 100% safe.

const MONDAY_API_URL = 'https://api.monday.com/v2';
const REQUEST_TIMEOUT_MS = 30_000;

const BLOCKED_OPERATIONS = [
  'delete',
  'archive',
  'move_item',
  'clear_item',
  'update_item',
  'duplicate_item',
  'change_column_value',
  'change_simple_column_value',
  'change_multiple_column_values',
];

const ALLOWED_MUTATIONS = ['create_item', 'create_update'];

/** Thrown when the Monday API returns HTTP 429 (rate limited). */
class RateLimitError extends Error {
  constructor() {
    super('Rate limited by Monday API');
    this.name = 'RateLimitError';
  }
}

/**
 * assertSafe — case-insensitive GQL guard.
 * Throws 'SAFETY ERROR' if any blocked op is present or no allowed mutation exists.
 * Also throws if the query is excessively large.
 */
function assertSafe(gql) {
  if (gql.length > 10_000) {
    throw new Error('SAFETY: query too large');
  }

  const normalised = gql.toLowerCase();

  for (const op of BLOCKED_OPERATIONS) {
    if (normalised.includes(op.toLowerCase())) {
      throw new Error('SAFETY ERROR: destructive operations are not allowed');
    }
  }

  const hasAllowed = ALLOWED_MUTATIONS.some(op => normalised.includes(op.toLowerCase()));
  if (!hasAllowed) {
    throw new Error('SAFETY ERROR: destructive operations are not allowed');
  }
}

/**
 * maskToken — replaces all occurrences of token in str with [REDACTED].
 * Prevents token leakage in error messages.
 */
function maskToken(str, token) {
  if (!token || !str) return str;
  return str.split(token).join('[REDACTED]');
}

/**
 * query — internal function. URL is hard-coded; never user-controlled.
 * Token is NEVER logged or included in error messages.
 * Variables are passed separately — user data never interpolated into gql.
 */
async function query(token, gql, variables = {}) {
  assertSafe(gql);

  let res;
  try {
    res = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      body: JSON.stringify({ query: gql, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(maskToken(`Monday API request failed: ${err.message}`, token));
  }

  if (res.status === 401) {
    throw new Error('Invalid API token — check MONDAY_API_TOKEN in your .env file');
  }

  if (res.status === 429) {
    throw new RateLimitError();
  }

  if (!res.ok) {
    throw new Error(`Monday API error: HTTP ${res.status}`);
  }

  const json = await res.json();

  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error('Monday API returned unexpected response format');
  }

  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors.map(e => e.message).join(', '));
  }

  return json.data;
}

/** Creates a new item on the board and returns its ID. */
export async function createItem(token, boardId, itemName) {
  const gql = `mutation CreateItem($boardId: ID!, $name: String!) {
    create_item(board_id: $boardId, item_name: $name) { id }
  }`;
  // Explicit field extraction — never spread untrusted API response
  const data = await query(token, gql, { boardId: String(boardId), name: itemName });
  return data.create_item.id;
}

/** Posts a comment on an existing item and returns the update ID. */
export async function createUpdate(token, itemId, body) {
  const gql = `mutation CreateUpdate($itemId: ID!, $body: String!) {
    create_update(item_id: $itemId, body: $body) { id }
  }`;
  // Explicit field extraction — never spread untrusted API response
  const data = await query(token, gql, { itemId: String(itemId), body });
  return data.create_update.id;
}

export { assertSafe, RateLimitError };
