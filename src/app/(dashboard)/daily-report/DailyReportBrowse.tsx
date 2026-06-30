'use client';

// 판매일보 조회(#93 Phase1) — 날짜 범위·지점·상태로 과거 일보 브라우징 + 변경 이력 열람.
import { useState, useEffect, useCallback } from 'react';
import { listDailyReportsRange, getDailyReportRevisions } from '@/lib/daily-report-actions';

interface Props {
  branches: { id: string; name: string }[];
  onOpen: (branchId: string, reportDate: string) => void;   // 입력 탭에서 열기
}

const STATUS_LABEL: Record<string, string> = { DRAFT: '임시', SUBMITTED: '제출', APPROVED: '승인' };
const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600', SUBMITTED: 'bg-blue-100 text-blue-700', APPROVED: 'bg-green-100 text-green-700',
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const off = 9 * 60;
  const k = new Date(d.getTime() + (off - d.getTimezoneOffset()) * 60000);
  return k.toISOString().slice(0, 10);
}

export default function DailyReportBrowse({ branches, onOpen }: Props) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [branchId, setBranchId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [revFor, setRevFor] = useState<any | null>(null);   // 변경이력 대상 row
  const [revs, setRevs] = useState<any[]>([]);
  const [revLoading, setRevLoading] = useState(false);

  useEffect(() => { setFrom(isoDaysAgo(30)); setTo(isoDaysAgo(0)); }, []);

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true); setErr(null);
    const res = await listDailyReportsRange({ from, to, branchId: branchId || undefined, status: statusFilter || undefined });
    if (res.error) { setErr(res.error); setRows([]); } else { setRows(res.rows || []); }
    setLoading(false);
  }, [from, to, branchId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const openRevisions = async (row: any) => {
    setRevFor(row); setRevLoading(true); setRevs([]);
    const res = await getDailyReportRevisions(row.report_id);
    setRevLoading(false);
    if (res.error) { alert(res.error); return; }
    setRevs(res.rows || []);
  };

  return (
    <div className="space-y-4">
      {/* 필터 */}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-slate-500 mb-1">~부터</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">~까지</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">지점</label>
          <select value={branchId} onChange={e => setBranchId(e.target.value)} className="input text-sm py-1.5">
            <option value="">전체</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">상태</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input text-sm py-1.5">
            <option value="">전체</option>
            <option value="DRAFT">임시</option>
            <option value="SUBMITTED">제출</option>
            <option value="APPROVED">승인</option>
          </select>
        </div>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}
      {loading ? (
        <p className="text-center text-slate-400 py-8 text-sm">불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="text-center text-slate-400 py-8 text-sm">해당 조건의 판매일보가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="table text-sm w-full min-w-[640px]">
            <thead>
              <tr className="bg-slate-50 text-[11px] text-slate-500 uppercase">
                <th className="px-3 py-2 text-left">일자</th>
                <th className="px-3 py-2 text-left">지점</th>
                <th className="px-3 py-2 text-left">상태</th>
                <th className="px-3 py-2 text-right">당일매출</th>
                <th className="px-3 py-2 text-left">작성자</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.report_id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap font-medium">{r.report_date}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.branch_name}</td>
                  <td className="px-3 py-2"><span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${STATUS_BADGE[r.status] || ''}`}>{STATUS_LABEL[r.status] || r.status}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(r.daily_total || 0).toLocaleString()}원</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{r.author_name || '-'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => openRevisions(r)} className="text-xs text-slate-500 hover:underline mr-2">변경이력</button>
                    <button onClick={() => onOpen(r.branch_id, r.report_date)} className="text-xs text-blue-600 hover:underline">열기</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 변경 이력 모달 */}
      {revFor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setRevFor(null)}>
          <div className="bg-white rounded-lg w-full max-w-lg max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-5 py-3 border-b">
              <div>
                <h2 className="font-bold">변경 이력</h2>
                <p className="text-sm text-slate-500 mt-0.5">{revFor.report_date} · {revFor.branch_name}</p>
              </div>
              <button onClick={() => setRevFor(null)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="p-5">
              {revLoading ? (
                <p className="text-center text-slate-400 py-6 text-sm">불러오는 중...</p>
              ) : revs.length === 0 ? (
                <p className="text-center text-slate-400 py-6 text-sm">변경 이력이 없습니다. (제출 후 재수정 시 직전 상태가 기록됩니다)</p>
              ) : (
                <ul className="space-y-3">
                  {revs.map(rv => {
                    const lineCount = Array.isArray(rv.snapshot?.lines) ? rv.snapshot.lines.length : 0;
                    return (
                      <li key={rv.id} className="rounded border border-slate-200 p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500 text-xs">{(rv.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                          <span className="text-slate-600">{rv.edited_by_name || '-'}</span>
                        </div>
                        <p className="mt-1">직전 당일매출 <b>{Number(rv.daily_total || 0).toLocaleString()}원</b> · 품목 {lineCount}건</p>
                        {rv.change_note && <p className="text-xs text-slate-500 mt-1">사유: {rv.change_note}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="px-5 py-3 border-t flex justify-end">
              <button onClick={() => setRevFor(null)} className="btn-primary text-sm">닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
