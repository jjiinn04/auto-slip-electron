import { Fragment, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, TrendingUp, TrendingDown, Wallet, CalendarDays, Layers, Download } from 'lucide-react';
import { formatAmount } from '../lib/format';
import { getAPI } from '../lib/electron-mock';

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const Y_TICKS = 4; // 가로 그리드 구간 수 (라벨 5개)

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// Y축 라벨용 간단 통화 표기 (억/만)
function compactWon(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(n % 1e8 === 0 ? 0 : 1)}억`;
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString('ko-KR')}만`;
  if (n <= 0) return '0';
  return Math.round(n).toLocaleString('ko-KR');
}

function monthSum(items: MonthlyCostItem[], year: number, month: number): number {
  return items.reduce((s, it) => s + (it.yearData[year]?.months?.[month] || 0), 0);
}

function yearSum(items: MonthlyCostItem[], year: number): number {
  return items.reduce((s, it) => s + (it.yearData[year]?.total || 0), 0);
}

interface ItemChange {
  name: string;
  diff: number;
  pct: number | null;
}

// 두 (연,월) 시점 간 항목별 증감 (증감 0 제외, 증감액 절댓값 내림차순)
function monthItemChanges(
  items: MonthlyCostItem[],
  curYear: number,
  curMonth: number,
  prevYear: number,
  prevMonth: number,
): ItemChange[] {
  return items
    .map((it) => {
      const c = it.yearData[curYear]?.months?.[curMonth] || 0;
      const p = it.yearData[prevYear]?.months?.[prevMonth] || 0;
      return { name: it.display_name, diff: c - p, pct: p > 0 ? ((c - p) / p) * 100 : null };
    })
    .filter((x) => x.diff !== 0)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}

