'use client';

import { useState, useEffect } from 'react';
import { getB2bPartners, createB2bPartner, updateB2bPartner } from '@/lib/b2b-actions';

const CYCLE_LABELS: Record<string, string> = { WEEKLY: '주간', BIWEEKLY: '격주', MONTHLY: '월간' };

export default function B2bPartnersTab() {
  const [partners, setPartners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);

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
                  <th>수수료</th>
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
                    <td className="text-sm">{p.commission_rate}%</td>
                    <td><span className={`badge text-xs ${p.is_active ? 'badge-success' : 'badge-error'}`}>{p.is_active ? '활성' : '비활성'}</span></td>
                    <td>
                      <button onClick={() => { setEditing(p); setShowForm(true); }} className="text-blue-600 hover:underline text-sm">수정</button>
                    </td>
                  </tr>
                ))}
                {partners.length === 0 && (
                  <tr><td colSpan={9} className="text-center py-8 text-slate-400">등록된 거래처가 없습니다</td></tr>
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
    commission_rate: partner?.commission_rate ?? 0,
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
          <div className="grid grid-cols-3 gap-3 pt-2 border-t">
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
            <div>
              <label className="block text-sm font-medium mb-1">수수료율 (%)</label>
              <input type="number" step="0.1" min={0} max={100} value={form.commission_rate} onChange={e => setForm({ ...form, commission_rate: parseFloat(e.target.value) || 0 })} className="input" />
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
