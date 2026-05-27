// SAFETY: this file can only CREATE new items and comments.
// It cannot delete, archive, move, or edit any existing data.
// Your existing Monday pipeline is 100% safe.

import fetch from 'node-fetch';

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
 */
function assertSafe(gql) {
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
 * query — internal function. URL is hard-coded; never user-controlled.
 * Token is NEVER logged or included in error messages.
 */
async function query(token, gql) {
  assertSafe(gql);

  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify({ query: gql }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

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

  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors.map(e => e.message).join(', '));
  }

  return json.data;
}

/** Creates a new item on the board and returns its ID. */
export async function createItem(token, boardId, itemName) {
  const escaped = itemName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const gql = `
    mutation {
      create_item(
        board_id: ${boardId},
        item_name: "${escaped}"
      ) {
        id
      }
    }
  `;
  const data = await query(token, gql);
  return data.create_item.id;
}

/** Posts a comment on an existing item and returns the update ID. */
export async function createUpdate(token, itemId, body) {
  const escaped = body.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const gql = `
    mutation {
      create_update(
        item_id: ${itemId},
        body: "${escaped}"
      ) {
        id
      }
    }
  `;
  const data = await query(token, gql);
  return data.create_update.id;
}

export { assertSafe, RateLimitError };
