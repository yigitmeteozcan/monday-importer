import ExcelJS from 'exceljs';
import { existsSync, lstatSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MAX_ROWS, MAX_ITEM_NAME_LENGTH, warn } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

export async function readExcel(filename = 'import.xlsx') {
  const filePath = path.resolve(__dirname, filename);

  if (!existsSync(filePath)) {
    throw new Error(`import.xlsx not found. Place your Excel file at: ${filePath}`);
  }

  const stats = lstatSync(filePath);
  if (stats.isSymbolicLink()) {
    throw new Error('import.xlsx must be a regular file, not a symlink.');
  }
  if (stats.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `import.xlsx is too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). Maximum is 50MB.`
    );
  }

  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.readFile(filePath);
  } catch (err) {
    throw new Error(`Cannot read import.xlsx: ${err.message}. Make sure the file is a valid .xlsx file.`);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('Excel file has no worksheets.');
  }

  const firstRow = sheet.getRow(1);
  if (firstRow.cellCount < 2) {
    throw new Error('Excel file must have at least 2 columns (Company Name, Notes).');
  }

  const allRows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    allRows.push({ row, rowNumber });
  });

  const totalRows = allRows.length;
  if (totalRows > MAX_ROWS) {
    warn(
      `Excel has ${totalRows} rows. Max is ${MAX_ROWS} per run. ` +
      `First ${MAX_ROWS} will be imported. Split your file to import more.`
    );
  }

  const rows = [];
  for (const { row, rowNumber } of allRows.slice(0, MAX_ROWS)) {
    let company = String(row.getCell(1).value ?? '').trim();
    const note = String(row.getCell(2).value ?? '').trim();

    if (!company) {
      warn(`Row ${rowNumber}: empty company name — skipped`);
      continue;
    }

    if (DANGEROUS_KEYS.includes(company)) {
      warn(`Row ${rowNumber}: company name '${company}' is a dangerous key — skipped`);
      continue;
    }

    if (company.length > MAX_ITEM_NAME_LENGTH) {
      warn(`Row ${rowNumber}: company name truncated to ${MAX_ITEM_NAME_LENGTH} chars`);
      company = company.slice(0, MAX_ITEM_NAME_LENGTH);
    }

    rows.push({ company, note });
  }

  if (rows.length === 0) {
    throw new Error('Excel file has no data rows (only a header was found or all company names are empty).');
  }

  return rows;
}
