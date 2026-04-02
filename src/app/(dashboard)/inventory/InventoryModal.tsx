'use client';

import { useState, useEffect } from 'react';
import { adjustInventory, getBranches } from '@/lib/actions';

interface Props {
  inventory?: any;
  onClose: () => void;
  onSuccess: () => void;
}

interface Product {
  id: string;
  name: string;
  code: string;
}

interface Branch {
  id: string;
  name: string;
}

export default function InventoryModal({ inventory, onClose, onSuccess }: Props) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [searchProduct, setSearchProduct] = useState('');
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<{ id: string; name: string; code: string } | null>(
    inventory?.product ? { id: inventory.product_id, name: inventory.product?.name, code: inventory.product?.code } : null
  );
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
    getBranches().then(res => setBranches(res.data || []));
    loadProducts();
  }, []);

  const loadProducts = async () => {
    const supabase = (window as any).createClient?.() || {};
    const { createClient } = await import('@/lib/supabase/client');
    const client = createClient();
    const { data } = await client.from('products').select('id, name, code').eq('is_active', true).order('name');
    setProducts((data || []) as Product[]);
    setFilteredProducts((data || []) as Product[]);
  };

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
    form.append('quantity', String(formData.quantity));
    form.append('safety_stock', String(formData.safety_stock));
    form.append('memo', formData.memo);

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
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">지점 *</label>
                <select
                  value={formData.branch_id}
                  onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                  required
                  className="mt-1 input"
                >
                  <option value="">선택하세요</option>
                  {branches.map(branch => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
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
            <input
              type="number"
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 })}
              required
              min="0"
              className="mt-1 input"
            />
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