export function DashboardPage() {
  const currentYear = new Date().getFullYear();
  const [baseYear, setBaseYear] = useState(currentYear);
  const [data, setData] = useState<MonthlyCostData | null>(null);
  const [department, setDepartment] = useState<Department | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    getAPI().getCurrentDepartment().then(setDepartment);
  }, []);

  useEffect(() => {
    getAPI().getMonthlyCostData(baseYear).then(setData);
  }, [baseYear]);

  if (!data) {
    return <div className="p-8 text-sm text-gray-400">불러오는 중...</div>;
  }

  const prevYear = baseYear - 1;
  const items = data.items;

  const curMonths = MONTHS.map((m) => monthSum(items, baseYear, m));
  const prevMonths = MONTHS.map((m) => monthSum(items, prevYear, m));
  const chartMax = Math.max(1, ...curMonths, ...prevMonths);

  const curTotal = yearSum(items, baseYear);
  const prevTotal = yearSum(items, prevYear);

  // 세금계산서가 처리된(금액이 있는) 마지막 월. 전년 대비·증감은 이 월까지만 누적 비교.
  const lastMonth = curMonths.reduce((last, v, i) => (v > 0 ? i + 1 : last), 0);
  const cumCur = curMonths.slice(0, lastMonth).reduce((s, v) => s + v, 0);
  const cumPrev = prevMonths.slice(0, lastMonth).reduce((s, v) => s + v, 0);
  const yoyPct = lastMonth > 0 && cumPrev > 0 ? ((cumCur - cumPrev) / cumPrev) * 100 : null;

  // 상단 "월 비용"은 세금계산서가 처리된 마지막 월 기준
  const lastMonthTotal = lastMonth > 0 ? curMonths[lastMonth - 1] : 0;
  const itemCount = items.filter((it) => (it.yearData[baseYear]?.total || 0) > 0).length;

  // 처리된 월(1~lastMonth) 누적 기준 항목별 전년 대비 증감
  const processedMonths = MONTHS.slice(0, lastMonth);
  const itemChanges = items
    .map((it) => {
      const c = processedMonths.reduce((s, m) => s + (it.yearData[baseYear]?.months?.[m] || 0), 0);
      const p = processedMonths.reduce((s, m) => s + (it.yearData[prevYear]?.months?.[m] || 0), 0);
      return { name: it.display_name, diff: c - p, pct: p > 0 ? ((c - p) / p) * 100 : null };
    })
    .filter((x) => x.diff !== 0);
  const increases = itemChanges.filter((x) => x.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5);
  const decreases = itemChanges.filter((x) => x.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 5);

  // 지난달 대비 항목별 증감 (처리된 마지막 월 vs 그 직전 월)
  const prevMonthNo = lastMonth - 1;
  const momChanges = lastMonth >= 2 ? monthItemChanges(items, baseYear, lastMonth, baseYear, prevMonthNo) : [];
  const momIncreases = momChanges.filter((x) => x.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5);
  const momDecreases = momChanges.filter((x) => x.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 5);

  const tickValues = Array.from({ length: Y_TICKS + 1 }, (_, k) => (chartMax * (Y_TICKS - k)) / Y_TICKS);

  function buildReportHtml(): string {
    const today = new Date().toLocaleDateString('ko-KR');
    const deptName = escapeHtml(department?.name ?? '부서');
    const yoyText = yoyPct === null ? '–' : `${yoyPct >= 0 ? '+' : ''}${yoyPct.toFixed(1)}%`;
    const yoyColor = yoyPct === null ? '#9ca3af' : yoyPct < 0 ? '#059669' : '#e11d48';

    const changeList = (rows: ItemChange[], up: boolean) =>
      rows.length === 0
        ? '<li class="empty">해당 항목 없음</li>'
        : rows
            .map(
              (r) =>
                `<li><span class="nm">${escapeHtml(r.name)}</span><span class="amt" style="color:${up ? '#e11d48' : '#059669'}">${r.diff > 0 ? '+' : '−'}₩${formatAmount(Math.abs(r.diff))} <em>${r.pct === null ? '신규' : `${r.pct > 0 ? '+' : ''}${r.pct.toFixed(0)}%`}</em></span></li>`,
            )
            .join('');

    const monthRows = MONTHS.map((m, i) => {
      const cur = curMonths[i];
      const prev = prevMonths[i];
      const processed = m <= lastMonth;
      const diff = cur - prev;
      const color = !processed ? '#d1d5db' : diff > 0 ? '#e11d48' : diff < 0 ? '#059669' : '#9ca3af';
      const text = !processed || diff === 0 ? '–' : `${diff > 0 ? '+' : ''}${formatAmount(diff)}`;
      return `<tr><td>${m}월</td><td class="r">${formatAmount(cur)}</td><td class="r dim">${formatAmount(prev)}</td><td class="r" style="color:${color}">${text}</td></tr>`;
    }).join('');

    const totalDiff = cumCur - cumPrev;
    const totalColor = lastMonth === 0 ? '#9ca3af' : totalDiff > 0 ? '#e11d48' : totalDiff < 0 ? '#059669' : '#9ca3af';
    const totalText =
      lastMonth === 0 || totalDiff === 0 ? '–' : `${totalDiff > 0 ? '+' : ''}${formatAmount(totalDiff)}`;

    const chartBars = MONTHS.map((m, i) => {
      const ch = (curMonths[i] / chartMax) * 100;
      const ph = (prevMonths[i] / chartMax) * 100;
      return `<div class="bcol"><span class="bar cur" style="height:${ch}%"></span><span class="bar prev" style="height:${ph}%"></span></div>`;
    }).join('');
    const chartYAxis = tickValues.map((t) => `<span>${compactWon(t)}</span>`).join('');
    const chartLabels = MONTHS.map((m) => `<span>${m}</span>`).join('');

    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
* { box-sizing: border-box; }
body { font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif; color: #111827; margin: 0; padding: 32px 36px; font-size: 12px; }
h1 { font-size: 20px; margin: 0 0 2px; }
.sub { color: #6b7280; font-size: 12px; margin: 0 0 24px; }
.cards { display: flex; gap: 12px; margin-bottom: 24px; }
.card { flex: 1; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; }
.card .lbl { color: #6b7280; font-size: 11px; margin-bottom: 6px; }
.card .val { font-size: 17px; font-weight: 700; }
.section { margin-bottom: 24px; }
.section > .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
.section h2 { font-size: 13px; margin: 0; }
.section .note { color: #9ca3af; font-size: 11px; }
.cols { display: flex; gap: 24px; }
.cols > div { flex: 1; }
.collbl { font-size: 11px; color: #6b7280; font-weight: 600; margin-bottom: 8px; }
ul { list-style: none; margin: 0; padding: 0; }
li { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; border-bottom: 1px solid #f3f4f6; }
li.empty { color: #d1d5db; justify-content: flex-start; }
li .nm { color: #374151; }
li .amt { white-space: nowrap; font-variant-numeric: tabular-nums; }
li .amt em { color: #9ca3af; font-style: normal; font-size: 11px; margin-left: 6px; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { padding: 6px 10px; text-align: left; }
th { background: #f9fafb; color: #6b7280; font-size: 11px; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
td { border-bottom: 1px solid #f3f4f6; }
.r { text-align: right; }
.dim { color: #6b7280; }
tfoot td { font-weight: 700; border-top: 2px solid #d1d5db; background: #f9fafb; }
.legend { font-size: 11px; color: #6b7280; }
.legend span { margin-left: 12px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
.chart-row { display: flex; gap: 6px; }
.yaxis { display: flex; flex-direction: column; justify-content: space-between; height: 180px; width: 44px; text-align: right; font-size: 9px; color: #9ca3af; font-variant-numeric: tabular-nums; }
.chart { flex: 1; display: flex; align-items: flex-end; gap: 4px; height: 180px; border-left: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; padding: 0 4px; }
.bcol { flex: 1; display: flex; align-items: flex-end; justify-content: center; gap: 2px; height: 100%; }
.bar { width: 9px; border-radius: 2px 2px 0 0; }
.bar.cur { background: #3b82f6; }
.bar.prev { background: #d1d5db; }
.xlabels { display: flex; gap: 6px; margin-top: 4px; }
.xlabels .yspace { width: 44px; }
.xlabels .xinner { flex: 1; display: flex; gap: 4px; padding: 0 4px; }
.xlabels .xinner span { flex: 1; text-align: center; font-size: 9px; color: #9ca3af; }
</style></head><body>
<h1>${deptName} 비용 현황 보고서</h1>
<p class="sub">${baseYear}년 · 생성일 ${today}</p>
<div class="cards">
  <div class="card"><div class="lbl">${baseYear}년 누적 총액</div><div class="val">₩${formatAmount(curTotal)}</div></div>
  <div class="card"><div class="lbl">${lastMonth > 0 ? `${lastMonth}월 비용` : '월 비용'}</div><div class="val">₩${formatAmount(lastMonthTotal)}</div></div>
  <div class="card"><div class="lbl">${lastMonth > 0 ? `전년 대비 (1~${lastMonth}월 누적)` : '전년 대비'}</div><div class="val" style="color:${yoyColor}">${yoyText}</div></div>
  <div class="card"><div class="lbl">비용 항목</div><div class="val">${itemCount}건</div></div>
</div>
${
  lastMonth > 0 && (increases.length > 0 || decreases.length > 0)
    ? `<div class="section"><div class="head"><h2>전년 대비 증감 항목</h2><span class="note">1~${lastMonth}월 누적 기준</span></div>
<div class="cols">
  <div><div class="collbl">주로 늘어난 항목</div><ul>${changeList(increases, true)}</ul></div>
  <div><div class="collbl">주로 줄어든 항목</div><ul>${changeList(decreases, false)}</ul></div>
</div></div>`
    : ''
}
${
  lastMonth >= 2 && (momIncreases.length > 0 || momDecreases.length > 0)
    ? `<div class="section"><div class="head"><h2>지난달 대비 증감 항목</h2><span class="note">${prevMonthNo}월 → ${lastMonth}월</span></div>
<div class="cols">
  <div><div class="collbl">늘어난 항목</div><ul>${changeList(momIncreases, true)}</ul></div>
  <div><div class="collbl">줄어든 항목</div><ul>${changeList(momDecreases, false)}</ul></div>
</div></div>`
    : ''
}
<div class="section"><div class="head"><h2>월별 비용 추이</h2><span class="legend"><span><i class="dot" style="background:#3b82f6"></i>${baseYear}년</span><span><i class="dot" style="background:#d1d5db"></i>${prevYear}년</span></span></div>
<div class="chart-row"><div class="yaxis">${chartYAxis}</div><div class="chart">${chartBars}</div></div>
<div class="xlabels"><div class="yspace"></div><div class="xinner">${chartLabels}</div></div></div>
<div class="section"><div class="head"><h2>월별 비교 (${baseYear} vs ${prevYear})</h2></div>
<table>
  <thead><tr><th>월</th><th class="r">${baseYear}년</th><th class="r">${prevYear}년</th><th class="r">증감</th></tr></thead>
  <tbody>${monthRows}</tbody>
  <tfoot><tr><td>합계</td><td class="r">${formatAmount(curTotal)}</td><td class="r dim">${formatAmount(prevTotal)}</td><td class="r" style="color:${totalColor}">${totalText}</td></tr></tfoot>
</table></div>
</body></html>`;
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const fileName = `${department?.name ?? '부서'}_비용보고서_${baseYear}.pdf`;
      const res = await getAPI().exportDashboardPdf(buildReportHtml(), fileName);
      if (!res.ok && !res.canceled) {
        alert(`보고서 생성 실패${res.message ? `: ${res.message}` : ''}`);
      }
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            {department ? `${department.name} 비용 현황` : '비용 현황'}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">{baseYear}년 부서 비용 대시보드</p>
        </div>
        <div className="flex items-center gap-2">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          <Download size={16} />
          {downloading ? '생성 중...' : '보고서 다운로드'}
        </button>
        <div className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white">
          <button
            onClick={() => setBaseYear((y) => y - 1)}
            className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-l-lg"
            aria-label="이전 연도"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="px-2 text-sm font-semibold text-gray-900 tabular-nums">{baseYear}년</span>
          <button
            onClick={() => setBaseYear((y) => Math.min(currentYear, y + 1))}
            disabled={baseYear >= currentYear}
            className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-r-lg disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="다음 연도"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard
          icon={<Wallet size={18} className="text-blue-600" />}
          label={`${baseYear}년 누적 총액`}
          value={`₩${formatAmount(curTotal)}`}
        />
        <SummaryCard
          icon={<CalendarDays size={18} className="text-violet-600" />}
          label={lastMonth > 0 ? `${lastMonth}월 비용` : '월 비용'}
          value={`₩${formatAmount(lastMonthTotal)}`}
        />
        <SummaryCard
          icon={
            yoyPct !== null && yoyPct < 0 ? (
              <TrendingDown size={18} className="text-emerald-600" />
            ) : (
              <TrendingUp size={18} className="text-rose-600" />
            )
          }
          label={lastMonth > 0 ? `전년 대비 (1~${lastMonth}월 누적)` : '전년 대비'}
          value={
            yoyPct === null
              ? '–'
              : `${yoyPct >= 0 ? '+' : ''}${yoyPct.toFixed(1)}%`
          }
          valueClass={
            yoyPct === null ? 'text-gray-400' : yoyPct < 0 ? 'text-emerald-600' : 'text-rose-600'
          }
        />
        <SummaryCard
          icon={<Layers size={18} className="text-amber-600" />}
          label="비용 항목"
          value={`${itemCount}건`}
        />
      </div>

      {/* 전년 대비 증감 항목 분석 */}
      {lastMonth > 0 && (increases.length > 0 || decreases.length > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">전년 대비 증감 항목</h3>
            <span className="text-xs text-gray-400">1~{lastMonth}월 누적 기준</span>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <ChangeList
              title="주로 늘어난 항목"
              icon={<TrendingUp size={15} className="text-rose-600" />}
              rows={increases}
              tone="up"
            />
            <ChangeList
              title="주로 줄어든 항목"
              icon={<TrendingDown size={15} className="text-emerald-600" />}
              rows={decreases}
              tone="down"
            />
          </div>
        </div>
      )}

      {/* 지난달 대비 증감 항목 분석 */}
      {lastMonth >= 2 && (momIncreases.length > 0 || momDecreases.length > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">지난달 대비 증감 항목</h3>
            <span className="text-xs text-gray-400">{prevMonthNo}월 → {lastMonth}월</span>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <ChangeList
              title="늘어난 항목"
              icon={<TrendingUp size={15} className="text-rose-600" />}
              rows={momIncreases}
              tone="up"
            />
            <ChangeList
              title="줄어든 항목"
              icon={<TrendingDown size={15} className="text-emerald-600" />}
              rows={momDecreases}
              tone="down"
            />
          </div>
        </div>
      )}

      {/* Monthly trend chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900">월별 비용 추이</h3>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-blue-500" />
              {baseYear}년
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-gray-300" />
              {prevYear}년
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {/* Y축 (금액) */}
          <div className="flex flex-col justify-between items-end h-48 w-14 shrink-0 text-[10px] text-gray-400 tabular-nums">
            {tickValues.map((t, k) => (
              <span key={k}>{chartMax > 1 ? compactWon(t) : k === Y_TICKS ? '0' : ''}</span>
            ))}
          </div>
          {/* 막대 영역 */}
          <div className="flex-1 flex items-end gap-2 h-48 border-l border-b border-gray-200 pl-1">
            {MONTHS.map((m, i) => (
              <div key={m} className="flex-1 flex items-end justify-center gap-0.5 h-full">
                <div
                  className="w-1/2 max-w-[16px] rounded-t bg-blue-500 hover:bg-blue-600 transition-colors"
                  style={{ height: `${(curMonths[i] / chartMax) * 100}%` }}
                  title={`${baseYear}년 ${m}월: ₩${formatAmount(curMonths[i])}`}
                />
                <div
                  className="w-1/2 max-w-[16px] rounded-t bg-gray-300 hover:bg-gray-400 transition-colors"
                  style={{ height: `${(prevMonths[i] / chartMax) * 100}%` }}
                  title={`${prevYear}년 ${m}월: ₩${formatAmount(prevMonths[i])}`}
                />
              </div>
            ))}
          </div>
        </div>
        {/* 월 라벨 (막대 영역과 정렬) */}
        <div className="flex gap-2 mt-1.5">
          <div className="w-14 shrink-0" />
          <div className="flex-1 flex gap-2 pl-1">
            {MONTHS.map((m) => (
              <span key={m} className="flex-1 text-center text-[11px] text-gray-400">
                {m}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Month / year comparison table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <h3 className="text-sm font-semibold text-gray-900 px-6 py-4 border-b border-gray-100">
          월별 비교 ({baseYear} vs {prevYear})
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 bg-gray-50">
              <th className="text-left font-medium px-6 py-2.5">월</th>
              <th className="text-right font-medium px-6 py-2.5">{baseYear}년</th>
              <th className="text-right font-medium px-6 py-2.5">{prevYear}년</th>
              <th className="text-right font-medium px-6 py-2.5">증감</th>
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((m, i) => {
              const cur = curMonths[i];
              const prev = prevMonths[i];
              const processed = m <= lastMonth;
              const diff = cur - prev;
              const expandable = processed && diff !== 0;
              const expanded = expandedMonth === m;
              const changes = expanded ? monthItemChanges(items, baseYear, m, prevYear, m) : [];
              return (
                <Fragment key={m}>
                  <tr
                    className={`border-t border-gray-50 ${expandable ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                    onClick={expandable ? () => setExpandedMonth(expanded ? null : m) : undefined}
                  >
                    <td className="px-6 py-2 text-gray-700">
                      <span className="inline-flex items-center gap-1">
                        {expandable && (
                          <ChevronDown
                            size={14}
                            className={`text-gray-400 transition-transform ${expanded ? '' : '-rotate-90'}`}
                          />
                        )}
                        {!expandable && <span className="w-[14px]" />}
                        {m}월
                      </span>
                    </td>
                    <td className="px-6 py-2 text-right tabular-nums text-gray-900">{formatAmount(cur)}</td>
                    <td className="px-6 py-2 text-right tabular-nums text-gray-500">{formatAmount(prev)}</td>
                    <td
                      className={`px-6 py-2 text-right tabular-nums ${
                        !processed
                          ? 'text-gray-300'
                          : diff > 0
                            ? 'text-rose-600'
                            : diff < 0
                              ? 'text-emerald-600'
                              : 'text-gray-400'
                      }`}
                    >
                      {!processed || diff === 0 ? '–' : `${diff > 0 ? '+' : ''}${formatAmount(diff)}`}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="bg-gray-50/60">
                      <td colSpan={4} className="px-6 py-3">
                        <ul className="space-y-1.5">
                          {changes.map((r) => (
                            <li key={r.name} className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-gray-600 truncate pl-5">{r.name}</span>
                              <span
                                className={`tabular-nums whitespace-nowrap ${
                                  r.diff > 0 ? 'text-rose-600' : 'text-emerald-600'
                                }`}
                              >
                                {r.diff > 0 ? '+' : '−'}₩{formatAmount(Math.abs(r.diff))}
                                <span className="text-gray-400 ml-1.5">
                                  {r.pct === null ? '신규' : `${r.pct > 0 ? '+' : ''}${r.pct.toFixed(0)}%`}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
              <td className="px-6 py-2.5 text-gray-900">합계</td>
              <td className="px-6 py-2.5 text-right tabular-nums text-gray-900">{formatAmount(curTotal)}</td>
              <td className="px-6 py-2.5 text-right tabular-nums text-gray-500">{formatAmount(prevTotal)}</td>
              <td
                className={`px-6 py-2.5 text-right tabular-nums ${
                  lastMonth === 0
                    ? 'text-gray-300'
                    : cumCur - cumPrev > 0
                      ? 'text-rose-600'
                      : cumCur - cumPrev < 0
                        ? 'text-emerald-600'
                        : 'text-gray-400'
                }`}
              >
                {lastMonth === 0 || cumCur - cumPrev === 0
                  ? '–'
                  : `${cumCur - cumPrev > 0 ? '+' : ''}${formatAmount(cumCur - cumPrev)}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function ChangeList({
  title,
  icon,
  rows,
  tone,
}: {
  title: string;
  icon: React.ReactNode;
  rows: { name: string; diff: number; pct: number | null }[];
  tone: 'up' | 'down';
}) {
  const amountClass = tone === 'up' ? 'text-rose-600' : 'text-emerald-600';
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-3">
        {icon}
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-300 py-2">해당 항목 없음</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-gray-700 truncate">{r.name}</span>
              <span className={`tabular-nums whitespace-nowrap ${amountClass}`}>
                {r.diff > 0 ? '+' : '−'}₩{formatAmount(Math.abs(r.diff))}
                <span className="text-xs text-gray-400 ml-1.5">
                  {r.pct === null ? '신규' : `${r.pct > 0 ? '+' : ''}${r.pct.toFixed(0)}%`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  valueClass = 'text-gray-900',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
        {icon}
        {label}
      </div>
      <p className={`text-xl font-bold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  );
}
