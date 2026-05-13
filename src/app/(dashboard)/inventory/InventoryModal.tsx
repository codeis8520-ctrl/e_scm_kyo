'use client';

import { useState, useEffect } from 'react';
import { adjustInventory } from '@/lib/actions';

interface Props {
  inventory?: any;
  onClose: () => void;
  onSuccess: () => void;
}

interface Product {
  id: string;
  name: string;
  code: string;
  product_type?: 'FINISHED' | 'RAW' | 'SUB' | null;
  unit?: string | null;            // 재고 base 단위 (예: 환)
  unit_size?: number | null;       // 입고 1단위 = N base. 예: 30
  unit_label?: string | null;      // 입고 단위 라벨. 예: 통
}

interface Branch {
  id: string;
  name: string;
  is_headquarters?: boolean;
}

// 원자재·부자재는 본사에서만 입출고·조정 가능 (OEM 위탁 생산 모델)
function isMaterialType(t?: string | null): boolean {
  return t === 'RAW' || t === 'SUB';
}

export default function InventoryModal({ inventory, onClose, onSuccess }: Props) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [searchProduct, setSearchProduct] = useState('');
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(
    inventory?.product ? {
      id: inventory.product_id,
      name: inventory.product?.name,
      code: inventory.product?.code,
      product_type: inventory.product?.product_type ?? null,
      unit: inventory.product?.unit ?? null,
      unit_size: inventory.product?.unit_size ?? null,
      unit_label: inventory.product?.unit_label ?? null,
    } : null
  );
  // "통 단위" 입력 모드 — 단위 환산 설정된 제품일 때만
  const [packMode, setPackMode] = useState(false);
  const [formData, setFormData] = useState({
    branch_id: inventory?.branch_id || '',
    movement_type: 'IN',
    quantity: 1,
    safety_stock: inventory?.safety_stock || 0,
    memo: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadBranches();
    loadProducts();
  }, []);

  const loadBranches = async () => {
    const { createClient } = await import('@/lib/supabase/client');
    const client = createClient();
    // is_headquarters 포함 시도 → 마이그 047 미적용 폴백
    let res: any = await client.from('branches').select('id, name, is_headquarters').eq('is_active', true).order('name');
    if (res.error) {
      res = await client.from('branches').select('id, name').eq('is_active', true).order('name');
    }
    setBranches((res.data || []) as Branch[]);
  };

  const loadProducts = async () => {
    const { createClient } = await import('@/lib/supabase/client');
    const client = createClient();
    // product_type 포함 시도 → 마이그 042 미적용 폴백
    let res: any = await client.from('products').select('id, name, code, product_type, unit, unit_size, unit_label').eq('is_active', true).order('name');
    if (res.error) {
      // 마이그 065 미적용 폴백
      res = await client.from('products').select('id, name, code, product_type, unit').eq('is_active', true).order('name');
    }
    if (res.error) {
      res = await client.from('products').select('id, name, code, product_type').eq('is_active', true).order('name');
    }
    if (res.error) {
      res = await client.from('products').select('id, name, code').eq('is_active', true).order('name');
    }
    setProducts((res.data || []) as Product[]);
    setFilteredProducts((res.data || []) as Product[]);
  };

  const hqBranch = branches.find(b => b.is_headquarters) || null;
  const selectedIsMaterial = isMaterialType(selectedProduct?.product_type);
  // RAW/SUB 제품 선택 + 본사 지정 존재 + 수정 모드(지점 고정) 아닐 때만 지점 드롭다운 제한
  const branchesForSelect = (selectedIsMaterial && hqBranch && !inventory) ? [hqBranch] : branches;

  // 제품 선택이 RAW/SUB로 바뀌면 지점을 본사로 자동 설정 (신규 입력 모드)
  useEffect(() => {
    if (inventory) return;
    if (selectedIsMaterial && hqBranch) {
      setFormData(prev => ({ ...prev, branch_id: hqBranch.id }));
    }
  }, [selectedProduct?.id, selectedIsMaterial, hqBranch?.id, inventory]);

  const handleProductSearch = (query: string) => {
    setSearchProduct(query);
    if (!query) {
      setFilteredProducts(products);
    } else {
      setFilteredProducts(
        products.filter(p => 
          p.name.toLowerCase().includes(query.toLowerCase()) ||
          p.code.toLowerCase().includes(query.toLowerCase())
        )
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!formData.branch_id) {
      setError('지점을 선택해주세요.');
      setLoading(false);
      return;
    }

    if (!selectedProduct && !inventory) {
      setError('제품을 선택해주세요.');
      setLoading(false);
      return;
    }

    const finalProductId = inventory?.product_id || selectedProduct?.id;

    const form = new FormData();
    form.append('branch_id', formData.branch_id);
    form.append('product_id', finalProductId);
    form.append('movement_type', formData.movement_type);
    // 통 단위 입력 모드면 자동 ×unit_size 환산해 base 단위로 저장
    const finalQty = packMode && selectedProduct?.unit_size && selectedProduct.unit_size > 1
      ? formData.quantity * selectedProduct.unit_size
      : formData.quantity;
    form.append('quantity', String(finalQty));
    form.append('safety_stock', String(formData.safety_stock));
    form.append('memo', formData.memo);

    try {
      const res: any = await adjustInventory(form);
      if (res?.error) {
        setError(res.error);
        setLoading(false);
        return;
      }
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
          {!inventory && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700">제품 *</label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchProduct || selectedProduct?.name || ''}
                    onChange={(e) => {
                      handleProductSearch(e.target.value);
                      setSelectedProduct(null);
                    }}
                    placeholder="제품명 또는 코드 검색..."
                    className="mt-1 input"
                  />
                  {searchProduct && filteredProducts.length > 0 && !selectedProduct && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {filteredProducts.slice(0, 10).map(product => (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => {
                            setSelectedProduct(product);
                            setSearchProduct(product.name);
                            setFilteredProducts([]);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                        >
                          <span className="font-medium">{product.name}</span>
                          <span className="text-slate-400 text-sm ml-2">{product.code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {selectedProduct && (
                  <p className="mt-1 text-xs text-green-600">
                    ✓ 선택됨: {selectedProduct.name} ({selectedProduct.code})
                    {selectedIsMaterial && (
                      <span className="ml-2 text-amber-600">· 원자재·부자재는 본사에서만 관리</span>
                    )}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">지점 *</label>
                <select
                  value={formData.branch_id}
                  onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                  required
                  disabled={selectedIsMaterial && !!hqBranch}
                  className="mt-1 input disabled:bg-slate-100"
                >
                  <option value="">선택하세요</option>
                  {branchesForSelect.map(branch => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}{branch.is_headquarters ? ' (본사)' : ''}
                    </option>
                  ))}
                </select>
                {selectedIsMaterial && hqBranch && (
                  <p className="mt-1 text-xs text-slate-500">지점은 본사로 고정됩니다.</p>
                )}
              </div>
            </>
          )}

          {inventory && (
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
          )}

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
            <p className="mt-1 text-xs text-slate-500">
              {formData.movement_type === 'IN' && '입고: 현재고 + 수량'}
              {formData.movement_type === 'OUT' && '출고: 현재고 - 수량'}
              {formData.movement_type === 'ADJUST' && '조정: 현재고 = 수량'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              {formData.movement_type === 'ADJUST' ? '변경 후 수량 *' : '수량 *'}
            </label>
            {/* 단위 환산 설정된 제품에 토글 노출 */}
            {selectedProduct?.unit_size && selectedProduct.unit_size > 1 && (
              <div className="flex gap-1 mt-1 mb-1.5">
                <button type="button"
                  onClick={() => setPackMode(false)}
                  className={`flex-1 px-2 py-1 text-xs rounded ${
                    !packMode ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {selectedProduct.unit || 'base'} 단위
                </button>
                <button type="button"
                  onClick={() => setPackMode(true)}
                  className={`flex-1 px-2 py-1 text-xs rounded ${
                    packMode ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  📦 {selectedProduct.unit_label || '통'} (×{selectedProduct.unit_size})
                </button>
              </div>
            )}
            <input
              type="number"
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 })}
              onFocus={(e) => e.target.select()}
              required
              min="0"
              className="input"
            />
            {packMode && selectedProduct?.unit_size && selectedProduct.unit_size > 1 && (
              <p className="mt-1 text-[11px] text-amber-700">
                = {formData.quantity * selectedProduct.unit_size} {selectedProduct.unit || 'base'} (자동 환산되어 저장됩니다)
              </p>
            )}
          </div>

          {inventory && (
            <div>
              <label className="block text-sm font-medium text-gray-700">
                안전재고 설정
                <span className="text-xs text-slate-400 ml-1">(최소 유지 재고량)</span>
              </label>
              <input
                type="number"
                value={formData.safety_stock}
                onChange={(e) => setFormData({ ...formData, safety_stock: parseInt(e.target.value) || 0 })}
                onFocus={(e) => e.target.select()}
                min="0"
                className="mt-1 input"
              />
              <p className="mt-1 text-xs text-slate-500">
                안전재고 이상이면 "정상", 미만이면 "부족"으로 표시됩니다
              </p>
            </div>
          )}

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
