import { getAPI } from '../lib/electron-mock';
import { useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { Download, FileSpreadsheet, CheckCircle } from 'lucide-react';

const exportTypes = [
  { id: 'list', name: '목록표', description: '세금계산서 전체 목록 (발행일, 공급자, 금액)' },
  { id: 'summary', name: '공급자별 집계', description: '공급자별 건수/금액 합계' },
  { id: 'monthly-cost', name: 'IT시스템 월별 비용', description: '시스템/서비스별 월별 비용 현황표' },
  { id: 'douzone', name: '더존 전표', description: '더존 ERP 업로드용 전표 양식' },
];

export function ExportPage() {
  const { month, setMonth } = useAppStore();
  const [selectedType, setSelectedType] = useState('list');
  const [isExporting, setIsExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    setExportedPath(null);
    try {
      const result = await getAPI().exportExcel(month, selectedType);
      setExportedPath(result.file_path);
    } catch (err: any) {
      alert(`내보내기 실패: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">엑셀 내보내기</h2>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-3">
        {exportTypes.map((type) => (
          <label
            key={type.id}
            className={`flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-colors ${
              selectedType === type.id
                ? 'border-blue-300 bg-blue-50'
                : 'border-gray-200 bg-white hover:bg-gray-50'
            }`}
          >
            <input
              type="radio"
              name="exportType"
              value={type.id}
              checked={selectedType === type.id}
              onChange={(e) => setSelectedType(e.target.value)}
              className="text-blue-600"
            />
            <div>
              <p className="font-medium text-gray-900">{type.name}</p>
              <p className="text-sm text-gray-500">{type.description}</p>
            </div>
          </label>
        ))}
      </div>

      <button
        onClick={handleExport}
        disabled={isExporting}
        className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        <Download size={18} />
        {isExporting ? '내보내는 중...' : '엑셀 다운로드'}
      </button>

      {exportedPath && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 border border-green-200">
          <CheckCircle size={20} className="text-green-600" />
          <div>
            <p className="text-sm font-medium text-green-800">내보내기 완료!</p>
            <p className="text-xs text-green-600 font-mono mt-0.5">{exportedPath}</p>
          </div>
        </div>
      )}
    </div>
  );
}
