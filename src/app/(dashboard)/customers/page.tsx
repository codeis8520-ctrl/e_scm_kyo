'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import CustomerModal from './CustomerModal';
import { autoUpgradeCustomerGrades } from '@/lib/actions';

const GRADE_LABELS: Record<string, string> = { VVIP: 'VVIP', VIP: 'VIP', NORMAL: '일반' };
const GRADE_BADGE: Record<string, string> = {
  VVIP: 'badge badge-warning',
  VIP: 'badge badge-info',
  NORMAL: 'badge',
};

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
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [syncingMembers, setSyncingMembers] = useState(false);

  const fetchCustomers = async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from('customers')
      .select('*, primary_branch:branches(*)')
      .order('created_at', { ascending: false });

    if (search) {
      query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    if (gradeFilter) {
      query = query.eq('grade', gradeFilter);
    }

    const { data } = await query;
    const customers = data || [];

    // customers 테이블에 total_points 컬럼 없음 → point_history 최신 balance 조회
    if (customers.length > 0) {
      const ids = customers.map((c: any) => c.id);
      const { data: pointRows } = await supabase
        .from('point_history')
        .select('customer_id, balance')
        .in('customer_id', ids)
        .order('created_at', { ascending: false });

      // 고객별 가장 최근 balance (DESC 정렬이므로 첫 번째가 최신)
      const balanceMap: Record<string, number> = {};
      for (const row of (pointRows || []) as any[]) {
        if (!(row.customer_id in balanceMap)) {
          balanceMap[row.customer_id] = row.balance;
        }
      }
      setCustomers(customers.map((c: any) => ({
        ...c,
        total_points: balanceMap[c.id] ?? 0,
      })));
    } else {
      setCustomers([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchCustomers();
  }, [search, gradeFilter]);

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
    fetchCustomers();
  };

  return (
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
              fetchCustomers();
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
                if (json.success) fetchCustomers();
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

      <div className="flex flex-col sm:flex-row gap-3 flex-wrap mb-4">
        <input
          type="text"
          placeholder="이름 또는 연락처 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input max-w-md"
        />
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
          ) : customers.map((customer) => (
            <tr key={customer.id}>
              <td className="font-medium">{customer.name}</td>
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
          ))}
          {!loading && customers.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center text-slate-400 py-8">
                등록된 고객이 없습니다
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>

      {showModal && (
        <CustomerModal
          customer={editCustomer}
          onClose={handleClose}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}
