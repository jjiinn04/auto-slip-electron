import ExcelJS from 'exceljs';
import path from 'path';
import { app } from 'electron';

interface InvoiceRow {
  issue_date: string;
  invoice_number: string;
  supplier_name: string;
  supplier_id: string;
  supply_amount: number;
  tax_amount: number;
  total_amount: number;
  description: string;
  status: string;
}

interface MonthlyCostExportItem {
  display_name: string;
  contract_period: string;
  supplier: string;
  yearData: Record<number, { total: number; months: Record<number, number> }>;
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF4472C4' },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } };

function styleHeaders(ws: ExcelJS.Worksheet) {
  ws.getRow(1).eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: 'center' };
  });
}

function amountFormat(ws: ExcelJS.Worksheet, cols: number[], rowCount: number) {
  for (let r = 2; r <= rowCount + 1; r++) {
    for (const c of cols) {
      ws.getCell(r, c).numFmt = '#,##0';
    }
  }
}

const thinBorder: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFB0B0B0' } };
const allBorders: Partial<ExcelJS.Borders> = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

export async function generateExcel(
  invoices: InvoiceRow[],
  exportType: string,
  month: string,
): Promise<string> {
  const wb = new ExcelJS.Workbook();

  if (exportType === 'list') {
    const ws = wb.addWorksheet('목록표');
    ws.columns = [
      { header: '발행일', width: 12 },
      { header: '전표번호', width: 22 },
      { header: '공급자', width: 20 },
      { header: '사업자번호', width: 14 },
      { header: '공급가액', width: 14 },
      { header: '세액', width: 12 },
      { header: '합계', width: 14 },
      { header: '적요', width: 20 },
      { header: '상태', width: 10 },
    ];
    for (const inv of invoices) {
      ws.addRow([
        inv.issue_date, inv.invoice_number, inv.supplier_name, inv.supplier_id,
        inv.supply_amount, inv.tax_amount, inv.total_amount, inv.description, inv.status,
      ]);
    }
    styleHeaders(ws);
    amountFormat(ws, [5, 6, 7], invoices.length);

  } else if (exportType === 'summary') {
    const ws = wb.addWorksheet('공급자별집계');
    ws.columns = [
      { header: '공급자명', width: 20 },
      { header: '사업자번호', width: 14 },
      { header: '건수', width: 8 },
      { header: '공급가액 합계', width: 16 },
      { header: '세액 합계', width: 14 },
      { header: '합계', width: 16 },
    ];
    const grouped = new Map<string, { name: string; sid: string; count: number; supply: number; tax: number; total: number }>();
    for (const inv of invoices) {
      const key = inv.supplier_name;
      const g = grouped.get(key) || { name: key, sid: inv.supplier_id, count: 0, supply: 0, tax: 0, total: 0 };
      g.count++;
      g.supply += inv.supply_amount;
      g.tax += inv.tax_amount;
      g.total += inv.total_amount;
      grouped.set(key, g);
    }
    for (const g of [...grouped.values()].sort((a, b) => b.total - a.total)) {
      ws.addRow([g.name, g.sid, g.count, g.supply, g.tax, g.total]);
    }
    styleHeaders(ws);
    amountFormat(ws, [4, 5, 6], grouped.size);

  } else if (exportType === 'douzone') {
    const ws = wb.addWorksheet('더존전표');
    ws.columns = [
      { header: '일자', width: 12 },
      { header: '계정과목', width: 10 },
      { header: '거래처', width: 20 },
      { header: '공급가액', width: 14 },
      { header: '세액', width: 12 },
      { header: '적요', width: 20 },
      { header: '부서', width: 8 },
    ];
    for (const inv of invoices) {
      ws.addRow([inv.issue_date, '51100', inv.supplier_name, inv.supply_amount, inv.tax_amount, inv.description, '0000']);
    }
    styleHeaders(ws);
    amountFormat(ws, [4, 5], invoices.length);
  }

  const desktopPath = app.getPath('desktop');
  const filePath = path.join(desktopPath, `autoslip_${month}_${exportType}.xlsx`);
  await wb.xlsx.writeFile(filePath);
  return filePath;
}

