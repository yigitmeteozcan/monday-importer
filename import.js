import 'dotenv/config';
import { createInterface } from 'readline';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { readExcel } from './excel.js';
import { createItem, createUpdate, RateLimitError } from './monday.js';
import { log, warn, validateEnv, defuseFormula, stripHtml } from './utils.js';

const SLEEP_BETWEEN_REQUESTS_MS = 300;
const RATE_LIMIT_WAIT_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const LOG_PATH = 'logs/import-log.txt';

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
    mkdirSync('logs', { recursive: true });
    appendFileSync(LOG_PATH, message + '\n');
  } catch (err) {
    // non-fatal: log file write failure should not stop the import
    warn(`Could not write to ${LOG_PATH}: ${err.message}`);
  }
}

// Returns a Set of company names already present in the log from prior runs.
// Log lines look like: "[3/10] Acme Corp | item_id=123456 | item created"
function loadImportedCompanies() {
  if (!existsSync(LOG_PATH)) return new Set();
  const lines = readFileSync(LOG_PATH, 'utf8').split('\n');
  const seen = new Set();
  for (const line of lines) {
    const match = line.match(/^\[\d+\/\d+\] (.+?) \| item_id=\d+/);
    if (match) {
      let name = match[1];
      // Strip defuseFormula's leading quote if present
      if (name.startsWith("'")) name = name.slice(1);
      seen.add(name);
    }
  }
  return seen;
}

async function importRow(token, boardId, company, note, onItemCreated) {
  const cleanCompany = stripHtml(company);
  const cleanNote = stripHtml(note);

  const itemId = await createItem(token, boardId, cleanCompany);
  // Log item ID immediately — before attempting createUpdate.
  // If createUpdate fails, the log proves the item already exists and won't be duplicated on retry.
  onItemCreated(itemId);
  await sleep(SLEEP_BETWEEN_REQUESTS_MS);

  if (cleanNote) {
    await createUpdate(token, itemId, cleanNote);
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
  const importedCompanies = loadImportedCompanies();
  if (importedCompanies.size > 0) {
    log(`Found ${importedCompanies.size} previously imported ${importedCompanies.size === 1 ? 'company' : 'companies'} in log — duplicates will be skipped.`);
  }

  const timestamp = new Date().toISOString();
  logToFile(`\n=== Import run: ${timestamp} | Board: ${boardId} | Rows: ${total} ===`);

  let successCount = 0;
  let skippedCount = 0;
  let consecutiveFailures = 0;

  for (let i = 0; i < rows.length; i++) {
    const { company, note } = rows[i];
    const position = `[${i + 1}/${total}]`;

    if (importedCompanies.has(company)) {
      log(`${position} ${company} — already imported, skipping`);
      skippedCount++;
      continue;
    }

    try {
      const itemId = await importRow(token, boardId, company, note, id => {
        logToFile(`${position} ${defuseFormula(company)} | item_id=${id} | item created`);
      });
      log(`${position} ${company} ✓  (item ID: ${itemId})`);
      logToFile(`${position} ${defuseFormula(company)} | item_id=${itemId} | comment posted`);
      successCount++;
      consecutiveFailures = 0;
    } catch (err) {
      if (err.name === 'RateLimitError') {
        warn(`${position} Rate limited by Monday. Waiting 60s before retry...`);
        await sleep(RATE_LIMIT_WAIT_MS);

        try {
          const itemId = await importRow(token, boardId, company, note, id => {
            logToFile(`${position} ${defuseFormula(company)} | item_id=${id} | item created [retry]`);
          });
          log(`${position} ${company} ✓  (item ID: ${itemId}) [retry]`);
          logToFile(`${position} ${defuseFormula(company)} | item_id=${itemId} | comment posted [retry]`);
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
  if (skippedCount > 0) {
    log(`${skippedCount} row(s) skipped — already imported in a previous run.`);
  }
  if (successCount + skippedCount < total) {
    log(`${total - successCount - skippedCount} row(s) failed — check warnings above.`);
  }
  log(`Item IDs saved to ${LOG_PATH}\n`);
}

main();
