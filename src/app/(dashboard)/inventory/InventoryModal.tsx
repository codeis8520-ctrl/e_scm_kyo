'use client';

import { useState, useEffect } from 'react';
import { adjustInventory, getBranches } from '@/lib/actions';

interface Props {
  inventory?: any;
  onClose: () => void;
  onSuccess: () => void;
}

export default function InventoryModal({ inventory, onClose, onSuccess }: Props) {
  const [branches, setBranches] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    branch_id: inventory?.branch_id || '',
    product_id: inventory?.product_id || '',
    movement_type: 'IN',
    quantity: 1,
    memo: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getBranches().then(res => setBranches(res.data || []));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!formData.branch_id) {
      setError('지점을 선택해주세요.');
      setLoading(false);
      return;
    }

    const form = new FormData();
    Object.entries(formData).forEach(([key, value]) => {
      form.append(key, String(value));
    });

    try {
      await adjustInventory(form);
      onSuccess();
    } catch (err: any) {
      setError(err?.message || '재고 조정 중 오류가 발생했습니다.');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">재고 조정</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>

        {inventory && (
          <div className="mb-4 p-3 bg-slate-100 rounded-lg">
            <p className="font-medium">{inventory.product?.name}</p>
            <p className="text-sm text-slate-500">{inventory.branch?.name}</p>
            <p className="text-sm">현재고: <span className="font-semibold">{inventory.quantity}</span></p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">지점 *</label>
            <select
              value={formData.branch_id}
              onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
              required
              disabled={!!inventory}
              className="mt-1 input"
            >
              <option value="">선택하세요</option>
              {branches.map(branch => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">조정 유형 *</label>
            <div className="flex gap-2 mt-1">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, movement_type: 'IN' })}
                className={`flex-1 py-2 rounded-md ${
                  formData.movement_type === 'IN'
                    ? 'bg-green-500 text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                입고 (+)
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, movement_type: 'OUT' })}
                className={`flex-1 py-2 rounded-md ${
                  formData.movement_type === 'OUT'
                    ? 'bg-red-500 text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                출고 (-)
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, movement_type: 'ADJUST' })}
                className={`flex-1 py-2 rounded-md ${
                  formData.movement_type === 'ADJUST'
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                조정 (=)
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">수량 *</label>
            <input
              type="number"
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 })}
              required
              min="1"
              className="mt-1 input"
            />
            {formData.quantity < 1 && (
              <p className="mt-1 text-xs text-red-500">수량은 1 이상이어야 합니다</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">메모</label>
            <input
              type="text"
              value={formData.memo}
              onChange={(e) => setFormData({ ...formData, memo: e.target.value })}
              placeholder="입출고 사유..."
              className="mt-1 input"
            />
          </div>

          <div className="pt-4">
            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary"
            >
              {loading ? '처리 중...' : '적용'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
