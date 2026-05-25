import { create } from 'zustand';

interface AppState {
  invoiceFolder: string;
  approvalFolder: string;
  month: string;
  isProcessing: boolean;
  progress: ProcessingProgress | null;
  lastResult: ProcessResult | null;

  setInvoiceFolder: (path: string) => void;
  setApprovalFolder: (path: string) => void;
  setMonth: (month: string) => void;
  setProcessing: (processing: boolean) => void;
  setProgress: (progress: ProcessingProgress | null) => void;
  setLastResult: (result: ProcessResult | null) => void;
}

const now = new Date();
const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

export const useAppStore = create<AppState>((set) => ({
  invoiceFolder: '',
  approvalFolder: '',
  month: defaultMonth,
  isProcessing: false,
  progress: null,
  lastResult: null,

  setInvoiceFolder: (path) => set({ invoiceFolder: path }),
  setApprovalFolder: (path) => set({ approvalFolder: path }),
  setMonth: (month) => set({ month }),
  setProcessing: (isProcessing) => set({ isProcessing }),
  setProgress: (progress) => set({ progress }),
  setLastResult: (lastResult) => set({ lastResult }),
}));
