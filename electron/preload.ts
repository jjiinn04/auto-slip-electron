import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  selectExcelFile: () => ipcRenderer.invoke('dialog:selectExcelFile'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (data: Record<string, unknown>) => ipcRenderer.invoke('settings:set', data),

  getDepartments: () => ipcRenderer.invoke('department:list'),
  getCurrentDepartment: () => ipcRenderer.invoke('department:getCurrent'),
  selectDepartment: (id: string) => ipcRenderer.invoke('department:select', id),

  scanFolder: (folderPath: string) => ipcRenderer.invoke('folder:scan', folderPath),
  processFiles: (invoiceFolder: string, approvalFolder: string, month: string) =>
    ipcRenderer.invoke('files:process', invoiceFolder, approvalFolder, month),

  getInvoices: (month: string) => ipcRenderer.invoke('invoices:list', month),
  getInvoice: (id: number) => ipcRenderer.invoke('invoices:get', id),
  printInvoices: (ids: number[], mode?: 'all' | 'tax' | 'approval') => ipcRenderer.invoke('invoices:print', ids, mode),
  markPrinted: (ids: number[]) => ipcRenderer.invoke('invoices:markPrinted', ids),
  buildPdfMapping: (month: string) => ipcRenderer.invoke('invoices:buildMapping', month),
  deleteInvoice: (id: number) => ipcRenderer.invoke('invoices:delete', id),
  matchInvoice: (invoiceId: number, approvalId: number) => ipcRenderer.invoke('invoices:match', invoiceId, approvalId),
  unmatchInvoice: (approvalId: number) => ipcRenderer.invoke('invoices:unmatch', approvalId),
  getUnmatchedApprovals: (month: string, classification?: string) => ipcRenderer.invoke('approvals:unmatched', month, classification),
  openFile: (filePath: string) => ipcRenderer.invoke('file:open', filePath),
  showInFolder: (filePath: string) => ipcRenderer.invoke('file:showInFolder', filePath),
  getApprovals: (month: string) => ipcRenderer.invoke('approvals:list', month),
  getMatched: (month: string) => ipcRenderer.invoke('matched:list', month),
  getSummary: (month: string) => ipcRenderer.invoke('summary:get', month),
  getCostItems: () => ipcRenderer.invoke('costItems:list'),
  saveCostItem: (item: any) => ipcRenderer.invoke('costItems:save', item),
  deleteCostItem: (id: number) => ipcRenderer.invoke('costItems:delete', id),
  autoDetectCostItems: () => ipcRenderer.invoke('costItems:autoDetect'),
  importCostItemsFromExcel: (filePath: string) => ipcRenderer.invoke('costItems:importFromExcel', filePath),
  getMonthlyCostData: (baseYear: number) => ipcRenderer.invoke('monthlyCost:data', baseYear),
  saveCostItemAmount: (costItemId: number, year: number, month: number, amount: number) =>
    ipcRenderer.invoke('costItemAmount:save', costItemId, year, month, amount),

  getApprovalMasters: () => ipcRenderer.invoke('approvalMasters:list'),
  addApprovalMaster: (data: { match_supplier: string; match_description: string; memo: string }) =>
    ipcRenderer.invoke('approvalMasters:add', data),
  updateApprovalMaster: (id: number, data: { match_supplier: string; match_description: string; memo: string }) =>
    ipcRenderer.invoke('approvalMasters:update', id, data),
  deleteApprovalMaster: (id: number) => ipcRenderer.invoke('approvalMasters:delete', id),
  updateApprovalMasterFile: (id: number) => ipcRenderer.invoke('approvalMasters:updateFile', id),
  autoMatchApprovalMasters: (folderPath: string) => ipcRenderer.invoke('approvalMasters:autoMatch', folderPath),

  exportExcel: (month: string, type: string) => ipcRenderer.invoke('export:excel', month, type),
  exportDashboardPdf: (html: string, defaultName: string) =>
    ipcRenderer.invoke('dashboard:exportPdf', html, defaultName),

  getAppVersion: () => ipcRenderer.invoke('update:getVersion'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  quitAndInstall: () => ipcRenderer.invoke('update:quitAndInstall'),
  onUpdateStatus: (callback: (status: unknown) => void) => {
    const handler = (_event: unknown, status: unknown) => callback(status);
    ipcRenderer.on('update:status', handler);
    return () => ipcRenderer.removeListener('update:status', handler);
  },

  onProcessingProgress: (callback: (progress: { step: string; current: number; total: number }) => void) => {
    const handler = (_event: unknown, progress: { step: string; current: number; total: number }) => callback(progress);
    ipcRenderer.on('processing:progress', handler);
    return () => ipcRenderer.removeListener('processing:progress', handler);
  },
});
