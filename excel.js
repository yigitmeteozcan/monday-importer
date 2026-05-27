import ExcelJS from 'exceljs';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MAX_ROWS, MAX_ITEM_NAME_LENGTH, warn } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function readExcel(filename = 'import.xlsx') {
  const filePath = path.resolve(__dirname, filename);

  if (!existsSync(filePath)) {
    throw new Error(`import.xlsx not found. Place your Excel file at: ${filePath}`);
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