export async function generateMonthlyCostExcel(
  items: MonthlyCostExportItem[],
  baseYear: number,
  departmentName = '부서',
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('IT시스템 월별비용');

  const years = [baseYear, baseYear - 1];
  const shortYears = years.map(y => String(y).slice(2));

  // Column widths
  ws.getColumn(1).width = 6;   // 순번
  ws.getColumn(2).width = 28;  // 내역
  ws.getColumn(3).width = 22;  // 계약기간
  ws.getColumn(4).width = 14;  // 거래처
  ws.getColumn(5).width = 6;   // 년도
  for (let i = 6; i <= 17; i++) ws.getColumn(i).width = 13; // 1~12월
  ws.getColumn(18).width = 14; // 합계

  // Header Row 1
  const h1 = ws.getRow(1);
  ws.mergeCells(1, 1, 2, 1); // 순번
  ws.mergeCells(1, 2, 2, 2); // 내역
  ws.mergeCells(1, 3, 2, 3); // 계약기간
  ws.mergeCells(1, 4, 2, 4); // 거래처
  ws.mergeCells(1, 5, 2, 5); // 년도
  ws.mergeCells(1, 6, 1, 18); // 월비용 헤더

  h1.getCell(1).value = '순번';
  h1.getCell(2).value = '내역';
  h1.getCell(3).value = '계약기간';
  h1.getCell(4).value = '거래처';
  h1.getCell(5).value = '년도';
  h1.getCell(6).value = `${baseYear}년 월 비용 (단위: 원, VAT 별도)`;

  // Header Row 2 (month numbers)
  const h2 = ws.getRow(2);
  for (let m = 1; m <= 12; m++) {
    h2.getCell(m + 5).value = m;
  }
  h2.getCell(18).value = '합계';

  // Style headers
  const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  const headerFont: Partial<ExcelJS.Font> = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
  for (let r = 1; r <= 2; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= 18; c++) {
      const cell = row.getCell(c);
      cell.fill = headerFill;
      cell.font = headerFont;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = allBorders;
    }
  }

  // Data rows
  let rowNum = 3;
  const yearFills: Record<number, ExcelJS.Fill> = {
    0: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
    1: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } },
    2: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } },
  };
  const yearCount = years.length;

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const startRow = rowNum;

    for (let yi = 0; yi < yearCount; yi++) {
      const year = years[yi];
      const yd = item.yearData[year] || { total: 0, months: {} };
      const row = ws.getRow(rowNum);
      row.height = 18;

      if (yi === 0) {
        row.getCell(1).value = idx + 1;
        row.getCell(2).value = item.display_name;
        row.getCell(3).value = item.contract_period;
        row.getCell(4).value = item.supplier;
      }

      row.getCell(5).value = `${shortYears[yi]}년`;

      for (let m = 1; m <= 12; m++) {
        const val = yd.months[m] || 0;
        if (val > 0) {
          row.getCell(m + 5).value = val;
          row.getCell(m + 5).numFmt = '#,##0';
        }
      }

      if (yd.total > 0) {
        row.getCell(18).value = yd.total;
        row.getCell(18).numFmt = '#,##0';
        row.getCell(18).font = { bold: true, size: 9 };
      }

      // Style
      for (let c = 1; c <= 18; c++) {
        const cell = row.getCell(c);
        cell.fill = yearFills[yi] || yearFills[1];
        cell.border = allBorders;
        cell.font = { ...cell.font, size: 9 };
        if (c >= 6) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else if (c === 5) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { vertical: 'middle', wrapText: c === 2 || c === 3 };
        }
      }

      rowNum++;
    }

    // Merge cells for this item (순번, 내역, 계약기간, 거래처)
    const endRow = startRow + yearCount - 1;
    if (endRow > startRow) {
      ws.mergeCells(startRow, 1, endRow, 1);
      ws.mergeCells(startRow, 2, endRow, 2);
      ws.mergeCells(startRow, 3, endRow, 3);
      ws.mergeCells(startRow, 4, endRow, 4);
    }

    // Center the merged cells
    for (const c of [1, 2, 3, 4]) {
      const cell = ws.getCell(startRow, c);
      cell.alignment = { horizontal: c === 2 ? 'left' : 'center', vertical: 'middle', wrapText: c === 2 || c === 3 };
    }
  }

  // 총합 행
  const totalFills: ExcelJS.Fill[] = [
    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } },
    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } },
    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECF0F1' } },
  ];
  const totalStartRow = rowNum;
  for (let yi = 0; yi < yearCount; yi++) {
    const year = years[yi];
    const row = ws.getRow(rowNum);
    row.height = 20;
    if (yi === 0) {
      row.getCell(2).value = '월별 비용 총합';
    }
    row.getCell(5).value = `${shortYears[yi]}년`;
    let grandTotal = 0;
    for (let m = 1; m <= 12; m++) {
      let mTotal = 0;
      for (const item of items) {
        mTotal += item.yearData[year]?.months[m] || 0;
      }
      if (mTotal > 0) {
        row.getCell(m + 5).value = mTotal;
        row.getCell(m + 5).numFmt = '#,##0';
      }
      grandTotal += mTotal;
    }
    if (grandTotal > 0) {
      row.getCell(18).value = grandTotal;
      row.getCell(18).numFmt = '#,##0';
    }
    for (let c = 1; c <= 18; c++) {
      const cell = row.getCell(c);
      cell.fill = totalFills[yi] || totalFills[1];
      cell.font = { bold: true, size: 9 };
      cell.border = allBorders;
      cell.alignment = c >= 6 ? { horizontal: 'right', vertical: 'middle' } : c === 5 ? { horizontal: 'center', vertical: 'middle' } : { horizontal: 'center', vertical: 'middle' };
    }
    rowNum++;
  }
  const totalEndRow = totalStartRow + yearCount - 1;
  ws.mergeCells(totalStartRow, 1, totalEndRow, 1);
  ws.mergeCells(totalStartRow, 2, totalEndRow, 2);
  ws.mergeCells(totalStartRow, 3, totalEndRow, 3);
  ws.mergeCells(totalStartRow, 4, totalEndRow, 4);

  const desktopPath = app.getPath('desktop');
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const safeDept = departmentName.replace(/[\\/:*?"<>|]/g, '');
  const filePath = path.join(desktopPath, `${safeDept}-월별비용-${dateStr}.xlsx`);
  await wb.xlsx.writeFile(filePath);
  return filePath;
}
