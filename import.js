import 'dotenv/config';
import { createInterface } from 'readline';
import { appendFileSync } from 'fs';
import { readExcel } from './excel.js';
import { createItem, createUpdate, RateLimitError } from './monday.js';
import { log, warn, validateEnv, defuseFormula } from './utils.js';

const SLEEP_BETWEEN_REQUESTS_MS = 300;
const RATE_LIMIT_WAIT_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 3;

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

function logToFile(message) {
  try {
    appendFileSync('import-log.txt', message + '\n');
  } catch (err) {
    // non-fatal: log file write failure should not stop the import
    warn(`Could not write to import-log.txt: ${err.message}`);
  }
}

async function importRow(token, boardId, company, note) {
  const itemId = await createItem(token, boardId, company);
  await sleep(SLEEP_BETWEEN_REQUESTS_MS);

  if (note) {
    await createUpdate(token, itemId, note);
    await sleep(SLEEP_BETWEEN_REQUESTS_MS);
  }

  return itemId;
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
  let consecutiveFailures = 0;

  for (let i = 0; i < rows.length; i++) {
    const { company, note } = rows[i];
    const position = `[${i + 1}/${total}]`;

    try {
      const itemId = await importRow(token, boardId, company, note);
      log(`${position} ${company} ✓  (item ID: ${itemId})`);
      logToFile(`${position} ${defuseFormula(company)} | item_id=${itemId}`);
      successCount++;
      consecutiveFailures = 0;
    } catch (err) {
      if (err.name === 'RateLimitError') {
        warn(`${position} Rate limited by Monday. Waiting 60s before retry...`);
        await sleep(RATE_LIMIT_WAIT_MS);

        try {
          const itemId = await importRow(token, boardId, company, note);
          log(`${position} ${company} ✓  (item ID: ${itemId}) [retry]`);
          logToFile(`${position} ${defuseFormula(company)} | item_id=${itemId} [retry]`);
          successCount++;
          consecutiveFailures = 0;
          continue;
        } catch (retryErr) {
          warn(`${position} ${company} failed after rate-limit retry: ${retryErr.message}`);
          logToFile(`${position} ${company} | ERROR (retry): ${retryErr.message}`);
        }
      } else {
        warn(`${position} ${company} ✗  ${err.message}`);
        logToFile(`${position} ${company} | ERROR: ${err.message}`);
      }

      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        log(
          `Monday API appears to be down after 3 consecutive failures. ` +
          `${successCount} items imported successfully before the error. ` +
          `Re-run the script to continue — already-imported items will not be duplicated.`
        );
        logToFile(`STOPPED: 3 consecutive API failures at row ${i + 1}`);
        process.exit(1);
      }

      await sleep(SLEEP_BETWEEN_REQUESTS_MS);
    }
  }

  log(`\nDone. ${successCount}/${total} items imported successfully.`);
  if (successCount < total) {
    log(`${total - successCount} row(s) failed — check warnings above.`);
  }
  log('Item IDs saved to import-log.txt\n');
}

main();
