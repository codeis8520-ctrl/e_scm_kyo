'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  getSupplierPriceSheet,
  getProductPriceHistory,
  getSupplierPricesForProduct,
  recordManualSupplierPrice,
} from '@/lib/purchase-actions';
import { kstTodayString } from '@/lib/date';

type ProductType = 'FINISHED' | 'RAW' | 'SUB';

const TYPE_BADGE: Record<ProductType, { label: string; cls: string }> = {
  FINISHED: { label: '완제품', cls: 'bg-blue-100 text-blue-700' },
  RAW:      { label: '원자재', cls: 'bg-emerald-100 text-emerald-700' },
  SUB:      { label: '부자재', cls: 'bg-amber-100 text-amber-700' },
};

const SOURCE_LABEL: Record<string, string> = {
  MANUAL: '수동',
  PO_CONFIRMED: '발주 확정',
  PO_RECEIVED: '입고',
};

function daysAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff <= 0) return '오늘';
  if (diff === 1) return '어제';
  return `${diff}일 전`;
}

interface Supplier { id: string; name: string; code?: string; }
interface PriceRow {
  product_id: string;
  unit_price: number;
  effective_from: string;
  source: string;
  product: { id: string; name: string; code: string; unit?: string; product_type: ProductType } | null;
}

export default function PricesPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [sheet, setSheet] = useState<PriceRow[]>([]);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [productFilter, setProductFilter] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');

  // 수동 등록 모달 상태
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    const sb = createClient();
    (sb as any).from('suppliers').select('id, name, code').eq('is_active', true).order('name')
      .then(({ data }: any) => setSuppliers(data || []));
  }, []);

  const loadSheet = useCallback(async () => {
    if (!selectedSupplierId) { setSheet([]); return; }
    setSheetLoading(true);
    const { data } = await getSupplierPriceSheet(selectedSupplierId);
    setSheet((data as any) || []);
    setSheetLoading(false);
  }, [selectedSupplierId]);

  useEffect(() => { loadSheet(); }, [loadSheet]);

  const filteredSuppliers = supplierSearch
    ? suppliers.filter(s =>
        s.name.toLowerCase().includes(supplierSearch.toLowerCase()) ||
        (s.code || '').toLowerCase().includes(supplierSearch.toLowerCase()))
    : suppliers;

  const filteredSheet = useMemo(() => {
    if (!productFilter) return sheet;
    const q = productFilter.toLowerCase();
    return sheet.filter(r =>
      r.product?.name.toLowerCase().includes(q) || (r.product?.code || '').toLowerCase().includes(q)
    );
  }, [sheet, productFilter]);

  const selectedSupplier = suppliers.find(s => s.id === selectedSupplierId) || null;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-slate-800">매입 단가 관리</h1>
          <p className="text-sm text-slate-500 mt-0.5">공급사별 최근 단가와 이력을 확인·관리합니다.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/purchases" className="btn-secondary text-sm">← 발주 목록</Link>
          <button
            onClick={() => setShowAdd(true)}
            className="btn-primary text-sm"
            disabled={!selectedSupplierId}
          >
            + 단가 수동 등록
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* 좌: 공급사 목록 */}
        <div className="card lg:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-700">공급사</h3>
            <span className="text-xs text-slate-400">{filteredSuppliers.length}개</span>
          </div>
          <input
            type="text"
            value={supplierSearch}
            onChange={e => setSupplierSearch(e.target.value)}
            placeholder="공급사 검색..."
            className="input text-sm mb-3"
          />
          <div className="max-h-[520px] overflow-y-auto divide-y divide-slate-100 rounded border border-slate-100">
            {filteredSuppliers.length === 0 ? (
              <div className="text-center text-slate-400 text-sm py-8">공급사가 없습니다</div>
            ) : filteredSuppliers.map(s => {
              const selected = s.id === selectedSupplierId;
              return (
                <button
                  key={s.id}
                  onClick={() => { setSelectedSupplierId(s.id); setSelectedProductId(''); }}
                  className={`w-full text-left px-3 py-2.5 transition-colors ${
                    selected ? 'bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <p className={`font-medium text-sm truncate ${selected ? 'text-blue-700' : 'text-slate-700'}`}>{s.name}</p>
                  {s.code && <p className="text-[11px] text-slate-400 font-mono mt-0.5">{s.code}</p>}
                </button>
              );
            })}
          </div>
        </div>

        {/* 중: 공급사 단가 시트 */}
        <div className="lg:col-span-2">
          {!selectedSupplier ? (
            <div className="card text-center text-slate-400 py-16">
              <p className="text-sm">좌측에서 공급사를 선택하면 단가 시트가 표시됩니다.</p>
            </div>
          ) : (
            <div className="card">
              <div className="flex items-start justify-between gap-3 mb-3 pb-2 border-b border-slate-100">
                <div>
                  <p className="text-xs text-slate-400 font-mono">{selectedSupplier.code || ''}</p>
                  <h3 className="font-bold text-slate-800 text-lg">{selectedSupplier.name}</h3>
                  <p className="text-xs text-slate-500 mt-1">공급 품목 {sheet.length}종</p>
                </div>
                <input
                  type="text"
                  value={productFilter}
                  onChange={e => setProductFilter(e.target.value)}
                  placeholder="제품명 검색..."
                  className="input text-sm w-40"
                />
              </div>

              {sheetLoading ? (
                <div className="text-center py-8 text-slate-400 text-sm">불러오는 중...</div>
              ) : filteredSheet.length === 0 ? (
                <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-lg text-slate-400 text-sm">
                  <p>등록된 단가가 없습니다.</p>
                  <p className="text-xs mt-1">발주서를 확정하거나 수동 등록으로 단가를 시작하세요.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-slate-500">
                      <tr className="border-b border-slate-200">
                        <th className="text-left font-medium py-2">제품</th>
                        <th className="text-right font-medium py-2 w-28">최근 단가</th>
                        <th className="text-right font-medium py-2 w-24">기준일</th>
                        <th className="text-left font-medium py-2 w-20">기록</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSheet.map(r => {
                        const pt = (r.product?.product_type || 'FINISHED') as ProductType;
                        const meta = TYPE_BADGE[pt] || TYPE_BADGE.FINISHED;
                        const selected = r.product_id === selectedProductId;
                        return (
                          <tr
                            key={r.product_id}
                            onClick={() => setSelectedProductId(r.product_id)}
                            className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${
                              selected ? 'bg-blue-50/60' : ''
                            }`}
                          >
                            <td className="py-2">
                              <div className="flex items-center gap-2">
                                <span className={`badge text-[10px] ${meta.cls}`}>{meta.label}</span>
                                <div className="min-w-0">
                                  <p className="font-medium text-slate-700 truncate">{r.product?.name || '?'}</p>
                                  <p className="text-[11px] text-slate-400 font-mono">{r.product?.code}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-2 text-right font-semibold text-slate-800">
                              {Number(r.unit_price).toLocaleString()}원
                            </td>
                            <td className="py-2 text-right text-xs text-slate-500">
                              {r.effective_from}
                              <div className="text-slate-400">{daysAgo(r.effective_from)}</div>
                            </td>
                            <td className="py-2 text-xs text-slate-500">
                              {SOURCE_LABEL[r.source] || r.source}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 우: 선택 제품 히스토리·공급사 비교 */}
        <div className="lg:col-span-1">
          {selectedProductId ? (
            <PriceHistoryPanel productId={selectedProductId} currentSupplierId={selectedSupplierId} />
          ) : (
            <div className="card text-center text-slate-400 py-16">
              <p className="text-xs">제품을 선택하면 단가 이력과 공급사 비교가 표시됩니다.</p>
            </div>
          )}
        </div>
      </div>

      {showAdd && selectedSupplier && (
        <ManualPriceModal
          supplierId={selectedSupplierId}
          supplierName={selectedSupplier.name}
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); loadSheet(); }}
        />
      )}
    </div>
  );
}

