'use client';

// 판매일보 Phase 1 — 모바일 우선 입력 화면(기록 전용).
//   재고/매출/회계 미반영. 마감재고 자동계산(클라 실시간) + 사원 수정 시 차이 배지.
//   오픈재고는 서버 템플릿이 전일 마감 이월. RBAC=서버액션(비관리자 본인매장 강제).
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getDailyReport, getReportTemplate, saveDailyReport, getDailyReportBranches, listDailyReports,
  approveDailyReport, unpostDailyReport,
  type DailyReportLineInput,
} from '@/lib/daily-report-actions';
import { kstTodayString } from '@/lib/date';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  return document.cookie.split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    acc[k] = decodeURIComponent(v || '');
    return acc;
  }, {} as Record<string, string>)[name] || null;
}

const MANAGER_ROLES = new Set(['SUPER_ADMIN', 'HQ_OPERATOR', 'EXECUTIVE']);
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
// 마감재고 자동값 = 오픈 + 입고/반품 − 현장판매 − 시음증정/파손
const autoClosing = (l: DailyReportLineInput): number =>
  num(l.opening_stock) + num(l.in_return) - num(l.onsite_sold) - num(l.sample_damage);

export default function DailyReportPage() {
  const userRole = getCookie('user_role') || '';
  const userBranchId = getCookie('user_branch_id') || '';
  const isManager = MANAGER_ROLES.has(userRole);

  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [branchId, setBranchId] = useState(userBranchId);
  const [reportDate, setReportDate] = useState(() => kstTodayString());
  const [lines, setLines] = useState<DailyReportLineInput[]>([]);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'DRAFT' | 'SUBMITTED' | 'APPROVED' | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);   // 승인/취소 대상 id
  const [confirmAction, setConfirmAction] = useState<null | 'approve' | 'unpost'>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // 마감재고 수동수정 토글(라인 인덱스 집합) — 토글 시 closing_stock 직접입력 허용.
  const [manualClosing, setManualClosing] = useState<Set<number>>(new Set());
  // #76 현장매출 수동수정 라인(기본 자동=현장판매×판매가). 사용자가 직접 고친 라인만 자동계산 제외.
  const [revenueManual, setRevenueManual] = useState<Set<number>>(new Set());
  // 판매사원 콤보모드: 검색어 + 편집중 라인 인덱스(콤보로 추가/제거). lines 자체는 전 품목 유지(저장 무변경).
  const [comboSearch, setComboSearch] = useState('');
  const [editedIdx, setEditedIdx] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState(false);   // [전체 보기] 토글(비관리자도 전 품목 그리드)
  // Phase1.2 관리자 탭: 'input'(일보 입력) | 'status'(제출 현황). 비관리자는 항상 input.
  const [mgrTab, setMgrTab] = useState<'input' | 'status'>('input');
  // #76: 진입 시 화면 기능·연동 기준 안내(접을 수 있음). 실사용 전 최종 검토 단계임을 명시.
  const [showInfo, setShowInfo] = useState(true);
  const [statusRows, setStatusRows] = useState<Awaited<ReturnType<typeof listDailyReports>>['rows']>([]);
  const [statusSummary, setStatusSummary] = useState<{ total: number; approved?: number; submitted: number; draft: number; missing: number } | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    getDailyReportBranches().then(r => {
      setBranches(r.branches || []);
      if (!branchId && r.branches?.[0]) setBranchId(r.branches[0].id);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!branchId) { setLoading(false); return; }
    setLoading(true); setError(null); setMsg(null); setManualClosing(new Set()); setRevenueManual(new Set()); setComboSearch('');
    const res = await getDailyReport(branchId, reportDate);
    if (res.error) { setError(res.error); setLines([]); setStatus(null); setReportId(null); setLoading(false); return; }
    if (res.report) {
      const l = res.report.lines;
      setLines(l);
      setNote(res.report.header.note || '');
      setStatus(res.report.header.status as 'DRAFT' | 'SUBMITTED' | 'APPROVED');
      setReportId(res.report.header.id);
      // 기존 저장분 중 자동값과 다른 closing 은 수동수정으로 간주(차이 배지 노출).
      const manual = new Set<number>();
      const edited = new Set<number>();
      const revManual = new Set<number>();
      l.forEach((line, i) => {
        if (num(line.closing_stock) !== autoClosing(line)) manual.add(i);
        // #76: 저장된 현장매출이 자동값(현장판매×판매가)과 다르면 수동조정으로 간주(수량 변경 시 보존).
        if (num(line.onsite_revenue) !== num(line.onsite_sold) * num(line.unit_price)) revManual.add(i);
        // 이미 움직인 라인(판매/증정/입고/매출 등 0 아님)은 콤보모드에서 편집중 카드로 노출.
        if (num(line.onsite_sold) || num(line.sample_damage) || num(line.in_return) ||
            num(line.hq_parcel) || num(line.onsite_revenue) || num(line.parcel_revenue)) edited.add(i);
      });
      setManualClosing(manual);
      setRevenueManual(revManual);
      setEditedIdx(edited);
    } else {
      const tpl = await getReportTemplate(branchId, reportDate);
      if (tpl.error) { setError(tpl.error); setLines([]); setStatus(null); setReportId(null); setLoading(false); return; }
      setReportId(null);
      setLines(tpl.template?.lines || []);
      setNote('');
      setStatus(null);
      setEditedIdx(new Set());
    }
    setLoading(false);
  }, [branchId, reportDate]);

  useEffect(() => { load(); }, [load]);

  // 제출 현황 로드(관리자·status 탭만). reportDate 공유.
  const loadStatus = useCallback(async () => {
    if (!isManager) return;
    setStatusLoading(true); setStatusError(null);
    const res = await listDailyReports(reportDate);
    if (res.error) { setStatusError(res.error); setStatusRows([]); setStatusSummary(null); setStatusLoading(false); return; }
    setStatusRows(res.rows || []);
    setStatusSummary(res.summary || null);
    setStatusLoading(false);
  }, [isManager, reportDate]);

  useEffect(() => { if (isManager && mgrTab === 'status') loadStatus(); }, [isManager, mgrTab, loadStatus]);

  // 현황 행 클릭 → 일보 입력 탭 전환 + 해당 매장·날짜 세팅(date 공유) → 기존 그리드 로드.
  const openDetail = (branchIdToOpen: string) => {
    setBranchId(branchIdToOpen);
    setMgrTab('input');
    setShowAll(true);   // 현황에서 열면 전체 품목 그리드로 표시(변동 품목만 마킹) — 한눈 파악
  };

  // 라인 필드 변경 — 수동수정 안 한 라인은 closing_stock 을 자동값으로 유지.
  const updateLine = (i: number, field: keyof DailyReportLineInput, value: string) => {
    setLines(prev => {
      const next = [...prev];
      const line = { ...next[i], [field]: field === 'product_name' || field === 'product_code' ? value : num(value) } as DailyReportLineInput;
      if (field !== 'closing_stock' && !manualClosing.has(i)) {
        line.closing_stock = autoClosing(line);   // 자동 추종
      }
      // #76/#91: 현장매출 자동계산 = 현장판매 × 판매가 (수동수정 안 한 라인만).
      //   현장판매 또는 판매가(단가) 변경 시 즉시 반영. #91 단가 직접 수정 지원.
      if ((field === 'onsite_sold' || field === 'unit_price') && !revenueManual.has(i)) {
        line.onsite_revenue = num(line.onsite_sold) * num(line.unit_price);
      }
      next[i] = line;
      return next;
    });
    setEditedIdx(prev => prev.has(i) ? prev : new Set(prev).add(i));   // 값 건드린 라인=편집중
  };

  // 표 셀에서 마감재고 직접 편집 — 입력 즉시 수동수정으로 표시(카드의 [직접 수정] 토글과 동일 효과).
  const editClosingCell = (i: number, value: string) => {
    setManualClosing(prev => prev.has(i) ? prev : new Set(prev).add(i));
    updateLine(i, 'closing_stock', value);
  };

  // #76 현장매출 직접 편집 — 입력 즉시 수동수정으로 표시(이후 현장판매 변경에도 자동 덮어쓰기 안 함).
  const editRevenue = (i: number, value: string) => {
    setRevenueManual(prev => prev.has(i) ? prev : new Set(prev).add(i));
    updateLine(i, 'onsite_revenue', value);
  };

  const toggleManual = (i: number) => {
    setManualClosing(prev => {
      const n = new Set(prev);
      if (n.has(i)) {
        n.delete(i);
        // 자동으로 되돌릴 때 closing_stock 자동값 복원
        setLines(ls => { const c = [...ls]; c[i] = { ...c[i], closing_stock: autoClosing(c[i]) }; return c; });
      } else {
        n.add(i);
      }
      return n;
    });
  };

  // 인덱스 집합 재계산(라인 삭제 시 i 이후 한 칸 당김).
  const reindexAfterRemove = (set: Set<number>, removed: number): Set<number> => {
    const n = new Set<number>();
    set.forEach(idx => { if (idx < removed) n.add(idx); else if (idx > removed) n.add(idx - 1); });
    return n;
  };

  const removeLine = (i: number) => {
    setLines(prev => prev.filter((_, idx) => idx !== i));
    setManualClosing(prev => reindexAfterRemove(prev, i));
    setRevenueManual(prev => reindexAfterRemove(prev, i));
    setEditedIdx(prev => reindexAfterRemove(prev, i));
  };

  const addLine = () => {
    setLines(prev => {
      const next = [...prev, {
        product_id: null, product_code: null, product_name: '', unit_price: 0,
        opening_stock: 0, onsite_sold: 0, sample_damage: 0, in_return: 0, closing_stock: 0,
        hq_parcel: 0, onsite_revenue: 0, parcel_revenue: 0, sort_order: prev.length,
      } as DailyReportLineInput];
      setEditedIdx(prevSet => new Set(prevSet).add(next.length - 1));   // 새 라인=편집중 노출
      return next;
    });
  };

  // 콤보: 검색어로 미편집 라인 필터(이미 추가된 건 후보 제외). 추가 DB 조회 없음(메모리 lines).
  const comboCandidates = useMemo(() => {
    const q = comboSearch.trim().toLowerCase();
    return lines
      .map((l, i) => ({ l, i }))
      .filter(({ l, i }) =>
        !editedIdx.has(i) &&
        (!q ||
          (l.product_name || '').toLowerCase().includes(q) ||
          (l.product_code || '').toLowerCase().includes(q))
      )
      .slice(0, 30);
  }, [lines, comboSearch, editedIdx]);

  const addToEdited = (i: number) => {
    setEditedIdx(prev => new Set(prev).add(i));
    setComboSearch('');
  };
  const removeFromEdited = (i: number) => {
    // 라인 자체는 lines에 남아 이월값으로 저장됨(브리프 2번). 편집중 카드에서만 제거.
    setEditedIdx(prev => { const n = new Set(prev); n.delete(i); return n; });
  };

  const totals = useMemo(() => {
    const onsite = lines.reduce((s, l) => s + num(l.onsite_revenue), 0);
    const parcel = lines.reduce((s, l) => s + num(l.parcel_revenue), 0);
    return { onsite, parcel, daily: onsite + parcel };
  }, [lines]);

  const save = async (newStatus: 'DRAFT' | 'SUBMITTED') => {
    if (!branchId) { setError('매장을 선택하세요.'); return; }
    setSaving(true); setError(null); setMsg(null);
    const res = await saveDailyReport({
      branch_id: branchId, report_date: reportDate, status: newStatus,
      note, lines: lines.map((l, i) => ({ ...l, sort_order: i })),
    });
    if (res.error) { setError(res.error); setSaving(false); return; }
    setStatus(res.status || newStatus);
    setMsg(newStatus === 'SUBMITTED' ? '제출되었습니다.' : '임시저장되었습니다.');
    setSaving(false);
  };

  // 승인(재고+분개 반영) / 승인취소(역연동). 관리자만. 확인모달 경유.
  const doApprove = async () => {
    if (!reportId) return;
    setSaving(true); setError(null); setMsg(null); setConfirmAction(null);
    const res = await approveDailyReport(reportId);
    if (res.error) { setError(res.error); setSaving(false); return; }
    setMsg('승인되었습니다. 재고·매출이 반영되었습니다.');
    setSaving(false);
    await load();
  };
  const doUnpost = async () => {
    if (!reportId) return;
    setSaving(true); setError(null); setMsg(null); setConfirmAction(null);
    const res = await unpostDailyReport(reportId);
    if (res.error) { setError(res.error); setSaving(false); return; }
    setMsg('승인이 취소되었습니다. 재고·매출이 원복되었습니다.');
    setSaving(false);
    await load();
  };

  const isApproved = status === 'APPROVED';   // 읽기전용 잠금 기준

  // 라인 입력 카드 — 관리자 그리드/전체보기/콤보 편집중 영역 공용. onRemove 만 모드별 주입.
  const renderCard = (l: DailyReportLineInput, i: number, onRemove: () => void, removeTitle: string) => {
    const auto = autoClosing(l);
    const isManual = manualClosing.has(i);
    const diff = num(l.closing_stock) - auto;
    return (
      <div key={i} className="card space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {l.product_id ? (
              <p className="font-medium text-sm text-slate-800 break-words">{l.product_name}</p>
            ) : (
              <input
                type="text" value={l.product_name}
                onChange={e => updateLine(i, 'product_name', e.target.value)}
                placeholder="품목명 직접 입력"
                className="input text-sm font-medium w-full"
              />
            )}
            {l.product_code && <p className="text-[11px] text-slate-400 font-mono">{l.product_code}</p>}
          </div>
          <button onClick={onRemove} className="text-slate-300 hover:text-red-500 text-lg leading-none px-1" title={removeTitle}>×</button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {/* #81: 오픈재고는 전산 재고(전일 마감/시작 재고) 자동 — 읽기 전용 */}
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">오픈재고 <span className="text-slate-400">자동</span></label>
            <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-600 tabular-nums">{num(l.opening_stock).toLocaleString()}</div>
          </div>
          <NumField label="입고/반품" value={l.in_return} onChange={v => updateLine(i, 'in_return', v)} />
          <NumField label="현장판매" value={l.onsite_sold} onChange={v => updateLine(i, 'onsite_sold', v)} />
          <NumField label="시음증정/파손" value={l.sample_damage} onChange={v => updateLine(i, 'sample_damage', v)} />
        </div>

        {/* 마감재고 — 판매·반품·소모 기준 자동 계산(읽기전용). 강제 수정은 권한자(#81)만 예외적으로. */}
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">마감재고 <span className="text-slate-400">자동 계산</span></span>
            {isManager && (
              <button onClick={() => toggleManual(i)} className="text-[11px] text-blue-600 underline">
                {isManual ? '자동으로' : '⚠ 강제 수정'}
              </button>
            )}
          </div>
          {isManager && isManual ? (
            <div className="flex items-center gap-2 mt-1">
              <input
                type="number" inputMode="decimal" step="any"
                value={l.closing_stock}
                onChange={e => updateLine(i, 'closing_stock', e.target.value)}
                className="input text-sm w-28 font-semibold border-amber-300"
              />
              {diff !== 0 && (
                <span className={`badge text-[10px] ${diff > 0 ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                  자동 {auto} ({diff > 0 ? '+' : ''}{diff})
                </span>
              )}
            </div>
          ) : (
            <p className="text-base font-semibold text-slate-800 mt-0.5">{num(l.closing_stock).toLocaleString()}</p>
          )}
        </div>

        {/* #91 판매가(단가) 직접 수정 — 변경 시 현장매출(=현장판매×판매가) 자동 재계산. 정가보다 높게도 가능(채널별 판매가). */}
        <div className="grid grid-cols-2 gap-2">
          <NumField label="판매가(단가)" value={l.unit_price} onChange={v => updateLine(i, 'unit_price', v)} won />
          <NumField label="현장매출" value={l.onsite_revenue} onChange={v => editRevenue(i, v)} won />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumField label="본사택배" value={l.hq_parcel} onChange={v => updateLine(i, 'hq_parcel', v)} />
          <NumField label="택배매출" value={l.parcel_revenue} onChange={v => updateLine(i, 'parcel_revenue', v)} won />
        </div>
      </div>
    );
  };

  // 전 품목 표(관리자 / [전체 보기] on). lines(저장 스냅샷) 기준 렌더 → 제품 추가·삭제 후에도
  //   해당 일보에 기록된 시점의 품목 그대로 표시(라이브 카탈로그 재조회 안 함). 변동 라인만 마킹.
  const cellCls = 'w-[68px] rounded border border-slate-200 px-1 py-1 text-sm text-right focus:border-blue-400 outline-none disabled:bg-slate-50';
  const fullGrid = (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="text-sm border-collapse min-w-[1040px]">
          <thead>
            <tr className="text-[11px] text-slate-500 bg-slate-50 border-b border-slate-200">
              <th className="text-left px-2 py-2 sticky left-0 bg-slate-50 z-10 min-w-[160px]">품목</th>
              <th className="px-2 py-2 font-medium text-right">판매가</th>
              <th className="px-1 py-2 font-medium">오픈재고</th>
              <th className="px-1 py-2 font-medium">시스템재고</th>
              <th className="px-1 py-2 font-medium">입고/반품</th>
              <th className="px-1 py-2 font-medium">현장판매</th>
              <th className="px-1 py-2 font-medium">시음/파손</th>
              <th className="px-1 py-2 font-medium">마감재고</th>
              <th className="px-1 py-2 font-medium">현장매출</th>
              <th className="px-1 py-2 font-medium">본사택배</th>
              <th className="px-1 py-2 font-medium">택배매출</th>
              <th className="px-1 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const auto = autoClosing(l);
              const isManual = manualClosing.has(i);
              const isChanged = editedIdx.has(i);
              const diff = num(l.closing_stock) - auto;
              const rowBg = isChanged ? 'bg-blue-50' : 'bg-white';
              // 시스템재고(라이브 inventories.quantity) ↔ 오픈재고(어제 마감 이월) 대조. 다르면 ⚠(승인지연/외부변동).
              const sysStock = l.system_stock;
              const sysMismatch = sysStock != null && num(sysStock) !== num(l.opening_stock);
              return (
                <tr key={i} className={`border-b border-slate-100 last:border-0 ${rowBg}`}>
                  <td className={`px-2 py-1 sticky left-0 z-10 min-w-[160px] ${rowBg}`}>
                    <div className="flex items-center gap-1.5">
                      {l.product_id ? (
                        <span className="text-slate-800 break-words">{l.product_name}</span>
                      ) : (
                        <input type="text" value={l.product_name}
                          onChange={e => updateLine(i, 'product_name', e.target.value)}
                          placeholder="품목명" className="w-32 rounded border border-slate-200 px-1.5 py-1 text-sm" />
                      )}
                      {isChanged && <span className="badge text-[10px] bg-blue-100 text-blue-700 shrink-0">변동</span>}
                    </div>
                    {l.product_code && <p className="text-[10px] text-slate-400 font-mono">{l.product_code}</p>}
                  </td>
                  {/* #91 판매가(단가) 직접 수정 — 변경 시 현장매출 자동 재계산 */}
                  <td className="px-1 py-1 text-center"><input type="number" inputMode="decimal" step="any" value={l.unit_price} onChange={e => updateLine(i, 'unit_price', e.target.value)} className={cellCls} /></td>
                  {/* #81 오픈재고 읽기전용(전산 재고 자동) */}
                  <td className="px-1 py-1 text-center whitespace-nowrap tabular-nums text-slate-600">{num(l.opening_stock).toLocaleString()}</td>
                  <td className="px-1 py-1 text-center whitespace-nowrap tabular-nums">
                    {sysStock == null ? (
                      <span className="text-slate-300">-</span>
                    ) : (
                      <span className={sysMismatch ? 'text-amber-600 font-semibold' : 'text-slate-400'} title={sysMismatch ? '오픈재고(어제 마감 이월)와 시스템 재고가 다릅니다. 전일 일보 미승인 또는 외부 재고변동일 수 있습니다.' : undefined}>
                        {num(sysStock).toLocaleString()}{sysMismatch ? ' ⚠' : ''}
                      </span>
                    )}
                  </td>
                  <td className="px-1 py-1 text-center"><input type="number" inputMode="decimal" step="any" value={l.in_return} onChange={e => updateLine(i, 'in_return', e.target.value)} className={cellCls} /></td>
                  <td className="px-1 py-1 text-center"><input type="number" inputMode="decimal" step="any" value={l.onsite_sold} onChange={e => updateLine(i, 'onsite_sold', e.target.value)} className={cellCls} /></td>
                  <td className="px-1 py-1 text-center"><input type="number" inputMode="decimal" step="any" value={l.sample_damage} onChange={e => updateLine(i, 'sample_damage', e.target.value)} className={cellCls} /></td>
                  {/* #81 마감재고 자동(읽기전용). 강제수정은 권한자만 */}
                  <td className="px-1 py-1 text-center">
                    {isManager ? (
                      <>
                        <input type="number" inputMode="decimal" step="any" value={l.closing_stock}
                          onChange={e => editClosingCell(i, e.target.value)}
                          className={`${cellCls} font-semibold ${isManual ? 'border-amber-300' : ''}`} />
                        {isManual && diff !== 0 && (
                          <button onClick={() => toggleManual(i)} title={`자동 ${auto}로 되돌리기`}
                            className="block mx-auto text-[10px] text-amber-600 mt-0.5">자동 {auto} ↺</button>
                        )}
                      </>
                    ) : (
                      <span className="whitespace-nowrap tabular-nums font-semibold text-slate-700">{num(l.closing_stock).toLocaleString()}</span>
                    )}
                  </td>
                  <td className="px-1 py-1 text-center"><input type="number" inputMode="decimal" step="any" value={l.onsite_revenue} onChange={e => editRevenue(i, e.target.value)} className={`${cellCls} w-[88px]`} /></td>
                  <td className="px-1 py-1 text-center"><input type="number" inputMode="decimal" step="any" value={l.hq_parcel} onChange={e => updateLine(i, 'hq_parcel', e.target.value)} className={cellCls} /></td>
                  <td className="px-1 py-1 text-center"><input type="number" inputMode="decimal" step="any" value={l.parcel_revenue} onChange={e => updateLine(i, 'parcel_revenue', e.target.value)} className={`${cellCls} w-[88px]`} /></td>
                  <td className="px-1 py-1 text-center"><button onClick={() => removeLine(i)} className="text-slate-300 hover:text-red-500 text-lg leading-none px-1" title="라인 삭제">×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button onClick={addLine} className="btn-secondary text-sm w-full py-2">+ 품목 추가</button>
    </div>
  );

  // 입력 UX는 역할 무관 동일(검색 콤보 기본). 관리자 차이점은 '매장 선택 가능'뿐.
  // 전 품목 그리드는 [전체 보기] 토글로만(관리자 포함 누구나) 진입.
  const showFullGrid = showAll;

  return (
    <div className={`${showFullGrid ? 'max-w-5xl' : 'max-w-2xl'} mx-auto space-y-4`}>
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-bold text-slate-800">📝 판매일보</h1>
        {(!isManager || mgrTab === 'input') && status && (
          <span className={`badge text-[11px] ${
            status === 'APPROVED' ? 'bg-blue-100 text-blue-700'
            : status === 'SUBMITTED' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
          }`}>
            {status === 'APPROVED' ? '승인완료' : status === 'SUBMITTED' ? '제출완료' : '임시저장'}
          </span>
        )}
        {!showInfo && (
          <button onClick={() => setShowInfo(true)} className="ml-auto text-[11px] text-slate-400 hover:text-slate-600 underline">ℹ️ 안내</button>
        )}
      </div>

      {/* #76: 화면 기능·내용 정의 + 연동 기준 안내(진입 시). 실사용 전 최종 검토 단계. */}
      {showInfo && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">ℹ️ 판매일보란? — 백화점 매장의 하루 판매를 마감·기록하는 화면입니다. <span className="text-amber-700">(실사용 전 최종 검토 단계)</span></p>
            <button onClick={() => setShowInfo(false)} className="text-amber-400 hover:text-amber-700 shrink-0" title="안내 접기">✕</button>
          </div>
          <ul className="list-disc pl-4 space-y-0.5 text-amber-800">
            <li><b>입력</b>: 품목별 오픈재고·현장판매·시음/파손·입고반품·마감재고 + 현장/택배 매출. (마감재고는 자동계산되며 수정 가능, 시스템재고와 다르면 ⚠ 표시)</li>
            <li><b>연동 기준</b>: <b>[승인]</b> 시에만 해당 지점 재고가 차감/증가되고 매출이 분개(백화점 미수금)로 반영됩니다. 승인 전에는 <b>기록만</b> 됩니다.</li>
            <li><b>판매현황·매출현황과의 관계</b>: 일보 승인분은 <b>회계(매출분개·미수금)</b>에 반영됩니다. 개별 판매전표(POS 주문)는 만들지 않으며, <b>지점별 매출 화면 연결은 정식 가동 시 적용 예정</b>(현재 검토 단계, 이중집계 방지 기준 확정 후).</li>
            <li><b>목적</b>: 지점 일일 <b>마감 기록 + 승인 시 매출·재고 반영</b>용입니다. (실시간 POS 판매 입력과는 별개)</li>
          </ul>
        </div>
      )}

      {/* 관리자 전용 탭 — [일보 입력] / [제출 현황]. 비관리자는 탭 미노출(기존 입력만). */}
      {isManager && (
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
          {([['input', '일보 입력'], ['status', '제출 현황']] as ['input' | 'status', string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setMgrTab(k)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                mgrTab === k ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── 제출 현황 탭(관리자) ── */}
      {isManager && mgrTab === 'status' && (
        <div className="space-y-3">
          <div className="card">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">일자</span>
              <input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} className="input text-sm w-44" />
            </label>
          </div>

          {statusError && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{statusError}</div>}

          {statusSummary && (
            <div className="grid grid-cols-5 gap-2">
              <SummaryStat label="대상" value={statusSummary.total} />
              <SummaryStat label="승인" value={statusSummary.approved ?? 0} tone="blue" />
              <SummaryStat label="제출" value={statusSummary.submitted} tone="green" />
              <SummaryStat label="임시" value={statusSummary.draft} tone="slate" />
              <SummaryStat label="미제출" value={statusSummary.missing} tone="red" emphasize />
            </div>
          )}

          {statusLoading ? (
            <div className="text-center py-12 text-slate-400">불러오는 중...</div>
          ) : statusRows.length === 0 ? (
            <div className="card text-center py-10 text-slate-400 text-sm">대상(백화점) 매장이 없습니다.</div>
          ) : (
            <>
              {/* 모바일 카드 */}
              <div className="space-y-2 md:hidden">
                {statusRows.map(r => (
                  <button
                    key={r.branch_id}
                    onClick={() => openDetail(r.branch_id)}
                    className="card w-full text-left flex items-center justify-between gap-2 hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-slate-800">{r.branch_name}</p>
                      <p className="text-[11px] text-slate-400">{r.author_name || '—'}{r.submitted_at ? ` · ${new Date(r.submitted_at).toLocaleString('ko-KR')}` : ''}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <StatusBadge status={r.status} />
                      {r.status !== 'MISSING' && <p className="text-xs font-semibold text-slate-700 mt-1">{r.daily_total.toLocaleString()}원</p>}
                    </div>
                  </button>
                ))}
              </div>
              {/* 데스크탑 표 */}
              <div className="card hidden md:block overflow-x-auto">
                <table className="table text-sm w-full">
                  <thead>
                    <tr className="text-xs text-slate-500">
                      <th>매장</th><th>작성자</th><th>상태</th><th className="text-right">당일매출</th><th>제출시각</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusRows.map(r => (
                      <tr key={r.branch_id} onClick={() => openDetail(r.branch_id)} className="cursor-pointer hover:bg-slate-50">
                        <td className="font-medium text-slate-800">{r.branch_name}</td>
                        <td className="text-slate-600">{r.author_name || '—'}</td>
                        <td><StatusBadge status={r.status} /></td>
                        <td className="text-right text-slate-700">{r.status !== 'MISSING' ? `${r.daily_total.toLocaleString()}원` : '—'}</td>
                        <td className="text-[11px] text-slate-400">{r.submitted_at ? new Date(r.submitted_at).toLocaleString('ko-KR') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── 일보 입력 탭(비관리자 기본 / 관리자 input) ── */}
      {(!isManager || mgrTab === 'input') && (<>
      {/* 매장·날짜 선택 */}
      <div className="card space-y-2">
        {isManager && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">매장</span>
            <select value={branchId} onChange={e => setBranchId(e.target.value)} className="input text-sm">
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">일자</span>
          <input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} className="input text-sm" />
        </label>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
      {msg && <div className="rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm px-3 py-2">{msg}</div>}

      {/* 승인 잠금 안내 — APPROVED 면 입력 잠금(fieldset disabled). 수정은 승인취소 선행. */}
      {isApproved && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm px-3 py-2">
          🔒 승인 완료된 일보입니다(재고·매출 반영됨). 수정하려면 아래 [승인취소]를 먼저 실행하세요.
        </div>
      )}

      <fieldset disabled={isApproved} className={isApproved ? 'opacity-70' : ''}><div className="space-y-4">

      {/* [전체 보기] 토글 — 콤보 ↔ 전 품목 그리드. 역할 무관(관리자 포함). */}
      {!loading && lines.length > 0 && (
        <div className="flex justify-end">
          <button onClick={() => setShowAll(v => !v)} className="text-xs text-blue-600 underline">
            {showAll ? '← 검색 입력으로' : '전체 보기 →'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400">불러오는 중...</div>
      ) : lines.length === 0 ? (
        <div className="card text-center py-10 text-slate-400 text-sm">
          취급 품목이 없습니다. 아래 [품목 추가]로 직접 입력하세요.
          <div className="mt-3"><button onClick={addLine} className="btn-secondary text-sm py-2 px-4">+ 품목 추가</button></div>
        </div>
      ) : showFullGrid ? (
        fullGrid
      ) : (
        // 판매사원 콤보 모드 — 검색해 움직인 품목만 입력 카드로 추가. 미선택 품목은 이월값으로 백그라운드 저장.
        <div className="space-y-3">
          <div className="card space-y-2">
            <input
              type="text"
              value={comboSearch}
              onChange={e => setComboSearch(e.target.value)}
              placeholder="제품명·코드 검색 후 선택"
              className="input text-sm w-full"
            />
            {comboSearch.trim() && (
              comboCandidates.length === 0 ? (
                <p className="text-xs text-slate-400 px-1">일치하는 품목이 없습니다.</p>
              ) : (
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                  {comboCandidates.map(({ l, i }) => (
                    <button
                      key={i}
                      onClick={() => addToEdited(i)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between gap-2"
                    >
                      <span className="text-sm text-slate-700 truncate">
                        {l.product_name}
                        {l.product_code && <span className="text-[11px] text-slate-400 font-mono ml-1.5">{l.product_code}</span>}
                      </span>
                      <span className="text-[11px] text-blue-600 shrink-0">+ 추가</span>
                    </button>
                  ))}
                </div>
              )
            )}
            <p className="text-[11px] text-slate-400 px-1">
              움직인 품목만 검색해 추가하세요. 선택 안 한 품목은 어제 마감재고가 그대로 이월 저장됩니다.
            </p>
          </div>

          {/* 편집중 카드 — editedIdx 라인만 */}
          {[...editedIdx].sort((a, b) => a - b).map(i => (
            lines[i] ? renderCard(lines[i], i, () => removeFromEdited(i), '입력 목록에서 제거(이월값으로 저장됨)') : null
          ))}
          {editedIdx.size === 0 && (
            <div className="card text-center py-8 text-slate-400 text-sm">위에서 품목을 검색해 추가하세요.</div>
          )}

          <button onClick={addLine} className="btn-secondary text-sm w-full py-2">+ 취급외 품목 직접 추가</button>
        </div>
      )}

      {/* 합계 + 비고 */}
      {!loading && (
        <div className="card space-y-2">
          <div className="flex justify-between text-sm"><span className="text-slate-500">현장매출 합</span><span className="font-medium">{totals.onsite.toLocaleString()}원</span></div>
          <div className="flex justify-between text-sm"><span className="text-slate-500">택배매출 합</span><span className="font-medium">{totals.parcel.toLocaleString()}원</span></div>
          <div className="flex justify-between text-base font-bold border-t border-slate-100 pt-2"><span>당일매출</span><span className="text-blue-700">{totals.daily.toLocaleString()}원</span></div>
          <label className="flex flex-col gap-1 pt-1">
            <span className="text-xs text-slate-500">비고</span>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="input text-sm" placeholder="특이사항" />
          </label>
        </div>
      )}
      </div></fieldset>

      {/* 하단 고정 버튼 — 승인상태별 분기. 승인취소 버튼은 fieldset 밖(잠금 무관 클릭 가능). */}
      {!loading && (
        <div className="sticky bottom-0 z-30 px-4 py-3 bg-white border border-slate-200 rounded-t-xl flex gap-2 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
          {isApproved ? (
            isManager ? (
              <button onClick={() => setConfirmAction('unpost')} disabled={saving} className="btn-secondary flex-1 py-2.5 text-red-600 disabled:opacity-40">승인취소</button>
            ) : (
              <span className="flex-1 text-center text-sm text-slate-400 py-2.5">승인 완료된 일보입니다.</span>
            )
          ) : (
            <>
              <button onClick={() => save('DRAFT')} disabled={saving} className="btn-secondary flex-1 py-2.5 disabled:opacity-40">임시저장</button>
              <button onClick={() => save('SUBMITTED')} disabled={saving} className="btn-primary flex-1 py-2.5 disabled:opacity-40">제출</button>
              {isManager && status === 'SUBMITTED' && reportId && (
                <button onClick={() => setConfirmAction('approve')} disabled={saving} className="btn-primary flex-1 py-2.5 bg-blue-700 disabled:opacity-40">승인</button>
              )}
            </>
          )}
        </div>
      )}
      </>)}

      {/* 승인/취소 확인 모달 */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setConfirmAction(null)}>
          <div className="bg-white rounded-xl p-5 max-w-sm w-full space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800">{confirmAction === 'approve' ? '일보 승인' : '승인 취소'}</h3>
            <p className="text-sm text-slate-600">
              {confirmAction === 'approve'
                ? '승인하면 라인 수량이 실재고에 반영(현장판매·시음/파손 차감, 입고/반품 증가)되고 현장·택배매출이 매출분개(미수금)로 기록됩니다. 이후 수정하려면 승인취소가 필요합니다.'
                : '승인을 취소하면 반영된 재고가 원복되고 매출분개가 역분개됩니다. 이후 일보를 다시 수정·승인할 수 있습니다.'}
            </p>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setConfirmAction(null)} className="btn-secondary flex-1 py-2">취소</button>
              <button
                onClick={confirmAction === 'approve' ? doApprove : doUnpost}
                disabled={saving}
                className={`flex-1 py-2 rounded-lg text-white font-medium disabled:opacity-40 ${confirmAction === 'approve' ? 'bg-blue-700' : 'bg-red-600'}`}
              >
                {confirmAction === 'approve' ? '승인' : '승인취소'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'SUBMITTED' | 'DRAFT' | 'MISSING' | 'APPROVED' }) {
  const map = {
    APPROVED: { cls: 'bg-blue-100 text-blue-700', label: '승인완료' },
    SUBMITTED: { cls: 'bg-green-100 text-green-700', label: '제출완료' },
    DRAFT: { cls: 'bg-slate-100 text-slate-500', label: '임시저장' },
    MISSING: { cls: 'bg-red-100 text-red-700', label: '미제출' },
  }[status];
  return <span className={`badge text-[10px] ${map.cls}`}>{map.label}</span>;
}

function SummaryStat({ label, value, tone, emphasize }: { label: string; value: number; tone?: 'green' | 'slate' | 'red' | 'blue'; emphasize?: boolean }) {
  const color = tone === 'green' ? 'text-green-700' : tone === 'red' ? 'text-red-600' : tone === 'blue' ? 'text-blue-700' : 'text-slate-800';
  return (
    <div className={`card py-2 text-center ${emphasize && value > 0 ? 'ring-1 ring-red-300' : ''}`}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}

function NumField({ label, value, onChange, won }: { label: string; value: number; onChange: (v: string) => void; won?: boolean }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] text-slate-500">{label}{won ? '(원)' : ''}</span>
      <input
        type="number" inputMode="decimal" step="any"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="input text-sm w-full"
      />
    </label>
  );
}
