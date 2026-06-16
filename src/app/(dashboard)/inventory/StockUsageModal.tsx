'use client';

import { useState, useMemo } from 'react';
import { recordStockUsage } from '@/lib/actions';
import { useEscClose } from '@/hooks/useEscClose';

interface Inventory {
  id: string;
  branch_id: string;
  product_id: string;
  quantity: number;
  product?: { id: string; name: string; code: string };
}

interface UsageType {
  id: string;
  code: string;
  name: string;
}

interface Props {
  branches: { id: string; name: string; is_headquarters?: boolean }[];
  inventories: Inventory[];
  usageTypes: UsageType[];
  defaultBranchId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface UsageRow {
  product_id: string;
  name: string;
  code: string;
  quantity: number;
}

export default function StockUsageModal({
  branches,
  inventories,
  usageTypes,
  defaultBranchId,
  onClose,
  onSuccess,
}: Props) {
  const branchLocked = !!defaultBranchId;
  const [branchId, setBranchId] = useState(defaultBranchId || '');
  const [usageTypeId, setUsageTypeId] = useState('');
  const [memo, setMemo] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEscClose(onClose, {
    isDirty: () => rows.length > 0 || usageTypeId !== '' || memo.trim() !== '',
  });

  // 선택 지점 + product_id 매칭 현재고
  const stockOf = (productId: string): number | null => {
    const inv = inventories.find(
      (i) => i.branch_id === branchId && i.product_id === productId
    );
    return inv ? inv.quantity : null;
  };

  // 제품 검색 후보 — inventories 의 product 로 필터 (이미 추가된 품목 제외)
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const addedIds = new Set(rows.map((r) => r.product_id));
    const seen = new Set<string>();
    const out: { product_id: string; name: string; code: string }[] = [];
    for (const inv of inventories) {
      const p = inv.product;
      if (!p) continue;
      if (seen.has(inv.product_id) || addedIds.has(inv.product_id)) continue;
      const name = (p.name || '').toLowerCase();
      const code = (p.code || '').toLowerCase();
      if (name.includes(q) || code.includes(q)) {
        seen.add(inv.product_id);
        out.push({ product_id: inv.product_id, name: p.name, code: p.code });
      }
    }
    return out.slice(0, 20);
  }, [search, inventories, rows]);

  const addRow = (c: { product_id: string; name: string; code: string }) => {
    setRows((prev) => [...prev, { ...c, quantity: 1 }]);
    setSearch('');
  };

  const updateQty = (productId: string, qty: number) => {
    setRows((prev) =>
      prev.map((r) => (r.product_id === productId ? { ...r, quantity: qty } : r))
    );
  };

  const removeRow = (productId: string) => {
    setRows((prev) => prev.filter((r) => r.product_id !== productId));
  };

  const noUsageTypes = usageTypes.length === 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!branchId) {
      setError('지점을 선택하세요.');
      return;
    }
    if (!usageTypeId) {
      setError('사용유형을 선택하세요.');
      return;
    }
    if (rows.length === 0) {
      setError('소모 품목을 1개 이상 추가하세요.');
      return;
    }
    for (const r of rows) {
      if (!Number.isInteger(r.quantity) || r.quantity < 1) {
        setError(`'${r.name}' 수량은 1개 이상의 정수여야 합니다.`);
        return;
      }
    }

    setLoading(true);
    const result = await recordStockUsage({
      branch_id: branchId,
      usage_type_id: usageTypeId,
      memo: memo || undefined,
      items: rows.map((r) => ({ product_id: r.product_id, quantity: r.quantity })),
    });

    if (result?.error) {
      setError(result.error);
      setLoading(false);
    } else {
      onSuccess();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">재고 소모 차감</h2>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">지점 *</label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                disabled={branchLocked}
                required
                className={`mt-1 input ${branchLocked ? 'bg-slate-100 cursor-not-allowed' : ''}`}
              >
                <option value="">지점 선택</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">사용유형 *</label>
              <select
                value={usageTypeId}
                onChange={(e) => setUsageTypeId(e.target.value)}
                disabled={noUsageTypes}
                required
                className={`mt-1 input ${noUsageTypes ? 'bg-slate-100 cursor-not-allowed' : ''}`}
              >
                <option value="">사용유형 선택</option>
                {usageTypes.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              {noUsageTypes && (
                <p className="mt-1 text-xs text-red-600">
                  사용유형을 먼저 시스템코드에서 등록하세요.
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">메모</label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="소모 사유 (선택)"
              className="mt-1 input"
            />
          </div>

          {/* 다건 품목 검색 */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700">품목 추가</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="제품명 / 코드 검색..."
              className="mt-1 input"
            />
            {candidates.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow max-h-56 overflow-y-auto">
                {candidates.map((c) => (
                  <li key={c.product_id}>
                    <button
                      type="button"
                      onClick={() => addRow(c)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-100 text-sm"
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="text-slate-500"> · {c.code}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 선택 품목 리스트 */}
          {rows.length > 0 && (
            <div className="border border-slate-200 rounded-lg divide-y">
              {rows.map((r) => {
                const stock = stockOf(r.product_id);
                const over = stock !== null && r.quantity > stock;
                return (
                  <div key={r.product_id} className="flex items-center gap-3 p-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{r.name}</p>
                      <p className="text-xs text-slate-500">
                        {r.code} · 현재고:{' '}
                        <span className="font-semibold">
                          {stock === null ? '없음(0)' : stock}
                        </span>
                        {over && (
                          <span className="ml-2 px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                            현재고 초과
                          </span>
                        )}
                      </p>
                    </div>
                    <input
                      type="number"
                      value={r.quantity}
                      min="1"
                      onChange={(e) => updateQty(r.product_id, parseInt(e.target.value) || 0)}
                      className={`input w-24 ${over ? 'border-red-400' : ''}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeRow(r.product_id)}
                      className="text-slate-400 hover:text-red-600 px-2"
                      aria-label="삭제"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="pt-2 flex gap-2">
            <button
              type="submit"
              disabled={loading || noUsageTypes}
              className="flex-1 btn-primary"
            >
              {loading ? '처리 중...' : `소모 차감 (${rows.length})`}
            </button>
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">
              취소
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
