import { getAPI } from '../lib/electron-mock';
import { useEffect, useState } from 'react';
import { FolderOpen, Save, CheckCircle, RefreshCw, Download } from 'lucide-react';
import { useAppStore } from '../stores/useAppStore';

export function SettingsPage() {
  const { invoiceFolder, approvalFolder, setInvoiceFolder, setApprovalFolder } = useAppStore();
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [department, setDepartment] = useState<Department | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [appVersion, setAppVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    getAPI().getSettings().then((s) => {
      if (s.invoiceFolder) setInvoiceFolder(s.invoiceFolder);
      if (s.approvalFolder) setApprovalFolder(s.approvalFolder);
      if (s.anthropicApiKey) setApiKey(s.anthropicApiKey);
    });
    getAPI().getCurrentDepartment().then(setDepartment);
    getAPI().getDepartments().then(setDepartments);
    getAPI().getAppVersion().then(setAppVersion);
    const off = getAPI().onUpdateStatus(setUpdateStatus);
    return off;
  }, []);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setUpdateStatus({ state: 'checking' });
    try {
      const r = await getAPI().checkForUpdates();
      if (!r.ok) setUpdateStatus({ state: 'error', message: r.message ?? '업데이트 확인 실패' });
      // 성공 시 이후 상태는 onUpdateStatus 이벤트로 갱신됨
    } finally {
      setChecking(false);
    }
  };

  const updateMessage = (() => {
    if (!updateStatus) return null;
    switch (updateStatus.state) {
      case 'checking': return { text: '업데이트 확인 중…', color: 'text-gray-500' };
      case 'available': return { text: `새 버전 ${updateStatus.version} 발견 — 다운로드 중…`, color: 'text-blue-600' };
      case 'downloading': return { text: `다운로드 중… ${updateStatus.percent}%`, color: 'text-blue-600' };
      case 'downloaded': return { text: `버전 ${updateStatus.version} 다운로드 완료 — 재시작 시 적용`, color: 'text-green-600' };
      case 'none': return { text: '최신 버전을 사용 중입니다.', color: 'text-green-600' };
      case 'error': return { text: `업데이트 오류: ${updateStatus.message}`, color: 'text-red-500' };
    }
  })();

  const handleChangeDepartment = async (id: string) => {
    if (!department || id === department.id) return;
    if (!confirm('부서를 변경하면 앱이 재시작되고 해당 부서의 데이터로 전환됩니다. 계속할까요?')) return;
    await getAPI().selectDepartment(id);
  };

  const selectFolder = async (type: 'invoice' | 'approval') => {
    const selected = await getAPI().selectFolder();
    if (!selected) return;
    if (type === 'invoice') setInvoiceFolder(selected);
    else setApprovalFolder(selected);
  };

  const handleSave = async () => {
    await getAPI().setSettings({
      invoiceFolder,
      approvalFolder,
      anthropicApiKey: apiKey,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">설정</h2>

      {department && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
          <label className="block text-sm font-medium text-gray-700">현재 부서</label>
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center rounded-md px-2.5 py-1 text-sm font-medium"
              style={{ backgroundColor: `${department.color}1a`, color: department.color }}
            >
              {department.name}
            </span>
            <select
              value={department.id}
              onChange={(e) => handleChangeDepartment(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-gray-400">부서를 바꾸면 앱이 재시작되고 해당 부서의 데이터로 전환됩니다.</p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">세금계산서 폴더</label>
          <div className="flex gap-3">
            <input
              type="text"
              value={invoiceFolder}
              readOnly
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm bg-gray-50 font-mono"
              placeholder="세금계산서 XML이 있는 폴더"
            />
            <button
              onClick={() => selectFolder('invoice')}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              <FolderOpen size={16} />
              선택
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">기안문서 폴더</label>
          <div className="flex gap-3">
            <input
              type="text"
              value={approvalFolder}
              readOnly
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm bg-gray-50 font-mono"
              placeholder="기안 PDF/이미지가 있는 폴더 (선택)"
            />
            <button
              onClick={() => selectFolder('approval')}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              <FolderOpen size={16} />
              선택
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">세금계산서와 매칭할 기안/결재문서 (PDF, 이미지)</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Anthropic API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
            placeholder="sk-ant-..."
          />
          <p className="text-xs text-gray-400 mt-1">PDF/이미지 AI 분류에 사용 (선택사항)</p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            <Save size={16} />
            저장
          </button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-sm text-green-600">
              <CheckCircle size={16} />
              저장됨
            </span>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-sm font-medium text-gray-700">앱 업데이트</label>
            <p className="text-xs text-gray-400 mt-0.5">현재 버전 {appVersion || '…'}</p>
          </div>
          {updateStatus?.state === 'downloaded' ? (
            <button
              onClick={() => getAPI().quitAndInstall()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700"
            >
              <Download size={16} />
              재시작하여 적용
            </button>
          ) : (
            <button
              onClick={handleCheckUpdate}
              disabled={checking}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={16} className={checking ? 'animate-spin' : ''} />
              업데이트 확인
            </button>
          )}
        </div>
        {updateMessage && <p className={`text-sm ${updateMessage.color}`}>{updateMessage.text}</p>}
      </div>
    </div>
  );
}
