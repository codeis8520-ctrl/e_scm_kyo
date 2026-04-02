'use client';

import { useState, useEffect } from 'react';
import { createCustomer, updateCustomer, deleteCustomer } from '@/lib/actions';
import { createClient } from '@/lib/supabase/client';
import { validators, formatPhone } from '@/lib/validators';

declare global {
  interface Window {
    daum: any;
  }
}

interface Customer {
  id?: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  grade: string;
  primary_branch_id: string | null;
  health_note: string | null;
  is_active: boolean;
}

interface Props {
  customer?: Customer | null;
  onClose: () => void;
  onSuccess: () => void;
}

function splitAddress(address: string | null): [string, string] {
  if (!address) return ['', ''];
  const idx = address.indexOf('\n');
  if (idx === -1) return [address, ''];
  return [address.slice(0, idx), address.slice(idx + 1)];
}

export default function CustomerModal({ customer, onClose, onSuccess }: Props) {
  const [branches, setBranches] = useState<any[]>([]);
  const [grades, setGrades] = useState<any[]>([]);

  const [addr1, addr2] = splitAddress(customer?.address ?? null);
  const [formData, setFormData] = useState({
    name: customer?.name || '',
    phone: customer?.phone || '',
    email: customer?.email || '',
    grade: customer?.grade || '',
    primary_branch_id: customer?.primary_branch_id || '',
    health_note: customer?.health_note || '',
    is_active: customer?.is_active ?? true,
  });
  const [address1, setAddress1] = useState(addr1);
  const [address2, setAddress2] = useState(addr2);

  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    supabase.from('branches').select('id, name').eq('is_active', true).order('created_at').then(({ data }) => {
      setBranches(data || []);
    });

    supabase.from('customer_grades').select('code, name').eq('is_active', true).order('sort_order').then(({ data }) => {
      const list: { code: string; name: string }[] = (data as any) || [];
      setGrades(list);
      if (!formData.grade && list.length > 0) {
        setFormData(prev => ({ ...prev, grade: list[0].code }));
      }
    });

    // Daum 우편번호 스크립트 로드
    if (!window.daum) {
      const script = document.createElement('script');
      script.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      document.head.appendChild(script);
    }
  }, []);

  const openPostcode = () => {
    if (!window.daum) return;
    new window.daum.Postcode({
      oncomplete: (data: any) => {
        const road = data.roadAddress || data.jibunAddress;
        setAddress1(road);
        setAddress2('');
      },
    }).open();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setFieldErrors({});

    const errors: Record<string, string> = {};
    const nameError = validators.required(formData.name, '이름');
    if (nameError) errors.name = nameError;
    const phoneError = validators.phone(formData.phone);
    if (phoneError) errors.phone = phoneError;
    if (formData.email) {
      const emailError = validators.email(formData.email);
      if (emailError) errors.email = emailError;
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setLoading(false);
      return;
    }

    const combinedAddress = address2.trim()
      ? `${address1.trim()}\n${address2.trim()}`
      : address1.trim() || null;

    const form = new FormData();
    form.append('name', formData.name);
    form.append('phone', formData.phone);
    form.append('email', formData.email);
    form.append('grade', formData.grade);
    form.append('primary_branch_id', formData.primary_branch_id);
    form.append('health_note', formData.health_note);
    form.append('is_active', String(formData.is_active));
    if (combinedAddress) form.append('address', combinedAddress);

    const result = customer?.id
      ? await updateCustomer(customer.id, form)
      : await createCustomer(form);

    if (result?.error) {
      setError(result.error);
      setLoading(false);
    } else {
      onSuccess();
    }
  };

  const handleDelete = async () => {
    if (!customer?.id) return;
    if (!confirm('정말 삭제하시겠습니까?')) return;
    setLoading(true);
    await deleteCustomer(customer.id);
    onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">
            {customer?.id ? '고객 수정' : '고객 등록'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">이름 *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => { setFormData({ ...formData, name: e.target.value }); setFieldErrors({ ...fieldErrors, name: '' }); }}
              required
              className={`mt-1 input ${fieldErrors.name ? 'border-red-500' : ''}`}
            />
            {fieldErrors.name && <p className="mt-1 text-xs text-red-500">{fieldErrors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">연락처 *</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => { setFormData({ ...formData, phone: formatPhone(e.target.value) }); setFieldErrors({ ...fieldErrors, phone: '' }); }}
              required
              placeholder="010-0000-0000"
              className={`mt-1 input ${fieldErrors.phone ? 'border-red-500' : ''}`}
            />
            {fieldErrors.phone && <p className="mt-1 text-xs text-red-500">{fieldErrors.phone}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">이메일</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => { setFormData({ ...formData, email: e.target.value }); setFieldErrors({ ...fieldErrors, email: '' }); }}
              className={`mt-1 input ${fieldErrors.email ? 'border-red-500' : ''}`}
              placeholder="example@email.com"
            />
            {fieldErrors.email && <p className="mt-1 text-xs text-red-500">{fieldErrors.email}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">주소</label>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={address1}
                readOnly
                className="input flex-1 bg-slate-50 cursor-pointer"
                placeholder="주소 검색 버튼을 눌러주세요"
                onClick={openPostcode}
              />
              <button
                type="button"
                onClick={openPostcode}
                className="btn-secondary whitespace-nowrap"
              >
                주소 검색
              </button>
            </div>
            <input
              type="text"
              value={address2}
              onChange={(e) => setAddress2(e.target.value)}
              className="mt-2 input"
              placeholder="상세 주소 (동/호수 등)"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">등급</label>
              <select
                value={formData.grade}
                onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
                className="mt-1 input"
              >
                {grades.map(g => (
                  <option key={g.code} value={g.code}>{g.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">담당 지점</label>
              <select
                value={formData.primary_branch_id}
                onChange={(e) => setFormData({ ...formData, primary_branch_id: e.target.value })}
                className="mt-1 input"
              >
                <option value="">선택 안 함</option>
                {branches.map(branch => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">건강 메모</label>
            <textarea
              value={formData.health_note}
              onChange={(e) => setFormData({ ...formData, health_note: e.target.value })}
              rows={3}
              className="mt-1 input"
              placeholder="건강 관련 특이사항..."
            />
          </div>

          {customer?.id && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              />
              <label htmlFor="is_active" className="text-sm text-gray-700">활성 상태</label>
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <button type="submit" disabled={loading} className="flex-1 btn-primary">
              {loading ? '처리 중...' : (customer?.id ? '수정' : '등록')}
            </button>
            {customer?.id && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={loading}
                className="px-4 py-2 bg-red-100 text-red-600 rounded-md hover:bg-red-200"
              >
                삭제
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
