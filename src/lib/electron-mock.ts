const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

const mockSettings: AppSettings = {
  invoiceFolder: '',
  approvalFolder: '',
  anthropicApiKey: '',
  defaultMonth: '2026-05',
  selectedDepartmentId: 'it-system',
};

const mockDepartments: Department[] = [
  { id: 'it-system', name: 'IT시스템팀', color: '#3b82f6', icon: 'Server' },
  { id: 'finance', name: '재무팀', color: '#10b981', icon: 'Landmark' },
  { id: 'general-affairs', name: '총무팀', color: '#f59e0b', icon: 'Building2' },
];

const mockAPI: ElectronAPI = {
  selectFolder: async () => prompt('폴더 경로 입력:') || null,
  selectExcelFile: async () => prompt('엑셀 파일 경로 입력:') || null,
  getSettings: async () => ({ ...mockSettings }),
  setSettings: async (data) => {
    Object.assign(mockSettings, data);
    return true;
  },
  getDepartments: async () => [...mockDepartments],
  getCurrentDepartment: async () =>
    mockDepartments.find((d) => d.id === mockSettings.selectedDepartmentId) ?? null,
  selectDepartment: async (id) => {
    mockSettings.selectedDepartmentId = id;
    return true;
  },
  scanFolder: async () => ({
    files: [],
    counts: { xml: 4, pdf: 6, image: 1, other: 2, total: 13 },
  }),
  processFiles: async () => ({
    parsed: 4,
    approvals: 1,
    matched: 0,
    costItemsAdded: 0,
    errors: [],
    total: 5,
  }),
  getInvoices: async () => [
    {
      id: 1, invoice_number: '120260090058382000', issue_date: '2026-05-22',
      supplier_id: '0000000000', supplier_name: '테스트공급자㈜',
      supply_amount: 2608900, tax_amount: 260890, total_amount: 2869790,
      description: 'ASP-APT관제', status: 'parsed', source_file: 'test.xml',
      month: '2026-05', approval_files: null, statement_files: null, master_count: 0,
    },
    {
      id: 2, invoice_number: '120260090057802000', issue_date: '2026-05-21',
      supplier_id: '0000000000', supplier_name: '테스트공급자㈜',
      supply_amount: 219000, tax_amount: 21900, total_amount: 240900,
      description: 'APT관제 부가서비스', status: 'parsed', source_file: 'test2.xml',
      month: '2026-05', approval_files: null, statement_files: null, master_count: 0,
    },
  ],
  deleteInvoice: async () => true,
  matchInvoice: async () => true,
  unmatchInvoice: async () => true,
  getUnmatchedApprovals: async () => [],
  openFile: async () => true,
  showInFolder: async () => true,
  getInvoice: async (id) => ({
    invoice: {
      id, invoice_number: '120260090058382000', issue_date: '2026-05-22',
      supplier_id: '0000000000', supplier_name: '테스트공급자㈜',
      supply_amount: 2608900, tax_amount: 260890, total_amount: 2869790,
      description: 'ASP-APT관제', status: 'parsed', source_file: 'test.xml',
      month: '2026-05', approval_files: null, statement_files: null, master_count: 0,
    },
    items: [
      { id: 1, invoice_id: id, line_number: 1, item_description: 'ASP-APT관제', quantity: 1, unit_price: 2608900, line_total: 2608900 },
    ],
    approvals: [],
    statements: [],
  }),
  getApprovals: async () => [
    { id: 1, file_name: 'sd-wan기안.png', file_path: '/기안/sd-wan기안.png', file_type: 'image', classification: 'approval', confidence: 0.9, matched_invoice_id: null, month: '2026-05' },
  ],
  getMatched: async () => [],
  getCostItems: async () => [],
  saveCostItem: async () => 1,
  deleteCostItem: async () => true,
  autoDetectCostItems: async () => ({ added: 0, total: 0 }),
  importCostItemsFromExcel: async () => ({ added: 0, skipped: 0, total: 0, amountsImported: 0 }),
  getMonthlyCostData: async () => ({ items: [], years: [2026, 2025, 2024] }),
  saveCostItemAmount: async () => true,
  getSummary: async () => ({
    invoices: { total_invoices: 4, total_supply: 26508500, total_tax: 2650850, total_amount: 29159350 },
    approvals: 1,
    matched: 0,
    bySupplier: [
      { supplier_name: '테스트공급자㈜', count: 4, supply: 26508500, tax: 2650850, total: 29159350 },
    ],
    recentLogs: [],
  }),
  getApprovalMasters: async () => [],
  addApprovalMaster: async () => null,
  updateApprovalMaster: async () => true,
  deleteApprovalMaster: async () => true,
  updateApprovalMasterFile: async () => null,
  autoMatchApprovalMasters: async () => ({ matched: 0, skipped: 0 }),
  exportExcel: async (_month, type) => ({ file_path: `~/Desktop/autoslip_${type}.xlsx` }),
  getAppVersion: async () => '1.0.0 (dev)',
  checkForUpdates: async () => ({ ok: false, message: '개발 모드에서는 업데이트 확인을 사용할 수 없습니다.' }),
  quitAndInstall: async () => {},
  onUpdateStatus: () => () => {},
  onProcessingProgress: () => () => {},
};

export function getAPI(): ElectronAPI {
  if (isElectron) return window.electronAPI;
  return mockAPI;
}
