'use client';

import { useState, useEffect } from 'react';
import { createCustomer, updateCustomer, deleteCustomer, getBranches } from '@/lib/actions';
import { validators, formatPhone } from '@/lib/validators';

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

export default function CustomerModal({ customer, onClose, onSuccess }: Props) {
  const [branches, setBranches] = useState<any[]>([]);
  const [formData, setFormData] = useState<Customer>({
    name: customer?.name || '',
    phone: customer?.phone || '',
    email: customer?.email || null,
    address: customer?.address || null,
    grade: customer?.grade || 'NORMAL',
    primary_branch_id: customer?.primary_branch_id || null,
    health_note: customer?.health_note || null,
    is_active: customer?.is_active ?? true,
  });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getBranches().then(res => setBranches(res.data || []));
  }, []);

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
    const emailError = validators.email(formData.email);
    if (emailError) errors.email = emailError;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setLoading(false);
      return;
    }

    const form = new FormData();
    Object.entries(formData).forEach(([key, value]) => {
      form.append(key, String(value));
    });

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
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">
            {customer?.id ? '고객 수정' : '고객 등록'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">이름 *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => {
                setFormData({ ...formData, name: e.target.value });
                setFieldErrors({ ...fieldErrors, name: '' });
              }}
              required
              className={`mt-1 input ${fieldErrors.name ? 'border-red-500' : ''}`}
            />
            {fieldErrors.name && (
              <p className="mt-1 text-xs text-red-500">{fieldErrors.name}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">연락처 *</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => {
                const formatted = formatPhone(e.target.value);
                setFormData({ ...formData, phone: formatted });
                setFieldErrors({ ...fieldErrors, phone: '' });
              }}
              required
              placeholder="010-0000-0000"
              className={`mt-1 input ${fieldErrors.phone ? 'border-red-500' : ''}`}
            />
            {fieldErrors.phone && (
              <p className="mt-1 text-xs text-red-500">{fieldErrors.phone}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">이메일</label>
            <input
              type="email"
              value={formData.email || ''}
              onChange={(e) => {
                setFormData({ ...formData, email: e.target.value || null });
                setFieldErrors({ ...fieldErrors, email: '' });
              }}
              className={`mt-1 input ${fieldErrors.email ? 'border-red-500' : ''}`}
              placeholder="example@email.com"
            />
            {fieldErrors.email && (
              <p className="mt-1 text-xs text-red-500">{fieldErrors.email}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">주소</label>
            <input
              type="text"
              value={formData.address || ''}
              onChange={(e) => setFormData({ ...formData, address: e.target.value || null })}
              className="mt-1 input"
              placeholder="北京市朝阳区..."
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
                <option value="NORMAL">일반</option>
                <option value="VIP">VIP</option>
                <option value="VVIP">VVIP</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">담당 지점</label>
              <select
                value={formData.primary_branch_id || ''}
                onChange={(e) => setFormData({ ...formData, primary_branch_id: e.target.value || null })}
                className="mt-1 input"
              >
                <option value="">선택하세요</option>
                {branches.map(branch => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">건강 메모</label>
            <textarea
              value={formData.health_note || ''}
              onChange={(e) => setFormData({ ...formData, health_note: e.target.value || null })}
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
            <button
              type="submit"
              disabled={loading}
              className="flex-1 btn-primary"
            >
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
