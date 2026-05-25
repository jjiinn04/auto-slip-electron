import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Play, CheckCircle, AlertCircle } from 'lucide-react';
import { useAppStore } from '../stores/useAppStore';
import { formatAmount } from '../lib/format';
import { getAPI } from '../lib/electron-mock';

export function HomePage() {
  const {
    invoiceFolder, approvalFolder, month, isProcessing, progress, lastResult,
    setInvoiceFolder, setApprovalFolder, setMonth, setProcessing, setProgress, setLastResult,
  } = useAppStore();
  const [invoiceScan, setInvoiceScan] = useState<ScanResult | null>(null);
  const [approvalScan, setApprovalScan] = useState<ScanResult | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    getAPI().getSettings().then((s) => {
      if (s.invoiceFolder) setInvoiceFolder(s.invoiceFolder);
      if (s.approvalFolder) setApprovalFolder(s.approvalFolder);
      if (s.defaultMonth) setMonth(s.defaultMonth);
    });
  }, []);

  useEffect(() => {
    if (invoiceFolder) {
      getAPI().scanFolder(invoiceFolder).then(setInvoiceScan);
    }
    if (approvalFolder) {
      getAPI().scanFolder(approvalFolder).then(setApprovalScan);
    }
    getAPI().getSummary(month).then(setSummary);
  }, [invoiceFolder, approvalFolder, month]);

  useEffect(() => {
    const unsub = getAPI().onProcessingProgress(setProgress);
    return unsub;
  }, []);

  const selectFolder = async (type: 'invoice' | 'approval') => {
    const selected = await getAPI().selectFolder();
    if (!selected) return;
    if (type === 'invoice') {
      setInvoiceFolder(selected);
      await getAPI().setSettings({ invoiceFolder: selected });
    } else {
      setApprovalFolder(selected);
      await getAPI().setSettings({ approvalFolder: selected });
    }
  };

  const handleProcess = async () => {
    console.log('[handleProcess]', { invoiceFolder, approvalFolder, month, isProcessing });
    if (!invoiceFolder || isProcessing) return;
    setProcessing(true);
    setLastResult(null);
    try {
      console.log('[handleProcess] calling processFiles...');
      const result = await getAPI().processFiles(invoiceFolder, approvalFolder, month);
      console.log('[handleProcess] result:', result);
      setLastResult(result);
      const newSummary = await getAPI().getSummary(month);
      setSummary(newSummary);
    } catch (err: any) {
      console.error('[handleProcess] error:', err);
      alert(`처리 오류: ${err.message}`);
    } finally {
      setProcessing(false);
      setProgress(null);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">전표 처리</h2>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      {/* Folder Selection */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => selectFolder('invoice')}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors shrink-0"
          >
            <FolderOpen size={18} />
            세금계산서 폴더
          </button>
          <div className="flex-1 min-w-0">
            {invoiceFolder ? (
              <p className="text-sm text-gray-700 truncate font-mono">{invoiceFolder}</p>
            ) : (
              <p className="text-sm text-gray-400">세금계산서 XML 파일이 있는 폴더</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => selectFolder('approval')}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors shrink-0"
          >
            <FolderOpen size={18} />
            기안문서 폴더
          </button>
          <div className="flex-1 min-w-0">
            {approvalFolder ? (
              <p className="text-sm text-gray-700 truncate font-mono">{approvalFolder}</p>
            ) : (
              <p className="text-sm text-gray-400">기안 PDF/이미지 파일이 있는 폴더 (선택)</p>
            )}
          </div>
        </div>

        {(invoiceScan || approvalScan) && (
          <div className="grid grid-cols-5 gap-3">
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-blue-700">{invoiceScan?.counts.xml ?? 0}</p>
              <p className="text-xs text-blue-600 mt-1">XML (세금계산서)</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-amber-700">{(invoiceScan?.counts.pdf ?? 0) + (approvalScan?.counts.pdf ?? 0)}</p>
              <p className="text-xs text-amber-600 mt-1">PDF</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{(invoiceScan?.counts.image ?? 0) + (approvalScan?.counts.image ?? 0)}</p>
              <p className="text-xs text-green-600 mt-1">이미지 (기안)</p>
            </div>
            <div className="bg-purple-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-purple-700">{(invoiceScan?.counts.other ?? 0) + (approvalScan?.counts.other ?? 0)}</p>
              <p className="text-xs text-purple-600 mt-1">기타</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-gray-700">{(invoiceScan?.counts.total ?? 0) + (approvalScan?.counts.total ?? 0)}</p>
              <p className="text-xs text-gray-600 mt-1">전체</p>
            </div>
          </div>
        )}

        <div className="pt-1">
          <button
            onClick={handleProcess}
            disabled={!invoiceFolder || isProcessing}
            className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Play size={18} />
            {isProcessing ? '처리 중...' : `${month} 전표 처리`}
          </button>
        </div>

        {isProcessing && progress && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>{progress.step}</span>
              <span>{progress.current}/{progress.total}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {lastResult && (
          <div className="p-4 rounded-lg bg-green-50 border border-green-200">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={18} className="text-green-600" />
              <span className="font-medium text-green-800">처리 완료</span>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-600">세금계산서: </span>
                <span className="font-medium">{lastResult.parsed}건</span>
              </div>
              <div>
                <span className="text-gray-600">기안문서: </span>
                <span className="font-medium">{lastResult.approvals}건</span>
              </div>
              <div>
                <span className="text-gray-600">자동매칭: </span>
                <span className="font-medium">{lastResult.matched}건</span>
              </div>
            </div>
            {lastResult.errors.length > 0 && (
              <div className="mt-3">
                <div className="flex items-center gap-1 text-sm text-red-600 mb-1">
                  <AlertCircle size={14} />
                  <span>오류 {lastResult.errors.length}건</span>
                </div>
                {lastResult.errors.map((err, i) => (
                  <p key={i} className="text-xs text-red-500 ml-5">{err}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Summary */}
      {summary && summary.invoices.total_invoices > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">{month} 요약</h3>
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-gray-900">{summary.invoices.total_invoices}</p>
              <p className="text-sm text-gray-500 mt-1">세금계산서</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-gray-900">{summary.approvals}</p>
              <p className="text-sm text-gray-500 mt-1">기안문서</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-blue-600">{summary.matched}</p>
              <p className="text-sm text-gray-500 mt-1">매칭 완료</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-gray-900">₩{formatAmount(summary.invoices.total_amount)}</p>
              <p className="text-sm text-gray-500 mt-1">합계 금액</p>
            </div>
          </div>

          {summary.bySupplier.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">공급자별</h4>
              <div className="overflow-x-auto rounded-lg border border-gray-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-600 uppercase">
                      <th className="px-4 py-2">공급자</th>
                      <th className="px-4 py-2 text-right">건수</th>
                      <th className="px-4 py-2 text-right">공급가액</th>
                      <th className="px-4 py-2 text-right">세액</th>
                      <th className="px-4 py-2 text-right">합계</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {summary.bySupplier.map((s, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium text-gray-900">{s.supplier_name}</td>
                        <td className="px-4 py-2 text-right text-gray-600">{s.count}</td>
                        <td className="px-4 py-2 text-right text-gray-600">{formatAmount(s.supply)}</td>
                        <td className="px-4 py-2 text-right text-gray-600">{formatAmount(s.tax)}</td>
                        <td className="px-4 py-2 text-right font-medium">{formatAmount(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-4 flex gap-3">
            <button onClick={() => navigate('/invoices')} className="text-sm text-blue-600 hover:text-blue-800">
              세금계산서 상세 보기 →
            </button>
            <button onClick={() => navigate('/matching')} className="text-sm text-blue-600 hover:text-blue-800">
              매칭 현황 보기 →
            </button>
            <button onClick={() => navigate('/export')} className="text-sm text-blue-600 hover:text-blue-800">
              엑셀 내보내기 →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
