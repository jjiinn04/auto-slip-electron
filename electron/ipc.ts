import { ipcMain, BrowserWindow, shell, dialog, app } from 'electron';
import Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SettingsStore } from './settings';
import { parseTaxInvoiceXML, checkEncrypted } from './xml-parser';
import { generateExcel, generateMonthlyCostExcel } from './excel-generator';
import { buildTaxPdfIndex, mergeBundle, approvalNoFromSourceFile, type BundleItem } from './print-bundle';

interface ScannedFile {
  name: string;
  path: string;
  type: 'xml' | 'pdf' | 'image' | 'other';
  size: number;
}

function normalize(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/[-_\s·.]/g, '');
}

// 정규화된 문자열에서 날짜/기간(YY년 MM월 DD일)과 숫자 제거 → 품명 핵심만 남긴다.
// 예: "26년05월롯데지에프알통합유지보수" / "2026롯데지에프알통합유지보수" → 둘 다 "롯데지에프알통합유지보수"
function stripPeriod(s: string): string {
  return s.replace(/\d+년/g, '').replace(/\d+월/g, '').replace(/\d+일/g, '').replace(/\d+/g, '');
}

const MATCH_STOPWORDS = new Set([
  '유지보수', '비용', '서비스', '임대', '임대료', '사용료', '도입', '구독', '갱신',
  '통합', '대응', '추가', '통신', '회선', '장비', '시스템', '솔루션', '인증서',
  '관리', 'user', '그룹인터넷', '롯데지에프알', '롯데이노베이트', '라온아이티',
]);

function tokenize(s: string): string[] {
  return s
    .normalize('NFC')
    .toLowerCase()
    .split(/[\s()/_·,]+/)
    .map(t => t.replace(/[-.]/g, ''))
    .filter(t => t.length >= 2 && !/^\d+$/.test(t) && !MATCH_STOPWORDS.has(t));
}

