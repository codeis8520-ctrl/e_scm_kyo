'use client';

import { useState, useEffect, useRef } from 'react';
import { createProduct, updateProduct, deleteProduct, getCategories, addProductFile, deleteProductFile } from '@/lib/actions';
import { createClient } from '@/lib/supabase/client';
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
  image_url?: string | null;
  spec?: Record<string, string> | null;
  description?: string | null;
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
    image_url: product?.image_url || null,
  });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // spec / description state
  const [specRows, setSpecRows] = useState<{ key: string; value: string }[]>(
    Object.entries(product?.spec || {}).map(([key, value]) => ({ key, value: String(value) }))
  );
  const [description, setDescription] = useState(product?.description || '');

  // product_files state
  const [productFiles, setProductFiles] = useState<any[]>([]);
  const [fileUploading, setFileUploading] = useState(false);
  const docFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getCategories().then(res => setCategories(res.data || []));
  }, []);

  // edit 모드에서만 파일 목록 로드
  useEffect(() => {
    if (!product?.id) return;
    const supabase = createClient();
    supabase
      .from('product_files')
      .select('*')
      .eq('product_id', product.id)
      .order('sort_order')
      .then(({ data }) => setProductFiles(data || []));
  }, [product?.id]);

  const resizeImage = (file: File, maxSize = 300): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('리사이징 실패')), 'image/jpeg', 0.85);
      };
      img.onerror = reject;
      img.src = url;
    });

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageUploading(true);
    setError('');

    try {
      const resized = await resizeImage(file);
      const thumbFile = new File([resized], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });

      const uploadForm = new FormData();
      uploadForm.append('file', thumbFile);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: uploadForm,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '이미지 업로드에 실패했습니다.');
      }

      const data = await res.json();
      setFormData(prev => ({ ...prev, image_url: data.url }));
    } catch (err: any) {
      setError(err.message || '이미지 업로드에 실패했습니다.');
    } finally {
      setImageUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !product?.id) return;

    const isImage = file.type.startsWith('image/');
    const fileType: 'image' | 'document' = isImage ? 'image' : 'document';

    setFileUploading(true);
    try {
      const uploadForm = new FormData();
      if (isImage) {
        const resized = await resizeImage(file, 800);
        const thumb = new File([resized], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
        uploadForm.append('file', thumb);
      } else {
        uploadForm.append('file', file);
      }

      const res = await fetch('/api/upload', { method: 'POST', body: uploadForm });
      if (!res.ok) throw new Error('업로드 실패');
      const { url } = await res.json();

      const result = await addProductFile(product.id, url, file.name, fileType);
      if (result?.error) throw new Error(result.error);

      setProductFiles(prev => [
        ...prev,
        { id: Date.now().toString(), file_url: url, file_name: file.name, file_type: fileType },
      ]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setFileUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    await deleteProductFile(fileId);
    setProductFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setFieldErrors({});

    const errors: Record<string, string> = {};
    const nameError = validators.required(formData.name, '제품명');
    if (nameError) errors.name = nameError;
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
      if (key === 'image_url') {
        form.append('image_url', value ?? '');
      } else if (value !== null) {
        form.append(key, String(value));
      }
    });

    // spec 직렬화
    const specObj: Record<string, string> = {};
    specRows.forEach(({ key, value }) => { if (key.trim()) specObj[key.trim()] = value; });
    form.append('spec', JSON.stringify(specObj));
    form.append('description', description);

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
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto">
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

          {/* 이미지 업로드 섹션 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">제품 이미지</label>
            <div className="flex items-center gap-3">
              {formData.image_url && (
                <img
                  src={formData.image_url}
                  alt="제품 이미지"
                  className="w-20 h-20 object-cover rounded-md border border-slate-200"
                />
              )}
              <div className="flex flex-col gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageChange}
                  disabled={imageUploading}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={imageUploading}
                  className="px-3 py-1.5 text-sm bg-slate-100 text-slate-700 rounded-md hover:bg-slate-200 disabled:opacity-50"
                >
                  {imageUploading ? '업로드 중...' : '이미지 선택'}
                </button>
                {formData.image_url && (
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, image_url: null }))}
                    disabled={imageUploading}
                    className="px-3 py-1.5 text-sm bg-red-50 text-red-600 rounded-md hover:bg-red-100 disabled:opacity-50"
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>
          </div>

          {product?.id && (
            <div>
              <label className="block text-sm font-medium text-gray-700">제품코드</label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                className="mt-1 input font-mono"
              />
              <p className="mt-1 text-xs text-slate-400">고유 코드 — 중복 불가</p>
            </div>
          )}

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

          {/* 규격 정보 섹션 */}
          <div className="border-t pt-4">
            <p className="text-sm font-semibold text-slate-700 mb-3">규격 정보</p>
            <div className="space-y-2">
              {specRows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="항목명 (예: 용량)"
                    value={row.key}
                    onChange={e => setSpecRows(prev => prev.map((r, j) => j === i ? { ...r, key: e.target.value } : r))}
                    className="input w-2/5"
                  />
                  <input
                    type="text"
                    placeholder="값 (예: 80g)"
                    value={row.value}
                    onChange={e => setSpecRows(prev => prev.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
                    className="input flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => setSpecRows(prev => prev.filter((_, j) => j !== i))}
                    className="px-2 text-slate-400 hover:text-red-500"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setSpecRows(prev => [...prev, { key: '', value: '' }])}
                className="text-sm text-blue-600 hover:underline"
              >
                + 항목 추가
              </button>
            </div>
          </div>

          {/* 상세 설명 */}
          <div>
            <label className="block text-sm font-medium text-gray-700">상세 설명</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="제품 상세 설명..."
              className="mt-1 input resize-none"
            />
          </div>

          {/* 추가 이미지 / 파일 섹션 (edit 모드 전용) */}
          {product?.id && (
            <div className="border-t pt-4">
              <p className="text-sm font-semibold text-slate-700 mb-3">추가 이미지 / 파일</p>
              {productFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {productFiles.map(f => (
                    <div key={f.id} className="relative group">
                      {f.file_type === 'image' ? (
                        <img
                          src={f.file_url}
                          alt={f.file_name}
                          className="w-20 h-20 object-cover rounded border"
                        />
                      ) : (
                        <div className="w-20 h-20 flex flex-col items-center justify-center bg-slate-100 rounded border text-xs text-slate-500 p-1 text-center">
                          📄 {f.file_name}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteFile(f.id)}
                        className="absolute -top-1 -right-1 hidden group-hover:flex w-5 h-5 bg-red-500 text-white rounded-full items-center justify-center text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  ref={docFileInputRef}
                  type="file"
                  accept="image/*,.pdf,.xlsx,.docx"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <button
                  type="button"
                  disabled={fileUploading}
                  onClick={() => docFileInputRef.current?.click()}
                  className="px-3 py-1.5 text-sm bg-slate-100 text-slate-700 rounded hover:bg-slate-200 disabled:opacity-50"
                >
                  {fileUploading ? '업로드 중...' : '+ 이미지 / 파일 추가'}
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <button
              type="submit"
              id="product-submit"
              disabled={loading || imageUploading}
              className="flex-1 btn-primary"
            >
              {loading ? '처리 중...' : (product?.id ? '수정' : '등록')}
            </button>
            {product?.id && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={loading || imageUploading}
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
