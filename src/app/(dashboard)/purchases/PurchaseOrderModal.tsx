'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { createPurchaseOrder } from '@/lib/purchase-actions';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

interface OrderItem {
  product_id: string;
  product_name: string;
  product_code: string;
  unit: string;
  ordered_quantity: number;
  unit_price: number;
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  return document.cookie.split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    acc[k] = decodeURIComponent(v || '');
    return acc;
  }, {} as Record<string, string>)[name] || null;
}

export default function PurchaseOrderModal({ onClose, onSuccess }: Props) {
  const userRole = getCookie('user_role');
  const userBranchId = getCookie('user_branch_id');
  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';

  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [showProductDrop, setShowProductDrop] = useState(false);
  const [form, setForm] = useState({ supplier_id: '', branch_id: isBranchUser && userBranchId ? userBranchId : '', expected_date: '', memo: '' });
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const sb = createClient();
    (sb as any).from('suppliers').select('id, name, code').eq('is_active', true).order('name')
      .then(({ data }: any) => setSuppliers(data || []));
    (sb as any).from('branches').select('id, name').eq('is_active', true).order('name')
      .then(({ data }: any) => setBranches(data || []));
    (sb as any).from('products').select('id, name, code, unit, cost').eq('is_active', true).order('name')
      .then(({ data }: any) => setProducts(data || []));
  }, []);

  const filteredProducts = products.filter(p =>
    !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.code.toLowerCase().includes(productSearch.toLowerCase())
  ).slice(0, 20);

  const addItem = (product: any) => {
    if (items.find(i => i.product_id === product.id)) {
      setError('이미 추가된 제품입니다.'); return;
    }
    setItems(prev => [...prev, {
      product_id: product.id,
      product_name: product.name,
      product_code: product.code,
      unit: product.unit || '개',
      ordered_quantity: 1,
      unit_price: product.cost || 0,
    }]);
    setProductSearch('');
    setShowProductDrop(false);
  };

  const updateItem = (idx: number, field: 'ordered_quantity' | 'unit_price', val: number) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: Math.max(field === 'ordered_quantity' ? 1 : 0, val) } : item));
  };

  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));

  const totalAmount = items.reduce((s, i) => s + i.ordered_quantity * i.unit_price, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.supplier_id) { setError('공급업체를 선택하세요.'); return; }
    if (!form.branch_id) { setError('입고 지점을 선택하세요.'); return; }
    if (!items.length) { setError('발주 항목을 1개 이상 추가하세요.'); return; }

    setLoading(true);
    const fd = new FormData();
    fd.append('supplier_id', form.supplier_id);
    fd.append('branch_id', form.branch_id);
    fd.append('expected_date', form.expected_date);
    fd.append('memo', form.memo);
    fd.append('items', JSON.stringify(items.map(i => ({
      product_id: i.product_id,
      ordered_quantity: i.ordered_quantity,
      unit_price: i.unit_price,
    }))));

    const result = await createPurchaseOrder(fd);
    if (result.error) { setError(result.error); setLoading(false); }
    else onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex justify-between items-center px-6 py-4 border-b sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold">발주서 작성</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {error && <div className="mx-6 mt-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* 헤더 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">공급업체 *</label>
              <select value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))} className="mt-1 input" required>
                <option value="">선택</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">입고 지점 *</label>
              <select
                value={form.branch_id}
                onChange={e => setForm(f => ({ ...f, branch_id: e.target.value }))}
                className={`mt-1 input ${isBranchUser ? 'bg-slate-100 cursor-not-allowed' : ''}`}
                disabled={isBranchUser}
                required
              >
                <option value="">선택</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">납기 예정일</label>
              <input type="date" value={form.expected_date} onChange={e => setForm(f => ({ ...f, expected_date: e.target.value }))} className="mt-1 input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">메모</label>
              <input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} className="mt-1 input" />
            </div>
          </div>

          <hr />

          {/* 제품 추가 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">발주 항목 추가</label>
            <div className="relative">
              <input
                type="text"
                value={productSearch}
                onChange={e => { setProductSearch(e.target.value); setShowProductDrop(true); }}
                onFocus={() => setShowProductDrop(true)}
                placeholder="제품명 또는 코드 검색..."
                className="input"
              />
              {showProductDrop && productSearch && (
                <div className="absolute z-20 top-full left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {filteredProducts.length === 0
                    ? <p className="p-3 text-sm text-slate-400">검색 결과 없음</p>
                    : filteredProducts.map(p => (
                      <button type="button" key={p.id} onClick={() => addItem(p)}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0">
                        <span className="font-medium text-sm">{p.name}</span>
                        <span className="text-xs text-slate-400 ml-2">{p.code}</span>
                        {p.cost && <span className="text-xs text-slate-500 float-right">{p.cost.toLocaleString()}원</span>}
                      </button>
                    ))
                  }
                </div>
              )}
            </div>
          </div>

          {/* 항목 테이블 */}
          {items.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <table className="table">
                <thead>
                  <tr>
                    <th>제품명</th>
                    <th className="w-20">단위</th>
                    <th className="w-28">발주수량</th>
                    <th className="w-36">단가(원)</th>
                    <th className="w-32 text-right">금액</th>
                    <th className="w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={item.product_id}>
                      <td>
                        <p className="font-medium text-sm">{item.product_name}</p>
                        <p className="text-xs text-slate-400">{item.product_code}</p>
                      </td>
                      <td className="text-sm text-slate-500">{item.unit}</td>
                      <td>
                        <input type="number" min={1} value={item.ordered_quantity}
                          onChange={e => updateItem(idx, 'ordered_quantity', parseInt(e.target.value) || 1)}
                          className="input text-center w-24" />
                      </td>
                      <td>
                        <input type="number" min={0} value={item.unit_price}
                          onChange={e => updateItem(idx, 'unit_price', parseInt(e.target.value) || 0)}
                          className="input text-right w-32" />
                      </td>
                      <td className="text-right font-medium text-sm">
                        {(item.ordered_quantity * item.unit_price).toLocaleString()}원
                      </td>
                      <td>
                        <button type="button" onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600 text-lg">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50">
                    <td colSpan={4} className="text-right font-semibold text-slate-700 pr-4">총 발주금액</td>
                    <td className="text-right font-bold text-blue-700">{totalAmount.toLocaleString()}원</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading || !items.length} className="flex-1 btn-primary py-2.5">
              {loading ? '처리 중...' : `발주서 작성 (${items.length}종 · ${totalAmount.toLocaleString()}원)`}
            </button>
            <button type="button" onClick={onClose} className="flex-1 btn-secondary py-2.5">취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}
