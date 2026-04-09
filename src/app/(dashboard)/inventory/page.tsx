'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import InventoryModal from './InventoryModal';
import TransferModal from './TransferModal';
import { updateSafetyStock } from '@/lib/inventory-actions';

interface Inventory {
  id: string;
  branch_id: string;
  product_id: string;
  quantity: number;
  safety_stock: number;
  branch?: { id: string; name: string };
  product?: { id: string; name: string; code: string; barcode?: string };
}

interface Branch {
  id: string;
  name: string;
}

// 제품별 피벗 행: 제품 정보 + 지점별 재고 맵
interface ProductRow {
  productId: string;
  productName: string;
  productCode: string;
  barcode?: string;
  byBranch: Record<string, Inventory>; // branch_id → Inventory
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  return document.cookie.split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    acc[k] = decodeURIComponent(v || '');
    return acc;
  }, {} as Record<string, string>)[name] || null;
}

export default function InventoryPage() {
  const [inventories, setInventories] = useState<Inventory[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [editInventory, setEditInventory] = useState<Inventory | null>(null);
  const [transferInventory, setTransferInventory] = useState<Inventory | null>(null);
  const [viewMode, setViewMode] = useState<'pivot' | 'flat'>('pivot');
  const [flatBranchFilter, setFlatBranchFilter] = useState('');

  const userRole = getCookie('user_role');
  const userBranchId = getCookie('user_branch_id');
  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';

  useEffect(() => {
    fetchBranches();
    fetchInventory();
    if (isBranchUser && userBranchId) {
      setFlatBranchFilter(userBranchId);
      setViewMode('flat');
    }
  }, []);

  const fetchBranches = async () => {
    const supabase = createClient();
    const { data } = await supabase.from('branches').select('id, name').eq('is_active', true).order('name');
    setBranches(data || []);
  };

  const fetchInventory = async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from('inventories')
      .select('*, branch:branches(id, name), product:products(id, name, code, barcode)')
      .order('product_id');
    setInventories(data || []);
    setLoading(false);
  };

  const handleAdjust = (item: Inventory) => {
    setEditInventory(item);
    setShowModal(true);
  };

  const handleClose = () => {
    setShowModal(false);
    setEditInventory(null);
  };

  const handleSuccess = () => {
    handleClose();
    fetchInventory();
  };

  // ── 피벗 데이터 계산 ─────────────────────────────────────────────────
  const productRows: ProductRow[] = (() => {
    const map = new Map<string, ProductRow>();
    for (const inv of inventories) {
      if (!inv.product) continue;
      if (!map.has(inv.product_id)) {
        map.set(inv.product_id, {
          productId: inv.product_id,
          productName: inv.product.name,
          productCode: inv.product.code,
          barcode: inv.product.barcode,
          byBranch: {},
        });
      }
      map.get(inv.product_id)!.byBranch[inv.branch_id] = inv;
    }
    return Array.from(map.values()).sort((a, b) => a.productName.localeCompare(b.productName, 'ko'));
  })();

  // ── 검색 필터 ─────────────────────────────────────────────────────────
  const searchLower = search.toLowerCase();

  const filteredPivot = searchLower
    ? productRows.filter(r =>
        r.productName.toLowerCase().includes(searchLower) ||
        r.productCode.toLowerCase().includes(searchLower) ||
        (r.barcode || '').toLowerCase().includes(searchLower)
      )
    : productRows;

  const filteredFlat = inventories.filter(item => {
    const matchBranch = !flatBranchFilter || item.branch_id === flatBranchFilter;
    const matchSearch = !searchLower ||
      item.product?.name?.toLowerCase().includes(searchLower) ||
      item.product?.code?.toLowerCase().includes(searchLower) ||
      (item.product?.barcode || '').toLowerCase().includes(searchLower);
    return matchBranch && matchSearch;
  });

  // 재고 부족 수 (지점 사용자는 자기 지점만)
  const lowCount = inventories.filter(i =>
    i.quantity < i.safety_stock &&
    (!isBranchUser || !userBranchId || i.branch_id === userBranchId)
  ).length;

  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-lg">재고 현황</h3>
          {lowCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
              부족 {lowCount}건
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/inventory/count" className="btn-secondary py-2 px-4 text-sm">재고 실사</Link>
          <button
            onClick={() => { setEditInventory(null); setShowModal(true); }}
            className="btn-primary text-sm"
          >
            + 입출고
          </button>
        </div>
      </div>

      {/* 검색 + 뷰 전환 */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4 flex-wrap items-start sm:items-center">
        <input
          type="text"
          placeholder="제품명 / 코드 / 바코드 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-full sm:w-64"
        />

        {/* 뷰 모드 토글 — 지점 고정 사용자는 지점별만 */}
        {!isBranchUser && (
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
            <button
              onClick={() => setViewMode('pivot')}
              className={`px-4 py-2 font-medium transition-colors ${
                viewMode === 'pivot'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              제품별 (전체)
            </button>
            <button
              onClick={() => setViewMode('flat')}
              className={`px-4 py-2 font-medium transition-colors ${
                viewMode === 'flat'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              지점별
            </button>
          </div>
        )}

        {/* 지점별 뷰일 때만 지점 선택 */}
        {viewMode === 'flat' && (
          <select
            value={flatBranchFilter}
            onChange={(e) => setFlatBranchFilter(e.target.value)}
            disabled={isBranchUser}
            className={`input w-full sm:w-44 ${isBranchUser ? 'bg-slate-100 cursor-not-allowed' : ''}`}
          >
            <option value="">전체 지점</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="text-center text-slate-400 py-12">로딩 중...</div>
      ) : viewMode === 'pivot' ? (
        /* ── 제품별 피벗 뷰 ── */
        <div className="overflow-x-auto">
          <table className="table text-sm min-w-[500px]">
            <thead>
              <tr>
                <th className="w-24">코드</th>
                <th>제품명</th>
                {branches.map(b => (
                  <th key={b.id} className="text-center whitespace-nowrap">{b.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPivot.length === 0 ? (
                <tr>
                  <td colSpan={3 + branches.length} className="text-center text-slate-400 py-8">
                    검색 결과가 없습니다
                  </td>
                </tr>
              ) : filteredPivot.map(row => {
                const hasAnyLow = branches.some(b => {
                  const inv = row.byBranch[b.id];
                  return inv && inv.quantity < inv.safety_stock;
                });
                return (
                  <tr key={row.productId} className={hasAnyLow ? 'bg-red-50/30' : ''}>
                    <td className="font-mono text-xs text-slate-500">{row.productCode}</td>
                    <td>
                      <span className="font-medium">{row.productName}</span>
                      {row.barcode && (
                        <span className="ml-2 text-xs text-slate-400 font-mono">{row.barcode}</span>
                      )}
                    </td>
                    {branches.map(b => {
                      const inv = row.byBranch[b.id];
                      // 레코드가 없는 지점은 가상 재고 객체로 처리 (재고 0, 클릭 가능)
                      const effective: Inventory = inv ?? {
                        id: '',
                        branch_id: b.id,
                        product_id: row.productId,
                        quantity: 0,
                        safety_stock: 0,
                        branch: b,
                        product: { id: row.productId, name: row.productName, code: row.productCode, barcode: row.barcode },
                      };
                      const isLow = effective.quantity < effective.safety_stock;
                      const isMissing = !inv;
                      return (
                        <td key={b.id} className="text-center p-0">
                          <button
                            onClick={() => handleAdjust(effective)}
                            title={isMissing ? '재고 없음 · 클릭하여 입고' : `입출고 · 안전재고 ${effective.safety_stock}`}
                            className={`w-full h-full px-3 py-2 font-semibold transition-colors rounded hover:ring-2 hover:ring-blue-300 hover:ring-inset ${
                              isMissing
                                ? 'text-slate-300 hover:bg-blue-50 hover:text-slate-600'
                                : isLow
                                  ? 'text-red-600 bg-red-50 hover:bg-red-100'
                                  : 'text-slate-800 hover:bg-blue-50'
                            }`}
                          >
                            {effective.quantity}
                            {isLow && !isMissing && <span className="ml-1 text-xs font-normal">↓{effective.safety_stock}</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-slate-400 mt-3">
            숫자 클릭 → 입출고 처리 · 빨간 숫자 = 안전재고 미달 (↓기준값)
          </p>
        </div>
      ) : (
        /* ── 지점별 플랫 뷰 ── */
        <div className="overflow-x-auto">
        <table className="table min-w-[640px]">
          <thead>
            <tr>
              <th>지점</th>
              <th>제품코드</th>
              <th>제품명</th>
              <th>바코드</th>
              <th>현재재고</th>
              <th>안전재고</th>
              <th>상태</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {filteredFlat.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-slate-400 py-8">
                  재고 데이터가 없습니다
                </td>
              </tr>
            ) : filteredFlat.map((item) => {
              const isLow = item.quantity < item.safety_stock;
              return (
                <tr key={item.id}>
                  <td>{item.branch?.name}</td>
                  <td className="font-mono text-xs">{item.product?.code}</td>
                  <td>{item.product?.name}</td>
                  <td className="font-mono text-xs text-slate-500">{item.product?.barcode || '-'}</td>
                  <td className={isLow ? 'text-red-600 font-semibold' : ''}>
                    {item.quantity}
                  </td>
                  <td>
                    <SafetyStockCell
                      inventoryId={item.id}
                      productId={item.product_id}
                      value={item.safety_stock}
                      onSaved={fetchInventory}
                    />
                  </td>
                  <td>
                    {isLow ? (
                      <span className="badge badge-error">부족</span>
                    ) : (
                      <span className="badge badge-success">정상</span>
                    )}
                  </td>
                  <td>
                    <button
                      onClick={() => handleAdjust(item)}
                      className="text-blue-600 hover:underline mr-2"
                    >
                      입출고
                    </button>
                    <button
                      onClick={() => { setTransferInventory(item); setShowTransferModal(true); }}
                      className="text-green-600 hover:underline"
                    >
                      이동
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}

      {showModal && (
        <InventoryModal
          inventory={editInventory}
          onClose={handleClose}
          onSuccess={handleSuccess}
        />
      )}

      {showTransferModal && transferInventory && (
        <TransferModal
          inventory={transferInventory}
          branches={branches}
          onClose={() => { setShowTransferModal(false); setTransferInventory(null); }}
          onSuccess={() => { setShowTransferModal(false); setTransferInventory(null); fetchInventory(); }}
        />
      )}
    </div>
  );
}

// ── 안전재고 인라인 편집 셀 ────────────────────────────────────────────────

function SafetyStockCell({ inventoryId, productId, value, onSaved }: {
  inventoryId: string;
  productId: string;
  value: number;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  const handleSave = async (bulk: boolean) => {
    const num = parseInt(input);
    if (isNaN(num) || num < 0) return;
    if (num === value && !bulk) { setEditing(false); return; }
    setSaving(true);
    let res;
    if (bulk) {
      const { bulkUpdateSafetyStock } = await import('@/lib/inventory-actions');
      res = await bulkUpdateSafetyStock(productId, num);
    } else {
      res = await updateSafetyStock(inventoryId, num);
    }
    setSaving(false);
    if (res.error) { alert(res.error); return; }
    setEditing(false);
    setShowBulk(false);
    onSaved();
  };

  if (!editing) {
    return (
      <button
        onClick={() => { setInput(String(value)); setEditing(true); }}
        className="text-slate-600 hover:text-blue-600 hover:underline cursor-pointer"
        title="클릭하여 안전재고 수정"
      >
        {value}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(false); if (e.key === 'Escape') setEditing(false); }}
          className="input text-sm py-0.5 w-16 text-center"
          autoFocus
        />
        <button
          onClick={() => handleSave(false)}
          disabled={saving}
          className="px-1.5 py-0.5 rounded text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '..' : '저장'}
        </button>
        <button
          onClick={() => setEditing(false)}
          className="px-1.5 py-0.5 rounded text-xs text-slate-500 hover:bg-slate-100"
        >
          취소
        </button>
      </div>
      {!showBulk ? (
        <button
          onClick={() => setShowBulk(true)}
          className="text-xs text-purple-600 hover:underline text-left"
        >
          전 지점 일괄 적용
        </button>
      ) : (
        <button
          onClick={() => handleSave(true)}
          disabled={saving}
          className="px-1.5 py-0.5 rounded text-xs bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {saving ? '적용 중..' : `전 지점 ${input}개로 일괄 적용`}
        </button>
      )}
    </div>
  );
}
