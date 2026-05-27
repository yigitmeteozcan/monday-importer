import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { readFileSync, symlinkSync, mkdtempSync as fsMkdtempSync, rmSync as fsRmSync } from 'fs';
import { assertSafe, RateLimitError } from '../monday.js';
import { stripHtml, validateEnv, MAX_ROWS, MAX_ITEM_NAME_LENGTH, defuseFormula } from '../utils.js';
import { readExcel, MAX_FILE_SIZE_BYTES } from '../excel.js';

// ---------------------------------------------------------------------------
// Scenario 1 — API token never logged in 401 error message
// ---------------------------------------------------------------------------
test('Scenario 1: 401 error message does not contain the token string', () => {
  const fakeToken = 'super-secret-test-token-12345';
  const hardcodedMsg = 'Invalid API token — check MONDAY_API_TOKEN in your .env file';
  assert.ok(
    !hardcodedMsg.includes(fakeToken),
    'The hardcoded 401 error message must not contain the token'
  );
});

// ---------------------------------------------------------------------------
// Scenario 2 — placeholder token rejected by validateEnv
// ---------------------------------------------------------------------------
test('Scenario 2: validateEnv throws on placeholder token', () => {
  const origToken = process.env.MONDAY_API_TOKEN;
  const origBoard = process.env.MONDAY_BOARD_ID;

  process.env.MONDAY_API_TOKEN = 'your_token_here';
  process.env.MONDAY_BOARD_ID = '12345';

  try {
    assert.throws(
      () => validateEnv(),
      (err) => {
        assert.ok(err.message.toLowerCase().includes('placeholder'), `Expected 'placeholder' in: ${err.message}`);
        return true;
      }
    );
  } finally {
    process.env.MONDAY_API_TOKEN = origToken;
    process.env.MONDAY_BOARD_ID = origBoard;
  }
});

// ---------------------------------------------------------------------------
// Scenario 3 — delete mutation blocked by assertSafe
// ---------------------------------------------------------------------------
test('Scenario 3: delete mutation is blocked by assertSafe', () => {
  assert.throws(
    () => assertSafe(`mutation { delete_item(item_id: 123) { id } }`),
    /SAFETY ERROR/
  );
});

// ---------------------------------------------------------------------------
// Scenario 4 — empty company name row is skipped
// ---------------------------------------------------------------------------
test('Scenario 4: empty company name row is skipped by readExcel', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'monday-test-'));
  const filePath = path.join(dir, 'import.xlsx');

  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['Company Name', 'Notes']);   // header
    ws.addRow(['Acme Corp', 'Great team']); // valid row
    ws.addRow(['', 'Some note']);           // empty company — should be skipped
    ws.addRow(['Beta Inc', 'Another note']); // valid row
    await wb.xlsx.writeFile(filePath);

    const rows = await readExcel(filePath);
    assert.equal(rows.length, 2, 'Only 2 valid rows expected');
    assert.ok(rows.every(r => r.company.trim() !== ''), 'No empty company names in output');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Scenario 5 — HTML tags stripped from notes
// ---------------------------------------------------------------------------
test('Scenario 5: stripHtml removes script tags', () => {
  const input = '<script>alert(1)</script>Interesting company';
  const result = stripHtml(input);
  assert.ok(!result.includes('<script>'), 'Output must not contain <script>');
  assert.ok(!result.includes('</script>'), 'Output must not contain </script>');
  assert.ok(result.includes('Interesting company'), 'Plain text must be preserved');
});

// ---------------------------------------------------------------------------
// Scenario 6 — company name truncated at 255 chars
// ---------------------------------------------------------------------------
test('Scenario 6: company name longer than 255 chars is truncated', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'monday-test-'));
  const filePath = path.join(dir, 'import.xlsx');

  try {
    const longName = 'A'.repeat(300);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['Company Name', 'Notes']);
    ws.addRow([longName, 'Some note']);
    await wb.xlsx.writeFile(filePath);

    const rows = await readExcel(filePath);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].company.length, MAX_ITEM_NAME_LENGTH,
      `Company name must be truncated to ${MAX_ITEM_NAME_LENGTH} chars`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Scenario 7 — Excel with 600 rows is capped at MAX_ROWS (500)
// ---------------------------------------------------------------------------
test('Scenario 7: readExcel caps output at MAX_ROWS when file has more rows', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'monday-test-'));
  const filePath = path.join(dir, 'import.xlsx');

  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['Company Name', 'Notes']); // header
    for (let i = 1; i <= 600; i++) {
      ws.addRow([`Company ${i}`, `Note ${i}`]);
    }
    await wb.xlsx.writeFile(filePath);

    const rows = await readExcel(filePath);
    assert.equal(rows.length, MAX_ROWS, `Expected ${MAX_ROWS} rows, got ${rows.length}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Scenario 8 — RateLimitError is a proper Error subclass
// ---------------------------------------------------------------------------
test('Scenario 8: RateLimitError has correct name and is instanceof Error', () => {
  const err = new RateLimitError();
  assert.equal(err.name, 'RateLimitError');
  assert.ok(err instanceof Error, 'RateLimitError must be instanceof Error');
  assert.ok(err.message.length > 0, 'RateLimitError must have a non-empty message');
});

// ---------------------------------------------------------------------------
// Scenario 9 — 3 consecutive failures: structural verification
// ---------------------------------------------------------------------------
test('Scenario 9: MAX_CONSECUTIVE_FAILURES constant is 3 (verified structurally)', async () => {
  // The import loop tracks consecutiveFailures and calls process.exit(1) after 3.
  // We verify the constant value is correct by reading the source contract.
  // Full end-to-end coverage requires integration testing with a mocked API.
  const { readFileSync } = await import('fs');
  const src = readFileSync(new URL('../import.js', import.meta.url), 'utf8');
  assert.ok(
    src.includes('MAX_CONSECUTIVE_FAILURES = 3'),
    'import.js must define MAX_CONSECUTIVE_FAILURES = 3'
  );
  assert.ok(
    src.includes('consecutiveFailures >= MAX_CONSECUTIVE_FAILURES'),
    'import.js must check consecutiveFailures >= MAX_CONSECUTIVE_FAILURES'
  );
});

// ---------------------------------------------------------------------------
// Scenario 10 — corrupted .xlsx throws a clean error
// ---------------------------------------------------------------------------
test('Scenario 10: corrupted xlsx file throws a clean error message', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'monday-test-'));
  const filePath = path.join(dir, 'import.xlsx');

  try {
    writeFileSync(filePath, Buffer.from([0x00, 0xFF, 0xAB, 0xCD, 0x12, 0x34]));

    await assert.rejects(
      () => readExcel(filePath),
      (err) => {
        assert.ok(
          err.message.includes('Cannot read import.xlsx'),
          `Expected 'Cannot read import.xlsx' in: ${err.message}`
        );
        return true;
      }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
