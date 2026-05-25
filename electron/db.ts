import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

export function setupDatabase(): Database.Database {
  const userDataPath = app.getPath('userData');
  const dbDir = path.join(userDataPath, 'data');
  fs.mkdirSync(dbDir, { recursive: true });

  const dbPath = path.join(dbDir, 'autoslip.db');
  console.log('[DB] path:', dbPath);
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Migrations for existing databases
  const colCheck = db.prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('cost_items') WHERE name = 'billing_cycle'").get() as any;
  if (colCheck.cnt === 0) {
    db.exec("ALTER TABLE cost_items ADD COLUMN billing_cycle TEXT NOT NULL DEFAULT 'monthly'");
  }

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
    CREATE INDEX IF NOT EXISTS idx_cost_items_sort ON cost_items(sort_order);
    CREATE INDEX IF NOT EXISTS idx_cost_amounts_item ON cost_item_amounts(cost_item_id, year);
  `);

  return db;
}
