import { app, BrowserWindow, ipcMain, dialog, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupDatabase, absorbLegacyData } from './db';
import { registerIpcHandlers } from './ipc';
import { createSettingsStore } from './settings';
import { DEPARTMENTS, findDepartment } from './departments';
import { setupAutoUpdater } from './updater';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 개발 서버 URL. app.relaunch() 시 인자로 다시 넘겨 개발 모드를 유지한다.
const DEV_SERVER_URL =
  process.env.VITE_DEV_SERVER_URL ||
  process.argv.find((a) => a.startsWith('--dev-server-url='))?.slice('--dev-server-url='.length) ||
  '';

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

  if (DEV_SERVER_URL) {
    mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
    if (DEV_SERVER_URL) {
      mainWindow?.webContents.openDevTools({ mode: 'bottom' });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // 프로덕션(패키징) 빌드에는 엄격한 CSP를 응답 헤더로 적용
  if (!DEV_SERVER_URL) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:;",
          ],
        },
      });
    });
  }

  const settings = createSettingsStore();
  const departmentId = settings.get('selectedDepartmentId') as string;
  const department = findDepartment(departmentId);

  // 부서 게이트 핸들러 — 부서 선택 여부와 무관하게 항상 등록
  ipcMain.handle('department:list', () => DEPARTMENTS);
  ipcMain.handle('department:getCurrent', () => findDepartment(settings.get('selectedDepartmentId') as string));
  ipcMain.handle('department:select', (_e, id: string) => {
    const dept = findDepartment(id);
    if (!dept) return false;
    // 기존 단일-부서 데이터는 '최초' 부서 선택 때만 흡수 (부서 전환 시엔 제외)
    const isFirstSelection = !(settings.get('selectedDepartmentId') as string);
    if (isFirstSelection) absorbLegacyData(id);
    settings.set('selectedDepartmentId', id);
    // 부서 워크스페이스 DB로 다시 열기 위해 재시작 (set-once). 개발 모드면 dev URL 유지.
    const relaunchArgs = process.argv.slice(1).filter((a) => !a.startsWith('--dev-server-url='));
    if (DEV_SERVER_URL) relaunchArgs.push(`--dev-server-url=${DEV_SERVER_URL}`);
    app.relaunch({ args: relaunchArgs });
    app.exit(0);
    return true;
  });

  // 부서가 선택된 경우에만 업무 핸들러 등록 (DB 필요)
  if (department) {
    const db = setupDatabase(department.id);
    registerIpcHandlers(db, settings, () => mainWindow);
  }

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

  // 자동 업데이트 (GitHub Releases). 핸들러는 항상 등록, 시작 자동확인은 패키징 빌드만.
  setupAutoUpdater(() => mainWindow);

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
