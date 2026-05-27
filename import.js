import 'dotenv/config';
import { createInterface } from 'readline';
import { appendFileSync } from 'fs';
import { readExcel } from './excel.js';
import { createItem, createUpdate } from './monday.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function log(message) {
  process.stdout.write(message + '\n');
}

function logToFile(message) {
  try {
    appendFileSync('import-log.txt', message + '\n');
  } catch {
    // non-fatal
  }
}

function validateEnv() {
  const token = process.env.MONDAY_API_TOKEN;
  const boardId = process.env.MONDAY_BOARD_ID;

  if (!token || token === 'your_token_here') {
    throw new Error('MONDAY_API_TOKEN is not set. Copy .env.example to .env and add your token.');
  }
  if (!boardId) {
    throw new Error('MONDAY_BOARD_ID is not set. Copy .env.example to .env and set your board ID.');
  }

  return { token, boardId };
}

async function main() {
  // 1. Validate environment
  let token, boardId;
  try {
    ({ token, boardId } = validateEnv());
  } catch (err) {
    log(`\nConfiguration error: ${err.message}\n`);
    process.exit(1);
  }

  // 2. Read Excel
  let rows;
  try {
    rows = await readExcel();
  } catch (err) {
    log(`\nExcel error: ${err.message}\n`);
    process.exit(1);
  }

  // 3. Preview
  const total = rows.length;
  const previewCount = Math.min(3, total);
  const previewLines = rows
    .slice(0, previewCount)
    .map((r, i) => {
      const note = r.note.length > 50 ? r.note.slice(0, 50) + '...' : r.note;
      return `   ${i + 1}. ${r.company} — "${note}"`;
    })
    .join('\n');

  log(`\nAbout to import ${total} ${total === 1 ? 'company' : 'companies'} to Monday board ${boardId}.`);
  log(`Preview:\n${previewLines}\n`);

  const answer = await prompt('Continue? (y/n): ');
  if (answer !== 'y') {
    log('Import cancelled.');
    process.exit(0);
  }

  log('');

  // 4. Import rows
  const timestamp = new Date().toISOString();
  logToFile(`\n=== Import run: ${timestamp} | Board: ${boardId} | Rows: ${total} ===`);

  let successCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const { company, note } = rows[i];
    const position = `[${i + 1}/${total}]`;

    try {
      const itemId = await createItem(token, boardId, company);
      await sleep(300);

      if (note) {
        await createUpdate(token, itemId, note);
        await sleep(300);
      }

      log(`${position} ${company} ✓  (item ID: ${itemId})`);
      logToFile(`${position} ${company} | item_id=${itemId}`);
      successCount++;
    } catch (err) {
      log(`${position} ${company} ✗  WARNING: ${err.message}`);
      logToFile(`${position} ${company} | ERROR: ${err.message}`);
      await sleep(300);
    }
  }

  log(`\nDone. ${successCount}/${total} items imported successfully.`);
  if (successCount < total) {
    log(`${total - successCount} row(s) failed — check warnings above.`);
  }
  log('Item IDs saved to import-log.txt\n');
}

main();
