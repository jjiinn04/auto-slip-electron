import electronUpdater from 'electron-updater';
import { app, dialog, ipcMain, BrowserWindow } from 'electron';

const { autoUpdater } = electronUpdater;

type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'none' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

// 자동 업데이트 설정 — GitHub Releases에 발행된 latest.yml / latest-mac.yml을 기준으로 동작.
// IPC 핸들러는 항상 등록(설정 화면의 "업데이트 확인" 버튼용), 시작 시 자동 확인은 패키징 빌드에서만.
export function setupAutoUpdater(getWindow: () => BrowserWindow | null) {
  const send = (status: UpdateStatus) => getWindow()?.webContents.send('update:status', status);

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('error', (err) => send({ state: 'error', message: String(err?.message ?? err) }));
  autoUpdater.on('update-downloaded', async (info) => {
    send({ state: 'downloaded', version: info.version });
    const win = getWindow();
    const result = await dialog.showMessageBox(win!, {
      type: 'info',
      buttons: ['지금 재시작', '나중에'],
      defaultId: 0,
      cancelId: 1,
      title: '업데이트 준비 완료',
      message: `새 버전 ${info.version}이(가) 다운로드되었습니다.`,
      detail: '지금 재시작하여 업데이트를 적용할까요? "나중에"를 선택하면 다음 종료 시 자동 적용됩니다.',
    });
    if (result.response === 0) autoUpdater.quitAndInstall();
  });

  ipcMain.handle('update:getVersion', () => app.getVersion());

  ipcMain.handle('update:check', async () => {
    try {
      const r = await autoUpdater.checkForUpdates();
      return { ok: true, version: r?.updateInfo?.version };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, message };
    }
  });

  ipcMain.handle('update:quitAndInstall', () => autoUpdater.quitAndInstall());

  // 시작 시 자동 확인 (패키징된 프로덕션 빌드만)
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => {});
  }
}
