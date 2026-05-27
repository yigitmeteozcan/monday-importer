// SAFETY: this file can only CREATE new items and comments.
// It cannot delete, archive, move, or edit any existing data.
// Your existing Monday pipeline is 100% safe.

import fetch from 'node-fetch';

const MONDAY_API_URL = 'https://api.monday.com/v2';

const BLOCKED_OPERATIONS = [
  'delete',
  'archive',
  'move_item',
  'change_column_value',
  'change_simple_column_value',
  'change_multiple_column_values',
];

const ALLOWED_MUTATIONS = ['create_item', 'create_update'];

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

async function query(token, gql) {
  assertSafe(gql);

  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify({ query: gql }),
  });

  if (!res.ok) {
    throw new Error(`Monday API HTTP error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  if (json.errors && json.errors.length > 0) {
    throw new Error(`Monday API error: ${json.errors.map(e => e.message).join(', ')}`);
  }

  return json.data;
}

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

export { assertSafe };
