import { useEffect, useState, useRef, useCallback } from 'react';
import { Download, Plus, Wand2, Trash2, Save, X, FileSpreadsheet, Pencil } from 'lucide-react';
import { formatAmount } from '../lib/format';
import { getAPI } from '../lib/electron-mock';

interface EditableCostItem extends CostItem {
  dirty?: boolean;
}

interface EditingCell {
  itemId: number;
  year: number;
  month: number;
  value: string;
}

export function MonthlyCostPage() {
  const currentYear = new Date().getFullYear();
  const [baseYear, setBaseYear] = useState(currentYear);
  const [data, setData] = useState<MonthlyCostData | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [costItems, setCostItems] = useState<EditableCostItem[]>([]);
  const [editingItem, setEditingItem] = useState<Partial<CostItem> | null>(null);
  const [newItem, setNewItem] = useState<Partial<CostItem> | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editMode, setEditMode] = useState(false);
  const cellInputRef = useRef<HTMLInputElement>(null);

  const loadData = () => {
    getAPI().getMonthlyCostData(baseYear).then(setData);
  };

  useEffect(() => {
    getAPI().getMonthlyCostData(baseYear).then(setData);
  }, [baseYear]);

  useEffect(() => {
    if (showSettings) {
      getAPI().getCostItems().then(items => setCostItems(items.map(i => ({ ...i, dirty: false }))));
      setNewItem(null);
    }
  }, [showSettings]);

  const handleAutoDetect = async () => {
    const result = await getAPI().autoDetectCostItems();
    alert(`${result.added}개 항목이 자동 감지되었습니다.`);
    getAPI().getCostItems().then(setCostItems);
    loadData();
  };

  const handleImportFromExcel = async () => {
    const filePath = await getAPI().selectExcelFile();
    if (!filePath) return;
    try {
      const result = await getAPI().importCostItemsFromExcel(filePath);
      alert(`엑셀에서 ${result.total}개 항목 중 ${result.added}개 추가, ${result.skipped}개 기존 유지\n금액 데이터 ${result.amountsImported}건 반영`);
      getAPI().getCostItems().then(setCostItems);
      loadData();
    } catch (err: any) {
      alert(`임포트 실패: ${err.message}`);
    }
  };

  const handleSaveItem = async (item: Partial<CostItem>) => {
    if (!item.display_name || !item.match_keyword) return;
    await getAPI().saveCostItem({
      id: item.id,
      display_name: item.display_name,
      contract_period: item.contract_period || '',
      supplier: item.supplier || '',
      match_keyword: item.match_keyword,
      billing_cycle: item.billing_cycle || 'monthly',
      sort_order: item.sort_order || 0,
    });
    getAPI().getCostItems().then(items => setCostItems(items.map(i => ({ ...i, dirty: false }))));
    loadData();
  };

  const updateItemField = (id: number, field: keyof CostItem, value: string) => {
    setCostItems(prev => prev.map(item =>
      item.id === id ? { ...item, [field]: value, dirty: true } : item
    ));
  };

  const handleDeleteItem = async (id: number) => {
    if (!confirm('삭제하시겠습니까?')) return;
    await getAPI().deleteCostItem(id);
    getAPI().getCostItems().then(setCostItems);
    loadData();
  };

  const handleExport = async () => {
    setIsExporting(true);
    setExportedPath(null);
    try {
      const result = await getAPI().exportExcel(String(baseYear), 'monthly-cost');
      setExportedPath(result.file_path);
    } catch (err: any) {
      alert(`내보내기 실패: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleCellSave = useCallback(async () => {
    if (!editingCell) return;
    const amount = parseFloat(editingCell.value.replace(/,/g, '')) || 0;
    await getAPI().saveCostItemAmount(editingCell.itemId, editingCell.year, editingCell.month, amount);
    setEditingCell(null);
    loadData();
  }, [editingCell]);

  const startCellEdit = (itemId: number, year: number, month: number, currentVal: number) => {
    setEditingCell({ itemId, year, month, value: currentVal > 0 ? String(currentVal) : '' });
    setTimeout(() => cellInputRef.current?.select(), 0);
  };

  const years = data?.years || [baseYear, baseYear - 1];
  const shortYears = years.map(y => String(y).slice(2));
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const nowYear = now.getFullYear();

  const isMissingMonthly = (item: MonthlyCostItem, year: number, month: number): boolean => {
    if (item.billing_cycle !== 'monthly') return false;
    if (year !== baseYear) return false;
    if (year > nowYear || (year === nowYear && month > currentMonth)) return false;
    const val = item.yearData[year]?.months[month] || 0;
    if (val > 0) return false;
    let prevVal = 0;
    if (month > 1) {
      prevVal = item.yearData[year]?.months[month - 1] || 0;
    } else {
      prevVal = item.yearData[year - 1]?.months[12] || 0;
    }
    return prevVal > 0;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white shrink-0">
        <h2 className="text-lg font-bold text-gray-900">IT시스템 월별 비용</h2>
        <div className="flex items-center gap-2">
          <select
            value={baseYear}
            onChange={(e) => setBaseYear(Number(e.target.value))}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            {[currentYear, currentYear - 1, currentYear - 2].map(y => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
          <button onClick={() => setEditMode(!editMode)}
            className={`px-3 py-1.5 text-sm border rounded flex items-center gap-1 ${editMode ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 hover:bg-gray-50'}`}>
            <Pencil size={14} /> {editMode ? '편집 완료' : '금액 편집'}
          </button>
          <button onClick={() => setShowSettings(true)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
            항목 관리
          </button>
          <button onClick={handleExport} disabled={isExporting || !data?.items.length}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            <span className="flex items-center gap-1"><Download size={14} />{isExporting ? '내보내는 중...' : '엑셀 다운로드'}</span>
          </button>
        </div>
      </div>

      {exportedPath && (
        <div className="mx-6 mt-2 p-2 rounded bg-green-50 border border-green-200 text-xs text-green-700 shrink-0">
          저장: <span className="font-mono">{exportedPath}</span>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {!data?.items.length ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            등록된 비용 항목이 없습니다. "항목 관리" → "자동 감지"를 실행해주세요.
          </div>
        ) : (
          <table className="w-max min-w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-800 text-white">
                <th className="border border-slate-600 px-2 py-2 text-center w-10 font-medium" rowSpan={shortYears.length}>순번</th>
                <th className="border border-slate-600 px-2 py-2 text-center min-w-[200px] font-medium" rowSpan={shortYears.length}>내역</th>
                <th className="border border-slate-600 px-2 py-2 text-center w-12 font-medium" rowSpan={shortYears.length}>주기</th>
                <th className="border border-slate-600 px-2 py-2 text-center min-w-[90px] font-medium" rowSpan={shortYears.length}>거래처</th>
                <th className="border border-slate-600 px-1 py-2 text-center w-10 font-medium" rowSpan={shortYears.length}>년도</th>
                <th className="border border-slate-600 px-1 py-2 text-center w-[95px] font-medium" rowSpan={shortYears.length}>합계</th>
                <th className="border border-slate-600 px-2 py-1.5 text-center font-medium" colSpan={12}>
                  {baseYear}년 월 비용 (단위: 원, VAT 별도)
                </th>
                <th className="border border-slate-600 px-2 py-2 text-center min-w-[140px] font-medium" rowSpan={shortYears.length}>계약기간</th>
              </tr>
              <tr className="bg-slate-700 text-white">
                {Array.from({ length: 12 }, (_, i) => (
                  <th key={i} className="border border-slate-600 px-1 py-1.5 text-center w-[85px] font-medium">{i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* 년별 합계 */}
              {shortYears.map((sy, yi) => {
                const year = years[yi];
                const monthTotals: Record<number, number> = {};
                let grandTotal = 0;
                for (let m = 1; m <= 12; m++) {
                  monthTotals[m] = data.items.reduce((sum, it) => sum + (it.yearData[year]?.months[m] || 0), 0);
                  grandTotal += monthTotals[m];
                }
                const rowBg = yi === 0 ? 'bg-slate-100 text-slate-900' : 'bg-slate-50 text-slate-700';
                const cellBorder = 'border-slate-200';
                const totalBg = yi === 0 ? 'bg-slate-200/70 text-slate-900' : 'bg-slate-100 text-slate-800';
                return (
                  <tr key={`total-${year}`} className={`${rowBg} font-semibold border-b border-slate-300`}>
                    {yi === 0 && (
                      <>
                        <td className="border border-slate-200 px-2 py-2 text-center bg-white" rowSpan={shortYears.length}></td>
                        <td className="border border-slate-200 px-3 py-2 text-center text-slate-700 bg-white" rowSpan={shortYears.length}>월별 비용 총합</td>
                        <td className="border border-slate-200 px-2 py-2 bg-white" rowSpan={shortYears.length}></td>
                        <td className="border border-slate-200 px-2 py-2 bg-white" rowSpan={shortYears.length}></td>
                      </>
                    )}
                    <td className={`border ${cellBorder} px-1 py-2 text-center text-slate-500`}>{sy}년</td>
                    <td className={`border ${cellBorder} px-1 py-2 text-right tabular-nums ${totalBg}`}>
                      {grandTotal > 0 ? formatAmount(grandTotal) : ''}
                    </td>
                    {Array.from({ length: 12 }, (_, m) => {
                      const val = monthTotals[m + 1];
                      return (
                        <td key={m} className={`border ${cellBorder} px-1 py-2 text-right tabular-nums`}>
                          {val > 0 ? formatAmount(val) : ''}
                        </td>
                      );
                    })}
                    {yi === 0 && (
                      <td className="border border-slate-200 px-2 py-2 bg-white" rowSpan={shortYears.length}></td>
                    )}
                  </tr>
                );
              })}
              {data.items.map((item, idx) =>
                shortYears.map((sy, yi) => {
                  const year = years[yi];
                  const yd = item.yearData[year];
                  const isFirst = yi === 0;
                  const bg = yi === 0 ? 'bg-white' : 'bg-slate-50/60';

                  return (
                    <tr key={`${item.id}-${year}`} className={`${bg} border-b border-slate-200 hover:bg-slate-50`}>
                      {isFirst && (
                        <>
                          <td className="border border-slate-200 px-2 py-1.5 text-center text-slate-500" rowSpan={shortYears.length}>{idx + 1}</td>
                          <td className="border border-slate-200 px-3 py-1.5 font-medium text-slate-800" rowSpan={shortYears.length}>{item.display_name}</td>
                          <td className="border border-slate-200 px-1 py-1.5 text-center text-slate-600 text-[11px] font-medium" rowSpan={shortYears.length}>{item.billing_cycle === 'yearly' ? '년별' : '월별'}</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-center text-slate-500" rowSpan={shortYears.length}>{item.supplier}</td>
                        </>
                      )}
                      <td className="border border-slate-200 px-1 py-1.5 text-center text-slate-400 font-medium">{sy}년</td>
                      <td className="border border-slate-200 px-1 py-1.5 text-right font-semibold tabular-nums text-slate-800 bg-slate-50">
                        {(yd?.total || 0) > 0 ? formatAmount(yd.total) : ''}
                      </td>
                      {Array.from({ length: 12 }, (_, m) => {
                        const month = m + 1;
                        const val = yd?.months[month] || 0;
                        const missing = yi === 0 && isMissingMonthly(item, year, month);
                        const isEditing = editingCell?.itemId === item.id && editingCell?.year === year && editingCell?.month === month;
                        return (
                          <td
                            key={m}
                            className={`border border-slate-100 px-1 py-1.5 text-right tabular-nums ${missing ? 'bg-red-50 text-red-500' : 'text-slate-700'} ${editMode && !isEditing ? 'cursor-pointer hover:bg-blue-50' : ''}`}
                            onDoubleClick={() => editMode && startCellEdit(item.id, year, month, val)}
                          >
                            {isEditing ? (
                              <input
                                ref={cellInputRef}
                                type="text"
                                value={editingCell.value}
                                onChange={e => setEditingCell({ ...editingCell, value: e.target.value })}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') handleCellSave();
                                  if (e.key === 'Escape') setEditingCell(null);
                                }}
                                onBlur={handleCellSave}
                                className="w-full text-right text-xs border border-blue-400 rounded px-1 py-0.5 outline-none bg-white"
                                autoFocus
                              />
                            ) : (
                              val > 0 ? formatAmount(val) : missing ? '미처리' : ''
                            )}
                          </td>
                        );
                      })}
                      {isFirst && (
                        <td className="border border-slate-200 px-2 py-1.5 text-center text-slate-500 text-[11px] whitespace-pre-line" rowSpan={shortYears.length}>{item.contract_period}</td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowSettings(false)}>
          <div className="bg-white rounded-xl shadow-xl w-[900px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="text-lg font-semibold">비용 항목 관리</h3>
              <div className="flex items-center gap-2">
                <button onClick={handleImportFromExcel}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded bg-green-100 text-green-800 hover:bg-green-200">
                  <FileSpreadsheet size={14} /> 엑셀에서 가져오기
                </button>
                <button onClick={handleAutoDetect}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded bg-amber-100 text-amber-800 hover:bg-amber-200">
                  <Wand2 size={14} /> 자동 감지
                </button>
                <button onClick={() => setShowSettings(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 z-10">
                  <tr className="text-left text-xs text-slate-500 font-medium border-b border-slate-200">
                    <th className="py-2.5 px-3 w-10">#</th>
                    <th className="py-2.5 px-2">내역</th>
                    <th className="py-2.5 px-2 w-[120px]">매칭 키워드</th>
                    <th className="py-2.5 px-2 w-[140px]">계약기간</th>
                    <th className="py-2.5 px-2 w-[90px]">거래처</th>
                    <th className="py-2.5 px-2 w-[70px]">주기</th>
                    <th className="py-2.5 px-1 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {costItems.map((item, i) => (
                    <tr key={item.id} className="border-b border-slate-100 group hover:bg-slate-50/50">
                      <td className="py-1 px-3 text-slate-400 text-xs">{i + 1}</td>
                      <td className="py-1 px-1">
                        <input
                          value={item.display_name}
                          onChange={e => updateItemField(item.id, 'display_name', e.target.value)}
                          className="w-full bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-400 focus:bg-white rounded px-1.5 py-1 text-sm text-slate-800 outline-none transition-colors"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input
                          value={item.match_keyword}
                          onChange={e => updateItemField(item.id, 'match_keyword', e.target.value)}
                          className="w-full bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-400 focus:bg-white rounded px-1.5 py-1 text-xs font-mono text-slate-600 outline-none transition-colors"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input
                          value={item.contract_period}
                          onChange={e => updateItemField(item.id, 'contract_period', e.target.value)}
                          className="w-full bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-400 focus:bg-white rounded px-1.5 py-1 text-xs text-slate-500 outline-none transition-colors"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input
                          value={item.supplier}
                          onChange={e => updateItemField(item.id, 'supplier', e.target.value)}
                          className="w-full bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-400 focus:bg-white rounded px-1.5 py-1 text-xs text-slate-500 outline-none transition-colors"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <select
                          value={item.billing_cycle || 'monthly'}
                          onChange={e => updateItemField(item.id, 'billing_cycle', e.target.value)}
                          className="w-full bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-400 focus:bg-white rounded px-0.5 py-1 text-xs text-slate-600 outline-none transition-colors"
                        >
                          <option value="monthly">월별</option>
                          <option value="yearly">년별</option>
                        </select>
                      </td>
                      <td className="py-1 px-1">
                        <div className="flex items-center gap-0.5">
                          {item.dirty && (
                            <button onClick={() => handleSaveItem(item)} className="p-1 text-blue-500 hover:text-blue-700" title="저장">
                              <Save size={13} />
                            </button>
                          )}
                          <button onClick={() => handleDeleteItem(item.id)} className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" title="삭제">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {/* 새 항목 추가 행 */}
                  {newItem && (
                    <tr className="border-b border-blue-200 bg-blue-50/50">
                      <td className="py-1 px-3 text-blue-400 text-xs">+</td>
                      <td className="py-1 px-1">
                        <input
                          autoFocus
                          placeholder="내역 (표시명)"
                          value={newItem.display_name || ''}
                          onChange={e => setNewItem({ ...newItem, display_name: e.target.value })}
                          className="w-full border border-blue-200 focus:border-blue-400 bg-white rounded px-1.5 py-1 text-sm outline-none"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input
                          placeholder="매칭 키워드"
                          value={newItem.match_keyword || ''}
                          onChange={e => setNewItem({ ...newItem, match_keyword: e.target.value })}
                          className="w-full border border-blue-200 focus:border-blue-400 bg-white rounded px-1.5 py-1 text-xs font-mono outline-none"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input
                          placeholder="계약기간"
                          value={newItem.contract_period || ''}
                          onChange={e => setNewItem({ ...newItem, contract_period: e.target.value })}
                          className="w-full border border-blue-200 focus:border-blue-400 bg-white rounded px-1.5 py-1 text-xs outline-none"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input
                          placeholder="거래처"
                          value={newItem.supplier || ''}
                          onChange={e => setNewItem({ ...newItem, supplier: e.target.value })}
                          className="w-full border border-blue-200 focus:border-blue-400 bg-white rounded px-1.5 py-1 text-xs outline-none"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <select
                          value={newItem.billing_cycle || 'monthly'}
                          onChange={e => setNewItem({ ...newItem, billing_cycle: e.target.value as 'monthly' | 'yearly' })}
                          className="w-full border border-blue-200 focus:border-blue-400 bg-white rounded px-0.5 py-1 text-xs outline-none"
                        >
                          <option value="monthly">월별</option>
                          <option value="yearly">년별</option>
                        </select>
                      </td>
                      <td className="py-1 px-1">
                        <div className="flex items-center gap-0.5">
                          <button onClick={async () => {
                            if (!newItem.display_name) return;
                            await handleSaveItem({ ...newItem, match_keyword: newItem.match_keyword || newItem.display_name, billing_cycle: newItem.billing_cycle || 'monthly', sort_order: costItems.length + 1 });
                            setNewItem(null);
                            getAPI().getCostItems().then(items => setCostItems(items.map(i => ({ ...i, dirty: false }))));
                          }} className="p-1 text-blue-500 hover:text-blue-700"><Save size={13} /></button>
                          <button onClick={() => setNewItem(null)} className="p-1 text-slate-400 hover:text-slate-600"><X size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 border-t flex justify-between">
              <button onClick={() => setNewItem({ display_name: '', match_keyword: '', contract_period: '', supplier: '', billing_cycle: 'monthly' })}
                className="flex items-center gap-1 px-3 py-1.5 text-sm border border-slate-200 rounded hover:bg-slate-50 text-slate-600">
                <Plus size={14} /> 항목 추가
              </button>
              <div className="flex items-center gap-2">
                {costItems.some(i => i.dirty) && (
                  <button onClick={async () => {
                    for (const item of costItems.filter(i => i.dirty)) await handleSaveItem(item);
                  }} className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                    변경사항 저장
                  </button>
                )}
                <button onClick={() => { setShowSettings(false); loadData(); }} className="px-4 py-1.5 text-sm bg-slate-800 text-white rounded hover:bg-slate-900">닫기</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
