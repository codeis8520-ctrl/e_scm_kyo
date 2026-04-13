'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import CustomerModal from './CustomerModal';
import { autoUpgradeCustomerGrades } from '@/lib/actions';

const GRADE_LABELS: Record<string, string> = { VVIP: 'VVIP', VIP: 'VIP', NORMAL: '일반' };
const GRADE_BADGE: Record<string, string> = {
  VVIP: 'badge badge-warning',
  VIP: 'badge badge-info',
  NORMAL: 'badge',
};

interface MatchReason {
  field: string;
  value: string;
  label: string;
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
  match_reasons: MatchReason[];
}

// 탭별 동적 로드
import dynamic from 'next/dynamic';
const CampaignTab = dynamic(() => import('./CampaignTab'), { ssr: false, loading: () => <div className="py-8 text-center text-slate-400">로딩 중...</div> });

type TabType = 'list' | 'campaign';

const MATCH_FIELD_STYLES: Record<string, string> = {
  address: 'text-emerald-600',
  product: 'text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded',
  email: 'text-purple-600',
  phone: 'text-amber-600',
};

export default function CustomersPage() {
  const [activeTab, setActiveTab] = useState<TabType>('list');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [syncingMembers, setSyncingMembers] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const limit = 30;

  const fetchCustomers = useCallback(async (searchQuery: string, gradeVal: string, pageNum: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      if (gradeVal) params.set('grade', gradeVal);
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

  // 디바운스 검색
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchCustomers(search, gradeFilter, 1);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, gradeFilter, fetchCustomers]);

  // 페이지 변경
  useEffect(() => {
    if (page > 1) fetchCustomers(search, gradeFilter, page);
  }, [page]);

  // 자동 포커스
  useEffect(() => {
    if (activeTab === 'list') searchRef.current?.focus();
  }, [activeTab]);

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
    fetchCustomers(search, gradeFilter, page);
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <h3 className="font-semibold text-lg">고객 목록</h3>
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
              fetchCustomers(search, gradeFilter, page);
            }}
            disabled={upgrading}
            className="btn-secondary py-2 px-4 text-sm"
          >
            {upgrading ? '처리 중...' : '등급 자동 업그레이드'}
          </button>
          <button
            onClick={async () => {
              if (!confirm('카페24 회원 전체를 customers 테이블로 동기화합니다.\n(cafe24_member_id 기준 upsert)\n계속하시겠습니까?')) return;
              setSyncingMembers(true);
              try {
                const res = await fetch('/api/cafe24/members', { method: 'POST' });
                const json = await res.json();
                alert(json.success ? json.message : `실패: ${json.error}`);
                if (json.success) fetchCustomers(search, gradeFilter, page);
              } catch (e: any) {
                alert(`오류: ${e.message}`);
              } finally {
                setSyncingMembers(false);
              }
            }}
            disabled={syncingMembers}
            className="btn-secondary py-2 px-4 text-sm"
          >
            {syncingMembers ? '동기화 중...' : '카페24 회원 동기화'}
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary">
            + 고객 추가
          </button>
        </div>
      </div>

      {/* 통합 검색 */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap mb-4">
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
          className="input w-full sm:w-40"
        >
          <option value="">전체 등급</option>
          <option value="NORMAL">일반</option>
          <option value="VIP">VIP</option>
          <option value="VVIP">VVIP</option>
        </select>
        {!loading && (
          <span className="self-center text-sm text-slate-500">
            {total}명 {search ? '검색됨' : ''}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
      <table className="table min-w-[600px]">
        <thead>
          <tr>
            <th>이름</th>
            <th>연락처</th>
            <th>등급</th>
            <th>담당 지점</th>
            <th>적립포인트</th>
            <th>상태</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={7} className="text-center text-slate-400 py-8">
                로딩 중...
              </td>
            </tr>
          ) : customers.map((customer) => {
            // 이름/전화번호 이외의 매칭 사유만 표시
            const extraReasons = customer.match_reasons?.filter(
              (r) => r.field !== 'name' && r.field !== 'phone'
            ) || [];

            return (
              <tr key={customer.id}>
                <td>
                  <div className="font-medium">{customer.name}</div>
                  {extraReasons.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {extraReasons.map((r, i) => (
                        <span key={i} className={`text-xs ${MATCH_FIELD_STYLES[r.field] || 'text-slate-500'}`}>
                          {r.label}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td>{customer.phone}</td>
                <td>
                  <span className={GRADE_BADGE[customer.grade] || 'badge'}>
                    {GRADE_LABELS[customer.grade] || customer.grade}
                  </span>
                </td>
                <td>{customer.primary_branch?.name || '-'}</td>
                <td>{customer.total_points?.toLocaleString() || 0}P</td>
                <td>
                  <span className={customer.is_active ? 'badge badge-success' : 'badge badge-error'}>
                    {customer.is_active ? '활성' : '비활성'}
                  </span>
                </td>
                <td>
                  <Link
                    href={`/customers/${customer.id}`}
                    className="text-blue-600 hover:underline mr-2"
                  >
                    상세
                  </Link>
                  <button
                    onClick={() => handleEdit(customer)}
                    className="text-blue-600 hover:underline"
                  >
                    수정
                  </button>
                </td>
              </tr>
            );
          })}
          {!loading && customers.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center text-slate-400 py-8">
                {search ? `"${search}" 검색 결과가 없습니다` : '등록된 고객이 없습니다'}
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
    </div>
      )}
    </div>
  );
}
