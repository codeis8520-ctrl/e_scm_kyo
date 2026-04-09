'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  getProfitLoss,
  getJournalEntries,
  getLedger,
  getGLAccounts,
  createJournalEntry,
  getVatReport,
  getGlBalances,
  closePeriod,
  reopenPeriod,
  getClosedPeriods,
} from '@/lib/accounting-actions';

type Tab = 'pl' | 'journal' | 'ledger' | 'manual' | 'vat' | 'gl_balance';

function getMonth(offset = 0): { start: string; end: string } {
  const d = new Date();
  d.setMonth(d.getMonth() + offset, 1);
  const start = d.toISOString().slice(0, 10);
  d.setMonth(d.getMonth() + 1, 0);
  const end = d.toISOString().slice(0, 10);
  return { start, end };
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  ASSET: '자산', LIABILITY: '부채', EQUITY: '자본',
  REVENUE: '매출', COGS: '매출원가', EXPENSE: '비용',
};
const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  ASSET: 'text-blue-700', LIABILITY: 'text-red-600', EQUITY: 'text-purple-700',
  REVENUE: 'text-green-700', COGS: 'text-orange-600', EXPENSE: 'text-rose-600',
};
const SOURCE_LABELS: Record<string, string> = {
  SALE: '매출', PURCHASE_RECEIPT: '매입', RETURN: '환불', MANUAL: '수동입력',
};

