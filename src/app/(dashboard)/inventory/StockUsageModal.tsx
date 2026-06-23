'use client';

import { useState, useMemo, useEffect } from 'react';
import { recordStockUsage } from '@/lib/actions';
import { useEscClose } from '@/hooks/useEscClose';
import { toNum, fmtStock } from '@/lib/validators';

// 팬텀 소모 단위 — 본인 재고가 없고 product_bom 으로 base 에서 분수 차감되는 제품(예: 침향 10환 → 30환 0.333).
interface PhantomUnit {
  product_id: string;
  name: string;
  code: string;
  decomposeLabel: string; // 예: "침향 30환 0.3333/개"
}

interface Inventory {
  id: string;
  branch_id: string;
  product_id: string;
  quantity: number;
  product?: { id: string; name: string; code: string; allow_decimal_stock?: boolean };
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
  defaultProductId?: string;   // 셀 클릭 시 1행 자동 채움
  onClose: () => void;
  onSuccess: () => void;
}

interface UsageRow {
  product_id: string;
  name: string;
  code: string;
  quantity: number;
  isPhantom?: boolean;       // 팬텀 소모 단위(본인 재고 없음 → base 분수 차감)
  decomposeLabel?: string;   // 팬텀 행 안내 문구
}

export default function StockUsageModal({
  branches,
  inventories,
  usageTypes,
  defaultBranchId,
  defaultProductId,
  onClose,
  onSuccess,
}: Props) {
  const branchLocked = !!defaultBranchId;
  const [branchId, setBranchId] = useState(defaultBranchId || '');
  const [usageTypeId, setUsageTypeId] = useState('');
  const [memo, setMemo] = useState('');
  const [search, setSearch] = useState('');
  // 셀 클릭 진입 시 클릭한 제품을 1행(수량 1) 자동 추가. 이후 다건 검색·삭제는 그대로.
  const [rows, setRows] = useState<UsageRow[]>(() => {
    if (!defaultProductId) return [];
    const inv = inventories.find(i => i.product_id === defaultProductId && i.product);
    return inv?.product
      ? [{ product_id: inv.product_id, name: inv.product.name, code: inv.product.code, quantity: 1 }]
      : [];
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [phantomUnits, setPhantomUnits] = useState<PhantomUnit[]>([]);
  // base 제품 id → 그 base 를 분해 소모하는 팬텀 단위 이름들(예: FCH30 → ["침향 10환","침향 1환"]).
  // 사용자가 base(30환)를 추가했을 때 "더 작은 단위는 세트로 검색" 안내에 사용.
  const [phantomsByBase, setPhantomsByBase] = useState<Map<string, string[]>>(new Map());

  // 팬텀 소모 단위 로드 — is_phantom 제품 중 product_bom(분수 BOM)이 있는 것만.
  // 본인 재고가 없어 inventories 후보엔 안 잡히므로 별도 조회해 검색 후보로 제공.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { createClient } = await import('@/lib/supabase/client');
      const client = createClient();
      const phRes: any = await client.from('products')
        .select('id, name, code').eq('is_active', true).eq('is_phantom', true).order('name');
      if (phRes.error) return; // is_phantom 컬럼 부재 등 → 팬텀 기능 비활성(기존 동작 유지)
      const phs = (phRes.data || []) as { id: string; name: string; code: string }[];
      if (phs.length === 0) { if (alive) setPhantomUnits([]); return; }
      const ids = phs.map((p) => p.id);
      const bomRes: any = await client.from('product_bom').select('product_id, material_id, quantity').in('product_id', ids);
      const boms = (bomRes.data || []) as { product_id: string; material_id: string; quantity: number }[];
      if (boms.length === 0) { if (alive) setPhantomUnits([]); return; }
      const matIds = Array.from(new Set(boms.map((b) => b.material_id)));
      const matRes: any = await client.from('products').select('id, name').in('id', matIds);
      const matName = new Map<string, string>((matRes.data || []).map((m: any) => [m.id, m.name]));
      const bomByPhantom = new Map<string, { material_id: string; quantity: number }[]>();
      for (const b of boms) {
        const arr = bomByPhantom.get(b.product_id) || [];
        arr.push(b); bomByPhantom.set(b.product_id, arr);
      }
      const units: PhantomUnit[] = [];
      const baseMap = new Map<string, string[]>(); // base id → 팬텀 단위 이름들
      for (const p of phs) {
        const comps = bomByPhantom.get(p.id);
        if (!comps || comps.length === 0) continue; // BOM 있는 팬텀만 소모 단위로 노출
        const label = comps.map((c) => `${matName.get(c.material_id) || '자재'} ${fmtStock(c.quantity, true)}/개`).join(', ');
        units.push({ product_id: p.id, name: p.name, code: p.code, decomposeLabel: label });
        for (const c of comps) {
          const arr = baseMap.get(c.material_id) || [];
          if (!arr.includes(p.name)) arr.push(p.name);
          baseMap.set(c.material_id, arr);
        }
      }
      if (alive) { setPhantomUnits(units); setPhantomsByBase(baseMap); }
    })().catch(() => { /* 팬텀 로드 실패 시 무시 — 일반 소모는 정상 동작 */ });
    return () => { alive = false; };
  }, []);

  useEscClose(onClose, {
    isDirty: () => rows.length > 0 || usageTypeId !== '' || memo.trim() !== '',
  });

  // 선택 지점 + product_id 매칭 현재고
  const stockOf = (productId: string): number | null => {
    const inv = inventories.find(
      (i) => i.branch_id === branchId && i.product_id === productId
    );
    return inv ? toNum(inv.quantity) : null;
  };
  // 제품의 소수점 재고 허용 여부 (표시 포맷용)
  const allowDecimalOf = (productId: string): boolean =>
    inventories.find((i) => i.product_id === productId)?.product?.allow_decimal_stock === true;

  // 제품 검색 후보 — inventories 의 product 로 필터 (이미 추가된 품목 제외)
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const addedIds = new Set(rows.map((r) => r.product_id));
    const seen = new Set<string>();
    const out: { product_id: string; name: string; code: string; isPhantom?: boolean; decomposeLabel?: string }[] = [];
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
    // 팬텀 소모 단위(침향 10환 등) — 본인 재고는 없지만 base 에서 분수 차감
    for (const u of phantomUnits) {
      if (seen.has(u.product_id) || addedIds.has(u.product_id)) continue;
      if (u.name.toLowerCase().includes(q) || u.code.toLowerCase().includes(q)) {
        seen.add(u.product_id);
        out.push({ product_id: u.product_id, name: u.name, code: u.code, isPhantom: true, decomposeLabel: u.decomposeLabel });
      }
    }
    return out.slice(0, 20);
  }, [search, inventories, rows, phantomUnits]);

  const addRow = (c: { product_id: string; name: string; code: string; isPhantom?: boolean; decomposeLabel?: string }) => {
    setRows((prev) => [...prev, { product_id: c.product_id, name: c.name, code: c.code, quantity: 1, isPhantom: c.isPhantom, decomposeLabel: c.decomposeLabel }]);
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

    if (result && 'error' in result && result.error) {
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
                      {c.isPhantom && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-xs">세트</span>
                      )}
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
                const stock = r.isPhantom ? null : stockOf(r.product_id);
                const over = !r.isPhantom && stock !== null && r.quantity > stock;
                return (
                  <div key={r.product_id} className="flex items-center gap-3 p-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {r.name}
                        {r.isPhantom && (
                          <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-xs align-middle">세트</span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">
                        {r.isPhantom ? (
                          <>{r.code} · 세트 분해 차감{r.decomposeLabel ? ` · ${r.decomposeLabel}` : ''}</>
                        ) : (
                          <>
                            {r.code} · 현재고:{' '}
                            <span className="font-semibold">
                              {stock === null ? '없음(0)' : fmtStock(stock, allowDecimalOf(r.product_id))}
                            </span>
                            {over && (
                              <span className="ml-2 px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                                현재고 초과
                              </span>
                            )}
                          </>
                        )}
                      </p>
                      {/* base(30환 등) 추가 시 — 더 작은 단위는 세트 팬텀으로 검색하라고 안내 */}
                      {!r.isPhantom && (phantomsByBase.get(r.product_id)?.length ?? 0) > 0 && (
                        <p className="text-xs text-amber-600 mt-0.5">
                          더 작은 단위로 소모하려면 검색에서 ‘{phantomsByBase.get(r.product_id)!.join('’, ‘')}’ (세트)로 추가하세요.
                        </p>
                      )}
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
