import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

function legacyDbPath(): string {
  return path.join(app.getPath('userData'), 'data', 'autoslip.db');
}

function workspaceDbPath(departmentId: string): string {
  return path.join(app.getPath('userData'), 'workspaces', `${departmentId}.db`);
}

// 부서 최초 선택 시 기존 단일-부서 DB를 그 부서 워크스페이스로 흡수한다.
// 이미 부서 워크스페이스가 있거나 레거시 DB가 없으면 아무것도 하지 않는다.
export function absorbLegacyData(departmentId: string): boolean {
  const legacy = legacyDbPath();
  const target = workspaceDbPath(departmentId);
  if (fs.existsSync(target)) return false;
  if (!fs.existsSync(legacy)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const src = new Database(legacy, { readonly: true });
  try {
    src.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }
  return true;
}

export function setupDatabase(departmentId?: string): Database.Database {
  const userDataPath = app.getPath('userData');
  const dbDir = departmentId
    ? path.join(userDataPath, 'workspaces')
    : path.join(userDataPath, 'data');
  fs.mkdirSync(dbDir, { recursive: true });

  const dbPath = departmentId
    ? path.join(dbDir, `${departmentId}.db`)
    : path.join(dbDir, 'autoslip.db');
  console.log('[DB] path:', dbPath);
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS tax_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT,
      issue_date TEXT NOT NULL,
      supplier_id TEXT,
      supplier_name TEXT NOT NULL,
      supply_amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      source_file TEXT,
      month TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS line_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES tax_invoices(id),
      line_number INTEGER NOT NULL DEFAULT 1,
      item_description TEXT,
      quantity REAL,
      unit_price REAL,
      line_total REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS approval_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      classification TEXT DEFAULT 'approval',
      confidence REAL DEFAULT 0,
      matched_invoice_id INTEGER REFERENCES tax_invoices(id),
      month TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS processing_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL,
      action TEXT NOT NULL,
      description TEXT,
      file_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cost_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL,
      contract_period TEXT DEFAULT '',
      supplier TEXT DEFAULT '',
      match_keyword TEXT NOT NULL,
      billing_cycle TEXT NOT NULL DEFAULT 'monthly',
      sort_order INTEGER DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cost_item_amounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cost_item_id INTEGER NOT NULL REFERENCES cost_items(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'excel',
      UNIQUE(cost_item_id, year, month)
    );

    CREATE INDEX IF NOT EXISTS idx_invoices_month ON tax_invoices(month);
    CREATE INDEX IF NOT EXISTS idx_approvals_month ON approval_documents(month);
    CREATE INDEX IF NOT EXISTS idx_logs_month ON processing_logs(month);
    CREATE TABLE IF NOT EXISTS approval_masters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      match_supplier TEXT NOT NULL,
      match_description TEXT DEFAULT '',
      memo TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_cost_items_sort ON cost_items(sort_order);
    CREATE INDEX IF NOT EXISTS idx_cost_amounts_item ON cost_item_amounts(cost_item_id, year);

    -- 승인번호(정규화) → 세금계산서 PDF 경로 매핑. 월 재처리로 tax_invoices가 삭제돼도 유지된다.
    CREATE TABLE IF NOT EXISTS tax_pdf_map (
      approval_key TEXT PRIMARY KEY,
      pdf_path TEXT NOT NULL,
      mapped_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 승인번호(정규화) → 출력완료 기록. 월 재처리로 tax_invoices가 삭제돼도 유지된다.
    CREATE TABLE IF NOT EXISTS tax_print_status (
      approval_key TEXT PRIMARY KEY,
      printed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrations for existing databases (must run AFTER table creation)
  const colCheck = db.prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('cost_items') WHERE name = 'billing_cycle'").get() as any;
  if (colCheck.cnt === 0) {
    db.exec("ALTER TABLE cost_items ADD COLUMN billing_cycle TEXT NOT NULL DEFAULT 'monthly'");
  }

  // 소프트 삭제 플래그: 사용자가 삭제한 항목을 자동 감지가 다시 만들지 않도록 한다.
  const delCheck = db.prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('cost_items') WHERE name = 'is_deleted'").get() as any;
  if (delCheck.cnt === 0) {
    db.exec("ALTER TABLE cost_items ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0");
  }

  return db;
}
