interface ElectronAPI {
  selectFolder: () => Promise<string | null>;
  selectExcelFile: () => Promise<string | null>;
  getSettings: () => Promise<AppSettings>;
  setSettings: (data: Partial<AppSettings>) => Promise<boolean>;
  getDepartments: () => Promise<Department[]>;
  getCurrentDepartment: () => Promise<Department | null>;
  selectDepartment: (id: string) => Promise<boolean>;
  scanFolder: (folderPath: string) => Promise<ScanResult>;
  processFiles: (invoiceFolder: string, approvalFolder: string, month: string) => Promise<ProcessResult>;
  getInvoices: (month: string) => Promise<Invoice[]>;
  getInvoice: (id: number) => Promise<InvoiceDetail>;
  printInvoices: (ids: number[], mode?: 'all' | 'tax' | 'approval') => Promise<PrintResult>;
  markPrinted: (ids: number[]) => Promise<{ ok: boolean; marked: number }>;
  buildPdfMapping: (month: string) => Promise<PdfMappingResult>;
  setPdfManual: (invoiceId: number) => Promise<{ ok: boolean; canceled?: boolean; file_path?: string; message?: string }>;
  clearPdfMapping: (invoiceId: number) => Promise<{ ok: boolean }>;
  deleteInvoice: (id: number) => Promise<boolean>;
  matchInvoice: (invoiceId: number, approvalId: number) => Promise<boolean>;
  unmatchInvoice: (approvalId: number) => Promise<boolean>;
  getUnmatchedApprovals: (month: string, classification?: string) => Promise<Approval[]>;
  openFile: (filePath: string) => Promise<boolean>;
  showInFolder: (filePath: string) => Promise<boolean>;
  getApprovals: (month: string) => Promise<Approval[]>;
  getMatched: (month: string) => Promise<MatchedItem[]>;
  getSummary: (month: string) => Promise<Summary>;
  getCostItems: () => Promise<CostItem[]>;
  saveCostItem: (item: Partial<CostItem> & { display_name: string; match_keyword: string; billing_cycle?: string }) => Promise<number>;
  deleteCostItem: (id: number) => Promise<boolean>;
  reorderCostItems: (orderedIds: number[]) => Promise<boolean>;
  autoDetectCostItems: () => Promise<{ added: number; total: number }>;
  importCostItemsFromExcel: (filePath: string) => Promise<{ added: number; skipped: number; total: number; amountsImported: number }>;
  getMonthlyCostData: (baseYear: number) => Promise<MonthlyCostData>;
  saveCostItemAmount: (costItemId: number, year: number, month: number, amount: number) => Promise<boolean>;
  getApprovalMasters: () => Promise<ApprovalMaster[]>;
  addApprovalMaster: (data: { match_supplier: string; match_description: string; memo: string }) =>
    Promise<{ id: number; file_name: string; file_path: string; file_type: string } | null>;
  updateApprovalMaster: (id: number, data: { match_supplier: string; match_description: string; memo: string }) => Promise<boolean>;
  deleteApprovalMaster: (id: number) => Promise<boolean>;
  updateApprovalMasterFile: (id: number) => Promise<{ file_name: string; file_path: string; file_type: string } | null>;
  autoMatchApprovalMasters: (folderPath: string) => Promise<{ matched: number; skipped: number }>;

  exportExcel: (month: string, type: string) => Promise<ExportResult>;
  exportDashboardPdf: (html: string, defaultName: string) => Promise<ExportPdfResult>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<{ ok: boolean; version?: string; message?: string }>;
  quitAndInstall: () => Promise<void>;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
  onProcessingProgress: (callback: (progress: ProcessingProgress) => void) => () => void;
}

interface PrintResult {
  ok: boolean;
  printed?: number;
  missing?: string[];
  printedIds?: number[];
  message?: string;
}

type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'none' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

interface AppSettings {
  invoiceFolder: string;
  approvalFolder: string;
  anthropicApiKey: string;
  defaultMonth: string;
  selectedDepartmentId: string;
}

interface Department {
  id: string;
  name: string;
  color: string;
  icon: string;
}

interface ScanResult {
  files: ScannedFile[];
  counts: { xml: number; pdf: number; image: number; other: number; total: number };
}

interface ScannedFile {
  name: string;
  path: string;
  type: 'xml' | 'pdf' | 'image' | 'other';
  size: number;
}

interface ProcessResult {
  parsed: number;
  approvals: number;
  matched: number;
  costItemsAdded?: number;
  errors: string[];
  total: number;
}

interface ProcessingProgress {
  step: string;
  current: number;
  total: number;
}

interface Invoice {
  id: number;
  invoice_number: string;
  issue_date: string;
  supplier_id: string;
  supplier_name: string;
  supply_amount: number;
  tax_amount: number;
  total_amount: number;
  description: string;
  status: string;
  source_file: string;
  month: string;
  approval_files: string | null;
  statement_files: string | null;
  master_count: number;
  pdf_mapped: boolean;
  printed_at: string | null;
}

interface PdfMappingResult {
  ok: boolean;
  message?: string;
  total?: number;
  mapped?: number;
  newlyMapped?: number;
  unmapped?: string[];
}

interface ApprovalMaster {
  id: number;
  file_name: string;
  file_path: string;
  file_type: string;
  match_supplier: string;
  match_description: string;
  memo: string;
  created_at: string;
}

interface InvoiceDetail {
  invoice: Invoice;
  items: LineItem[];
  approvals: ApprovalMaster[];
  statements: Approval[];
}

interface LineItem {
  id: number;
  invoice_id: number;
  line_number: number;
  item_description: string;
  quantity: number | null;
  unit_price: number | null;
  line_total: number;
}

interface Approval {
  id: number;
  file_name: string;
  file_path: string;
  file_type: string;
  classification: string;
  confidence: number;
  matched_invoice_id: number | null;
  matched_supplier?: string;
  month: string;
}

interface MatchedItem {
  id: number;
  invoice_number: string;
  supplier_name: string;
  total_amount: number;
  issue_date: string;
  approval_file: string;
  approval_path: string;
}

interface Summary {
  invoices: { total_invoices: number; total_supply: number; total_tax: number; total_amount: number };
  approvals: number;
  matched: number;
  bySupplier: { supplier_name: string; count: number; supply: number; tax: number; total: number }[];
  recentLogs: { id: number; month: string; action: string; description: string; file_count: number; created_at: string }[];
}

interface CostItem {
  id: number;
  display_name: string;
  contract_period: string;
  supplier: string;
  match_keyword: string;
  billing_cycle: 'monthly' | 'yearly';
  sort_order: number;
}

interface CostItemYearData {
  total: number;
  months: Record<number, number>;
}

interface MonthlyCostItem {
  id: number;
  display_name: string;
  contract_period: string;
  supplier: string;
  match_keyword: string;
  billing_cycle: 'monthly' | 'yearly';
  sort_order: number;
  yearData: Record<number, CostItemYearData>;
}

interface MonthlyCostData {
  items: MonthlyCostItem[];
  years: number[];
}

interface ExportResult {
  file_path: string;
}

interface ExportPdfResult {
  ok: boolean;
  canceled?: boolean;
  file_path?: string;
  message?: string;
}

interface Window {
  electronAPI: ElectronAPI;
}
