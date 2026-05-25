import Store from 'electron-store';

export interface AppSettings {
  invoiceFolder: string;
  approvalFolder: string;
  anthropicApiKey: string;
  defaultMonth: string;
}

const defaults: AppSettings = {
  invoiceFolder: '',
  approvalFolder: '',
  anthropicApiKey: '',
  defaultMonth: '',
};

export function createSettingsStore() {
  return new Store<AppSettings>({ defaults });
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
