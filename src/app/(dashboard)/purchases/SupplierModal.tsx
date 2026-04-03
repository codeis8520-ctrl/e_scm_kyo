'use client';

import { useState } from 'react';
import { createSupplier, updateSupplier } from '@/lib/purchase-actions';

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
}

interface Props {
  supplier?: Supplier | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SupplierModal({ supplier, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: supplier?.name || '',
    business_number: supplier?.business_number || '',
    representative: supplier?.representative || '',
    phone: supplier?.phone || '',
    email: supplier?.email || '',
    fax: supplier?.fax || '',
    address: supplier?.address || '',
    payment_terms: String(supplier?.payment_terms ?? 30),
    bank_name: supplier?.bank_name || '',
    bank_account: supplier?.bank_account || '',
    bank_holder: supplier?.bank_holder || '',
    memo: supplier?.memo || '',
    is_active: String(supplier?.is_active ?? true),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('공급업체명은 필수입니다.'); return; }
    setLoading(true);
    setError('');

    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));

    const result = supplier?.id
      ? await updateSupplier(supplier.id, fd)
      : await createSupplier(fd);

    if (result.error) { setError(result.error); setLoading(false); }
    else onSuccess();
  };

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center px-6 py-4 border-b">
          <h2 className="text-lg font-bold">{supplier?.id ? '공급업체 수정' : '공급업체 등록'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {error && <div className="mx-6 mt-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* 기본 정보 */}
          <div>
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">기본 정보</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700">공급업체명 *</label>
                <input value={form.name} onChange={e => set('name', e.target.value)} required className="mt-1 input" placeholder="(주)경옥바이오" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">사업자번호</label>
                <input value={form.business_number} onChange={e => set('business_number', e.target.value)} className="mt-1 input" placeholder="000-00-00000" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">대표자</label>
                <input value={form.representative} onChange={e => set('representative', e.target.value)} className="mt-1 input" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">전화번호</label>
                <input value={form.phone} onChange={e => set('phone', e.target.value)} className="mt-1 input" placeholder="02-0000-0000" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">팩스</label>
                <input value={form.fax} onChange={e => set('fax', e.target.value)} className="mt-1 input" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">이메일</label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className="mt-1 input" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">결제 조건 (일)</label>
                <input type="number" min={0} max={180} value={form.payment_terms} onChange={e => set('payment_terms', e.target.value)} className="mt-1 input" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700">주소</label>
                <input value={form.address} onChange={e => set('address', e.target.value)} className="mt-1 input" />
              </div>
            </div>
          </div>

          <hr />

          {/* 계좌 정보 */}
          <div>
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">계좌 정보</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">은행</label>
                <input value={form.bank_name} onChange={e => set('bank_name', e.target.value)} className="mt-1 input" placeholder="국민은행" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">계좌번호</label>
                <input value={form.bank_account} onChange={e => set('bank_account', e.target.value)} className="mt-1 input" placeholder="000-0000-0000-00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">예금주</label>
                <input value={form.bank_holder} onChange={e => set('bank_holder', e.target.value)} className="mt-1 input" />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">메모</label>
            <textarea value={form.memo} onChange={e => set('memo', e.target.value)} rows={2} className="mt-1 input" />
          </div>

          {supplier?.id && (
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_active" checked={form.is_active === 'true'}
                onChange={e => set('is_active', String(e.target.checked))} />
              <label htmlFor="is_active" className="text-sm text-slate-700">활성 상태</label>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading} className="flex-1 btn-primary py-2.5">
              {loading ? '처리 중...' : supplier?.id ? '수정' : '등록'}
            </button>
            <button type="button" onClick={onClose} className="flex-1 btn-secondary py-2.5">취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}