export default function AccountingPage() {
  const [tab, setTab] = useState<Tab>('pl');
  const [branches, setBranches] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // P&L
  const [plRange, setPlRange] = useState(getMonth(0));
  const [plBranch, setPlBranch] = useState('');
  const [pl, setPl] = useState<any>(null);

  // Journal
  const [journalRange, setJournalRange] = useState(getMonth(0));
  const [journalSource, setJournalSource] = useState('');
  const [journals, setJournals] = useState<any[]>([]);
  const [expandedJournal, setExpandedJournal] = useState<Set<string>>(new Set());

  // Ledger
  const [ledgerAccount, setLedgerAccount] = useState('');
  const [ledgerRange, setLedgerRange] = useState(getMonth(0));
  const [ledgerRows, setLedgerRows] = useState<any[]>([]);

  // Manual entry
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10));
  const [manualDesc, setManualDesc] = useState('');
  const [manualLines, setManualLines] = useState([
    { account_id: '', debit: '', credit: '', memo: '' },
    { account_id: '', debit: '', credit: '', memo: '' },
  ]);
  const [manualError, setManualError] = useState('');
  const [manualLoading, setManualLoading] = useState(false);

  useEffect(() => {
    const sb = createClient() as any;
    sb.from('branches').select('id, name').eq('is_active', true).order('name')
      .then(({ data }: any) => setBranches(data || []));
    getGLAccounts().then(r => setAccounts(r.data || []));
  }, []);

  // ── P&L 조회
  const fetchPL = useCallback(async () => {
    setLoading(true);
    const result = await getProfitLoss(plRange.start, plRange.end, plBranch || undefined);
    setPl(result);
    setLoading(false);
  }, [plRange, plBranch]);

  // ── 분개장 조회
  const fetchJournals = useCallback(async () => {
    setLoading(true);
    const result = await getJournalEntries({
      startDate: journalRange.start,
      endDate: journalRange.end,
      sourceType: journalSource || undefined,
    });
    setJournals(result.data || []);
    setLoading(false);
  }, [journalRange, journalSource]);

  // ── 원장 조회
  const fetchLedger = useCallback(async () => {
    if (!ledgerAccount) return;
    setLoading(true);
    const result = await getLedger(ledgerAccount, ledgerRange.start, ledgerRange.end);
    setLedgerRows(result.data || []);
    setLoading(false);
  }, [ledgerAccount, ledgerRange]);

  useEffect(() => { if (tab === 'pl') fetchPL(); }, [tab, fetchPL]);
  useEffect(() => { if (tab === 'journal') fetchJournals(); }, [tab, fetchJournals]);
  useEffect(() => { if (tab === 'ledger') fetchLedger(); }, [tab, fetchLedger]);

  const toggleJournal = (id: string) => {
    setExpandedJournal(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const updateManualLine = (idx: number, field: string, val: string) => {
    setManualLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: val } : l));
  };
  const addManualLine = () => setManualLines(prev => [...prev, { account_id: '', debit: '', credit: '', memo: '' }]);
  const removeManualLine = (idx: number) => setManualLines(prev => prev.filter((_, i) => i !== idx));

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualError('');
    const lines = manualLines
      .filter(l => l.account_id && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0))
      .map(l => ({
        account_id: l.account_id,
        debit: parseFloat(l.debit) || 0,
        credit: parseFloat(l.credit) || 0,
        memo: l.memo,
      }));

    const fd = new FormData();
    fd.append('entry_date', manualDate);
    fd.append('description', manualDesc);
    fd.append('lines', JSON.stringify(lines));

    setManualLoading(true);
    const result = await createJournalEntry(fd);
    setManualLoading(false);

    if (result.error) { setManualError(result.error); return; }
    setManualDesc('');
    setManualLines([
      { account_id: '', debit: '', credit: '', memo: '' },
      { account_id: '', debit: '', credit: '', memo: '' },
    ]);
    alert(`분개 등록 완료: ${result.entryNumber}`);
    if (tab === 'journal') fetchJournals();
  };

  const totalDebit  = manualLines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0);
  const totalCredit = manualLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  const TABS: { key: Tab; label: string }[] = [
    { key: 'pl', label: '손익계산서' },
    { key: 'journal', label: '분개장' },
    { key: 'ledger', label: '총계정원장' },
    { key: 'vat', label: '부가세' },
    { key: 'gl_balance', label: 'GL 잔액' },
    { key: 'manual', label: '수동 분개' },
  ];

  return (
    <div className="space-y-5">
      {/* 탭 */}
      <div className="overflow-x-auto">
      <div className="flex gap-1 border-b border-slate-200 whitespace-nowrap">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      </div>

      {/* ── 손익계산서 ── */}
      {tab === 'pl' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-start sm:items-center">
            <input type="date" value={plRange.start} onChange={e => setPlRange(r => ({ ...r, start: e.target.value }))} className="input w-36" />
            <span className="text-slate-400">~</span>
            <input type="date" value={plRange.end} onChange={e => setPlRange(r => ({ ...r, end: e.target.value }))} className="input w-36" />
            <select value={plBranch} onChange={e => setPlBranch(e.target.value)} className="input w-40">
              <option value="">전체 지점</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button onClick={fetchPL} className="btn-primary px-5">조회</button>
            {[0, -1, -2].map(offset => {
              const { start, end } = getMonth(offset);
              const d = new Date(); d.setMonth(d.getMonth() + offset);
              const label = offset === 0 ? '이번달' : offset === -1 ? '지난달' : `${d.getMonth() + 1}월`;
              return (
                <button key={offset} onClick={() => setPlRange({ start, end })}
                  className="text-xs text-blue-600 hover:underline">{label}</button>
              );
            })}
          </div>

          {loading ? (
            <div className="text-center py-12 text-slate-400">계산 중...</div>
          ) : pl && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 손익계산서 */}
              <div className="card">
                <h2 className="font-bold text-slate-800 mb-5">손익계산서</h2>
                <div className="space-y-1 text-sm">
                  <Row label="총 매출" value={pl.grossRevenue} />
                  <Row label="  (-) 포인트 할인" value={-pl.totalDiscount} indent />
                  <Row label="  (-) 환불" value={-pl.totalRefunds} indent />
                  <Divider />
                  <Row label="순매출" value={pl.netRevenue} bold />
                  <Row label="  (-) 매출원가" value={-pl.cogs} indent />
                  <Divider />
                  <Row
                    label="매출총이익"
                    value={pl.grossProfit}
                    bold
                    highlight={pl.grossProfit >= 0 ? 'text-green-700' : 'text-red-600'}
                  />
                  <div className="text-right text-xs text-slate-400 mt-1">
                    매출총이익률 {pl.grossMargin}%
                  </div>
                </div>
              </div>

              {/* 영업 현황 요약 */}
              <div className="space-y-4">
                <div className="card">
                  <h2 className="font-bold text-slate-800 mb-4">영업 현황</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <StatBox label="완료 주문" value={`${pl.orderCount}건`} color="text-blue-700" />
                    <StatBox label="환불 건수" value={`${pl.refundCount}건`} color="text-red-600" />
                    <StatBox label="순매출" value={`${pl.netRevenue.toLocaleString()}원`} color="text-green-700" />
                    <StatBox label="이익률" value={`${pl.grossMargin}%`} color={pl.grossMargin >= 0 ? 'text-green-700' : 'text-red-600'} />
                  </div>
                </div>
                <div className="card">
                  <h2 className="font-bold text-slate-800 mb-4">매입 현황</h2>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">기간 내 발주액</span>
                      <span className="font-medium">{pl.totalPurchases.toLocaleString()}원</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">원가 기준 매출원가</span>
                      <span className="font-medium">{pl.cogs.toLocaleString()}원</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 분개장 ── */}
      {tab === 'journal' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <input type="date" value={journalRange.start} onChange={e => setJournalRange(r => ({ ...r, start: e.target.value }))} className="input w-36" />
            <span className="text-slate-400 self-center">~</span>
            <input type="date" value={journalRange.end} onChange={e => setJournalRange(r => ({ ...r, end: e.target.value }))} className="input w-36" />
            <select value={journalSource} onChange={e => setJournalSource(e.target.value)} className="input w-36">
              <option value="">전체 유형</option>
              {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button onClick={fetchJournals} className="btn-primary px-5">조회</button>
          </div>

          <div className="card">
            {loading ? (
              <div className="text-center py-10 text-slate-400">로딩 중...</div>
            ) : journals.length === 0 ? (
              <div className="text-center py-10 text-slate-400">분개 내역이 없습니다</div>
            ) : (
              <div className="space-y-1">
                {journals.map(j => {
                  const expanded = expandedJournal.has(j.id);
                  return (
                    <div key={j.id} className="border border-slate-100 rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleJournal(j.id)}
                        className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-slate-50 text-left"
                      >
                        <div className="flex items-center gap-4">
                          <span className="text-slate-400 text-xs">{expanded ? '▼' : '▶'}</span>
                          <span className="font-mono text-sm text-blue-700 font-medium">{j.entry_number}</span>
                          <span className="text-sm text-slate-500">{j.entry_date}</span>
                          <span className="text-sm">{j.description}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          {j.source_type && (
                            <span className="text-xs px-2 py-0.5 bg-slate-100 rounded text-slate-500">
                              {SOURCE_LABELS[j.source_type] || j.source_type}
                            </span>
                          )}
                          <span className="text-sm font-semibold">{j.total_debit.toLocaleString()}원</span>
                        </div>
                      </button>
                      {expanded && (
                        <div className="border-t bg-slate-50 px-4 py-3">
                          <div className="overflow-x-auto">
                          <table className="table text-sm w-full min-w-[400px]">
                            <thead>
                              <tr>
                                <th>계정</th>
                                <th className="text-right w-32">차변</th>
                                <th className="text-right w-32">대변</th>
                                <th>적요</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(j.lines || []).map((line: any) => (
                                <tr key={line.id}>
                                  <td>
                                    <span className="text-slate-400 font-mono text-xs mr-2">{line.account?.code}</span>
                                    <span className={ACCOUNT_TYPE_COLORS[line.account?.account_type] || ''}>{line.account?.name}</span>
                                  </td>
                                  <td className="text-right">{line.debit > 0 ? line.debit.toLocaleString() : ''}</td>
                                  <td className="text-right">{line.credit > 0 ? line.credit.toLocaleString() : ''}</td>
                                  <td className="text-slate-500 text-xs">{line.memo}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-slate-100">
                                <td className="font-semibold pr-4 text-right">합계</td>
                                <td className="text-right font-bold">{j.total_debit.toLocaleString()}</td>
                                <td className="text-right font-bold">{j.total_credit.toLocaleString()}</td>
                                <td></td>
                              </tr>
                            </tfoot>
                          </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 총계정원장 ── */}
      {tab === 'ledger' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <select value={ledgerAccount} onChange={e => setLedgerAccount(e.target.value)} className="input w-56">
              <option value="">계정 선택</option>
              {accounts.map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name} ({ACCOUNT_TYPE_LABELS[a.account_type]})
                </option>
              ))}
            </select>
            <input type="date" value={ledgerRange.start} onChange={e => setLedgerRange(r => ({ ...r, start: e.target.value }))} className="input w-36" />
            <span className="text-slate-400 self-center">~</span>
            <input type="date" value={ledgerRange.end} onChange={e => setLedgerRange(r => ({ ...r, end: e.target.value }))} className="input w-36" />
            <button onClick={fetchLedger} disabled={!ledgerAccount} className="btn-primary px-5">조회</button>
          </div>

          {ledgerAccount && (
            <div className="card overflow-x-auto">
              {loading ? (
                <div className="text-center py-10 text-slate-400">로딩 중...</div>
              ) : ledgerRows.length === 0 ? (
                <div className="text-center py-10 text-slate-400">해당 계정의 거래 내역이 없습니다</div>
              ) : (
                <table className="table min-w-[500px]">
                  <thead>
                    <tr>
                      <th>일자</th>
                      <th>전표번호</th>
                      <th>적요</th>
                      <th className="text-right">차변</th>
                      <th className="text-right">대변</th>
                      <th className="text-right">잔액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerRows.map((row: any) => (
                      <tr key={row.id}>
                        <td className="text-sm">{row.entry?.entry_date}</td>
                        <td className="font-mono text-xs text-blue-700">{row.entry?.entry_number}</td>
                        <td className="text-sm">{row.memo || row.entry?.description}</td>
                        <td className="text-right text-sm">{row.debit > 0 ? row.debit.toLocaleString() : ''}</td>
                        <td className="text-right text-sm">{row.credit > 0 ? row.credit.toLocaleString() : ''}</td>
                        <td className={`text-right font-semibold text-sm ${row.balance < 0 ? 'text-red-600' : ''}`}>
                          {row.balance.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50">
                      <td colSpan={3} className="font-semibold text-right pr-4">합계 / 잔액</td>
                      <td className="text-right font-bold">
                        {ledgerRows.reduce((s: number, r: any) => s + r.debit, 0).toLocaleString()}
                      </td>
                      <td className="text-right font-bold">
                        {ledgerRows.reduce((s: number, r: any) => s + r.credit, 0).toLocaleString()}
                      </td>
                      <td className="text-right font-bold text-blue-700">
                        {ledgerRows.at(-1)?.balance?.toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── 부가세 신고 ── */}
      {tab === 'vat' && <VatReportTab />}

      {/* ── GL 잔액 ── */}
      {tab === 'gl_balance' && <GlBalanceTab />}

      {/* ── 수동 분개 ── */}
      {tab === 'manual' && (
        <div className="max-w-3xl">
          <form onSubmit={handleManualSubmit} className="card space-y-5">
            <h2 className="font-bold text-slate-800">수동 분개 입력</h2>

            {manualError && (
              <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{manualError}</div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">전표 일자</label>
                <input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)} className="input" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">적요</label>
                <input value={manualDesc} onChange={e => setManualDesc(e.target.value)} className="input" placeholder="거래 내용 요약" required />
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden overflow-x-auto">
              <table className="table min-w-[500px]">
                <thead>
                  <tr>
                    <th>계정과목</th>
                    <th className="w-32 text-right">차변</th>
                    <th className="w-32 text-right">대변</th>
                    <th className="w-40">적요</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {manualLines.map((line, idx) => (
                    <tr key={idx}>
                      <td>
                        <select
                          value={line.account_id}
                          onChange={e => updateManualLine(idx, 'account_id', e.target.value)}
                          className="input text-sm"
                          required={!!(line.debit || line.credit)}
                        >
                          <option value="">선택</option>
                          {Object.entries(
                            accounts.reduce((g: any, a: any) => {
                              (g[a.account_type] = g[a.account_type] || []).push(a);
                              return g;
                            }, {})
                          ).map(([type, accs]: [string, any]) => (
                            <optgroup key={type} label={ACCOUNT_TYPE_LABELS[type]}>
                              {accs.map((a: any) => (
                                <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number" min={0} value={line.debit}
                          onChange={e => {
                            updateManualLine(idx, 'debit', e.target.value);
                            if (e.target.value) updateManualLine(idx, 'credit', '');
                          }}
                          onFocus={e => e.target.select()}
                          className="input text-right w-28"
                          placeholder="0"
                        />
                      </td>
                      <td>
                        <input
                          type="number" min={0} value={line.credit}
                          onChange={e => {
                            updateManualLine(idx, 'credit', e.target.value);
                            if (e.target.value) updateManualLine(idx, 'debit', '');
                          }}
                          onFocus={e => e.target.select()}
                          className="input text-right w-28"
                          placeholder="0"
                        />
                      </td>
                      <td>
                        <input value={line.memo} onChange={e => updateManualLine(idx, 'memo', e.target.value)}
                          className="input text-sm w-36" />
                      </td>
                      <td>
                        {manualLines.length > 2 && (
                          <button type="button" onClick={() => removeManualLine(idx)}
                            className="text-red-400 hover:text-red-600 text-lg">×</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50">
                    <td className="text-right font-semibold pr-4">합계</td>
                    <td className="text-right font-bold">{totalDebit.toLocaleString()}</td>
                    <td className="text-right font-bold">{totalCredit.toLocaleString()}</td>
                    <td colSpan={2}>
                      {totalDebit > 0 && (
                        <span className={`text-xs ml-2 ${balanced ? 'text-green-600' : 'text-red-500'}`}>
                          {balanced ? '✓ 대차 일치' : `차액: ${Math.abs(totalDebit - totalCredit).toLocaleString()}`}
                        </span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={addManualLine} className="btn-secondary text-sm px-4">
                + 라인 추가
              </button>
              <button
                type="submit"
                disabled={manualLoading || !balanced}
                className="btn-primary px-6 disabled:opacity-50"
              >
                {manualLoading ? '저장 중...' : '분개 저장'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ─── 서브 컴포넌트 ─────────────────────────────────────────────

function Row({ label, value, indent, bold, highlight }: {
  label: string; value: number; indent?: boolean; bold?: boolean; highlight?: string;
}) {
  return (
    <div className={`flex justify-between py-1 ${indent ? 'pl-4 text-slate-500' : ''}`}>
      <span className={bold ? 'font-semibold text-slate-800' : ''}>{label}</span>
      <span className={`font-mono ${bold ? 'font-bold' : ''} ${highlight || ''}`}>
        {value.toLocaleString()}원
      </span>
    </div>
  );
}

function Divider() {
  return <hr className="my-1 border-slate-200" />;
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3 text-center">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`font-bold ${color || 'text-slate-800'}`}>{value}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 부가세 신고 탭
// ═══════════════════════════════════════════════════════════════════════

function VatReportTab() {
  const [range, setRange] = useState(getMonth(0));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [closedPeriods, setClosedPeriods] = useState<any[]>([]);
  const [closingPeriod, setClosingPeriod] = useState('');

  const fetchVat = async () => {
    setLoading(true);
    const [res, cpRes] = await Promise.all([
      getVatReport({ startDate: range.start, endDate: range.end }),
      getClosedPeriods(),
    ]);
    setData(res);
    setClosedPeriods(cpRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchVat(); }, [range.start, range.end]);

  const currentPeriod = range.start.slice(0, 7); // YYYY-MM
  const isClosed = closedPeriods.some(p => p.period === currentPeriod);

  const handleClose = async () => {
    if (!confirm(`${currentPeriod} 기간을 마감하시겠습니까?\n마감 후에는 해당 월의 분개를 수정할 수 없습니다.`)) return;
    const res = await closePeriod(currentPeriod);
    if (res.error) alert(res.error);
    else fetchVat();
  };

  const handleReopen = async () => {
    if (!confirm(`${currentPeriod} 기간을 재개하시겠습니까? (최고관리자만)`)) return;
    const res = await reopenPeriod(currentPeriod);
    if (res.error) alert(res.error);
    else fetchVat();
  };

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">시작일</label>
          <input type="date" value={range.start} onChange={e => setRange(r => ({ ...r, start: e.target.value }))} className="input text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">종료일</label>
          <input type="date" value={range.end} onChange={e => setRange(r => ({ ...r, end: e.target.value }))} className="input text-sm py-1.5" />
        </div>
        <button onClick={fetchVat} disabled={loading} className="btn-primary text-sm py-1.5">
          {loading ? '조회 중...' : '조회'}
        </button>
        <div className="ml-auto flex gap-2">
          {isClosed ? (
            <button onClick={handleReopen} className="px-3 py-1.5 rounded text-xs bg-amber-100 text-amber-700 hover:bg-amber-200">
              🔓 {currentPeriod} 재개
            </button>
          ) : (
            <button onClick={handleClose} className="px-3 py-1.5 rounded text-xs bg-red-100 text-red-700 hover:bg-red-200">
              🔒 {currentPeriod} 마감
            </button>
          )}
        </div>
      </div>

      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBox label="매출 부가세 (예수금)" value={`${(data.outputVat.net || 0).toLocaleString()}원`} color="text-red-600" />
            <StatBox label="매입 부가세 (대급금)" value={`${(data.inputVat.net || 0).toLocaleString()}원`} color="text-blue-600" />
            <StatBox
              label={data.vatPayable >= 0 ? '납부 세액' : '환급 세액'}
              value={`${Math.abs(data.vatPayable || 0).toLocaleString()}원`}
              color={data.vatPayable >= 0 ? 'text-red-700 text-xl' : 'text-blue-700 text-xl'}
            />
            <StatBox label="기간" value={data.period} />
          </div>

          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>구분</th>
                  <th className="text-right">대변 (발생)</th>
                  <th className="text-right">차변 (취소/환급)</th>
                  <th className="text-right">순액</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-medium">매출 부가세 (2151 예수금)</td>
                  <td className="text-right">{(data.outputVat.credit || 0).toLocaleString()}원</td>
                  <td className="text-right">{(data.outputVat.debit || 0).toLocaleString()}원</td>
                  <td className="text-right font-semibold text-red-600">{(data.outputVat.net || 0).toLocaleString()}원</td>
                </tr>
                <tr>
                  <td className="font-medium">매입 부가세 (1150 대급금)</td>
                  <td className="text-right">{(data.inputVat.debit || 0).toLocaleString()}원</td>
                  <td className="text-right">{(data.inputVat.credit || 0).toLocaleString()}원</td>
                  <td className="text-right font-semibold text-blue-600">{(data.inputVat.net || 0).toLocaleString()}원</td>
                </tr>
                <tr className="bg-slate-50 font-bold">
                  <td>{data.vatPayable >= 0 ? '납부 세액' : '환급 세액'}</td>
                  <td></td>
                  <td></td>
                  <td className={`text-right text-lg ${data.vatPayable >= 0 ? 'text-red-700' : 'text-blue-700'}`}>
                    {data.vatPayable >= 0 ? '' : '△ '}{Math.abs(data.vatPayable || 0).toLocaleString()}원
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="text-xs text-slate-400">
            납부 세액 = 매출 부가세(예수금) − 매입 부가세(대급금).
            양수면 납부, 음수면 환급 대상입니다. 부가세 신고 시 참고자료로 활용하세요.
          </p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// GL 계정 잔액 탭
// ═══════════════════════════════════════════════════════════════════════

const TYPE_ORDER = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COGS', 'EXPENSE'];
const ACCOUNT_TYPE_LABELS_SHORT: Record<string, string> = {
  ASSET: '자산', LIABILITY: '부채', EQUITY: '자본',
  REVENUE: '매출', COGS: '매출원가', EXPENSE: '비용',
};

function GlBalanceTab() {
  const [range, setRange] = useState(getMonth(0));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetch_ = async () => {
    setLoading(true);
    const res = await getGlBalances({ startDate: range.start, endDate: range.end });
    setData(res);
    setLoading(false);
  };

  useEffect(() => { fetch_(); }, [range.start, range.end]);

  // 유형별 그룹
  const grouped = TYPE_ORDER.map(type => ({
    type,
    label: ACCOUNT_TYPE_LABELS_SHORT[type] || type,
    accounts: (data?.accounts || []).filter((a: any) => a.type === type),
    subtotal: (data?.accounts || []).filter((a: any) => a.type === type).reduce((s: number, a: any) => s + a.balance, 0),
  })).filter(g => g.accounts.length > 0);

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">시작일</label>
          <input type="date" value={range.start} onChange={e => setRange(r => ({ ...r, start: e.target.value }))} className="input text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">종료일</label>
          <input type="date" value={range.end} onChange={e => setRange(r => ({ ...r, end: e.target.value }))} className="input text-sm py-1.5" />
        </div>
        <button onClick={fetch_} disabled={loading} className="btn-primary text-sm py-1.5">{loading ? '조회 중...' : '조회'}</button>
      </div>

      {data && (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>코드</th>
                <th>계정명</th>
                <th>유형</th>
                <th className="text-right">차변 합계</th>
                <th className="text-right">대변 합계</th>
                <th className="text-right">잔액</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(g => (
                <Fragment key={g.type}>
                  {g.accounts.map((a: any) => (
                    <tr key={a.code}>
                      <td className="font-mono text-sm">{a.code}</td>
                      <td className="font-medium">{a.name}</td>
                      <td className="text-xs text-slate-500">{g.label}</td>
                      <td className="text-right text-sm">{a.debit.toLocaleString()}</td>
                      <td className="text-right text-sm">{a.credit.toLocaleString()}</td>
                      <td className={`text-right font-semibold ${a.balance >= 0 ? '' : 'text-red-600'}`}>
                        {a.balance.toLocaleString()}원
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50">
                    <td colSpan={5} className="text-right font-semibold text-sm">{g.label} 소계</td>
                    <td className={`text-right font-bold ${g.subtotal >= 0 ? '' : 'text-red-600'}`}>
                      {g.subtotal.toLocaleString()}원
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
