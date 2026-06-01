import { getAPI } from '../lib/electron-mock';
import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { formatAmount } from '../lib/format';
import {
  FileText, ChevronDown, ChevronRight, Trash2, Link, Unlink,
  ExternalLink, FolderOpen, Paperclip, FileSpreadsheet, Download, Wand2, Printer,
} from 'lucide-react';

export function InvoicesPage() {
  const { month, setMonth } = useAppStore();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [matchingId, setMatchingId] = useState<number | null>(null);
  const [unmatchedDocs, setUnmatchedDocs] = useState<Approval[]>([]);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [autoMatching, setAutoMatching] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [printing, setPrinting] = useState(false);

  const reload = () => getAPI().getInvoices(month).then(setInvoices);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(prev => (prev.size === invoices.length ? new Set() : new Set(invoices.map(i => i.id))));
  };

  const handlePrint = async () => {
    if (selectedIds.size === 0) return;
    setPrinting(true);
    try {
      const result = await getAPI().printInvoices([...selectedIds]);
      if (!result.ok) {
        alert(`출력 실패\n${result.message ?? ''}`);
      } else if (result.missing && result.missing.length > 0) {
        alert(`${result.printed}건 출력. 세금계산서 PDF를 찾지 못한 항목:\n${result.missing.join('\n')}`);
      }
    } catch (err) {
      alert(`출력 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPrinting(false);
    }
  };

  const handleAutoMatch = async () => {
    const folder = await getAPI().selectFolder();
    if (!folder) return;
    setAutoMatching(true);
    try {
      const result = await getAPI().autoMatchApprovalMasters(folder);
      alert(`기안문서 자동매핑 완료: ${result.matched}건 매핑, ${result.skipped}건 이미 등록`);
      reload();
    } catch (err) {
      alert(`기안문서 자동매핑 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAutoMatching(false);
    }
  };

  useEffect(() => {
    setSelectedIds(new Set());
    reload();
  }, [month]);

  const handleExpand = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    const d = await getAPI().getInvoice(id);
    setDetail(d);
  };

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm('이 세금계산서를 삭제하시겠습니까?')) return;
    await getAPI().deleteInvoice(id);
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
    }
    reload();
  };

  const handleStartMatch = async (e: React.MouseEvent, invoiceId: number) => {
    e.stopPropagation();
    setMatchingId(invoiceId);
    const docs = await getAPI().getUnmatchedApprovals(month, 'statement');
    setUnmatchedDocs(docs);
  };

  const handleMatch = async (invoiceId: number, docId: number) => {
    await getAPI().matchInvoice(invoiceId, docId);
    setMatchingId(null);
    reload();
    if (expandedId === invoiceId) {
      const d = await getAPI().getInvoice(invoiceId);
      setDetail(d);
    }
  };

  const handleUnmatch = async (invoiceId: number, docId: number) => {
    await getAPI().unmatchInvoice(docId);
    reload();
    const d = await getAPI().getInvoice(invoiceId);
    setDetail(d);
  };

  const handleOpenFile = (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation();
    getAPI().openFile(filePath);
  };

  const handleShowInFolder = (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation();
    getAPI().showInFolder(filePath);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">세금계산서 목록</h2>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={handlePrint}
              disabled={printing}
              className="flex items-center gap-1 px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              title="선택한 세금계산서 PDF와 매칭된 기안문서를 한 PDF로 묶어 출력합니다"
            >
              <Printer size={14} /> {printing ? '준비 중…' : `선택 출력 (${selectedIds.size})`}
            </button>
          )}
          {invoices.length > 0 && (
            <button
              onClick={handleAutoMatch}
              disabled={autoMatching}
              className="flex items-center gap-1 px-3 py-2 text-sm bg-amber-100 text-amber-800 rounded-lg font-medium hover:bg-amber-200 disabled:opacity-50 transition-colors"
              title="기안문서 폴더를 선택하면 파일명으로 세금계산서와 자동 매칭합니다"
            >
              <Wand2 size={14} /> {autoMatching ? '매핑 중…' : '기안 자동매핑'}
            </button>
          )}
          {invoices.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(v => !v)}
                className="flex items-center gap-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Download size={14} /> 엑셀 다운로드
              </button>
              {showExportMenu && (
                <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1 w-44">
                  {([['list', '목록표'], ['summary', '공급자별 집계'], ['douzone', '더존 전표']] as const).map(([type, label]) => (
                    <button
                      key={type}
                      onClick={async () => {
                        setShowExportMenu(false);
                        const result = await getAPI().exportExcel(month, type);
                        alert(`저장 완료: ${result.file_path}`);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {invoices.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FileText size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">이 달의 세금계산서가 없습니다.</p>
          <p className="text-sm text-gray-400 mt-1">홈에서 폴더를 선택하고 처리해주세요.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-left text-xs font-medium text-white">
                <th className="w-8 px-3 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={invoices.length > 0 && selectedIds.size === invoices.length}
                    onChange={toggleSelectAll}
                    className="cursor-pointer"
                  />
                </th>
                <th className="w-8 px-3 py-3"></th>
                <th className="px-4 py-3">발행일</th>
                <th className="px-4 py-3">공급자</th>
                <th className="px-4 py-3">품명</th>
                <th className="px-4 py-3 text-right">공급가액</th>
                <th className="px-4 py-3 text-right">세액</th>
                <th className="px-4 py-3 text-right">합계</th>
                <th className="px-4 py-3 text-center">거래명세표</th>
                <th className="px-4 py-3 text-center">기안</th>
                <th className="w-10 px-2 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv) => (
                <InvoiceRow
                  key={inv.id}
                  inv={inv}
                  expanded={expandedId === inv.id}
                  detail={expandedId === inv.id ? detail : null}
                  matchingId={matchingId}
                  unmatchedDocs={unmatchedDocs}
                  selected={selectedIds.has(inv.id)}
                  onToggleSelect={toggleSelect}
                  onExpand={handleExpand}
                  onDelete={handleDelete}
                  onStartMatch={handleStartMatch}
                  onMatch={handleMatch}
                  onUnmatch={handleUnmatch}
                  onCancelMatch={() => setMatchingId(null)}
                  onOpenFile={handleOpenFile}
                  onShowInFolder={handleShowInFolder}
                  onReload={reload}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InvoiceRow({
  inv, expanded, detail, matchingId, unmatchedDocs, selected, onToggleSelect,
  onExpand, onDelete, onStartMatch, onMatch, onUnmatch, onCancelMatch,
  onOpenFile, onShowInFolder, onReload,
}: {
  inv: Invoice;
  expanded: boolean;
  detail: InvoiceDetail | null;
  matchingId: number | null;
  unmatchedDocs: Approval[];
  selected: boolean;
  onToggleSelect: (id: number) => void;
  onExpand: (id: number) => void;
  onDelete: (e: React.MouseEvent, id: number) => void;
  onStartMatch: (e: React.MouseEvent, id: number) => void;
  onMatch: (invoiceId: number, docId: number) => void;
  onUnmatch: (invoiceId: number, docId: number) => void;
  onCancelMatch: () => void;
  onOpenFile: (e: React.MouseEvent, path: string) => void;
  onShowInFolder: (e: React.MouseEvent, path: string) => void;
  onReload: () => void;
}) {
  const isMatchMode = matchingId === inv.id;

  return (
    <>
      <tr className="hover:bg-slate-50 cursor-pointer group" onClick={() => onExpand(inv.id)}>
        <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(inv.id)}
            className="cursor-pointer"
          />
        </td>
        <td className="px-3 py-2.5 text-gray-400">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </td>
        <td className="px-4 py-2.5 text-gray-600">{inv.issue_date}</td>
        <td className="px-4 py-2.5 font-medium text-gray-900">{inv.supplier_name}</td>
        <td className="px-4 py-2.5 text-gray-600">{inv.description}</td>
        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{formatAmount(inv.supply_amount)}</td>
        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{formatAmount(inv.tax_amount)}</td>
        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{formatAmount(inv.total_amount)}</td>
        <td className="px-4 py-2.5 text-center">
          {inv.statement_files ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-700 border border-sky-200">
              <FileSpreadsheet size={10} /> 매칭됨
            </span>
          ) : (
            <button
              onClick={(e) => onStartMatch(e, inv.id)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500 hover:bg-sky-50 hover:text-sky-600 hover:border-sky-200 border border-slate-200 transition-colors"
            >
              <Link size={10} /> 미매칭
            </button>
          )}
        </td>
        <td className="px-4 py-2.5 text-center">
          {inv.master_count > 0 ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              <Paperclip size={10} /> {inv.master_count}건
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-600 border border-amber-200">
              미등록
            </span>
          )}
        </td>
        <td className="px-2 py-2.5">
          <button
            onClick={(e) => onDelete(e, inv.id)}
            className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
            title="삭제"
          >
            <Trash2 size={14} />
          </button>
        </td>
      </tr>

      {isMatchMode && (
        <tr>
          <td colSpan={11} className="px-6 py-3 bg-blue-50 border-y border-blue-200">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-blue-800">
                매칭할 거래명세표를 선택하세요
              </p>
              <button onClick={onCancelMatch} className="text-xs text-blue-600 hover:text-blue-800">취소</button>
            </div>
            {unmatchedDocs.length === 0 ? (
              <p className="text-xs text-blue-500">미매칭 거래명세표가 없습니다.</p>
            ) : (
              <div className="space-y-1">
                {unmatchedDocs.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-blue-100 hover:border-blue-300 cursor-pointer transition-colors"
                    onClick={() => onMatch(inv.id, a.id)}
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <FileSpreadsheet size={12} className="text-sky-400" />
                      <span className="text-gray-800">{a.file_name}</span>
                      <span className="text-xs text-gray-400">{a.file_type}</span>
                    </div>
                    <span className="text-xs text-blue-600 font-medium">선택</span>
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}

      {expanded && detail && (
        <tr>
          <td colSpan={11} className="px-8 py-4 bg-slate-50 border-b border-slate-200">
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-gray-400 text-xs">사업자번호</span>
                  <p className="font-mono text-gray-700">{detail.invoice?.supplier_id}</p>
                </div>
                <div>
                  <span className="text-gray-400 text-xs">원본파일</span>
                  <p className="font-mono text-xs text-gray-700">{detail.invoice?.source_file}</p>
                </div>
                <div>
                  <span className="text-gray-400 text-xs">상태</span>
                  <p className="text-gray-700">{detail.invoice?.status}</p>
                </div>
              </div>

              {detail.items.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">품목</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-200">
                        <th className="text-left py-1.5">품명</th>
                        <th className="text-right py-1.5 w-20">수량</th>
                        <th className="text-right py-1.5 w-24">단가</th>
                        <th className="text-right py-1.5 w-24">금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.map((item) => (
                        <tr key={item.id} className="border-b border-gray-100">
                          <td className="py-1.5 text-gray-700">{item.item_description}</td>
                          <td className="text-right text-gray-500">{item.quantity ?? '-'}</td>
                          <td className="text-right text-gray-500">{item.unit_price ? formatAmount(item.unit_price) : '-'}</td>
                          <td className="text-right font-medium text-gray-700">{formatAmount(item.line_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <StatementSection
                docs={detail.statements}
                invoiceId={inv.id}
                onStartMatch={onStartMatch}
                onOpenFile={onOpenFile}
                onShowInFolder={onShowInFolder}
                onUnmatch={onUnmatch}
              />

              <MasterSection
                masters={detail.approvals}
                onOpenFile={onOpenFile}
                onShowInFolder={onShowInFolder}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function StatementSection({
  docs, invoiceId, onStartMatch, onOpenFile, onShowInFolder, onUnmatch,
}: {
  docs: Approval[];
  invoiceId: number;
  onStartMatch: (e: React.MouseEvent, id: number) => void;
  onOpenFile: (e: React.MouseEvent, path: string) => void;
  onShowInFolder: (e: React.MouseEvent, path: string) => void;
  onUnmatch: (invoiceId: number, docId: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-semibold text-gray-500">거래명세표</p>
        <button
          onClick={(e) => onStartMatch(e, invoiceId)}
          className="text-xs text-sky-600 hover:text-sky-800 flex items-center gap-1"
        >
          <Link size={10} /> 거래명세표 매칭
        </button>
      </div>
      {docs.length > 0 ? (
        <div className="space-y-1.5">
          {docs.map((a) => (
            <div key={a.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-gray-200">
              <div className="flex items-center gap-2">
                <FileSpreadsheet size={10} className="text-sky-500" />
                <span className="text-sm text-gray-800">{a.file_name}</span>
                <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{a.file_type}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={(e) => onOpenFile(e, a.file_path)} className="p-1 text-gray-400 hover:text-blue-600 transition-colors" title="파일 열기">
                  <ExternalLink size={14} />
                </button>
                <button onClick={(e) => onShowInFolder(e, a.file_path)} className="p-1 text-gray-400 hover:text-blue-600 transition-colors" title="폴더에서 보기">
                  <FolderOpen size={14} />
                </button>
                <button onClick={() => onUnmatch(invoiceId, a.id)} className="p-1 text-gray-400 hover:text-red-500 transition-colors" title="매칭 해제">
                  <Unlink size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400">매칭된 거래명세표가 없습니다.</p>
      )}
    </div>
  );
}

function MasterSection({
  masters, onOpenFile, onShowInFolder,
}: {
  masters: ApprovalMaster[];
  onOpenFile: (e: React.MouseEvent, path: string) => void;
  onShowInFolder: (e: React.MouseEvent, path: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-semibold text-gray-500">기안문서</p>
        <span className="text-xs text-gray-400">공급자+적요 기준 자동 매칭</span>
      </div>
      {masters.length > 0 ? (
        <div className="space-y-1.5">
          {masters.map((m) => (
            <div key={m.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-emerald-200">
              <div className="flex items-center gap-2">
                <Paperclip size={10} className="text-emerald-500" />
                <button
                  onClick={(e) => onOpenFile(e, m.file_path)}
                  className="text-sm text-gray-800 hover:text-blue-600 hover:underline transition-colors"
                  title="클릭하여 기안문서 열기"
                >
                  {m.file_name}
                </button>
                <span className="text-xs text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                  {m.match_supplier}{m.match_description ? ` · ${m.match_description}` : ''}
                </span>
                {m.memo && <span className="text-xs text-gray-400">{m.memo}</span>}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={(e) => onOpenFile(e, m.file_path)} className="p-1 text-gray-400 hover:text-blue-600 transition-colors" title="파일 열기">
                  <ExternalLink size={14} />
                </button>
                <button onClick={(e) => onShowInFolder(e, m.file_path)} className="p-1 text-gray-400 hover:text-blue-600 transition-colors" title="폴더에서 보기">
                  <FolderOpen size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-amber-500">등록된 기안문서가 없습니다. 매칭 페이지에서 기안문서를 등록하세요.</p>
      )}
    </div>
  );
}
