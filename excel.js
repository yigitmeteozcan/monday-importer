import ExcelJS from 'exceljs';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function readExcel(filename = 'import.xlsx') {
  const filePath = path.resolve(__dirname, filename);

  if (!existsSync(filePath)) {
    throw new Error(`import.xlsx not found. Place your Excel file at: ${filePath}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('Excel file has no worksheets.');
  }

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header

    const company = String(row.getCell(1).value ?? '').trim();
    const note = String(row.getCell(2).value ?? '').trim();

    if (company) {
      rows.push({ company, note });
    }
  });

  if (rows.length === 0) {
    throw new Error('Excel file has no data rows (only a header was found or all company names are empty).');
  }

  const firstRow = sheet.getRow(1);
  const colCount = firstRow.cellCount;
  if (colCount < 2) {
    throw new Error('Excel file must have at least 2 columns (Company Name, Notes).');
  }

  return rows;
}
