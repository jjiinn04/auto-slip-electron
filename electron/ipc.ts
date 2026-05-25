import { ipcMain, BrowserWindow, shell, dialog } from 'electron';
import Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { SettingsStore } from './settings';
import { parseTaxInvoiceXML, checkEncrypted } from './xml-parser';
import { generateExcel, generateMonthlyCostExcel } from './excel-generator';

interface ScannedFile {
  name: string;
  path: string;
  type: 'xml' | 'pdf' | 'image' | 'other';
  size: number;
}

function detectFileType(fileName: string): ScannedFile['type'] {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.xml') return 'xml';
  if (ext === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff'].includes(ext)) return 'image';
  return 'other';
}

function scanFolderFiles(folderPath: string): ScannedFile[] {
  if (!fs.existsSync(folderPath)) return [];

  const files: ScannedFile[] = [];
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && !entry.name.startsWith('.')) {
      const fullPath = path.join(folderPath, entry.name);
      const stat = fs.statSync(fullPath);
      files.push({
        name: entry.name,
        path: fullPath,
        type: detectFileType(entry.name),
        size: stat.size,
      });
    }
  }

  return files;
}

export function registerIpcHandlers(
  db: Database.Database,
  settings: SettingsStore,
  getWindow: () => BrowserWindow | null,
) {
  ipcMain.handle('settings:get', () => {
    return {
      invoiceFolder: settings.get('invoiceFolder'),
      approvalFolder: settings.get('approvalFolder'),
      anthropicApiKey: settings.get('anthropicApiKey'),
      defaultMonth: settings.get('defaultMonth'),
    };
  });

  ipcMain.handle('settings:set', (_event, data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) {
      settings.set(key as any, value as any);
    }
    return true;
  });

  ipcMain.handle('folder:scan', (_event, folderPath: string) => {
    const files = scanFolderFiles(folderPath);
    return {
      files,
      counts: {
        xml: files.filter(f => f.type === 'xml').length,
        pdf: files.filter(f => f.type === 'pdf').length,
        image: files.filter(f => f.type === 'image').length,
        other: files.filter(f => f.type === 'other').length,
        total: files.length,
      },
    };
  });

  ipcMain.handle('files:process', async (_event, invoiceFolder: string, approvalFolder: string, month: string) => {
    console.log('[files:process] start', { invoiceFolder, approvalFolder, month });
    const win = getWindow();
    const invoiceFiles = scanFolderFiles(invoiceFolder);
    const approvalFiles = approvalFolder ? scanFolderFiles(approvalFolder) : [];
    const xmlFiles = invoiceFiles.filter(f => f.type === 'xml');
    const statementFiles = invoiceFiles.filter(f => f.type === 'pdf' || f.type === 'image');
    const approvalDocFiles = approvalFiles.filter(f => f.type === 'pdf' || f.type === 'image');
    const docFiles = [...statementFiles, ...approvalDocFiles];
    const files = [...invoiceFiles, ...approvalFiles];

    const sendProgress = (step: string, current: number, total: number) => {
      win?.webContents.send('processing:progress', { step, current, total });
    };

    sendProgress('XML 파싱', 0, xmlFiles.length);
    const insertInvoice = db.prepare(`
      INSERT INTO tax_invoices (invoice_number, issue_date, supplier_id, supplier_name,
        supply_amount, tax_amount, total_amount, description, status, source_file, month)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'parsed', ?, ?)
    `);
    const insertLineItem = db.prepare(`
      INSERT INTO line_items (invoice_id, line_number, item_description, quantity, unit_price, line_total)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    db.prepare('DELETE FROM line_items WHERE invoice_id IN (SELECT id FROM tax_invoices WHERE month = ?)').run(month);
    db.prepare('DELETE FROM tax_invoices WHERE month = ?').run(month);
    db.prepare('DELETE FROM approval_documents WHERE month = ?').run(month);

    let parsedCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < xmlFiles.length; i++) {
      const file = xmlFiles[i];
      sendProgress('XML 파싱', i + 1, xmlFiles.length);

      try {
        const result = parseTaxInvoiceXML(file.path);
        db.transaction(() => {
          const inv = insertInvoice.run(
            result.invoice_number,
            result.issue_date,
            result.supplier_id,
            result.supplier_name,
            result.supply_amount,
            result.tax_amount,
            result.total_amount,
            result.line_items?.[0]?.item_description || '',
            file.name,
            month,
          );
          for (const item of result.line_items || []) {
            insertLineItem.run(
              inv.lastInsertRowid,
              item.line_number,
              item.item_description,
              item.quantity,
              item.unit_price,
              item.line_total,
            );
          }
        })();
        parsedCount++;
      } catch (err: any) {
        errors.push(`${file.name}: ${err.message}`);
      }
    }

    sendProgress('기안문서 등록', 0, docFiles.length);
    const insertDoc = db.prepare(`
      INSERT INTO approval_documents (file_name, file_path, file_type, classification, confidence, month)
      VALUES (?, ?, ?, ?, 0.9, ?)
    `);

    for (let i = 0; i < docFiles.length; i++) {
      const file = docFiles[i];
      sendProgress('문서 등록', i + 1, docFiles.length);
      const classification = statementFiles.includes(file) ? 'statement' : 'approval';
      insertDoc.run(file.name, file.path, file.type, classification, month);
    }

    sendProgress('매칭', 0, 1);
    const invoices = db.prepare('SELECT id, supplier_name, source_file FROM tax_invoices WHERE month = ?').all(month) as any[];
    const approvals = db.prepare('SELECT id, file_name FROM approval_documents WHERE month = ? AND matched_invoice_id IS NULL').all(month) as any[];

    let matchCount = 0;
    const updateMatch = db.prepare('UPDATE approval_documents SET matched_invoice_id = ? WHERE id = ?');
    for (const approval of approvals) {
      const approvalName = approval.file_name.toLowerCase().replace(/\.[^.]+$/, '');
      for (const inv of invoices) {
        const supplierLower = (inv.supplier_name || '').toLowerCase();
        if (approvalName.includes(supplierLower) || supplierLower.includes(approvalName)) {
          updateMatch.run(inv.id, approval.id);
          matchCount++;
          break;
        }
      }
    }
    sendProgress('매칭', 1, 1);

    db.prepare(`
      INSERT INTO processing_logs (month, action, description, file_count)
      VALUES (?, 'process', ?, ?)
    `).run(month, `XML ${parsedCount}건, 기안 ${docFiles.length}건, 매칭 ${matchCount}건`, files.length);

    sendProgress('완료', 1, 1);

    return {
      parsed: parsedCount,
      approvals: docFiles.length,
      matched: matchCount,
      errors,
      total: files.length,
    };
  });

  ipcMain.handle('invoices:list', (_event, month: string) => {
    return db.prepare(`
      SELECT t.*,
        GROUP_CONCAT(CASE WHEN a.classification = 'approval' THEN a.file_name END) as approval_files,
        GROUP_CONCAT(CASE WHEN a.classification = 'statement' THEN a.file_name END) as statement_files
      FROM tax_invoices t
      LEFT JOIN approval_documents a ON a.matched_invoice_id = t.id
      WHERE t.month = ?
      GROUP BY t.id
      ORDER BY t.issue_date DESC
    `).all(month);
  });

  ipcMain.handle('invoices:get', (_event, id: number) => {
    const invoice = db.prepare('SELECT * FROM tax_invoices WHERE id = ?').get(id);
    const items = db.prepare('SELECT * FROM line_items WHERE invoice_id = ? ORDER BY line_number').all(id);
    const approvals = db.prepare("SELECT * FROM approval_documents WHERE matched_invoice_id = ? AND classification = 'approval'").all(id);
    const statements = db.prepare("SELECT * FROM approval_documents WHERE matched_invoice_id = ? AND classification = 'statement'").all(id);
    return { invoice, items, approvals, statements };
  });

  ipcMain.handle('invoices:delete', (_event, id: number) => {
    db.transaction(() => {
      db.prepare('UPDATE approval_documents SET matched_invoice_id = NULL WHERE matched_invoice_id = ?').run(id);
      db.prepare('DELETE FROM line_items WHERE invoice_id = ?').run(id);
      db.prepare('DELETE FROM tax_invoices WHERE id = ?').run(id);
    })();
    return true;
  });

  ipcMain.handle('invoices:match', (_event, invoiceId: number, approvalId: number) => {
    db.prepare('UPDATE approval_documents SET matched_invoice_id = ? WHERE id = ?').run(invoiceId, approvalId);
    return true;
  });

  ipcMain.handle('invoices:unmatch', (_event, approvalId: number) => {
    db.prepare('UPDATE approval_documents SET matched_invoice_id = NULL WHERE id = ?').run(approvalId);
    return true;
  });

  ipcMain.handle('approvals:unmatched', (_event, month: string, classification?: string) => {
    if (classification) {
      return db.prepare('SELECT * FROM approval_documents WHERE month = ? AND matched_invoice_id IS NULL AND classification = ? ORDER BY file_name').all(month, classification);
    }
    return db.prepare('SELECT * FROM approval_documents WHERE month = ? AND matched_invoice_id IS NULL ORDER BY file_name').all(month);
  });

  ipcMain.handle('file:open', (_event, filePath: string) => {
    shell.openPath(filePath);
    return true;
  });

  ipcMain.handle('file:showInFolder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle('approvals:list', (_event, month: string) => {
    return db.prepare(`
      SELECT a.*, t.supplier_name as matched_supplier
      FROM approval_documents a
      LEFT JOIN tax_invoices t ON t.id = a.matched_invoice_id
      WHERE a.month = ?
      ORDER BY a.created_at DESC
    `).all(month);
  });

  ipcMain.handle('matched:list', (_event, month: string) => {
    return db.prepare(`
      SELECT t.id, t.invoice_number, t.supplier_name, t.total_amount, t.issue_date,
             a.file_name as approval_file, a.file_path as approval_path
      FROM tax_invoices t
      INNER JOIN approval_documents a ON a.matched_invoice_id = t.id
      WHERE t.month = ?
      ORDER BY t.issue_date DESC
    `).all(month);
  });

  ipcMain.handle('summary:get', (_event, month: string) => {
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_invoices,
        COALESCE(SUM(supply_amount), 0) as total_supply,
        COALESCE(SUM(tax_amount), 0) as total_tax,
        COALESCE(SUM(total_amount), 0) as total_amount
      FROM tax_invoices WHERE month = ?
    `).get(month) as any;

    const approvalCount = db.prepare(
      'SELECT COUNT(*) as count FROM approval_documents WHERE month = ?'
    ).get(month) as any;

    const matchedCount = db.prepare(
      'SELECT COUNT(*) as count FROM approval_documents WHERE month = ? AND matched_invoice_id IS NOT NULL'
    ).get(month) as any;

    const bySupplier = db.prepare(`
      SELECT supplier_name, COUNT(*) as count,
             SUM(supply_amount) as supply, SUM(tax_amount) as tax, SUM(total_amount) as total
      FROM tax_invoices WHERE month = ?
      GROUP BY supplier_name ORDER BY total DESC
    `).all(month);

    const recentLogs = db.prepare(
      'SELECT * FROM processing_logs WHERE month = ? ORDER BY created_at DESC LIMIT 10'
    ).all(month);

    return {
      invoices: stats,
      approvals: approvalCount.count,
      matched: matchedCount.count,
      bySupplier,
      recentLogs,
    };
  });

  ipcMain.handle('costItems:list', () => {
    return db.prepare('SELECT * FROM cost_items ORDER BY sort_order, id').all();
  });

  ipcMain.handle('costItems:save', (_event, item: { id?: number; display_name: string; contract_period: string; supplier: string; match_keyword: string; billing_cycle?: string; sort_order: number }) => {
    const cycle = item.billing_cycle || 'monthly';
    if (item.id) {
      db.prepare('UPDATE cost_items SET display_name=?, contract_period=?, supplier=?, match_keyword=?, billing_cycle=?, sort_order=? WHERE id=?')
        .run(item.display_name, item.contract_period, item.supplier, item.match_keyword, cycle, item.sort_order, item.id);
      return item.id;
    }
    const r = db.prepare('INSERT INTO cost_items (display_name, contract_period, supplier, match_keyword, billing_cycle, sort_order) VALUES (?,?,?,?,?,?)')
      .run(item.display_name, item.contract_period, item.supplier, item.match_keyword, cycle, item.sort_order);
    return r.lastInsertRowid;
  });

  ipcMain.handle('costItems:delete', (_event, id: number) => {
    db.prepare('DELETE FROM cost_items WHERE id=?').run(id);
    return true;
  });

  ipcMain.handle('costItems:autoDetect', () => {
    const existing = db.prepare('SELECT match_keyword FROM cost_items').all() as any[];
    const existingKeys = new Set(existing.map(e => e.match_keyword));

    const descriptions = db.prepare(`
      SELECT description, supplier_name, supplier_id, COUNT(*) as cnt
      FROM tax_invoices
      WHERE description IS NOT NULL AND description != ''
      GROUP BY description
      ORDER BY supplier_name, description
    `).all() as any[];

    let order = (db.prepare('SELECT MAX(sort_order) as m FROM cost_items').get() as any)?.m || 0;
    let added = 0;

    for (const d of descriptions) {
      if (!existingKeys.has(d.description)) {
        order++;
        db.prepare('INSERT INTO cost_items (display_name, contract_period, supplier, match_keyword, sort_order) VALUES (?,?,?,?,?)')
          .run(d.description, '', d.supplier_name, d.description, order);
        added++;
      }
    }
    return { added, total: order };
  });

  ipcMain.handle('costItems:importFromExcel', async (_event, filePath: string) => {
    const buf = fs.readFileSync(filePath);
    checkEncrypted(buf, filePath);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const ws = wb.worksheets[0];
    if (!ws) return { added: 0, skipped: 0, total: 0, amountsImported: 0 };

    function readCellText(cell: ExcelJS.Cell): string {
      const v = cell.value;
      if (v && typeof v === 'object' && 'richText' in (v as any)) {
        return ((v as any).richText as any[]).map((rt: any) => rt.text).join('').trim();
      }
      const s = String(v || '').trim();
      return s === 'null' ? '' : s;
    }

    const existing = db.prepare('SELECT id, display_name FROM cost_items').all() as any[];
    const existingMap = new Map(existing.map((e: any) => [e.display_name.trim(), e.id]));
    let order = (db.prepare('SELECT MAX(sort_order) as m FROM cost_items').get() as any)?.m || 0;

    interface ParsedRow {
      name: string;
      period: string;
      supplier: string;
      year: number;
      months: Record<number, number>;
    }
    const rows: ParsedRow[] = [];

    for (let r = 4; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const name = readCellText(row.getCell(3));
      if (!name || name === '내역' || name.includes('월별 비용 총합')) continue;

      const yearStr = readCellText(row.getCell(6));
      const yearMatch = yearStr.match(/(\d+)년/);
      if (!yearMatch) continue;
      const year = parseInt(yearMatch[1]) + (parseInt(yearMatch[1]) < 100 ? 2000 : 0);

      const period = readCellText(row.getCell(4));
      const supplier = readCellText(row.getCell(5));

      const months: Record<number, number> = {};
      for (let m = 1; m <= 12; m++) {
        const v = row.getCell(m + 6).value;
        if (typeof v === 'number' && v > 0) months[m] = Math.round(v);
      }

      rows.push({ name, period, supplier, year, months });
    }

    let added = 0;
    let skipped = 0;
    let amountsImported = 0;

    const upsertAmount = db.prepare(`
      INSERT INTO cost_item_amounts (cost_item_id, year, month, amount, source)
      VALUES (?, ?, ?, ?, 'excel')
      ON CONFLICT(cost_item_id, year, month) DO UPDATE SET amount = excluded.amount, source = 'excel'
    `);

    const seenNames = new Set<string>();
    for (const row of rows) {
      let itemId = existingMap.get(row.name);

      if (!itemId && !seenNames.has(row.name)) {
        order++;
        const r = db.prepare('INSERT INTO cost_items (display_name, contract_period, supplier, match_keyword, sort_order) VALUES (?,?,?,?,?)')
          .run(row.name, row.period, row.supplier, row.name, order);
        itemId = r.lastInsertRowid as number;
        existingMap.set(row.name, itemId);
        added++;
      } else if (!itemId) {
        itemId = existingMap.get(row.name);
      } else if (seenNames.has(row.name)) {
        // already counted
      } else {
        skipped++;
      }
      seenNames.add(row.name);

      if (itemId) {
        for (const [m, amount] of Object.entries(row.months)) {
          upsertAmount.run(itemId, row.year, parseInt(m), amount);
          amountsImported++;
        }
      }
    }

    return { added, skipped, total: seenNames.size, amountsImported };
  });

  ipcMain.handle('monthlyCost:data', (_event, baseYear: number) => {
    const items = db.prepare('SELECT * FROM cost_items ORDER BY sort_order, id').all() as any[];
    const years = [baseYear, baseYear - 1];

    const invoices = db.prepare(`
      SELECT description, supply_amount, issue_date
      FROM tax_invoices
      WHERE CAST(SUBSTR(issue_date, 1, 4) AS INTEGER) IN (?, ?)
    `).all(years[0], years[1]) as any[];

    const excelAmounts = db.prepare(`
      SELECT cost_item_id, year, month, amount
      FROM cost_item_amounts
      WHERE year IN (?, ?)
    `).all(years[0], years[1]) as any[];

    const excelMap = new Map<string, number>();
    for (const ea of excelAmounts) {
      excelMap.set(`${ea.cost_item_id}-${ea.year}-${ea.month}`, ea.amount);
    }

    const result = items.map((item: any) => {
      const yearData: Record<number, { total: number; months: Record<number, number> }> = {};
      for (const y of years) {
        yearData[y] = { total: 0, months: {} };
        for (let m = 1; m <= 12; m++) yearData[y].months[m] = 0;
      }

      for (const inv of invoices) {
        if (inv.description && inv.description.includes(item.match_keyword)) {
          const y = parseInt(inv.issue_date.slice(0, 4));
          const m = parseInt(inv.issue_date.slice(5, 7));
          if (yearData[y]) {
            yearData[y].months[m] += inv.supply_amount;
            yearData[y].total += inv.supply_amount;
          }
        }
      }

      for (const y of years) {
        for (let m = 1; m <= 12; m++) {
          if (yearData[y].months[m] === 0) {
            const excelVal = excelMap.get(`${item.id}-${y}-${m}`);
            if (excelVal && excelVal > 0) {
              yearData[y].months[m] = excelVal;
              yearData[y].total += excelVal;
            }
          }
        }
      }

      return {
        id: item.id,
        display_name: item.display_name,
        contract_period: item.contract_period,
        supplier: item.supplier,
        match_keyword: item.match_keyword,
        billing_cycle: item.billing_cycle || 'monthly',
        sort_order: item.sort_order,
        yearData,
      };
    });

    return { items: result, years };
  });

  ipcMain.handle('export:excel', async (_event, month: string, type: string) => {
    if (type === 'monthly-cost') {
      const baseYear = parseInt(month) || new Date().getFullYear();
      const years = [baseYear, baseYear - 1];
      const items = db.prepare('SELECT * FROM cost_items ORDER BY sort_order, id').all() as any[];
      const invoices = db.prepare(`
        SELECT description, supply_amount, issue_date
        FROM tax_invoices
        WHERE CAST(SUBSTR(issue_date, 1, 4) AS INTEGER) IN (?, ?)
      `).all(years[0], years[1]) as any[];

      const excelAmounts = db.prepare(`
        SELECT cost_item_id, year, month, amount
        FROM cost_item_amounts
        WHERE year IN (?, ?)
      `).all(years[0], years[1]) as any[];

      const excelMap = new Map<string, number>();
      for (const ea of excelAmounts) {
        excelMap.set(`${ea.cost_item_id}-${ea.year}-${ea.month}`, ea.amount);
      }

      const exportItems = items.map((item: any) => {
        const yearData: Record<number, { total: number; months: Record<number, number> }> = {};
        for (const y of years) {
          yearData[y] = { total: 0, months: {} };
          for (let m = 1; m <= 12; m++) yearData[y].months[m] = 0;
        }
        for (const inv of invoices) {
          if (inv.description && inv.description.includes(item.match_keyword)) {
            const y = parseInt(inv.issue_date.slice(0, 4));
            const m = parseInt(inv.issue_date.slice(5, 7));
            if (yearData[y]) {
              yearData[y].months[m] += inv.supply_amount;
              yearData[y].total += inv.supply_amount;
            }
          }
        }
        for (const y of years) {
          for (let m = 1; m <= 12; m++) {
            if (yearData[y].months[m] === 0) {
              const excelVal = excelMap.get(`${item.id}-${y}-${m}`);
              if (excelVal && excelVal > 0) {
                yearData[y].months[m] = excelVal;
                yearData[y].total += excelVal;
              }
            }
          }
        }
        return { display_name: item.display_name, contract_period: item.contract_period, supplier: item.supplier, yearData };
      });

      const filePath = await generateMonthlyCostExcel(exportItems, baseYear);
      shell.showItemInFolder(filePath);
      return { file_path: filePath };
    }

    const invoices = db.prepare('SELECT * FROM tax_invoices WHERE month = ? ORDER BY issue_date').all(month) as any[];
    const filePath = await generateExcel(invoices, type, month);
    shell.showItemInFolder(filePath);
    return { file_path: filePath };
  });
}
