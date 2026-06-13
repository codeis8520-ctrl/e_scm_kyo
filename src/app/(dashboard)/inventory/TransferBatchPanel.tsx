'use client';

import { useState, useMemo, useEffect } from 'react';
import { transferInventoryBatch, getInventory } from '@/lib/actions';

interface Inventory {
  id: string;
  branch_id: string;
  product_id: string;
  quantity: number;
  product?: { id: string; name: string; code: string };
}

interface Props {
  branches: { id: string; name: string; is_headquarters?: boolean }[];
  defaultFromBranchId?: string;
  fromBranchLocked?: boolean;
  onSuccess: () => void;
}

interface TransferRow {
  product_id: string;
  name: string;
  code: string;
  quantity: number;
}

export default function TransferBatchPanel({
  branches,
  defaultFromBranchId,
  fromBranchLocked,
  onSuccess,
}: Props) {
  const [fromBranchId, setFromBranchId] = useState(defaultFromBranchId || '');
  const [toBranchId, setToBranchId] = useState('');
  const [memo, setMemo] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 출발 지점 자체 페치 재고 — page-level prop 의존 제거(HQ 직행 시 후보 공백 방지)
  const [srcInventories, setSrcInventories] = useState<Inventory[]>([]);
  const [loadingInv, setLoadingInv] = useState(false);

  // 출발 지점 변경 시마다 해당 지점 재고를 직접 페치
  useEffect(() => {
    if (!fromBranchId) {
      setSrcInventories([]);
      return;
    }
    let cancelled = false;
    setLoadingInv(true);
    getInventory(fromBranchId)
      .then((res) => {
        if (!cancelled) setSrcInventories((res?.data || []) as Inventory[]);
      })
      .catch(() => {
        if (!cancelled) setSrcInventories([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingInv(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fromBranchId]);

  // 출발 지점 + product_id 매칭 현재고
  const stockOf = (productId: string): number | null => {
    const inv = srcInventories.find(
      (i) => i.branch_id === fromBranchId && i.product_id === productId
    );
    return inv ? inv.quantity : null;
  };

  // 둘러보기 목록 — 출발 지점(fromBranchId) 재고>0 품목 전체. search 는 필터로만 동작.
  // 이미 담긴 품목도 목록에 남긴다(체크 상태로 표시). 이름 한글 오름차순 정렬, 상위 200개 캡.
  const BROWSE_CAP = 200;
  const browseAll = useMemo(() => {
    if (!fromBranchId) return [];
    const seen = new Set<string>();
    const out: { product_id: string; name: string; code: string }[] = [];
    for (const inv of srcInventories) {
      const p = inv.product;
      if (!p) continue;
      if (inv.branch_id !== fromBranchId) continue;
      if (inv.quantity <= 0) continue;
      if (seen.has(inv.product_id)) continue;
      seen.add(inv.product_id);
      out.push({ product_id: inv.product_id, name: p.name, code: p.code });
    }
    out.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
    return out;
  }, [srcInventories, fromBranchId]);

  const browseFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return browseAll;
    return browseAll.filter((c) => {
      const name = (c.name || '').toLowerCase();
      const code = (c.code || '').toLowerCase();
      return name.includes(q) || code.includes(q);
    });
  }, [browseAll, search]);

  const browseList = browseFiltered.slice(0, BROWSE_CAP);
  const overCap = browseFiltered.length > BROWSE_CAP;

  const addRow = (c: { product_id: string; name: string; code: string }) => {
    setRows((prev) => [...prev, { ...c, quantity: 1 }]);
  };

  const updateQty = (productId: string, qty: number) => {
    setRows((prev) =>
      prev.map((r) => (r.product_id === productId ? { ...r, quantity: qty } : r))
    );
  };

  const removeRow = (productId: string) => {
    setRows((prev) => prev.filter((r) => r.product_id !== productId));
  };

  // 체크 ↔ rows 단일 출처 동기화 — checked 는 rows 파생, 토글은 add/remove 만.
  const toggleProduct = (c: { product_id: string; name: string; code: string }) => {
    const checked = rows.some((r) => r.product_id === c.product_id);
    if (checked) removeRow(c.product_id);
    else addRow(c);
  };

  // 전체 선택 — 현재 필터된 browseList 중 아직 안 담긴 것 전부 quantity:1 로 추가.
  const selectAllFiltered = () => {
    setRows((prev) => {
      const have = new Set(prev.map((r) => r.product_id));
      const toAdd = browseList
        .filter((c) => !have.has(c.product_id))
        .map((c) => ({ ...c, quantity: 1 }));
      return [...prev, ...toAdd];
    });
  };

  // 전체 해제 — browseList 에 보이는 product_id 들만 제거(필터 밖에서 담긴 품목 보존).
  const deselectAllFiltered = () => {
    const visible = new Set(browseList.map((c) => c.product_id));
    setRows((prev) => prev.filter((r) => !visible.has(r.product_id)));
  };

  // 출발 지점 변경 시 — 다른 지점 재고 기준이므로 선택 품목 초기화
  const handleFromChange = (id: string) => {
    setFromBranchId(id);
    setRows([]);
    setSearch('');
  };

  const sameBranch = !!fromBranchId && !!toBranchId && fromBranchId === toBranchId;
  const hasOver = rows.some((r) => {
    const stock = stockOf(r.product_id);
    return stock !== null && r.quantity > stock;
  });
  const hasInvalidQty = rows.some((r) => r.quantity < 1);
  const submitDisabled =
    loading ||
    sameBranch ||
    hasOver ||
    hasInvalidQty ||
    rows.length === 0 ||
    !fromBranchId ||
    !toBranchId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!fromBranchId) {
      setError('출발 지점을 선택하세요.');
      return;
    }
    if (!toBranchId) {
      setError('도착 지점을 선택하세요.');
      return;
    }
    if (fromBranchId === toBranchId) {
      setError('동일 지점 간 이동은 할 수 없습니다.');
      return;
    }
    if (rows.length === 0) {
      setError('이동 품목을 1개 이상 추가하세요.');
      return;
    }
    for (const r of rows) {
      if (!Number.isInteger(r.quantity) || r.quantity < 1) {
        setError(`'${r.name}' 수량은 1개 이상의 정수여야 합니다.`);
        return;
      }
    }

    setLoading(true);
    const result = await transferInventoryBatch({
      from_branch_id: fromBranchId,
      to_branch_id: toBranchId,
      memo: memo || undefined,
      items: rows.map((r) => ({ product_id: r.product_id, quantity: r.quantity })),
    });

    if (result?.error) {
      setError(result.error);
      setLoading(false);
    } else {
      setRows([]);
      setMemo('');
      setSearch('');
      setLoading(false);
      onSuccess();
    }
  };

  return (
    <div className="border border-slate-200 rounded-lg p-5">
      <h3 className="text-base font-bold mb-4">지점 재고 이동</h3>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 출발 → 도착 2-panel */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700">출발 지점 *</label>
            <select
              value={fromBranchId}
              onChange={(e) => handleFromChange(e.target.value)}
              disabled={fromBranchLocked}
              required
              className={`mt-1 input ${fromBranchLocked ? 'bg-slate-100 cursor-not-allowed' : ''}`}
            >
              <option value="">지점 선택</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-center pb-2 text-2xl text-slate-400 select-none">
            →
          </div>

          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700">도착 지점 *</label>
            <select
              value={toBranchId}
              onChange={(e) => setToBranchId(e.target.value)}
              required
              className="mt-1 input"
            >
              <option value="">지점 선택</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>

        {sameBranch && (
          <p className="text-sm text-red-600">동일 지점 간 이동은 할 수 없습니다.</p>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700">메모</label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="이동 사유 (선택)"
            className="mt-1 input"
          />
        </div>

        {/* 둘러보기 목록 — 출발 지점 재고>0 품목 체크박스 다중선택. search 는 목록 필터. */}
        <div>
          <div className="flex items-center justify-between gap-2">
            <label className="block text-sm font-medium text-gray-700">품목 선택</label>
            {fromBranchId && browseAll.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="text-xs text-blue-600 hover:underline"
                >
                  전체 선택
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={deselectAllFiltered}
                  className="text-xs text-slate-500 hover:underline"
                >
                  전체 해제
                </button>
              </div>
            )}
          </div>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={fromBranchId ? '제품명 / 코드로 목록 필터...' : '먼저 출발 지점을 선택하세요'}
            disabled={!fromBranchId}
            className={`mt-1 input ${!fromBranchId ? 'bg-slate-100 cursor-not-allowed' : ''}`}
          />

          {!fromBranchId && (
            <p className="mt-2 text-sm text-slate-400">먼저 출발 지점을 선택하세요.</p>
          )}
          {fromBranchId && loadingInv && (
            <p className="mt-2 text-xs text-slate-400">출발 지점 재고 불러오는 중...</p>
          )}
          {fromBranchId && !loadingInv && browseAll.length === 0 && (
            <p className="mt-2 text-sm text-slate-400">이동 가능한 재고가 없습니다.</p>
          )}
          {fromBranchId && !loadingInv && browseAll.length > 0 && (
            <>
              {browseList.length === 0 ? (
                <p className="mt-2 text-xs text-slate-400">검색 결과 없음</p>
              ) : (
                <div className="mt-1 border border-slate-200 rounded-lg max-h-72 overflow-y-auto divide-y">
                  {browseList.map((c) => {
                    const checked = rows.some((r) => r.product_id === c.product_id);
                    const stock = stockOf(c.product_id);
                    return (
                      <label
                        key={c.product_id}
                        className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProduct(c)}
                          className="h-4 w-4 shrink-0"
                        />
                        <span className="flex-1 min-w-0">
                          <span className="font-medium">{c.name}</span>
                          <span className="text-slate-500"> · {c.code}</span>
                        </span>
                        <span className="text-xs text-slate-500 shrink-0">
                          현재고 <span className="font-semibold">{stock === null ? 0 : stock}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              {overCap && (
                <p className="mt-1 text-xs text-slate-400">상위 200개만 표시 — 검색으로 좁히세요</p>
              )}
            </>
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

        <div className="pt-2">
          <button
            type="submit"
            disabled={submitDisabled}
            className="btn-primary"
          >
            {loading ? '처리 중...' : `일괄 이동 (${rows.length})`}
          </button>
        </div>
      </form>
    </div>
  );
}
