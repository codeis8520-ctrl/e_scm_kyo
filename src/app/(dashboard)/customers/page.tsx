'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import CustomerModal from './CustomerModal';
import CustomerImportModal from './CustomerImportModal';
import { autoUpgradeCustomerGrades } from '@/lib/actions';
import { createClient } from '@/lib/supabase/client';

const GRADE_LABELS: Record<string, string> = { VVIP: 'VVIP', VIP: 'VIP', NORMAL: '일반' };
const GRADE_BADGE: Record<string, string> = {
  VVIP: 'badge badge-warning',
  VIP: 'badge badge-info',
  NORMAL: 'badge',
};

const CONSULT_COLORS: Record<string, string> = {
  '전화 상담': 'bg-sky-100 text-sky-700 border-sky-200',
  '방문 상담': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  '구매 상담': 'bg-violet-100 text-violet-700 border-violet-200',
  '민원 처리': 'bg-red-100 text-red-700 border-red-200',
  '기타': 'bg-slate-100 text-slate-600 border-slate-200',
};
function consultColor(type?: string | null): string {
  if (!type) return CONSULT_COLORS['기타'];
  return CONSULT_COLORS[type] || CONSULT_COLORS['기타'];
}

interface MatchReason {
  field: string;
  value: string;
  label: string;
}

interface LastConsultation {
  type: string | null;
  snippet: string;
  created_at: string;
  consultant_name: string | null;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  grade: string;
  primary_branch_id: string | null;
  health_note: string | null;
  total_points: number;
  is_active: boolean;
  primary_branch?: { id: string; name: string };
  assigned_to?: { id: string; name: string } | null;
  match_reasons: MatchReason[];
  last_consultation?: LastConsultation | null;
  consultation_count?: number;
  last_purchase_at?: string | null;
  last_purchase_amount?: number | null;
}

// 탭별 동적 로드
import dynamic from 'next/dynamic';
const CampaignTab = dynamic(() => import('./CampaignTab'), { ssr: false, loading: () => <div className="py-8 text-center text-slate-400">로딩 중...</div> });

type TabType = 'list' | 'campaign';
type SortKey = 'recent' | 'recent_consult' | 'recent_purchase' | 'name';

