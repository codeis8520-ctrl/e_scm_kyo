'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getB2bPartners, createB2bPartner, updateB2bPartner, getPartnerPrices, upsertPartnerPrice, deletePartnerPrice } from '@/lib/b2b-actions';

const CYCLE_LABELS: Record<string, string> = { WEEKLY: '주간', BIWEEKLY: '격주', MONTHLY: '월간' };

export default function B2bPartnersTab() {
  const [partners, setPartners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [pricePartner, setPricePartner] = useState<any>(null);

  const fetchData = async () => {
    setLoading(true);
    const res = await getB2bPartners();
    setPartners(res.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold">거래처 목록</h3>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary text-sm">+ 거래처 추가</button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-slate-400">로딩 중...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[700px]">
              <thead>
                <tr>
                  <th>코드</th>
                  <th>거래처명</th>
                  <th>사업자번호</th>
                  <th>담당자</th>
                  <th>연락처</th>
                  <th>정산주기</th>
                  <th>상태</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {partners.map(p => (
                  <tr key={p.id} className={!p.is_active ? 'opacity-50' : ''}>
                    <td className="font-mono text-sm">{p.code}</td>
                    <td className="font-medium">{p.name}</td>
                    <td className="text-sm">{p.business_no || '-'}</td>
                    <td className="text-sm">{p.contact_name || '-'}</td>
                    <td className="text-sm">{p.phone || '-'}</td>
                    <td className="text-sm">{CYCLE_LABELS[p.settlement_cycle] || p.settlement_cycle} · {p.settlement_day}일</td>
                    <td><span className={`badge text-xs ${p.is_active ? 'badge-success' : 'badge-error'}`}>{p.is_active ? '활성' : '비활성'}</span></td>
                    <td>
                      <button onClick={() => setPricePartner(p)} className="text-emerald-600 hover:underline text-sm mr-2">단가표</button>
                      <button onClick={() => { setEditing(p); setShowForm(true); }} className="text-blue-600 hover:underline text-sm">수정</button>
                    </td>
                  </tr>
                ))}
                {partners.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-8 text-slate-400">등록된 거래처가 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <PartnerForm
          partner={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSuccess={() => { setShowForm(false); setEditing(null); fetchData(); }}
        />
      )}

      {pricePartner && (
        <PartnerPriceModal
          partner={pricePartner}
          onClose={() => setPricePartner(null)}
        />
      )}
    </div>
  );
}

function PartnerForm({ partner, onClose, onSuccess }: { partner: any; onClose: () => void; onSuccess: () => void }) {
  const isEdit = !!partner?.id;
  const [form, setForm] = useState({
    name: partner?.name || '',
    code: partner?.code || '',
    business_no: partner?.business_no || '',
    contact_name: partner?.contact_name || '',
    phone: partner?.phone || '',
    email: partner?.email || '',
    address: partner?.address || '',
    settlement_cycle: partner?.settlement_cycle || 'MONTHLY',
    settlement_day: partner?.settlement_day ?? 25,
    memo: partner?.memo || '',
    is_active: partner?.is_active ?? true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) { setError('거래처명을 입력하세요.'); return; }
    setSubmitting(true);
    setError('');
    const res = isEdit
      ? await updateB2bPartner(partner.id, form)
      : await createB2bPartner(form as any);
    setSubmitting(false);
    if (res.error) setError(res.error);
    else onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white w-full max-w-lg mx-auto max-h-[92vh] overflow-y-auto rounded-xl p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">{isEdit ? '거래처 수정' : '거래처 추가'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        {error && <div className="mb-3 p-3 bg-red-50 text-red-600 rounded text-sm">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">거래처명 *</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required className="input" placeholder="○○약국 / ○○마트" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">사업자번호</label>
              <input value={form.business_no} onChange={e => setForm({ ...form, business_no: e.target.value })} className="input" placeholder="123-45-67890" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">담당자</label>
              <input value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} className="input" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">연락처</label>
              <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="input" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">이메일</label>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="input" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">주소</label>
              <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="input" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2 border-t">
            <div>
              <label className="block text-sm font-medium mb-1">정산 주기</label>
              <select value={form.settlement_cycle} onChange={e => setForm({ ...form, settlement_cycle: e.target.value })} className="input">
                <option value="MONTHLY">월간</option>
                <option value="BIWEEKLY">격주</option>
                <option value="WEEKLY">주간</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">정산일</label>
              <input type="number" min={1} max={31} value={form.settlement_day} onChange={e => setForm({ ...form, settlement_day: parseInt(e.target.value) || 25 })} className="input" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">메모</label>
            <textarea value={form.memo} onChange={e => setForm({ ...form, memo: e.target.value })} rows={2} className="input" />
          </div>
          {isEdit && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4" />
              <span className="text-sm">활성 상태</span>
            </label>
          )}
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={submitting} className="flex-1 btn-primary">{submitting ? '처리 중...' : isEdit ? '수정' : '추가'}</button>
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 거래처별 단가표 모달
// ═══════════════════════════════════════════════════════════════════════

function PartnerPriceModal({ partner, onClose }: { partner: any; onClose: () => void }) {
  const [prices, setPrices] = useState<any[]>([]);
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // 추가용
  const [addProductId, setAddProductId] = useState('');
  const [addUnitPrice, setAddUnitPrice] = useState('');
  const [addDiscount, setAddDiscount] = useState('');

  // 일괄 할인율
  const [bulkRate, setBulkRate] = useState('');

  const fetchData = async () => {
    setLoading(true);
    const [priceRes, prodRes] = await Promise.all([
      getPartnerPrices(partner.id),
      (async () => {
        const sb = createClient() as any;
        const { data } = await sb.from('products').select('id, name, code, price').eq('is_active', true).order('name');
        return data || [];
      })(),
    ]);
    setPrices(priceRes.data || []);
    setAllProducts(prodRes);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [partner.id]);

  const registeredIds = new Set(prices.map((p: any) => p.product_id));
  const unregistered = allProducts.filter(p => !registeredIds.has(p.id));

  const handleSave = async (productId: string, unitPrice: number) => {
    setSaving(productId);
    await upsertPartnerPrice({ partnerId: partner.id, productId, unitPrice });
    setSaving(null);
    fetchData();
  };

  const handleAdd = async () => {
    if (!addProductId || !addUnitPrice) return;
    setSaving('add');
    await upsertPartnerPrice({ partnerId: partner.id, productId: addProductId, unitPrice: parseInt(addUnitPrice) });
    setSaving(null);
    setAddProductId('');
    setAddUnitPrice('');
    setAddDiscount('');
    fetchData();
  };

  const handleDelete = async (productId: string) => {
    if (!confirm('이 제품의 단가를 삭제하시겠습니까? (정가로 돌아감)')) return;
    await deletePartnerPrice(partner.id, productId);
    fetchData();
  };

  const handleBulkDiscount = async () => {
    const rate = parseFloat(bulkRate);
    if (isNaN(rate) || rate < 0 || rate > 100) { alert('0~100 사이 할인율을 입력하세요.'); return; }
    if (!confirm(`전 제품에 정가 대비 ${rate}% 할인을 일괄 적용합니다. 기존 단가가 모두 덮어써집니다.`)) return;

    setSaving('bulk');
    const rows = allProducts.map(p => ({
      productId: p.id,
      unitPrice: Math.round(Number(p.price) * (1 - rate / 100)),
    }));

    const { bulkUpsertPartnerPrices } = await import('@/lib/b2b-actions');
    await bulkUpsertPartnerPrices(partner.id, rows);
    setSaving(null);
    setBulkRate('');
    fetchData();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white w-full max-w-3xl mx-auto max-h-[92vh] overflow-y-auto rounded-xl p-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-bold">납품 단가표</h2>
            <p className="text-sm text-slate-500">{partner.name} ({partner.code})</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        {/* 일괄 할인 */}
        <div className="flex items-end gap-2 mb-4 p-3 bg-slate-50 rounded-lg">
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-1">일괄 할인율 적용</label>
            <div className="flex gap-2">
              <input
                type="number" step="0.1" min={0} max={100}
                value={bulkRate} onChange={e => setBulkRate(e.target.value)}
                placeholder="예: 30"
                className="input text-sm py-1.5 w-24"
              />
              <span className="text-sm text-slate-500 self-center">%</span>
              <button
                onClick={handleBulkDiscount}
                disabled={saving === 'bulk' || !bulkRate}
                className="px-3 py-1.5 rounded text-xs font-medium bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40"
              >
                {saving === 'bulk' ? '적용 중...' : '전 제품 일괄 적용'}
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-400">정가 기준으로 할인율을 적용합니다</p>
        </div>

        {loading ? (
          <div className="py-8 text-center text-slate-400">로딩 중...</div>
        ) : (
          <>
            {/* 등록된 단가 */}
            <div className="overflow-x-auto mb-4">
              <table className="table">
                <thead>
                  <tr>
                    <th>제품</th>
                    <th className="text-right">정가</th>
                    <th className="text-right w-32">납품 단가</th>
                    <th className="text-right">할인율</th>
                    <th className="w-24">동작</th>
                  </tr>
                </thead>
                <tbody>
                  {prices.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-6 text-slate-400">등록된 단가가 없습니다. 아래에서 추가하세요.</td></tr>
                  ) : prices.map((p: any) => (
                    <PriceRow
                      key={p.product_id}
                      price={p}
                      saving={saving === p.product_id}
                      onSave={(unitPrice) => handleSave(p.product_id, unitPrice)}
                      onDelete={() => handleDelete(p.product_id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* 제품 추가 */}
            {unregistered.length > 0 && (
              <div className="border-t pt-4">
                <p className="text-sm font-medium mb-2">제품 추가</p>
                <div className="flex gap-2 items-end flex-wrap">
                  <select value={addProductId} onChange={e => {
                    setAddProductId(e.target.value);
                    const prod = allProducts.find(p => p.id === e.target.value);
                    if (prod) { setAddUnitPrice(String(prod.price)); setAddDiscount('0'); }
                  }} className="input flex-1 text-sm min-w-[180px]">
                    <option value="">제품 선택</option>
                    {unregistered.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.code}) — 정가 {Number(p.price).toLocaleString()}원</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1">
                    <input
                      type="number" step="0.1" min={0} max={100}
                      value={addDiscount}
                      onChange={e => {
                        setAddDiscount(e.target.value);
                        const r = parseFloat(e.target.value);
                        const prod = allProducts.find(p => p.id === addProductId);
                        if (!isNaN(r) && prod) setAddUnitPrice(String(Math.round(Number(prod.price) * (1 - r / 100))));
                      }}
                      placeholder="할인"
                      className="input w-16 text-sm text-right"
                    />
                    <span className="text-xs text-slate-400">%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number" min={0}
                      value={addUnitPrice}
                      onChange={e => {
                        setAddUnitPrice(e.target.value);
                        const v = parseInt(e.target.value);
                        const prod = allProducts.find(p => p.id === addProductId);
                        if (!isNaN(v) && prod && Number(prod.price) > 0) setAddDiscount(((1 - v / Number(prod.price)) * 100).toFixed(1));
                      }}
                      placeholder="납품 단가"
                      className="input w-28 text-sm text-right"
                    />
                    <span className="text-xs text-slate-400">원</span>
                  </div>
                  <button
                    onClick={handleAdd}
                    disabled={saving === 'add' || !addProductId || !addUnitPrice}
                    className="px-3 py-1.5 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                  >
                    {saving === 'add' ? '...' : '추가'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PriceRow({ price, saving, onSave, onDelete }: { price: any; saving: boolean; onSave: (v: number) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(price.unit_price));
  const [discountVal, setDiscountVal] = useState('');
  const retailPrice = Number(price.product?.price || 0);

  const startEdit = () => {
    setVal(String(price.unit_price));
    setDiscountVal(retailPrice > 0 ? ((1 - Number(price.unit_price) / retailPrice) * 100).toFixed(1) : '');
    setEditing(true);
  };

  const applyDiscount = (rate: string) => {
    setDiscountVal(rate);
    const r = parseFloat(rate);
    if (!isNaN(r) && retailPrice > 0) {
      setVal(String(Math.round(retailPrice * (1 - r / 100))));
    }
  };

  const applyPrice = (p: string) => {
    setVal(p);
    const v = parseInt(p);
    if (!isNaN(v) && retailPrice > 0) {
      setDiscountVal(((1 - v / retailPrice) * 100).toFixed(1));
    }
  };

  const confirmEdit = () => {
    onSave(parseInt(val) || 0);
    setEditing(false);
  };

  return (
    <tr>
      <td>
        <div className="text-sm font-medium">{price.product?.name}</div>
        <div className="text-xs text-slate-400">{price.product?.code}</div>
      </td>
      <td className="text-right text-sm text-slate-500">{retailPrice.toLocaleString()}원</td>
      <td className="text-right">
        {editing ? (
          <div className="flex items-center gap-1 justify-end">
            <input
              type="number" min={0} value={val}
              onChange={e => applyPrice(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmEdit(); if (e.key === 'Escape') setEditing(false); }}
              className="input w-24 text-sm text-right py-0.5"
              autoFocus
            />
            <span className="text-xs text-slate-400">원</span>
          </div>
        ) : (
          <button onClick={startEdit} className="text-sm font-semibold hover:text-blue-600">
            {Number(price.unit_price).toLocaleString()}원
          </button>
        )}
      </td>
      <td className="text-right text-sm">
        {editing ? (
          <div className="flex items-center gap-1 justify-end">
            <input
              type="number" step="0.1" min={0} max={100} value={discountVal}
              onChange={e => applyDiscount(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmEdit(); if (e.key === 'Escape') setEditing(false); }}
              className="input w-16 text-sm text-right py-0.5"
            />
            <span className="text-xs text-slate-400">%</span>
          </div>
        ) : retailPrice > 0 ? (
          <button onClick={startEdit} className={`hover:text-blue-600 ${Number(price.discount_rate) > 0 ? 'text-red-600' : ''}`}>
            {Number(price.discount_rate).toFixed(1)}%
          </button>
        ) : '-'}
      </td>
      <td>
        {editing ? (
          <div className="flex gap-1">
            <button onClick={confirmEdit} disabled={saving} className="text-xs text-blue-600 hover:text-blue-800">{saving ? '...' : '저장'}</button>
            <button onClick={() => setEditing(false)} className="text-xs text-slate-400 hover:text-slate-600">취소</button>
          </div>
        ) : (
          <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600">삭제</button>
        )}
      </td>
    </tr>
  );
}
