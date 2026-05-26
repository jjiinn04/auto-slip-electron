import { getAPI } from '../lib/electron-mock';
import { useEffect, useState } from 'react';
import { formatAmount } from '../lib/format';
import {
  Plus, Trash2, Edit3, ExternalLink, FolderOpen, FileText, Save, X, RefreshCw,
} from 'lucide-react';

export function MatchingPage() {
  const [masters, setMasters] = useState<ApprovalMaster[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [editData, setEditData] = useState({ match_supplier: '', match_description: '', memo: '' });
  const [adding, setAdding] = useState(false);
  const [newData, setNewData] = useState({ match_supplier: '', match_description: '', memo: '' });

  const reload = () => getAPI().getApprovalMasters().then(setMasters);

  useEffect(() => { reload(); }, []);

  const handleAdd = async () => {
    if (!newData.match_supplier.trim()) return;
    const result = await getAPI().addApprovalMaster({
      match_supplier: newData.match_supplier.trim(),
      match_description: newData.match_description.trim(),
      memo: newData.memo.trim(),
    });
    if (result) {
      setAdding(false);
      setNewData({ match_supplier: '', match_description: '', memo: '' });
      reload();
    }
  };

  const handleUpdate = async (id: number) => {
    await getAPI().updateApprovalMaster(id, {
      match_supplier: editData.match_supplier.trim(),
      match_description: editData.match_description.trim(),
      memo: editData.memo.trim(),
    });
    setEditId(null);
    reload();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('이 기안문서를 삭제하시겠습니까?')) return;
    await getAPI().deleteApprovalMaster(id);
    reload();
  };

  const handleChangeFile = async (id: number) => {
    const result = await getAPI().updateApprovalMasterFile(id);
    if (result) reload();
  };

  const startEdit = (m: ApprovalMaster) => {
    setEditId(m.id);
    setEditData({ match_supplier: m.match_supplier, match_description: m.match_description, memo: m.memo });
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">기안문서 관리</h2>
          <p className="text-sm text-gray-500 mt-1">공급자+적요 기준으로 등록하면 세금계산서에 자동 매칭됩니다</p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} /> 기안문서 등록
        </button>
      </div>

      {adding && (
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-5 space-y-3">
          <p className="text-sm font-semibold text-blue-800">새 기안문서 등록</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">공급자명 (필수)</label>
              <input
                type="text"
                value={newData.match_supplier}
                onChange={(e) => setNewData({ ...newData, match_supplier: e.target.value })}
                placeholder="예: 롯데이노베이트"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">적요/품목 (선택)</label>
              <input
                type="text"
                value={newData.match_description}
                onChange={(e) => setNewData({ ...newData, match_description: e.target.value })}
                placeholder="예: 서버 유지보수"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">메모 (선택)</label>
              <input
                type="text"
                value={newData.memo}
                onChange={(e) => setNewData({ ...newData, memo: e.target.value })}
                placeholder="예: 2026년 계약"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <p className="text-xs text-blue-600">등록 버튼을 누르면 파일 선택 창이 열립니다.</p>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={!newData.match_supplier.trim()}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Save size={14} /> 등록
            </button>
            <button
              onClick={() => { setAdding(false); setNewData({ match_supplier: '', match_description: '', memo: '' }); }}
              className="flex items-center gap-1 px-3 py-1.5 bg-white text-gray-600 rounded-lg text-sm border border-gray-300 hover:bg-gray-50"
            >
              <X size={14} /> 취소
            </button>
          </div>
        </div>
      )}

      {masters.length === 0 && !adding ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FileText size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">등록된 기안문서가 없습니다.</p>
          <p className="text-sm text-gray-400 mt-1">기안문서를 등록하면 세금계산서에 자동 매칭됩니다.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-left text-xs font-medium text-white">
                <th className="px-4 py-3">공급자</th>
                <th className="px-4 py-3">적요/품목</th>
                <th className="px-4 py-3">파일</th>
                <th className="px-4 py-3">메모</th>
                <th className="w-32 px-4 py-3 text-center">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {masters.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  {editId === m.id ? (
                    <>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={editData.match_supplier}
                          onChange={(e) => setEditData({ ...editData, match_supplier: e.target.value })}
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={editData.match_description}
                          onChange={(e) => setEditData({ ...editData, match_description: e.target.value })}
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-4 py-2 text-gray-600">{m.file_name}</td>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={editData.memo}
                          onChange={(e) => setEditData({ ...editData, memo: e.target.value })}
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => handleUpdate(m.id)} className="p-1 text-blue-600 hover:text-blue-800" title="저장">
                            <Save size={14} />
                          </button>
                          <button onClick={() => setEditId(null)} className="p-1 text-gray-400 hover:text-gray-600" title="취소">
                            <X size={14} />
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 font-medium text-gray-900">{m.match_supplier}</td>
                      <td className="px-4 py-2.5 text-gray-600">{m.match_description || '-'}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <span className="text-gray-700 text-xs truncate max-w-48">{m.file_name}</span>
                          <button onClick={() => getAPI().openFile(m.file_path)} className="p-0.5 text-gray-400 hover:text-blue-600" title="파일 열기">
                            <ExternalLink size={12} />
                          </button>
                          <button onClick={() => getAPI().showInFolder(m.file_path)} className="p-0.5 text-gray-400 hover:text-blue-600" title="폴더에서 보기">
                            <FolderOpen size={12} />
                          </button>
                          <button onClick={() => handleChangeFile(m.id)} className="p-0.5 text-gray-400 hover:text-blue-600" title="파일 변경">
                            <RefreshCw size={12} />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{m.memo || '-'}</td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => startEdit(m)} className="p-1 text-gray-400 hover:text-blue-600" title="수정">
                            <Edit3 size={14} />
                          </button>
                          <button onClick={() => handleDelete(m.id)} className="p-1 text-gray-400 hover:text-red-500" title="삭제">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
