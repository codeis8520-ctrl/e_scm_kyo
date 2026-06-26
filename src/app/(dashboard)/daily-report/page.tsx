'use client';

// 판매일보 Phase 1 — 모바일 우선 입력 화면(기록 전용).
//   재고/매출/회계 미반영. 마감재고 자동계산(클라 실시간) + 사원 수정 시 차이 배지.
//   오픈재고는 서버 템플릿이 전일 마감 이월. RBAC=서버액션(비관리자 본인매장 강제).
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getDailyReport, getReportTemplate, saveDailyReport, getDailyReportBranches,
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
  const [status, setStatus] = useState<'DRAFT' | 'SUBMITTED' | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // 마감재고 수동수정 토글(라인 인덱스 집합) — 토글 시 closing_stock 직접입력 허용.
  const [manualClosing, setManualClosing] = useState<Set<number>>(new Set());

  useEffect(() => {
    getDailyReportBranches().then(r => {
      setBranches(r.branches || []);
      if (!branchId && r.branches?.[0]) setBranchId(r.branches[0].id);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!branchId) { setLoading(false); return; }
    setLoading(true); setError(null); setMsg(null); setManualClosing(new Set());
    const res = await getDailyReport(branchId, reportDate);
    if (res.error) { setError(res.error); setLines([]); setStatus(null); setLoading(false); return; }
    if (res.report) {
      const l = res.report.lines;
      setLines(l);
      setNote(res.report.header.note || '');
      setStatus(res.report.header.status);
      // 기존 저장분 중 자동값과 다른 closing 은 수동수정으로 간주(차이 배지 노출).
      const manual = new Set<number>();
      l.forEach((line, i) => { if (num(line.closing_stock) !== autoClosing(line)) manual.add(i); });
      setManualClosing(manual);
    } else {
      const tpl = await getReportTemplate(branchId, reportDate);
      if (tpl.error) { setError(tpl.error); setLines([]); setStatus(null); setLoading(false); return; }
      setLines(tpl.template?.lines || []);
      setNote('');
      setStatus(null);
    }
    setLoading(false);
  }, [branchId, reportDate]);

  useEffect(() => { load(); }, [load]);

  // 라인 필드 변경 — 수동수정 안 한 라인은 closing_stock 을 자동값으로 유지.
  const updateLine = (i: number, field: keyof DailyReportLineInput, value: string) => {
    setLines(prev => {
      const next = [...prev];
      const line = { ...next[i], [field]: field === 'product_name' || field === 'product_code' ? value : num(value) } as DailyReportLineInput;
      if (field !== 'closing_stock' && !manualClosing.has(i)) {
        line.closing_stock = autoClosing(line);   // 자동 추종
      }
      next[i] = line;
      return next;
    });
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

  const removeLine = (i: number) => {
    setLines(prev => prev.filter((_, idx) => idx !== i));
    setManualClosing(prev => {
      const n = new Set<number>();
      prev.forEach(idx => { if (idx < i) n.add(idx); else if (idx > i) n.add(idx - 1); });
      return n;
    });
  };

  const addLine = () => {
    setLines(prev => [...prev, {
      product_id: null, product_code: null, product_name: '', unit_price: 0,
      opening_stock: 0, onsite_sold: 0, sample_damage: 0, in_return: 0, closing_stock: 0,
      hq_parcel: 0, onsite_revenue: 0, parcel_revenue: 0, sort_order: prev.length,
    }]);
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

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-28">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-bold text-slate-800">📝 판매일보</h1>
        {status && (
          <span className={`badge text-[11px] ${status === 'SUBMITTED' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
            {status === 'SUBMITTED' ? '제출완료' : '임시저장'}
          </span>
        )}
      </div>

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

      {loading ? (
        <div className="text-center py-12 text-slate-400">불러오는 중...</div>
      ) : lines.length === 0 ? (
        <div className="card text-center py-10 text-slate-400 text-sm">
          취급 품목이 없습니다. 아래 [품목 추가]로 직접 입력하세요.
        </div>
      ) : (
        <div className="space-y-3">
          {lines.map((l, i) => {
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
                  <button onClick={() => removeLine(i)} className="text-slate-300 hover:text-red-500 text-lg leading-none px-1" title="라인 삭제">×</button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <NumField label="오픈재고" value={l.opening_stock} onChange={v => updateLine(i, 'opening_stock', v)} />
                  <NumField label="입고/반품" value={l.in_return} onChange={v => updateLine(i, 'in_return', v)} />
                  <NumField label="현장판매" value={l.onsite_sold} onChange={v => updateLine(i, 'onsite_sold', v)} />
                  <NumField label="시음증정/파손" value={l.sample_damage} onChange={v => updateLine(i, 'sample_damage', v)} />
                </div>

                {/* 마감재고 — 자동 또는 수동 */}
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">마감재고</span>
                    <button onClick={() => toggleManual(i)} className="text-[11px] text-blue-600 underline">
                      {isManual ? '자동으로' : '직접 수정'}
                    </button>
                  </div>
                  {isManual ? (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="number" inputMode="decimal" step="any"
                        value={l.closing_stock}
                        onChange={e => updateLine(i, 'closing_stock', e.target.value)}
                        className="input text-sm w-28 font-semibold"
                      />
                      {diff !== 0 && (
                        <span className={`badge text-[10px] ${diff > 0 ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                          자동 {auto} ({diff > 0 ? '+' : ''}{diff})
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-base font-semibold text-slate-800 mt-0.5">{auto}</p>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <NumField label="현장매출" value={l.onsite_revenue} onChange={v => updateLine(i, 'onsite_revenue', v)} won />
                  <NumField label="본사택배" value={l.hq_parcel} onChange={v => updateLine(i, 'hq_parcel', v)} />
                  <NumField label="택배매출" value={l.parcel_revenue} onChange={v => updateLine(i, 'parcel_revenue', v)} won />
                </div>
              </div>
            );
          })}
          <button onClick={addLine} className="btn-secondary text-sm w-full py-2">+ 품목 추가</button>
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

      {/* 하단 고정 저장 버튼 */}
      {!loading && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3 flex gap-2 max-w-2xl mx-auto">
          <button onClick={() => save('DRAFT')} disabled={saving} className="btn-secondary flex-1 py-2.5 disabled:opacity-40">임시저장</button>
          <button onClick={() => save('SUBMITTED')} disabled={saving} className="btn-primary flex-1 py-2.5 disabled:opacity-40">제출</button>
        </div>
      )}
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