const MATCH_FIELD_STYLES: Record<string, string> = {
  address: 'text-emerald-600',
  product: 'text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded',
  email: 'text-purple-600',
  phone: 'text-amber-600',
};

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  if (diff < 86400 * 30) return `${Math.floor(diff / (86400 * 7))}주 전`;
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}개월 전`;
  return `${Math.floor(diff / (86400 * 365))}년 전`;
}

function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

export default function CustomersPage() {
  const [activeTab, setActiveTab] = useState<TabType>('list');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [hasConsult, setHasConsult] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('recent_consult');
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalCustomers, setTotalCustomers] = useState<number | null>(null);
  const [totalLegacy, setTotalLegacy] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const limit = 30;

  const fetchCustomers = useCallback(async (
    searchQuery: string, gradeVal: string, pageNum: number,
    onlyConsult: boolean, sortVal: SortKey,
  ) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      if (gradeVal) params.set('grade', gradeVal);
      if (onlyConsult) params.set('hasConsult', '1');
      if (sortVal) params.set('sort', sortVal);
      params.set('page', String(pageNum));
      params.set('limit', String(limit));

      const res = await fetch(`/api/customers/search?${params.toString()}`);
      const data = await res.json();
      setCustomers(data.customers || []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error('Failed to fetch customers:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 디바운스 검색 / 필터: 검색어·필터·정렬 조건이 있을 때만 조회
  useEffect(() => {
    const hasCondition = search.trim() !== '' || gradeFilter !== '' || hasConsult;
    if (!hasCondition) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // 모든 조건이 비워지면 리스트를 비우고 빈 상태로 복귀
      setCustomers([]);
      setTotal(0);
      setHasSearched(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      setHasSearched(true);
      fetchCustomers(search, gradeFilter, 1, hasConsult, sortKey);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, gradeFilter, hasConsult, sortKey, fetchCustomers]);

  // 페이지 변경
  useEffect(() => {
    if (page > 1 && hasSearched) fetchCustomers(search, gradeFilter, page, hasConsult, sortKey);
  }, [page]);

  // 자동 포커스
  useEffect(() => {
    if (activeTab === 'list') searchRef.current?.focus();
  }, [activeTab]);

  // 페이지 진입 시 총 고객 수 / 과거구매(legacy) 카운트 — 검색 없어도 표시
  useEffect(() => {
    (async () => {
      const sb = createClient() as any;
      const [cust, leg] = await Promise.all([
        sb.from('customers').select('id', { count: 'exact', head: true }).eq('is_active', true),
        sb.from('legacy_purchases').select('id', { count: 'exact', head: true }),
      ]);
      setTotalCustomers(cust.count ?? 0);
      setTotalLegacy(leg.count ?? 0);
    })();
  }, []);

  const handleEdit = (customer: Customer) => {
    setEditCustomer(customer);
    setShowModal(true);
  };

  const handleClose = () => {
    setShowModal(false);
    setEditCustomer(null);
  };

  const handleSuccess = () => {
    handleClose();
    fetchCustomers(search, gradeFilter, page, hasConsult, sortKey);
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      {/* 탭 네비게이션 */}
      <div className="flex gap-1 border-b border-slate-200">
        {([
          { key: 'list' as TabType, label: '고객 목록' },
          { key: 'campaign' as TabType, label: '캠페인 관리' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'campaign' && <CampaignTab />}

      {activeTab === 'list' && (
    <div className="card">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-2">
        <div>
          <h3 className="font-semibold text-lg flex items-center gap-2 flex-wrap">
            고객 상담·히스토리
            {totalCustomers !== null && (
              <span className="text-sm font-normal text-slate-500">
                총 <b className="text-slate-700">{totalCustomers.toLocaleString()}</b>명
              </span>
            )}
            {totalLegacy !== null && totalLegacy > 0 && (
              <span className="text-xs font-normal px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                과거 구매 {totalLegacy.toLocaleString()}건
              </span>
            )}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">상담 이력과 최근 구매 흐름을 한눈에 확인하고, 이름을 눌러 상세로 들어갑니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/customers/analytics" className="btn-secondary py-2 px-4 text-sm">
            고객 분석
          </Link>
          <button
            onClick={async () => {
              if (!confirm('누적 구매액 기준으로 등급을 자동 업그레이드합니다.\n(VIP: 100만원↑, VVIP: 300만원↑)\n계속하시겠습니까?')) return;
              setUpgrading(true);
              const result = await autoUpgradeCustomerGrades();
              setUpgrading(false);
              alert(`등급 업그레이드 완료: ${result.upgraded}명`);
              fetchCustomers(search, gradeFilter, page, hasConsult, sortKey);
            }}
            disabled={upgrading}
            className="btn-secondary py-2 px-4 text-sm"
          >
            {upgrading ? '처리 중...' : '등급 자동 업그레이드'}
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="btn-secondary py-2 px-4 text-sm"
            title="엑셀로 고객 일괄 등록"
          >
            📥 엑셀 일괄 등록
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary">
            + 고객 추가
          </button>
        </div>
      </div>

      {/* 통합 검색 & 필터 */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap mb-4 mt-4">
        <div className="relative flex-1 max-w-lg">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            placeholder="이름, 연락처, 주소, 구매제품으로 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10 w-full"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <select
          value={gradeFilter}
          onChange={(e) => setGradeFilter(e.target.value)}
          className="input w-full sm:w-32"
        >
          <option value="">전체 등급</option>
          <option value="NORMAL">일반</option>
          <option value="VIP">VIP</option>
          <option value="VVIP">VVIP</option>
        </select>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="input w-full sm:w-44"
          title="정렬 기준"
        >
          <option value="recent_consult">최근 상담순</option>
          <option value="recent_purchase">최근 구매순</option>
          <option value="recent">최근 등록순</option>
          <option value="name">이름순</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600 whitespace-nowrap">
          <input
            type="checkbox"
            checked={hasConsult}
            onChange={(e) => setHasConsult(e.target.checked)}
            className="rounded border-slate-300"
          />
          상담 이력 있음
        </label>
        {!loading && (
          <span className="self-center text-sm text-slate-500">
            {total}명 {search ? '검색됨' : ''}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
      <table className="table min-w-[900px]">
        <thead>
          <tr>
            <th className="w-[22%]">고객</th>
            <th className="w-[10%]">등급/지점</th>
            <th className="w-[34%]">최근 상담</th>
            <th className="w-[18%]">최근 구매</th>
            <th className="w-[10%]">담당자</th>
            <th className="w-[6%]">관리</th>
          </tr>
        </thead>
        <tbody>
          {!hasSearched && !loading ? (
            <tr>
              <td colSpan={6} className="py-14 text-center">
                <div className="inline-flex flex-col items-center gap-2 text-slate-400">
                  <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <p className="text-sm">이름·연락처·주소·제품명으로 검색하거나 필터를 지정해 고객을 조회하세요.</p>
                  <p className="text-xs text-slate-400">예) "김", "010-1234", "홍삼", 등급/상담 이력/정렬 선택</p>
                </div>
              </td>
            </tr>
          ) : loading ? (
            <tr>
              <td colSpan={6} className="text-center text-slate-400 py-8">
                로딩 중...
              </td>
            </tr>
          ) : customers.map((customer) => {
            const extraReasons = customer.match_reasons?.filter(
              (r) => r.field !== 'name' && r.field !== 'phone'
            ) || [];
            const consult = customer.last_consultation;
            const cnt = customer.consultation_count || 0;

            return (
              <tr key={customer.id} className="align-top">
                <td>
                  <Link
                    href={`/customers/${customer.id}`}
                    className="font-medium text-slate-800 hover:text-blue-600 hover:underline"
                  >
                    {customer.name}
                  </Link>
                  <div className="text-xs text-slate-500 mt-0.5">{customer.phone}</div>
                  {!customer.is_active && (
                    <span className="inline-block mt-1 badge badge-error text-[10px]">비활성</span>
                  )}
                  {extraReasons.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {extraReasons.map((r, i) => (
                        <span key={i} className={`text-xs ${MATCH_FIELD_STYLES[r.field] || 'text-slate-500'}`}>
                          {r.label}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td>
                  <span className={GRADE_BADGE[customer.grade] || 'badge'}>
                    {GRADE_LABELS[customer.grade] || customer.grade}
                  </span>
                  <div className="text-xs text-slate-500 mt-1">{customer.primary_branch?.name || '-'}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{(customer.total_points ?? 0).toLocaleString()}P</div>
                </td>
                <td>
                  {consult ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded border ${consultColor(consult.type)}`}>
                          {consult.type || '기타'}
                        </span>
                        <span className="text-xs text-slate-500">{relativeTime(consult.created_at)}</span>
                        <span className="text-[11px] text-slate-400">· {fmtShortDate(consult.created_at)}</span>
                        {cnt > 1 && (
                          <span className="text-[11px] text-slate-500 bg-slate-100 px-1.5 rounded-full">총 {cnt}회</span>
                        )}
                      </div>
                      <div className="text-sm text-slate-700 line-clamp-2 break-words">
                        {consult.snippet || <span className="text-slate-400">(내용 없음)</span>}
                      </div>
                      {consult.consultant_name && (
                        <div className="text-[11px] text-slate-400">담당: {consult.consultant_name}</div>
                      )}
                    </div>
                  ) : (
                    <Link
                      href={`/customers/${customer.id}?tab=consultations`}
                      className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600"
                    >
                      <span className="text-slate-300">—</span> 상담 기록 없음 · 추가하기
                    </Link>
                  )}
                </td>
                <td>
                  {customer.last_purchase_at ? (
                    <div>
                      <div className="text-sm font-medium text-slate-700">
                        {fmtShortDate(customer.last_purchase_at)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {relativeTime(customer.last_purchase_at)}
                      </div>
                      {customer.last_purchase_amount != null && (
                        <div className="text-xs text-slate-400 mt-0.5">
                          {customer.last_purchase_amount.toLocaleString()}원
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">구매 없음</span>
                  )}
                </td>
                <td>
                  {customer.assigned_to ? (
                    <span className="text-sm text-slate-700">{customer.assigned_to.name}</span>
                  ) : (
                    <span className="text-xs text-slate-400">미지정</span>
                  )}
                </td>
                <td>
                  <button
                    onClick={() => handleEdit(customer)}
                    className="text-blue-600 hover:underline text-sm"
                  >
                    수정
                  </button>
                </td>
              </tr>
            );
          })}
          {!loading && customers.length === 0 && (
            <tr>
              <td colSpan={6} className="text-center text-slate-400 py-8">
                {search ? `"${search}" 검색 결과가 없습니다` : hasConsult ? '상담 이력이 있는 고객이 없습니다' : '등록된 고객이 없습니다'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg text-sm border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
          >
            이전
          </button>
          <span className="text-sm text-slate-600">
            {page} / {totalPages} 페이지
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg text-sm border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
          >
            다음
          </button>
        </div>
      )}

      {showModal && (
        <CustomerModal
          customer={editCustomer}
          onClose={handleClose}
          onSuccess={handleSuccess}
        />
      )}

      {showImportModal && (
        <CustomerImportModal
          onClose={() => setShowImportModal(false)}
          onSuccess={() => fetchCustomers(search, gradeFilter, page, hasConsult, sortKey)}
        />
      )}
    </div>
      )}
    </div>
  );
}
