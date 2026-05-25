import { getAPI } from '../lib/electron-mock';
import { useEffect, useState } from 'react';
import { FolderOpen, Save, CheckCircle } from 'lucide-react';
import { useAppStore } from '../stores/useAppStore';

export function SettingsPage() {
  const { invoiceFolder, approvalFolder, setInvoiceFolder, setApprovalFolder } = useAppStore();
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getAPI().getSettings().then((s) => {
      if (s.invoiceFolder) setInvoiceFolder(s.invoiceFolder);
      if (s.approvalFolder) setApprovalFolder(s.approvalFolder);
      if (s.anthropicApiKey) setApiKey(s.anthropicApiKey);
    });
  }, []);

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
    </div>
  );
}