function PriceHistoryPanel({ productId, currentSupplierId }: { productId: string; currentSupplierId: string }) {
  const [history, setHistory] = useState<any[]>([]);
  const [compare, setCompare] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      getProductPriceHistory(productId, 30),
      getSupplierPricesForProduct(productId),
    ]).then(([h, c]) => {
      if (!active) return;
      setHistory((h.data as any) || []);
      setCompare((c.data as any) || []);
      setLoading(false);
    });
    return () => { active = false; };
  }, [productId]);

  const prices = history.map(h => Number(h.unit_price));
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 0;
  const avg = prices.length ? Math.round(prices.reduce((s, v) => s + v, 0) / prices.length) : 0;

  const name = history[0]?.supplier?.name ? history[0]?.product?.name : undefined;

  return (
    <div className="card space-y-4">
      <div className="pb-2 border-b border-slate-100">
        <h3 className="font-semibold text-slate-700 text-sm">단가 이력 · 공급사 비교</h3>
      </div>

      {loading ? (
        <div className="text-center py-8 text-slate-400 text-sm">불러오는 중...</div>
      ) : (
        <>
          {/* 요약 */}
          {prices.length > 0 && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-slate-50 rounded px-2 py-2">
                <p className="text-[10px] text-slate-400">최저</p>
                <p className="text-sm font-semibold text-emerald-600">{min.toLocaleString()}</p>
              </div>
              <div className="bg-slate-50 rounded px-2 py-2">
                <p className="text-[10px] text-slate-400">평균</p>
                <p className="text-sm font-semibold text-slate-700">{avg.toLocaleString()}</p>
              </div>
              <div className="bg-slate-50 rounded px-2 py-2">
                <p className="text-[10px] text-slate-400">최고</p>
                <p className="text-sm font-semibold text-red-500">{max.toLocaleString()}</p>
              </div>
            </div>
          )}

          {/* 공급사별 최신 단가 비교 */}
          <div>
            <p className="text-xs font-medium text-slate-500 mb-1.5">공급사별 최신 단가</p>
            {compare.length === 0 ? (
              <p className="text-xs text-slate-400">비교 데이터 없음</p>
            ) : (
              <div className="space-y-1">
                {compare.map((r: any, i: number) => {
                  const isCurrent = r.supplier_id === currentSupplierId;
                  const isBest = i === 0;
                  return (
                    <div key={r.supplier_id}
                      className={`flex justify-between items-center px-2 py-1.5 rounded text-xs ${
                        isCurrent ? 'bg-blue-50 border border-blue-200' : 'bg-slate-50'
                      }`}
                    >
                      <div className="truncate flex items-center gap-1">
                        {isBest && <span className="text-emerald-600">●</span>}
                        <span className={isCurrent ? 'font-medium text-blue-700' : 'text-slate-700'}>
                          {r.supplier?.name || '?'}
                        </span>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <span className="font-semibold">{Number(r.unit_price).toLocaleString()}</span>
                        <span className="text-slate-400 ml-1">({daysAgo(r.effective_from)})</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 이력 타임라인 */}
          <div>
            <p className="text-xs font-medium text-slate-500 mb-1.5">단가 이력</p>
            {history.length === 0 ? (
              <p className="text-xs text-slate-400">이력 없음</p>
            ) : (
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {history.map((h: any, i: number) => {
                  const prev = history[i + 1];
                  const delta = prev ? Number(h.unit_price) - Number(prev.unit_price) : 0;
                  return (
                    <div key={h.id} className="flex justify-between items-start text-xs border-l-2 border-slate-200 pl-2 py-1">
                      <div className="min-w-0">
                        <p className="text-slate-700 font-medium truncate">{h.supplier?.name || '?'}</p>
                        <p className="text-[10px] text-slate-400">
                          {h.effective_from} · {SOURCE_LABEL[h.source] || h.source}
                        </p>
                        {h.memo && <p className="text-[10px] text-slate-500 truncate italic">{h.memo}</p>}
                      </div>
                      <div className="text-right whitespace-nowrap ml-2">
                        <span className="font-semibold text-slate-700">{Number(h.unit_price).toLocaleString()}</span>
                        {delta !== 0 && prev && (
                          <span className={`ml-1 text-[10px] ${delta > 0 ? 'text-red-500' : 'text-green-600'}`}>
                            {delta > 0 ? '↑' : '↓'}{Math.abs(delta).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ManualPriceModal({
  supplierId, supplierName, onClose, onSuccess,
}: {
  supplierId: string;
  supplierName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [productSearch, setProductSearch] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [memo, setMemo] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(() => kstTodayString());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const sb = createClient();
    (sb as any).from('products')
      .select('id, name, code, unit, product_type')
      .eq('is_active', true)
      .in('product_type', ['RAW', 'SUB', 'FINISHED'])
      .order('name')
      .then(({ data }: any) => setProducts(data || []));
  }, []);

  const filtered = productSearch
    ? products.filter(p =>
        p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.code.toLowerCase().includes(productSearch.toLowerCase())).slice(0, 20)
    : products.slice(0, 20);

  const handleSave = async () => {
    setError('');
    if (!selected) { setError('제품을 선택하세요.'); return; }
    if (!(unitPrice > 0)) { setError('단가를 입력하세요.'); return; }
    setSaving(true);
    const r = await recordManualSupplierPrice(supplierId, selected.id, unitPrice, {
      effective_from: effectiveFrom,
      memo: memo.trim() || undefined,
    });
    setSaving(false);
    if (r.error) { setError(r.error); return; }
    onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-lg">
        <div className="flex justify-between items-center px-5 py-4 border-b">
          <h2 className="font-bold">단가 수동 등록</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-sm text-slate-600">
            공급사: <span className="font-medium text-slate-800">{supplierName}</span>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">제품 *</label>
            {selected ? (
              <div className="flex items-center justify-between bg-slate-50 rounded px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{selected.name}</p>
                  <p className="text-xs text-slate-400 font-mono">{selected.code}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600 text-xs">변경</button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  placeholder="제품 검색..."
                  className="input text-sm"
                />
                <div className="mt-1 border border-slate-200 rounded-md max-h-40 overflow-y-auto bg-white">
                  {filtered.length === 0 ? (
                    <p className="text-center text-xs text-slate-400 py-3">결과 없음</p>
                  ) : filtered.map(p => {
                    const pt = (p.product_type || 'FINISHED') as ProductType;
                    const meta = TYPE_BADGE[pt];
                    return (
                      <button
                        key={p.id}
                        onClick={() => setSelected(p)}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center gap-2"
                      >
                        <span className={`badge text-[10px] ${meta.cls}`}>{meta.label}</span>
                        <span className="font-medium">{p.name}</span>
                        <span className="text-xs text-slate-400 font-mono">{p.code}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">단가(원) *</label>
              <input
                type="number" min={0}
                value={unitPrice || ''}
                onChange={e => setUnitPrice(parseInt(e.target.value) || 0)}
                onFocus={e => e.target.select()}
                className="input text-right"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">기준일</label>
              <input
                type="date"
                value={effectiveFrom}
                onChange={e => setEffectiveFrom(e.target.value)}
                className="input"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">메모 (선택)</label>
            <input
              type="text"
              value={memo}
              onChange={e => setMemo(e.target.value)}
              placeholder="예: 분기 단가 협상 결과"
              className="input text-sm"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving || !selected || !(unitPrice > 0)}
              className="flex-1 btn-primary disabled:opacity-50"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
            <button onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
        </div>
      </div>
    </div>
  );
}
