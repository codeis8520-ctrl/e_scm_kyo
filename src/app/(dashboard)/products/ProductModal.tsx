'use client';

import { useState, useEffect } from 'react';
import { createProduct, updateProduct, deleteProduct, getCategories } from '@/lib/actions';
import { validators } from '@/lib/validators';

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
  is_taxable: boolean;
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
    is_taxable: product?.is_taxable ?? true,
  });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getCategories().then(res => setCategories(res.data || []));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setFieldErrors({});

    const errors: Record<string, string> = {};
    const nameError = validators.required(formData.name, '제품명');
    if (nameError) errors.name = nameError;
    const codeError = validators.required(formData.code, '제품코드');
    if (codeError) errors.code = codeError;
    else {
      const codeFormatError = validators.code(formData.code);
      if (codeFormatError) errors.code = codeFormatError;
    }
    const priceError = validators.positiveInteger(formData.price, '판매가');
    if (priceError) errors.price = priceError;
    if (formData.cost !== null) {
      const costError = validators.positiveInteger(formData.cost, '원가');
      if (costError) errors.cost = costError;
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setLoading(false);
      return;
    }

    const form = new FormData();
    Object.entries(formData).forEach(([key, value]) => {
      if (value !== null) form.append(key, String(value));
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
              onChange={(e) => {
                setFormData({ ...formData, name: e.target.value });
                setFieldErrors({ ...fieldErrors, name: '' });
              }}
              required
              className={`mt-1 input ${fieldErrors.name ? 'border-red-500' : ''}`}
            />
            {fieldErrors.name && (
              <p className="mt-1 text-xs text-red-500">{fieldErrors.name}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">제품코드 *</label>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => {
                setFormData({ ...formData, code: e.target.value });
                setFieldErrors({ ...fieldErrors, code: '' });
              }}
              required
              placeholder="P-00001"
              className={`mt-1 input ${fieldErrors.code ? 'border-red-500' : ''}`}
            />
            {fieldErrors.code && (
              <p className="mt-1 text-xs text-red-500">{fieldErrors.code}</p>
            )}
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
                value={formData.price || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setFormData({ ...formData, price: val === '' ? 0 : parseInt(val) || 0 });
                  setFieldErrors({ ...fieldErrors, price: '' });
                }}
                onFocus={(e) => e.target.select()}
                required
                min="0"
                className={`mt-1 input ${fieldErrors.price ? 'border-red-500' : ''}`}
              />
              {fieldErrors.price && (
                <p className="mt-1 text-xs text-red-500">{fieldErrors.price}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">원가</label>
              <input
                type="number"
                value={formData.cost || ''}
                onChange={(e) => {
                  setFormData({ ...formData, cost: parseInt(e.target.value) || null });
                  setFieldErrors({ ...fieldErrors, cost: '' });
                }}
                onFocus={(e) => e.target.select()}
                min="0"
                className={`mt-1 input ${fieldErrors.cost ? 'border-red-500' : ''}`}
              />
              {fieldErrors.cost && (
                <p className="mt-1 text-xs text-red-500">{fieldErrors.cost}</p>
              )}
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    document.getElementById('product-submit')?.click();
                  }
                }}
                placeholder="스캐너로 바코드 입력 가능"
                className="mt-1 input font-mono"
                autoFocus={!product}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">부가세 구분 *</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, is_taxable: true })}
                className={`flex-1 py-2 rounded-md text-sm font-medium border transition-colors ${
                  formData.is_taxable
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                과세 (10%)
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, is_taxable: false })}
                className={`flex-1 py-2 rounded-md text-sm font-medium border transition-colors ${
                  !formData.is_taxable
                    ? 'bg-slate-700 text-white border-slate-700'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                면세
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {formData.is_taxable ? '부가세 10% 적용 — 공급가액 = 판매가 ÷ 1.1' : '부가세 없음 — 한약류, 식품류 등 면세 품목'}
            </p>
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
              id="product-submit"
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
