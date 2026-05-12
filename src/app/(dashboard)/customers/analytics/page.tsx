'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import {
  getRfmAnalysis, getRepurchaseCycles, getChurnRiskCustomers,
} from '@/lib/customer-analytics-actions';
import { SEGMENT_META, type RfmSegment } from '@/lib/customer-analytics-types';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  return document.cookie.split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    acc[k] = decodeURIComponent(v || '');
    return acc;
  }, {} as Record<string, string>)[name] || null;
}

const GRADE_LABELS: Record<string, string> = { VVIP: 'VVIP', VIP: 'VIP', NORMAL: '일반' };
const GRADE_BADGE: Record<string, string> = {
  VVIP:   'bg-red-100 text-red-700',
  VIP:    'bg-amber-100 text-amber-700',
  NORMAL: 'bg-slate-100 text-slate-600',
};

export default function CustomerAnalyticsPage() {
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [userRole] = useState(() => getCookie('user_role'));
  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';

  const [tab, setTab] = useState<'rfm' | 'cycle' | 'churn'>('rfm');

  // RFM
  const [rfmData, setRfmData]           = useState<any[]>([]);
  const [segmentSummary, setSegmentSummary] = useState<any[]>([]);
  const [rfmFilter, setRfmFilter]       = useState<RfmSegment | ''>('');
  const [rfmLoading, setRfmLoading]     = useState(false);

  // 재구매 주기
  const [cycleData, setCycleData]       = useState<any>(null);
  const [cycleLoading, setCycleLoading] = useState(false);

  // 이탈 위험
  const [churnData, setChurnData]       = useState<any[]>([]);
  const [churnLoading, setChurnLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient() as any;
    supabase.from('branches').select('id, name').eq('is_active', true).order('name').then(({ data }: any) => {
      setBranches(data || []);
      const cookieBranch = getCookie('user_branch_id');
      if (isBranchUser && cookieBranch) setSelectedBranch(cookieBranch);
    });
  }, [isBranchUser]);

  const loadRfm = useCallback(async () => {
    setRfmLoading(true);
    try {
      const r = await getRfmAnalysis(selectedBranch || undefined);
      setRfmData(r.data || []);
      setSegmentSummary(r.segmentSummary || []);
    } catch (e) {
      console.error('RFM 분석 오류:', e);
    } finally {
      setRfmLoading(false);
    }
  }, [selectedBranch]);

  const loadCycle = useCallback(async () => {
    setCycleLoading(true);
    try {
      const r = await getRepurchaseCycles(selectedBranch || undefined);
      setCycleData(r);
    } catch (e) {
      console.error('재구매 주기 분석 오류:', e);
    } finally {
      setCycleLoading(false);
    }
  }, [selectedBranch]);

  const loadChurn = useCallback(async () => {
    setChurnLoading(true);
    try {
      const r = await getChurnRiskCustomers(selectedBranch || undefined);
      setChurnData(r.data || []);
    } catch (e) {
      console.error('이탈 위험 분석 오류:', e);
    } finally {
      setChurnLoading(false);
    }
  }, [selectedBranch]);

  useEffect(() => { if (tab === 'rfm')   loadRfm();   }, [tab, loadRfm]);
  useEffect(() => { if (tab === 'cycle') loadCycle(); }, [tab, loadCycle]);
  useEffect(() => { if (tab === 'churn') loadChurn(); }, [tab, loadChurn]);

  const filteredRfm = rfmFilter
    ? rfmData.filter(r => r.segment === rfmFilter)
    : rfmData.filter(r => r.orderCount > 0);

  const maxCycleCount = cycleData
    ? Math.max(...(cycleData.distribution || []).map((d: any) => d.count), 1)
    : 1;

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/customers" className="text-slate-400 hover:text-slate-600 text-sm">← 고객 목록</Link>
          </div>
          <h1 className="text-xl font-bold text-slate-800">고객 분석</h1>
          <p className="text-sm text-slate-500">RFM 세그멘테이션 · 재구매 주기 · 이탈 위험</p>
          <p className="text-[11px] text-slate-400 mt-1">
            분석 데이터: 신규 판매(sales_orders, COMPLETED) + 과거 구매(legacy_purchases) 통합
          </p>
        </div>
        {!isBranchUser && (
          <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} className="input text-sm py-1.5 w-44">
            <option value="">전체 지점</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      {/* 탭 */}
      <div className="flex overflow-x-auto gap-1 border-b border-slate-200">
        {([
          { key: 'rfm',   label: 'RFM 세그멘테이션' },
          { key: 'cycle', label: '재구매 주기' },
          { key: 'churn', label: '이탈 위험 고객' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            {t.label}
            {t.key === 'churn' && churnData.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">{churnData.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── RFM 탭 ── */}
      {tab === 'rfm' && (
        rfmLoading ? <div className="text-center py-16 text-slate-400">분석 중...</div> : (
          <div className="space-y-6">
            {/* 세그먼트 카드 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3">
              {segmentSummary.map((s: any) => (
                <button
                  key={s.segment}
                  onClick={() => setRfmFilter(rfmFilter === s.segment ? '' : s.segment)}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${
                    rfmFilter === s.segment
                      ? `${s.bg} border-current`
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <p className={`text-xs font-medium ${s.color}`}>{s.label}</p>
                  <p className="text-2xl font-bold text-slate-800 mt-1">{s.count}</p>
                  <p className="text-xs text-slate-400 mt-0.5 leading-tight">{s.desc}</p>
                </button>
              ))}
            </div>

            {rfmFilter && (
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${SEGMENT_META[rfmFilter].bg}`}>
                <span className={`text-sm font-medium ${SEGMENT_META[rfmFilter].color}`}>
                  {SEGMENT_META[rfmFilter].label} 세그먼트 필터 중 ({filteredRfm.length}명)
                </span>
                <button onClick={() => setRfmFilter('')} className="ml-auto text-slate-400 hover:text-slate-600 text-xs">✕ 필터 해제</button>
              </div>
            )}

            {/* 고객 테이블 */}
            <div className="card overflow-x-auto">
              <table className="table text-sm min-w-[700px]">
                <thead>
                  <tr>
                    <th>고객명</th>
                    <th>연락처</th>
                    <th>등급</th>
                    <th className="text-center">R(최신성)</th>
                    <th className="text-center">F(빈도)</th>
                    <th className="text-center">M(금액)</th>
                    <th>세그먼트</th>
                    <th className="text-right">구매횟수</th>
                    <th className="text-right">총구매액</th>
                    <th className="text-right">마지막구매</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRfm.length === 0 ? (
                    <tr><td colSpan={10} className="text-center py-8 text-slate-400">데이터가 없습니다</td></tr>
                  ) : filteredRfm.slice(0, 100).map((c: any) => {
                    const seg = SEGMENT_META[c.segment as RfmSegment];
                    return (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/customers/${c.id}`} className="font-medium text-blue-600 hover:underline">{c.name}</Link>
                        </td>
                        <td className="font-mono text-xs">{c.phone}</td>
                        <td><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${GRADE_BADGE[c.grade] || ''}`}>{GRADE_LABELS[c.grade] || c.grade}</span></td>
                        <td className="text-center">
                          <RfmDot score={c.r} />
                        </td>
                        <td className="text-center">
                          <RfmDot score={c.f} />
                        </td>
                        <td className="text-center">
                          <RfmDot score={c.m} />
                        </td>
                        <td>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${seg?.bg || ''} ${seg?.color || ''}`}>
                            {seg?.label || c.segment}
                          </span>
                        </td>
                        <td className="text-right">{c.orderCount}</td>
                        <td className="text-right">{c.totalAmount.toLocaleString()}원</td>
                        <td className="text-right text-slate-400 text-xs">
                          {c.daysSinceLast !== null ? `${c.daysSinceLast}일 전` : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredRfm.length > 100 && (
                <p className="text-xs text-slate-400 text-center py-2">상위 100명 표시 중 (전체 {filteredRfm.length}명)</p>
              )}
            </div>
          </div>
        )
      )}

      {/* ── 재구매 주기 탭 ── */}
      {tab === 'cycle' && (
        cycleLoading ? <div className="text-center py-16 text-slate-400">분석 중...</div> : !cycleData ? null : (
          <div className="space-y-6">
            {/* 요약 카드 */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="stat-card">
                <p className="text-sm text-slate-500">평균 재구매 주기</p>
                <p className="text-3xl font-bold text-blue-600">{cycleData.avgCycleDays}</p>
                <p className="text-xs text-slate-400">일</p>
              </div>
              <div className="stat-card">
                <p className="text-sm text-slate-500">재구매 고객수</p>
                <p className="text-3xl font-bold text-slate-800">{cycleData.repeatCustomerCount}</p>
                <p className="text-xs text-slate-400">명 (2회 이상)</p>
              </div>
              <div className="stat-card">
                <p className="text-sm text-slate-500">가장 짧은 주기</p>
                <p className="text-3xl font-bold text-green-600">
                  {cycleData.topShortCycle?.[0]?.avgDays ?? '-'}
                </p>
                <p className="text-xs text-slate-400">일</p>
              </div>
            </div>

            {/* 구간별 분포 바 차트 */}
            <div className="card">
              <h3 className="font-semibold mb-5">재구매 주기 분포</h3>
              <div className="space-y-3">
                {(cycleData.distribution || []).map((d: any) => (
                  <div key={d.label} className="flex items-center gap-3">
                    <span className="text-xs sm:text-sm text-slate-600 w-20 sm:w-24 shrink-0">{d.label}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-5 relative">
                      <div
                        className="bg-blue-400 h-5 rounded-full transition-all"
                        style={{ width: `${maxCycleCount > 0 ? Math.round(d.count / maxCycleCount * 100) : 0}%` }}
                      />
                    </div>
                    <span className="text-xs sm:text-sm font-medium text-slate-700 w-10 sm:w-12 text-right">{d.count}건</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 짧은 주기 고객 */}
            {cycleData.topShortCycle?.length > 0 && (
              <div className="card overflow-x-auto">
                <h3 className="font-semibold mb-4">재구매 주기가 짧은 고객 Top 10</h3>
                <table className="table text-sm min-w-[400px]">
                  <thead><tr>
                    <th>순위</th>
                    <th>고객</th>
                    <th className="text-right">평균 주기</th>
                    <th className="text-right">구매 횟수</th>
                  </tr></thead>
                  <tbody>
                    {cycleData.topShortCycle.map((c: any, i: number) => (
                      <tr key={c.customerId}>
                        <td className="text-slate-400">{i + 1}</td>
                        <td>
                          <Link href={`/customers/${c.customerId}`} className="text-blue-600 hover:underline">{c.customerId.slice(0, 8)}…</Link>
                        </td>
                        <td className="text-right font-semibold text-blue-600">{c.avgDays}일</td>
                        <td className="text-right">{c.orderCount}회</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      )}

      {/* ── 이탈 위험 탭 ── */}
      {tab === 'churn' && (
        churnLoading ? <div className="text-center py-16 text-slate-400">분석 중...</div> : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <span className="text-amber-700 text-sm font-medium">
                ⚠️ 2회 이상 구매했으나 60일 이상 미방문 고객 {churnData.length}명
              </span>
            </div>

            {churnData.length === 0 ? (
              <div className="card text-center py-12 text-slate-400">이탈 위험 고객이 없습니다</div>
            ) : (
              <div className="card overflow-x-auto">
                <table className="table text-sm min-w-[600px]">
                  <thead><tr>
                    <th>고객명</th>
                    <th>연락처</th>
                    <th>등급</th>
                    <th className="text-right">마지막 구매</th>
                    <th className="text-right">경과일</th>
                    <th className="text-right">구매횟수</th>
                    <th className="text-right">총구매액(LTV)</th>
                    <th></th>
                  </tr></thead>
                  <tbody>
                    {churnData.map((c: any) => (
                      <tr key={c.customerId} className={c.daysSinceLast >= 180 ? 'bg-red-50/40' : c.daysSinceLast >= 90 ? 'bg-amber-50/40' : ''}>
                        <td>
                          <Link href={`/customers/${c.customerId}`} className="font-medium text-blue-600 hover:underline">{c.name}</Link>
                        </td>
                        <td className="font-mono text-xs">{c.phone}</td>
                        <td><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${GRADE_BADGE[c.grade] || ''}`}>{GRADE_LABELS[c.grade] || c.grade}</span></td>
                        <td className="text-right text-slate-500">{c.lastDate?.slice(0, 10)}</td>
                        <td className="text-right">
                          <span className={`font-semibold ${c.daysSinceLast >= 180 ? 'text-red-600' : c.daysSinceLast >= 90 ? 'text-amber-600' : 'text-slate-700'}`}>
                            {c.daysSinceLast}일
                          </span>
                        </td>
                        <td className="text-right">{c.orderCount}회</td>
                        <td className="text-right font-medium">{c.totalAmount.toLocaleString()}원</td>
                        <td>
                          <Link
                            href={`/notifications?prefill_phone=${encodeURIComponent(c.phone)}`}
                            className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                          >
                            SMS 발송
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

// RFM 점수 시각화 컴포넌트
function RfmDot({ score }: { score: number }) {
  if (!score) return <span className="text-slate-300 text-xs">-</span>;
  const colors = ['', 'bg-slate-200', 'bg-amber-200', 'bg-yellow-300', 'bg-green-300', 'bg-green-500'];
  return (
    <span className="inline-flex gap-0.5 items-center justify-center">
      {[1,2,3,4,5].map(i => (
        <span key={i} className={`w-2 h-2 rounded-full ${i <= score ? colors[score] : 'bg-slate-100'}`} />
      ))}
    </span>
  );
}
