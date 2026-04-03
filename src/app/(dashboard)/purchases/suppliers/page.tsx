'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { updateSupplier } from '@/lib/purchase-actions';
import SupplierModal from '../SupplierModal';

interface Supplier {
  id: string;
  code: string;
  name: string;
  business_number: string | null;
  representative: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  address: string | null;
  payment_terms: number;
  bank_name: string | null;
  bank_account: string | null;
  bank_holder: string | null;
  memo: string | null;
  is_active: boolean;
  created_at: string;
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<{ open: boolean; supplier?: Supplier | null }>({ open: false });

  const fetchSuppliers = async () => {
    setLoading(true);
    const sb = createClient() as any;
    let q = sb.from('suppliers').select('*').order('name');
    if (!showInactive) q = q.eq('is_active', true);
    const { data } = await q;
    setSuppliers(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchSuppliers(); }, [showInactive]);

  const filtered = suppliers.filter(s =>
    !search ||
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.code.toLowerCase().includes(search.toLowerCase()) ||
    (s.business_number || '').includes(search)
  );

  const handleToggleActive = async (s: Supplier) => {
    const label = s.is_active ? '비활성화' : '활성화';
    if (!confirm(`${s.name}을(를) ${label}하시겠습니까?`)) return;
    const fd = new FormData();
    fd.append('name', s.name);
    fd.append('is_active', String(!s.is_active));
    await updateSupplier(s.id, fd);
    fetchSuppliers();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/purchases" className="text-sm text-slate-500 hover:text-slate-700">← 발주 목록</Link>
          <h1 className="text-lg font-bold text-slate-800">공급업체 관리</h1>
        </div>
        <button onClick={() => setModal({ open: true, supplier: null })} className="btn-primary">+ 공급업체 등록</button>
      </div>

      <div className="card">
        <div className="flex flex-wrap gap-3 mb-5">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="업체명, 코드, 사업자번호 검색..."
            className="input w-72"
          />
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              className="rounded"
            />
            비활성 포함
          </label>
          <span className="text-sm text-slate-400 self-center">{filtered.length}개</span>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>코드</th>
                <th>공급업체명</th>
                <th>사업자번호</th>
                <th>대표자</th>
                <th>전화번호</th>
                <th>결제조건</th>
                <th>은행/계좌</th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">로딩 중...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">공급업체가 없습니다.</td></tr>
              ) : filtered.map(s => (
                <tr key={s.id} className={!s.is_active ? 'opacity-50' : ''}>
                  <td className="font-mono text-xs text-slate-500">{s.code}</td>
                  <td>
                    <p className="font-medium">{s.name}</p>
                    {s.memo && <p className="text-xs text-slate-400 truncate max-w-40">{s.memo}</p>}
                  </td>
                  <td className="text-sm text-slate-500">{s.business_number || '-'}</td>
                  <td className="text-sm">{s.representative || '-'}</td>
                  <td className="text-sm">{s.phone || '-'}</td>
                  <td className="text-sm text-center">{s.payment_terms}일</td>
                  <td className="text-sm">
                    {s.bank_name ? (
                      <div>
                        <p>{s.bank_name}</p>
                        <p className="text-xs text-slate-400">{s.bank_account}</p>
                      </div>
                    ) : '-'}
                  </td>
                  <td>
                    <span className={`badge ${s.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {s.is_active ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setModal({ open: true, supplier: s })}
                        className="text-xs text-blue-600 hover:underline"
                      >수정</button>
                      <button
                        onClick={() => handleToggleActive(s)}
                        className={`text-xs hover:underline ${s.is_active ? 'text-slate-400' : 'text-green-600'}`}
                      >
                        {s.is_active ? '비활성화' : '활성화'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal.open && (
        <SupplierModal
          supplier={modal.supplier}
          onClose={() => setModal({ open: false })}
          onSuccess={() => { setModal({ open: false }); fetchSuppliers(); }}
        />
      )}
    </div>
  );
}
