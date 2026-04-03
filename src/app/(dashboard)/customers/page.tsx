'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import CustomerModal from './CustomerModal';
import { autoUpgradeCustomerGrades } from '@/lib/actions';

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
    setCustomers(data || []);
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
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-semibold text-lg">고객 목록</h3>
        <div className="flex gap-2">
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
          <button onClick={() => setShowModal(true)} className="btn-primary">
            + 고객 추가
          </button>
        </div>
      </div>

      <div className="flex gap-4 mb-4">
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
          className="input w-40"
        >
          <option value="">전체 등급</option>
          <option value="NORMAL">일반</option>
          <option value="VIP">VIP</option>
          <option value="VVIP">VVIP</option>
        </select>
      </div>

      <table className="table">
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
                <span className={`badge ${
                  customer.grade === 'VVIP' ? 'badge-warning' :
                  customer.grade === 'VIP' ? 'badge-info' : ''
                }`}>
                  {customer.grade}
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
