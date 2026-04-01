'use client';

import { useState, useEffect } from 'react';
import { createProduct, updateProduct, deleteProduct, getCategories } from '@/lib/actions';

interface Product {
  id?: string;
  name: string;
  code: string;
  category_id: string | null;
  unit: string;
  price: number;
  cost: number | null;
  barcode: string | null;
  is_active: boolean;
}

interface Props {
  product?: Product | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ProductModal({ product, onClose, onSuccess }: Props) {
  const [categories, setCategories] = useState<any[]>([]);
  const [formData, setFormData] = useState<Product>({
    name: product?.name || '',
    code: product?.code || '',
    category_id: product?.category_id || null,
    unit: product?.unit || '개',
    price: product?.price || 0,
    cost: product?.cost || null,
    barcode: product?.barcode || null,
    is_active: product?.is_active ?? true,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getCategories().then(res => setCategories(res.data || []));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const form = new FormData();
    Object.entries(formData).forEach(([key, value]) => {
      form.append(key, String(value));
    });

    const result = product?.id
      ? await updateProduct(product.id, form)
      : await createProduct(form);

    if (result?.error) {
      setError(result.error);
      setLoading(false);
    } else {
      onSuccess();
    }
  };

  const handleDelete = async () => {
    if (!product?.id) return;
    if (!confirm('정말 삭제하시겠습니까?')) return;
    
    setLoading(true);
    await deleteProduct(product.id);
    onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">
            {product?.id ? '제품 수정' : '제품 등록'}
          </h2>
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
          <div>
            <label className="block text-sm font-medium text-gray-700">제품명 *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="mt-1 input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">제품코드 *</label>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value })}
              required
              className="mt-1 input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">카테고리</label>
            <select
              value={formData.category_id || ''}
              onChange={(e) => setFormData({ ...formData, category_id: e.target.value || null })}
              className="mt-1 input"
            >
              <option value="">선택하세요</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">판매가 *</label>
              <input
                type="number"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: parseInt(e.target.value) || 0 })}
                required
                className="mt-1 input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">원가</label>
              <input
                type="number"
                value={formData.cost || ''}
                onChange={(e) => setFormData({ ...formData, cost: parseInt(e.target.value) || null })}
                className="mt-1 input"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">단위</label>
              <input
                type="text"
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                className="mt-1 input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">바코드</label>
              <input
                type="text"
                value={formData.barcode || ''}
                onChange={(e) => setFormData({ ...formData, barcode: e.target.value || null })}
                className="mt-1 input"
              />
            </div>
          </div>

          {product?.id && (
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
            <button
              type="submit"
              disabled={loading}
              className="flex-1 btn-primary"
            >
              {loading ? '처리 중...' : (product?.id ? '수정' : '등록')}
            </button>
            {product?.id && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={loading}
                className="px-4 py-2 bg-red-100 text-red-600 rounded-md hover:bg-red-200"
              >
                삭제
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
