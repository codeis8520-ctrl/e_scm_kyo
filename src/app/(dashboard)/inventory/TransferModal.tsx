'use client';

import { useState, useEffect } from 'react';
import { transferInventory } from '@/lib/actions';
import { useEscClose } from '@/hooks/useEscClose';
import { toNum, fmtStock } from '@/lib/validators';
import { fmtDateKST } from '@/lib/date';

interface Props {
  inventory: {
    id: string;
    product_id: string;
    quantity: number;
    product?: { name: string; code: string; allow_decimal_stock?: boolean };
    branch?: { id: string; name: string };
  };
  branches: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function TransferModal({ inventory, branches, onClose, onSuccess }: Props) {
  const [formData, setFormData] = useState({
    from_branch_id: inventory.branch?.id || '',
    to_branch_id: '',
    quantity: 1,
    memo: '',
    ship_date: fmtDateKST(new Date()),  // 출발(출고)일, 기본=오늘(KST)
    arrival_date: '',                    // 도착예정일(선택)
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEscClose(onClose, {
    isDirty: () => formData.to_branch_id !== '' || formData.memo.trim() !== '',
  });

  const availableBranches = branches.filter(b => b.id !== inventory.branch?.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!formData.to_branch_id) {
      setError('이동할 지점을 선택해주세요.');
      setLoading(false);
      return;
    }

    if (formData.quantity > toNum(inventory.quantity)) {
      setError('이동 수량이 현재 재고보다 많습니다.');
      setLoading(false);
      return;
    }

    if (formData.arrival_date && formData.ship_date && formData.arrival_date < formData.ship_date) {
      setError('도착예정일은 출발일과 같거나 이후여야 합니다.');
      setLoading(false);
      return;
    }

    const form = new FormData();
    form.append('from_branch_id', formData.from_branch_id);
    form.append('to_branch_id', formData.to_branch_id);
    form.append('product_id', inventory.product_id);
    form.append('quantity', String(formData.quantity));
    form.append('memo', formData.memo);
    form.append('ship_date', formData.ship_date);
    form.append('arrival_date', formData.arrival_date);

    const result = await transferInventory(form);

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
          <h2 className="text-lg font-bold">지점 간 재고 이동</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="mb-4 p-3 bg-slate-100 rounded-lg">
          <p className="font-medium">{inventory.product?.name}</p>
          <p className="text-sm text-slate-500">
            {inventory.product?.code} · 현재고: <span className="font-semibold">{fmtStock(inventory.quantity, inventory.product?.allow_decimal_stock)}</span>
          </p>
          <p className="text-sm text-slate-500">출고 지점: {inventory.branch?.name}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">이동할 지점 *</label>
            <select
              value={formData.to_branch_id}
              onChange={(e) => setFormData({ ...formData, to_branch_id: e.target.value })}
              required
              className="mt-1 input"
            >
              <option value="">지점 선택</option>
              {availableBranches.map(branch => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">이동 수량 *</label>
            <input
              type="number"
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 })}
              required
              min="1"
              max={toNum(inventory.quantity)}
              className="mt-1 input"
            />
            <p className="mt-1 text-xs text-slate-500">
              이동 가능 수량: {fmtStock(inventory.quantity, inventory.product?.allow_decimal_stock)}개
            </p>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700">출발(출고)일 *</label>
              <input
                type="date"
                value={formData.ship_date}
                onChange={(e) => setFormData({ ...formData, ship_date: e.target.value })}
                required
                className="mt-1 input"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700">도착예정일</label>
              <input
                type="date"
                value={formData.arrival_date}
                min={formData.ship_date || undefined}
                onChange={(e) => setFormData({ ...formData, arrival_date: e.target.value })}
                className="mt-1 input"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">메모</label>
            <input
              type="text"
              value={formData.memo}
              onChange={(e) => setFormData({ ...formData, memo: e.target.value })}
              placeholder="이동 사유 (선택)"
              className="mt-1 input"
            />
          </div>

          <div className="pt-4 flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 btn-primary"
            >
              {loading ? '이동 중...' : '이동'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 btn-secondary"
            >
              취소
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