function tokenOverlapScore(fileTokens: string[], descTokens: string[]): number {
  let score = 0;
  for (const ft of fileTokens) {
    for (const dt of descTokens) {
      if (ft === dt) {
        score += ft.length;
        break;
      }
      if (ft.includes(dt) || dt.includes(ft)) {
        const shorter = ft.length <= dt.length ? ft : dt;
        const longer = ft.length <= dt.length ? dt : ft;
        const hangul = /[가-힣]/.test(shorter);
        if (shorter.length >= 4 || (hangul && shorter.length >= 2) ||
            (shorter.length === 3 && longer.startsWith(shorter))) {
          score += shorter.length;
          break;
        }
      }
    }
  }
  return score;
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

// 송장 품명(description)에 매칭되는 월별 비용 항목이 없으면 새 항목으로 추가한다.
// 매칭 로직은 monthlyCost:data 표시 로직과 동일하게 normalize + includes 를 사용한다.
function autoAddMissingCostItems(db: Database.Database): number {
  const items = db.prepare('SELECT match_keyword FROM cost_items').all() as any[];
  const keywords = items
    .map(i => normalize(i.match_keyword || ''))
    .filter(Boolean);

  const descriptions = db.prepare(`
    SELECT description, supplier_name
    FROM tax_invoices
    WHERE description IS NOT NULL AND description != ''
    GROUP BY description
    ORDER BY supplier_name, description
  `).all() as any[];

  let order = (db.prepare('SELECT MAX(sort_order) as m FROM cost_items').get() as any)?.m || 0;
  const insert = db.prepare(
    'INSERT INTO cost_items (display_name, contract_period, supplier, match_keyword, billing_cycle, sort_order) VALUES (?,?,?,?,?,?)'
  );

  let added = 0;
  for (const d of descriptions) {
    const ndesc = normalize(d.description);
    if (!ndesc) continue;
    // 기존 항목 중 하나라도 이 품명에 매칭되면 추가하지 않는다.
    if (keywords.some(kw => kw && ndesc.includes(kw))) continue;
    order++;
    insert.run(d.description, '', d.supplier_name || '', d.description, 'monthly', order);
    keywords.push(ndesc);
    added++;
  }
  return added;
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
    console.log(`[files:process] found ${invoiceFiles.length} files, ${xmlFiles.length} XMLs in ${invoiceFolder}`);
    const statementFiles = invoiceFiles.filter(f => f.type === 'pdf' || f.type === 'image');
    const docFiles = [...statementFiles];
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
    let skippedCount = 0;
    const errors: string[] = [];
    const seenInvoiceNumbers = new Set<string>();

    for (let i = 0; i < xmlFiles.length; i++) {
      const file = xmlFiles[i];
      sendProgress('XML 파싱', i + 1, xmlFiles.length);

      try {
        const result = parseTaxInvoiceXML(file.path);
        const invoiceNumber = (result.invoice_number || '').trim();
        if (invoiceNumber && seenInvoiceNumbers.has(invoiceNumber)) {
          skippedCount++;
          continue;
        }
        if (invoiceNumber) seenInvoiceNumbers.add(invoiceNumber);
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
      insertDoc.run(file.name, file.path, file.type, 'statement', month);
    }

    sendProgress('거래명세표 매칭', 0, 1);
    const invoicesForMatch = db.prepare('SELECT id, supplier_name, description FROM tax_invoices WHERE month = ?').all(month) as any[];
    const statementsForMatch = db.prepare("SELECT id, file_name FROM approval_documents WHERE month = ? AND matched_invoice_id IS NULL AND classification = 'statement'").all(month) as any[];

    let matchCount = 0;
    const updateMatch = db.prepare('UPDATE approval_documents SET matched_invoice_id = ? WHERE id = ?');
    for (const stmt of statementsForMatch) {
      const stmtName = stmt.file_name.toLowerCase().replace(/\.[^.]+$/, '');
      for (const inv of invoicesForMatch) {
        const supplierLower = (inv.supplier_name || '').toLowerCase();
        if (stmtName.includes(supplierLower) || supplierLower.includes(stmtName)) {
          updateMatch.run(inv.id, stmt.id);
          matchCount++;
          break;
        }
      }
    }
    sendProgress('거래명세표 매칭', 1, 1);

    sendProgress('비용항목 추가', 0, 1);
    const costItemsAdded = autoAddMissingCostItems(db);
    console.log(`[files:process] cost items auto-added: ${costItemsAdded}`);
    sendProgress('비용항목 추가', 1, 1);

    db.prepare(`
      INSERT INTO processing_logs (month, action, description, file_count)
      VALUES (?, 'process', ?, ?)
    `).run(month, `XML ${parsedCount}건${skippedCount > 0 ? ` (중복 ${skippedCount}건 제외)` : ''}, 기안 ${docFiles.length}건, 매칭 ${matchCount}건${costItemsAdded > 0 ? `, 비용항목 ${costItemsAdded}건 추가` : ''}`, files.length);

    sendProgress('완료', 1, 1);

    return {
      parsed: parsedCount,
      approvals: docFiles.length,
      matched: matchCount,
      costItemsAdded,
      errors,
      total: files.length,
    };
  });

  ipcMain.handle('invoices:list', (_event, month: string) => {
    const invoices = db.prepare(`
      SELECT t.*,
        GROUP_CONCAT(CASE WHEN a.classification = 'statement' THEN a.file_name END) as statement_files
      FROM tax_invoices t
      LEFT JOIN approval_documents a ON a.matched_invoice_id = t.id
      WHERE t.month = ?
      GROUP BY t.id
      ORDER BY t.issue_date DESC
    `).all(month) as any[];

    const masters = db.prepare('SELECT * FROM approval_masters').all() as any[];
    const mapRows = db.prepare('SELECT approval_key, pdf_path FROM tax_pdf_map').all() as any[];
    const pdfMap = new Map<string, string>(mapRows.map((r) => [r.approval_key, r.pdf_path]));
    const printRows = db.prepare('SELECT approval_key, printed_at FROM tax_print_status').all() as any[];
    const printMap = new Map<string, string>(printRows.map((r) => [r.approval_key, r.printed_at]));

    return invoices.map((inv: any) => {
      const matchedMasters = masters.filter((m: any) => {
        const supplierMatch = inv.supplier_name && m.match_supplier &&
          (inv.supplier_name.includes(m.match_supplier) || m.match_supplier.includes(inv.supplier_name));
        if (!supplierMatch) return false;
        if (!m.match_description) return true;
        return inv.description && inv.description.includes(m.match_description);
      });
      const key = approvalNoFromSourceFile(inv.source_file || '');
      const mappedPath = key ? pdfMap.get(key) : undefined;
      return {
        ...inv,
        approval_files: matchedMasters.length > 0 ? matchedMasters.map((m: any) => m.file_name).join(',') : null,
        master_count: matchedMasters.length,
        pdf_mapped: !!(mappedPath && fs.existsSync(mappedPath)),
        printed_at: key ? printMap.get(key) ?? null : null,
      };
    });
  });

  ipcMain.handle('invoices:get', (_event, id: number) => {
    const invoice = db.prepare('SELECT * FROM tax_invoices WHERE id = ?').get(id) as any;
    const items = db.prepare('SELECT * FROM line_items WHERE invoice_id = ? ORDER BY line_number').all(id);
    const statements = db.prepare("SELECT * FROM approval_documents WHERE matched_invoice_id = ? AND classification = 'statement'").all(id);

    const allMasters = db.prepare('SELECT * FROM approval_masters').all() as any[];
    const masters = invoice ? allMasters.filter((m: any) => {
      const supplierMatch = invoice.supplier_name && m.match_supplier &&
        (invoice.supplier_name.includes(m.match_supplier) || m.match_supplier.includes(invoice.supplier_name));
      if (!supplierMatch) return false;
      if (!m.match_description) return true;
      return invoice.description && invoice.description.includes(m.match_description);
    }) : [];

    return { invoice, items, approvals: masters, statements };
  });

  ipcMain.handle('invoices:delete', (_event, id: number) => {
    db.transaction(() => {
      db.prepare('UPDATE approval_documents SET matched_invoice_id = NULL WHERE matched_invoice_id = ?').run(id);
      db.prepare('DELETE FROM line_items WHERE invoice_id = ?').run(id);
      db.prepare('DELETE FROM tax_invoices WHERE id = ?').run(id);
    })();
    return true;
  });

  ipcMain.handle('invoices:print', async (_event, ids: number[], mode: 'all' | 'tax' | 'approval' = 'all') => {
    if (!ids || ids.length === 0) return { ok: false, message: '선택된 항목이 없습니다.' };

    const placeholders = ids.map(() => '?').join(',');
    const invoices = db.prepare(
      `SELECT * FROM tax_invoices WHERE id IN (${placeholders})`
    ).all(...ids) as any[];
    const masters = db.prepare('SELECT * FROM approval_masters').all() as any[];

    const needsTax = mode !== 'approval';
    const invoiceFolder = settings.get('invoiceFolder') as string | undefined;
    if (needsTax && !invoiceFolder) return { ok: false, message: '세금계산서 폴더가 설정되지 않았습니다.' };

    // 1) 저장된 매핑 우선 사용 (OCR/폴더 스캔 없이 바로 경로 확보)
    const taxIndex = new Map<string, string>();
    if (needsTax) {
      const mapRows = db.prepare('SELECT approval_key, pdf_path FROM tax_pdf_map').all() as any[];
      for (const r of mapRows) {
        if (r.pdf_path && fs.existsSync(r.pdf_path)) taxIndex.set(r.approval_key, r.pdf_path);
      }

      // 2) 매핑이 없는 선택 항목만 OCR 폴백 대상으로 추림
      const unmappedKeys = invoices
        .map((inv) => approvalNoFromSourceFile(inv.source_file || ''))
        .filter((k) => k && !taxIndex.has(k));

      // 매핑이 없는 항목이 있을 때만 폴더 인덱싱(텍스트+OCR) 수행 — 모두 매핑되면 자원 소모 0
      if (unmappedKeys.length > 0 && invoiceFolder) {
        const langPath = app.isPackaged
          ? path.join(process.resourcesPath, 'ocr')
          : path.join(app.getAppPath(), 'resources', 'ocr');
        const ocr = fs.existsSync(path.join(langPath, 'kor.traineddata')) ? { langPath } : undefined;

        const fallbackIndex = await buildTaxPdfIndex(invoiceFolder, unmappedKeys, ocr);
        const upsert = db.prepare(
          `INSERT INTO tax_pdf_map (approval_key, pdf_path, mapped_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(approval_key) DO UPDATE SET pdf_path = excluded.pdf_path, mapped_at = excluded.mapped_at`
        );
        for (const [key, pdfPath] of fallbackIndex) {
          taxIndex.set(key, pdfPath);
          upsert.run(key, pdfPath); // 폴백으로 찾은 결과도 저장 → 다음 출력부터 빨라짐
        }
      }
    }

    const items: BundleItem[] = [];
    const missing: string[] = [];
    const printedIds: number[] = [];

    // ids 순서 유지
    for (const id of ids) {
      const inv = invoices.find((i) => i.id === id);
      if (!inv) continue;

      const label = `${inv.supplier_name || ''} / ${inv.description || ''} (${inv.source_file || `#${id}`})`;
      const key = approvalNoFromSourceFile(inv.source_file || '');
      const taxPdfPath = key ? taxIndex.get(key) : undefined;

      // 매칭된 기안 PDF (공급자 + 품명 includes)
      const approvalPdfPaths: string[] = [];
      for (const m of masters) {
        const supplierMatch = inv.supplier_name && m.match_supplier &&
          (inv.supplier_name.includes(m.match_supplier) || m.match_supplier.includes(inv.supplier_name));
        if (!supplierMatch) continue;
        if (m.match_description && !(inv.description && inv.description.includes(m.match_description))) continue;
        if (m.file_path && fs.existsSync(m.file_path)) approvalPdfPaths.push(m.file_path);
      }

      let paths: string[];
      if (mode === 'tax') {
        if (!taxPdfPath) { missing.push(label); continue; }
        paths = [taxPdfPath];
      } else if (mode === 'approval') {
        if (approvalPdfPaths.length === 0) { missing.push(label); continue; }
        paths = [...approvalPdfPaths];
      } else {
        if (!taxPdfPath) { missing.push(label); continue; }
        paths = [taxPdfPath, ...approvalPdfPaths];
      }

      printedIds.push(id);
      items.push({ paths });
    }

    console.log(`[invoices:print] mode=${mode}, ids=${ids.length}, bundled=${items.length}, missing=${missing.length}, taxIndex=${taxIndex.size}`);

    if (items.length === 0) {
      const what = mode === 'approval' ? '기안 PDF' : '세금계산서 PDF';
      return { ok: false, message: `${what}를 찾지 못했습니다.\n${missing.join('\n')}` };
    }

    const pdfBytes = await mergeBundle(items);
    const tmpFile = path.join(os.tmpdir(), `autoslip-print-${mode}-${Date.now()}.pdf`);
    fs.writeFileSync(tmpFile, pdfBytes);
    await shell.openPath(tmpFile);

    return { ok: true, printed: items.length, missing, printedIds };
  });

  // 인쇄 완료 확인 → 선택 항목을 출력완료로 기록 (승인번호 기준, 월 재처리에도 유지)
  ipcMain.handle('invoices:markPrinted', (_event, ids: number[]) => {
    if (!ids || ids.length === 0) return { ok: false, marked: 0 };
    const placeholders = ids.map(() => '?').join(',');
    const invoices = db.prepare(
      `SELECT id, source_file FROM tax_invoices WHERE id IN (${placeholders})`
    ).all(...ids) as any[];

    const upsert = db.prepare(
      `INSERT INTO tax_print_status (approval_key, printed_at) VALUES (?, datetime('now'))
       ON CONFLICT(approval_key) DO UPDATE SET printed_at = excluded.printed_at`
    );
    let marked = 0;
    db.transaction(() => {
      for (const inv of invoices) {
        const key = approvalNoFromSourceFile(inv.source_file || '');
        if (!key) continue;
        upsert.run(key);
        marked++;
      }
    })();
    return { ok: true, marked };
  });

  // 세금계산서 PDF 매핑(미리 인덱싱). 텍스트+OCR로 승인번호↔PDF 경로를 찾아 저장한다.
  // 이미 매핑돼 파일이 존재하는 키는 건너뛰어 OCR 재실행을 피한다.
  ipcMain.handle('invoices:buildMapping', async (_event, month: string) => {
    const invoiceFolder = settings.get('invoiceFolder') as string | undefined;
    if (!invoiceFolder) return { ok: false, message: '세금계산서 폴더가 설정되지 않았습니다.' };

    const invoices = db.prepare('SELECT id, supplier_name, description, source_file FROM tax_invoices WHERE month = ?').all(month) as any[];
    if (invoices.length === 0) return { ok: true, total: 0, mapped: 0, newlyMapped: 0, unmapped: [] };

    // 이미 매핑돼 파일이 존재하는 키 집합
    const existing = new Map<string, string>(
      (db.prepare('SELECT approval_key, pdf_path FROM tax_pdf_map').all() as any[]).map((r) => [r.approval_key, r.pdf_path]),
    );
    const keyOf = (inv: any) => approvalNoFromSourceFile(inv.source_file || '');
    const remainingKeys = invoices
      .map(keyOf)
      .filter((k) => k && !(existing.has(k) && fs.existsSync(existing.get(k)!)));

    let newlyMapped = 0;
    if (remainingKeys.length > 0) {
      const langPath = app.isPackaged
        ? path.join(process.resourcesPath, 'ocr')
        : path.join(app.getAppPath(), 'resources', 'ocr');
      const ocr = fs.existsSync(path.join(langPath, 'kor.traineddata')) ? { langPath } : undefined;

      const index = await buildTaxPdfIndex(invoiceFolder, remainingKeys, ocr);
      const upsert = db.prepare(
        `INSERT INTO tax_pdf_map (approval_key, pdf_path, mapped_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(approval_key) DO UPDATE SET pdf_path = excluded.pdf_path, mapped_at = excluded.mapped_at`
      );
      db.transaction(() => {
        for (const [key, pdfPath] of index) {
          upsert.run(key, pdfPath);
          existing.set(key, pdfPath);
          newlyMapped++;
        }
      })();
    }

    // 최종 매핑 상태 집계
    const unmapped: string[] = [];
    let mapped = 0;
    for (const inv of invoices) {
      const k = keyOf(inv);
      if (k && existing.has(k) && fs.existsSync(existing.get(k)!)) mapped++;
      else unmapped.push(`${inv.supplier_name || ''} / ${inv.description || ''} (${inv.source_file || `#${inv.id}`})`);
    }

    console.log(`[invoices:buildMapping] month=${month}, total=${invoices.length}, mapped=${mapped}, newly=${newlyMapped}, unmapped=${unmapped.length}`);
    return { ok: true, total: invoices.length, mapped, newlyMapped, unmapped };
  });

  // 세금계산서 PDF 수기 지정: 파일 선택 → 해당 세금계산서 승인번호 키로 매핑 저장 (OCR 실패한 스캔본용)
  ipcMain.handle('invoices:setPdfManual', async (_event, invoiceId: number) => {
    const inv = db.prepare('SELECT id, source_file FROM tax_invoices WHERE id = ?').get(invoiceId) as any;
    if (!inv) return { ok: false, message: '세금계산서를 찾을 수 없습니다.' };
    const key = approvalNoFromSourceFile(inv.source_file || '');
    if (!key) return { ok: false, message: '승인번호를 확인할 수 없어 매핑할 수 없습니다.' };

    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: '세금계산서 PDF 선택',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };

    const pdfPath = result.filePaths[0];
    db.prepare(
      `INSERT INTO tax_pdf_map (approval_key, pdf_path, mapped_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(approval_key) DO UPDATE SET pdf_path = excluded.pdf_path, mapped_at = excluded.mapped_at`
    ).run(key, pdfPath);
    return { ok: true, file_path: pdfPath };
  });

  // 세금계산서 PDF 매핑 해제 (오매핑 정정용)
  ipcMain.handle('invoices:clearPdfMapping', (_event, invoiceId: number) => {
    const inv = db.prepare('SELECT source_file FROM tax_invoices WHERE id = ?').get(invoiceId) as any;
    if (!inv) return { ok: false };
    const key = approvalNoFromSourceFile(inv.source_file || '');
    if (!key) return { ok: false };
    db.prepare('DELETE FROM tax_pdf_map WHERE approval_key = ?').run(key);
    return { ok: true };
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
    db.prepare('DELETE FROM cost_item_amounts WHERE cost_item_id=?').run(id);
    db.prepare('DELETE FROM cost_items WHERE id=?').run(id);
    return true;
  });

  ipcMain.handle('costItems:autoDetect', () => {
    const added = autoAddMissingCostItems(db);
    const total = (db.prepare('SELECT MAX(sort_order) as m FROM cost_items').get() as any)?.m || 0;
    return { added, total };
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

    // Col layout: B=순번, C=품명, D=비용주기, E=계약시작, F=계약종료일, G=거래처, H=비고, I=년도, J-U=1~12월
    const existing = db.prepare('SELECT id, display_name FROM cost_items').all() as any[];
    const existingMap = new Map(existing.map((e: any) => [e.display_name.trim(), e.id]));
    let order = (db.prepare('SELECT MAX(sort_order) as m FROM cost_items').get() as any)?.m || 0;

    interface ParsedRow {
      name: string;
      billingCycle: string;
      contractStart: string;
      contractEnd: string;
      supplier: string;
      year: number;
      months: Record<number, number>;
    }
    const rows: ParsedRow[] = [];

    let lastName = '';
    let lastCycle = '';
    let lastStart = '';
    let lastEnd = '';
    let lastSupplier = '';
    for (let r = 4; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const name = readCellText(row.getCell(3));  // C: 품명
      if (name && (name === '내역' || name.includes('월별 비용 총합'))) continue;

      const yearStr = readCellText(row.getCell(9)); // I: 년도
      const yearMatch = yearStr.match(/(\d+)년/);
      if (!yearMatch) continue;
      const year = parseInt(yearMatch[1]) + (parseInt(yearMatch[1]) < 100 ? 2000 : 0);

      const currentName = name || lastName;
      if (!currentName) continue;

      const cycle = readCellText(row.getCell(4));       // D: 비용주기
      const contractStart = readCellText(row.getCell(5)); // E: 계약시작
      const contractEnd = readCellText(row.getCell(6));   // F: 계약종료일
      const supplier = readCellText(row.getCell(7));      // G: 거래처

      if (name) {
        lastName = name;
        lastCycle = cycle;
        lastStart = contractStart;
        lastEnd = contractEnd;
        lastSupplier = supplier;
      }

      const months: Record<number, number> = {};
      for (let m = 1; m <= 12; m++) {
        const v = row.getCell(m + 9).value; // J(10)~U(21): 1~12월
        if (typeof v === 'number' && v > 0) months[m] = Math.round(v);
      }

      rows.push({
        name: currentName,
        billingCycle: cycle || lastCycle,
        contractStart: contractStart || lastStart,
        contractEnd: contractEnd || lastEnd,
        supplier: supplier || lastSupplier,
        year,
        months,
      });
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
      const period = [row.contractStart, row.contractEnd].filter(Boolean).join(' ~ ');
      const billingCycle = row.billingCycle.includes('년') ? 'yearly' : 'monthly';

      if (!itemId && !seenNames.has(row.name)) {
        order++;
        const r = db.prepare(
          'INSERT INTO cost_items (display_name, contract_period, supplier, match_keyword, billing_cycle, sort_order) VALUES (?,?,?,?,?,?)'
        ).run(row.name, period, row.supplier, row.name, billingCycle, order);
        itemId = r.lastInsertRowid as number;
        existingMap.set(row.name, itemId);
        added++;
      } else if (!itemId) {
        itemId = existingMap.get(row.name);
      } else if (!seenNames.has(row.name)) {
        db.prepare('UPDATE cost_items SET contract_period = ?, supplier = ?, billing_cycle = ? WHERE id = ?')
          .run(period, row.supplier, billingCycle, itemId);
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

  ipcMain.handle('costItemAmount:save', (_event, costItemId: number, year: number, month: number, amount: number) => {
    if (amount <= 0) {
      db.prepare('DELETE FROM cost_item_amounts WHERE cost_item_id = ? AND year = ? AND month = ?').run(costItemId, year, month);
    } else {
      db.prepare(`
        INSERT INTO cost_item_amounts (cost_item_id, year, month, amount, source)
        VALUES (?, ?, ?, ?, 'manual')
        ON CONFLICT(cost_item_id, year, month) DO UPDATE SET amount = excluded.amount, source = 'manual'
      `).run(costItemId, year, month, amount);
    }
    return true;
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

      const kw = normalize(item.match_keyword);
      for (const inv of invoices) {
        if (inv.description && normalize(inv.description).includes(kw)) {
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

  ipcMain.handle('approvalMasters:list', () => {
    return db.prepare('SELECT * FROM approval_masters ORDER BY match_supplier, match_description').all();
  });

  ipcMain.handle('approvalMasters:add', async (_event, data: { match_supplier: string; match_description: string; memo: string }) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: '기안문서 파일 선택',
      filters: [
        { name: '문서', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'xlsx', 'xls', 'hwp', 'hwpx', 'doc', 'docx'] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;

    const filePath = result.filePaths[0];
    const fileName = path.basename(filePath);
    const fileType = detectFileType(fileName);

    const r = db.prepare(
      'INSERT INTO approval_masters (file_name, file_path, file_type, match_supplier, match_description, memo) VALUES (?,?,?,?,?,?)'
    ).run(fileName, filePath, fileType, data.match_supplier, data.match_description, data.memo);

    return { id: r.lastInsertRowid, file_name: fileName, file_path: filePath, file_type: fileType };
  });

  ipcMain.handle('approvalMasters:update', (_event, id: number, data: { match_supplier: string; match_description: string; memo: string }) => {
    db.prepare('UPDATE approval_masters SET match_supplier=?, match_description=?, memo=? WHERE id=?')
      .run(data.match_supplier, data.match_description, data.memo, id);
    return true;
  });

  ipcMain.handle('approvalMasters:delete', (_event, id: number) => {
    db.prepare('DELETE FROM approval_masters WHERE id=?').run(id);
    return true;
  });

  ipcMain.handle('approvalMasters:updateFile', async (_event, id: number) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: '기안문서 파일 변경',
      filters: [
        { name: '문서', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'xlsx', 'xls', 'hwp', 'hwpx', 'doc', 'docx'] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;

    const filePath = result.filePaths[0];
    const fileName = path.basename(filePath);
    const fileType = detectFileType(fileName);

    db.prepare('UPDATE approval_masters SET file_name=?, file_path=?, file_type=? WHERE id=?')
      .run(fileName, filePath, fileType, id);

    return { file_name: fileName, file_path: filePath, file_type: fileType };
  });

  ipcMain.handle('approvalMasters:autoMatch', (_event, folderPath: string) => {
    if (!folderPath || !fs.existsSync(folderPath)) return { matched: 0, skipped: 0 };

    const files = scanFolderFiles(folderPath);
    const docFiles = files.filter(f => ['pdf', 'image'].includes(f.type) || f.name.match(/\.(hwp|hwpx|doc|docx|xlsx|xls)$/i));

    const invoices = db.prepare('SELECT DISTINCT description, supplier_name FROM tax_invoices WHERE description IS NOT NULL AND description != \'\'').all() as any[];
    const existingMasters = db.prepare('SELECT file_path FROM approval_masters').all() as any[];
    const existingPaths = new Set(existingMasters.map((m: any) => m.file_path));

    let matched = 0;
    let skipped = 0;

    const insertMaster = db.prepare(
      'INSERT INTO approval_masters (file_name, file_path, file_type, match_supplier, match_description, memo) VALUES (?,?,?,?,?,?)'
    );

    for (const file of docFiles) {
      if (existingPaths.has(file.path)) { skipped++; continue; }

      const baseName = path.parse(file.name).name;
      const normalizedFileName = normalize(baseName);
      const coreFileName = stripPeriod(normalizedFileName);

      let hit: any = null;
      for (const inv of invoices) {
        const normalizedDesc = normalize(inv.description);
        if (normalizedFileName.includes(normalizedDesc) || normalizedDesc.includes(normalizedFileName)) {
          hit = inv;
          break;
        }
        // 날짜/기간 접두어를 제거한 핵심 문자열로도 부분일치 비교 (빈 문자열 오매칭 방지: 4자 이상)
        const coreDesc = stripPeriod(normalizedDesc);
        if (
          coreDesc.length >= 4 && coreFileName.length >= 4 &&
          (coreFileName.includes(coreDesc) || coreDesc.includes(coreFileName))
        ) {
          hit = inv;
          break;
        }
      }

      if (!hit) {
        const fileTokens = tokenize(baseName);
        let best: any = null;
        let bestScore = 0;
        for (const inv of invoices) {
          const score = tokenOverlapScore(fileTokens, tokenize(inv.description));
          if (score > bestScore) { bestScore = score; best = inv; }
        }
        if (best && bestScore >= 2) hit = best;
      }

      if (hit) {
        insertMaster.run(file.name, file.path, file.type, hit.supplier_name, hit.description, '자동매핑');
        existingPaths.add(file.path);
        matched++;
      }
    }

    return { matched, skipped };
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
        const kwNorm = normalize(item.match_keyword);
        for (const inv of invoices) {
          if (inv.description && normalize(inv.description).includes(kwNorm)) {
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

  ipcMain.handle('dashboard:exportPdf', async (_event, html: string, defaultName: string) => {
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: '대시보드 보고서 저장',
        defaultPath: path.join(app.getPath('desktop'), defaultName),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (canceled || !filePath) return { ok: false, canceled: true };
      fs.writeFileSync(filePath, pdf);
      shell.openPath(filePath);
      return { ok: true, file_path: filePath };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    } finally {
      win.destroy();
    }
  });
}
