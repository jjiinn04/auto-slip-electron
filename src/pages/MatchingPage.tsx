import { getAPI } from '../lib/electron-mock';
import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { formatAmount } from '../lib/format';
import { Link2, Link2Off } from 'lucide-react';

export function MatchingPage() {
  const { month, setMonth } = useAppStore();
  const [matched, setMatched] = useState<MatchedItem[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);

  useEffect(() => {
    getAPI().getMatched(month).then(setMatched);
    getAPI().getApprovals(month).then(setApprovals);
  }, [month]);

  const unmatched = approvals.filter((a) => !a.matched_invoice_id);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">매칭 현황</h2>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-green-50 rounded-xl border border-green-200 p-4 text-center">
          <Link2 size={24} className="mx-auto text-green-600 mb-2" />
          <p className="text-3xl font-bold text-green-700">{matched.length}</p>
          <p className="text-sm text-green-600">매칭 완료</p>
        </div>
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 text-center">
          <Link2Off size={24} className="mx-auto text-amber-600 mb-2" />
          <p className="text-3xl font-bold text-amber-700">{unmatched.length}</p>
          <p className="text-sm text-amber-600">미매칭 기안</p>
        </div>
      </div>

      {matched.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">매칭된 항목</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-600 uppercase">
                <th className="px-4 py-2">발행일</th>
                <th className="px-4 py-2">공급자</th>
                <th className="px-4 py-2 text-right">합계</th>
                <th className="px-4 py-2">기안문서</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {matched.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-600">{m.issue_date}</td>
                  <td className="px-4 py-2 font-medium text-gray-900">{m.supplier_name}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatAmount(m.total_amount)}</td>
                  <td className="px-4 py-2 text-gray-600">{m.approval_file}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {unmatched.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">미매칭 기안문서</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-600 uppercase">
                <th className="px-4 py-2">파일명</th>
                <th className="px-4 py-2">유형</th>
                <th className="px-4 py-2">경로</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {unmatched.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-900">{a.file_name}</td>
                  <td className="px-4 py-2 text-gray-500 uppercase text-xs">{a.file_type}</td>
                  <td className="px-4 py-2 text-gray-400 font-mono text-xs truncate max-w-xs">{a.file_path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
