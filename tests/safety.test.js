import assert from 'node:assert/strict';
import { assertSafe } from '../monday.js';

const SAFETY_ERROR = 'SAFETY ERROR: destructive operations are not allowed';

function expectSafetyError(gql) {
  try {
    assertSafe(gql);
    assert.fail(`Expected SAFETY ERROR but no error was thrown for: ${gql}`);
  } catch (err) {
    assert.equal(err.message, SAFETY_ERROR, `Wrong error message: ${err.message}`);
  }
}

// --- Blocked operations ---

expectSafetyError(`mutation { delete_item(item_id: 123) { id } }`);
console.log('PASS: delete mutation throws SAFETY ERROR');

expectSafetyError(`mutation { archive_item(item_id: 123) { id } }`);
console.log('PASS: archive mutation throws SAFETY ERROR');

expectSafetyError(`mutation { change_column_value(board_id: 1, item_id: 2, column_id: "x", value: "y") { id } }`);
console.log('PASS: change_column_value mutation throws SAFETY ERROR');

// --- Allowed operations ---

try {
  assertSafe(`mutation { create_item(board_id: 1, item_name: "Acme") { id } }`);
  console.log('PASS: create_item is allowed');
} catch (err) {
  assert.fail(`create_item should be allowed but threw: ${err.message}`);
}

try {
  assertSafe(`mutation { create_update(item_id: 99, body: "note") { id } }`);
  console.log('PASS: create_update is allowed');
} catch (err) {
  assert.fail(`create_update should be allowed but threw: ${err.message}`);
}

console.log('\nAll 5 safety tests passed.');
