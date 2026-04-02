'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { createBranch, updateBranch, deleteBranch } from '@/lib/actions';
import { validators } from '@/lib/validators';

interface Branch {
  id: string;
  name: string;
  code: string;
  channel: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
}

const CHANNEL_OPTIONS = [
  { value: 'STORE', label: '한약국' },
  { value: 'DEPT_STORE', label: '백화점' },
  { value: 'ONLINE', label: '자사몰' },
  { value: 'EVENT', label: '이벤트' },
];

const CHANNEL_COLORS: Record<string, string> = {
  STORE: 'bg-emerald-100 text-emerald-700',
  DEPT_STORE: 'bg-purple-100 text-purple-700',
  ONLINE: 'bg-blue-100 text-blue-700',
  EVENT: 'bg-amber-100 text-amber-700',
};

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);

  useEffect(() => {
    fetchBranches();
  }, []);

  const fetchBranches = async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase.from('branches').select('*').order('created_at', { ascending: true });
    setBranches(data || []);
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await deleteBranch(id);
    fetchBranches();
  };

  return (
    <div className="card">
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-semibold text-lg">지점 목록</h3>
        <button
          onClick={() => { setEditingBranch(null); setShowModal(true); }}
          className="btn-primary"
        >
          + 지점 추가
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-slate-400">불러오는 중...</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>지점코드</th>
              <th>지점명</th>
              <th>채널</th>
              <th>연락처</th>
              <th>주소</th>
              <th>상태</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {branches.map((branch) => (
              <tr key={branch.id}>
                <td className="font-mono">{branch.code}</td>
                <td className="font-medium">{branch.name}</td>
                <td>
                  <span className={`badge ${CHANNEL_COLORS[branch.channel] || 'bg-slate-100'}`}>
                    {CHANNEL_OPTIONS.find(c => c.value === branch.channel)?.label || branch.channel}
                  </span>
                </td>
                <td>{branch.phone || '-'}</td>
                <td className="text-slate-500 text-sm max-w-xs truncate">{branch.address || '-'}</td>
                <td>
                  <span className={`badge ${branch.is_active ? 'badge-success' : 'badge-error'}`}>
                    {branch.is_active ? '활성' : '비활성'}
                  </span>
                </td>
                <td>
                  <button
                    onClick={() => { setEditingBranch(branch); setShowModal(true); }}
                    className="text-blue-600 hover:underline mr-2"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => handleDelete(branch.id)}
                    className="text-red-600 hover:underline"
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {branches.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-slate-400 py-8">
                  등록된 지점이 없습니다
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {showModal && (
        <BranchModal
          branch={editingBranch}
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); fetchBranches(); }}
        />
      )}
    </div>
  );
}

function BranchModal({ branch, onClose, onSuccess }: { branch: Branch | null; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    name: branch?.name || '',
    code: branch?.code || '',
    channel: branch?.channel || 'STORE',
    address: branch?.address || '',
    phone: branch?.phone || '',
    is_active: branch?.is_active ?? true,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setFieldErrors({});

    const errors: Record<string, string> = {};
    const nameError = validators.required(formData.name, '지점명');
    if (nameError) errors.name = nameError;
    const codeError = validators.required(formData.code, '지점코드');
    if (codeError) errors.code = codeError;
    else {
      const codeFormatError = validators.code(formData.code);
      if (codeFormatError) errors.code = codeFormatError;
    }
    if (formData.phone) {
      const phoneError = validators.phone(formData.phone);
      if (phoneError) errors.phone = phoneError;
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setLoading(false);
      return;
    }

    const form = new FormData();
    Object.entries(formData).forEach(([key, value]) => {
      form.append(key, String(value));
    });

    const result = branch
      ? await updateBranch(branch.id, form)
      : await createBranch(form);

    if (result?.error) {
      setError(result.error);
      setLoading(false);
    } else {
      onSuccess();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">{branch ? '지점 수정' : '지점 추가'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">지점명 *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => { setFormData({ ...formData, name: e.target.value }); setFieldErrors({ ...fieldErrors, name: '' }); }}
              className={`mt-1 input ${fieldErrors.name ? 'border-red-500' : ''}`}
            />
            {fieldErrors.name && <p className="mt-1 text-xs text-red-500">{fieldErrors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">지점코드 *</label>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => { setFormData({ ...formData, code: e.target.value }); setFieldErrors({ ...fieldErrors, code: '' }); }}
              placeholder="SEOUL-01"
              className={`mt-1 input ${fieldErrors.code ? 'border-red-500' : ''}`}
            />
            {fieldErrors.code && <p className="mt-1 text-xs text-red-500">{fieldErrors.code}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">채널 *</label>
            <select
              value={formData.channel}
              onChange={(e) => setFormData({ ...formData, channel: e.target.value })}
              className="mt-1 input"
            >
              {CHANNEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">연락처</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => { setFormData({ ...formData, phone: e.target.value }); setFieldErrors({ ...fieldErrors, phone: '' }); }}
              placeholder="02-1234-5678"
              className={`mt-1 input ${fieldErrors.phone ? 'border-red-500' : ''}`}
            />
            {fieldErrors.phone && <p className="mt-1 text-xs text-red-500">{fieldErrors.phone}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">주소</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="mt-1 input"
            />
          </div>

          {branch && (
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
              {loading ? '처리 중...' : (branch ? '수정' : '추가')}
            </button>
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}
