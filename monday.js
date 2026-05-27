import fetch from 'node-fetch';

const MONDAY_API_URL = 'https://api.monday.com/v2';

async function query(token, gql) {
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
