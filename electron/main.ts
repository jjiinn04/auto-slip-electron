import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupDatabase } from './db';
import { registerIpcHandlers } from './ipc';
import { createSettingsStore } from './settings';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'AutoSlip - 월마감 전표 자동화',
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
    if (process.env.VITE_DEV_SERVER_URL) {
      mainWindow?.webContents.openDevTools({ mode: 'bottom' });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const db = setupDatabase();
  const settings = createSettingsStore();

  registerIpcHandlers(db, settings, () => mainWindow);

  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '전표 폴더 선택',
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:selectExcelFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: '월별 비용 엑셀 파일 선택',
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  // Auto-process on startup if settings exist
  const invoiceFolder = settings.get('invoiceFolder') as string;
  const approvalFolder = settings.get('approvalFolder') as string;
  if (!invoiceFolder) {
    const now = new Date();
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    settings.set('defaultMonth', defaultMonth);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
