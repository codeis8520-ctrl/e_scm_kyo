'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { createProduct, updateProduct, deleteProduct, getCategories, addProductFile, deleteProductFile } from '@/lib/actions';
import { getWhereUsed } from '@/lib/production-actions';
import { createClient } from '@/lib/supabase/client';
import { validators } from '@/lib/validators';
import { buildCategoryInfo, sortedCategoryOptions, categoryOptionLabel, type CategoryRow } from '@/lib/category-tree';

type ProductType = 'FINISHED' | 'RAW' | 'SUB' | 'SERVICE';
type CostSource = 'MANUAL' | 'BOM';

interface Product {
  id?: string;
  name: string;
  code: string;
  category_id: string | null;
  product_type: ProductType;
  cost_source?: CostSource;
  unit: string;
  price: number;
  cost: number | null;
  barcode: string | null;
  is_active: boolean;
  is_taxable: boolean;
  track_inventory: boolean;
  is_phantom?: boolean;
  image_url?: string | null;
  spec?: Record<string, string> | null;
  description?: string | null;
  // 마이그 065 — 입고/유통 단위 환산
  unit_size?: number | null;     // 입고 1단위 = N base unit. 예: 30
  unit_label?: string | null;    // 입고 단위 라벨. 예: "통"
}

const TYPE_META: Record<ProductType, { label: string; hint: string; color: string }> = {
  FINISHED: { label: '완제품', hint: '판매되는 최종 제품', color: 'border-blue-600 text-blue-700 bg-blue-50' },
  RAW:      { label: '원자재', hint: '제품 제조의 핵심 원료 (예: 홍삼, 대추)', color: 'border-emerald-600 text-emerald-700 bg-emerald-50' },
  SUB:      { label: '부자재', hint: '포장·첨가물·보조재 (예: 병, 캡, 라벨)', color: 'border-amber-600 text-amber-700 bg-amber-50' },
  SERVICE:  { label: '무형상품', hint: '컨설팅·교육 등 형태 없는 판매 항목 (재고 관리 X)', color: 'border-purple-600 text-purple-700 bg-purple-50' },
};

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
    product_type: (product?.product_type as ProductType) || 'FINISHED',
    cost_source: (product?.cost_source as CostSource) || 'MANUAL',
    unit: product?.unit || '개',
    price: product?.price || 0,
    cost: product?.cost || null,
    barcode: product?.barcode || null,
    is_active: product?.is_active ?? true,
    is_taxable: product?.is_taxable ?? true,
    // 무형상품(SERVICE)은 기본 false, 그 외는 기본 true.
    // 명시값(product?.track_inventory)이 있으면 그 값을 우선 사용.
    track_inventory: product?.track_inventory
      ?? ((product?.product_type as ProductType) === 'SERVICE' ? false : true),
    is_phantom: product?.is_phantom ?? false,
    image_url: product?.image_url || null,
    unit_size: product?.unit_size ?? null,
    unit_label: product?.unit_label ?? null,
  });
  const [bomComputedCost, setBomComputedCost] = useState<number | null>(null);
  const [bomLinesCount, setBomLinesCount] = useState(0);
  // 세트상품(Phantom) 일 때 구성품 상세 표시용
  const [bomLines, setBomLines] = useState<Array<{
    materialId: string; name: string; code: string;
    productType: ProductType | null; quantity: number; lossRate: number;
  }>>([]);
  const [whereUsed, setWhereUsed] = useState<any[]>([]);
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

  // 수정 모드 + 완제품이면 BOM 상세 + 합계 계산 (자동 원가 미리보기 / Phantom 구성품 표시)
  useEffect(() => {
    if (!product?.id || formData.product_type !== 'FINISHED') {
      setBomComputedCost(null);
      setBomLinesCount(0);
      setBomLines([]);
      return;
    }
    const supabase = createClient() as any;
    (async () => {
      const { data } = await supabase
        .from('product_bom')
        .select('material_id, quantity, loss_rate, material:products!product_bom_material_id_fkey(id, name, code, cost, product_type)')
        .eq('product_id', product.id);
      const rows = (data || []) as any[];
      setBomLinesCount(rows.length);

      const detailRows = rows.map(r => ({
        materialId: r.material_id,
        name: r.material?.name || '(이름 없음)',
        code: r.material?.code || '',
        productType: (r.material?.product_type ?? null) as ProductType | null,
        quantity: Number(r.quantity || 0),
        lossRate: Number(r.loss_rate || 0),
      }));
      setBomLines(detailRows);

      let sum = 0;
      for (const r of rows) {
        const mc = Number(r.material?.cost || 0);
        const qty = Number(r.quantity || 0) * (1 + Number(r.loss_rate || 0) / 100);
        sum += mc * qty;
      }
      setBomComputedCost(Math.round(sum));
    })();
  }, [product?.id, formData.product_type]);

  // cost_source=BOM이면 미리보기 값을 입력 필드에도 반영 (표시용)
  useEffect(() => {
    if (formData.product_type === 'FINISHED' && formData.cost_source === 'BOM' && bomComputedCost != null) {
      setFormData(prev => ({ ...prev, cost: bomComputedCost }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.cost_source, bomComputedCost]);

  // 원자재·부자재 수정 시: 사용처 완제품 목록 (where-used)
  useEffect(() => {
    if (!product?.id || (formData.product_type !== 'RAW' && formData.product_type !== 'SUB')) {
      setWhereUsed([]);
      return;
    }
    getWhereUsed(product.id).then((res: any) => {
      setWhereUsed((res.data as any[]) || []);
    });
  }, [product?.id, formData.product_type]);

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

    const isMaterial = formData.product_type === 'RAW' || formData.product_type === 'SUB';
    if (!isMaterial) {
      // 완제품만 판매가 검증
      const priceError = validators.positiveInteger(formData.price, '판매가');
      if (priceError) errors.price = priceError;
    } else {
      // 원·부자재는 매입 단가(cost) 필수
      if (formData.cost == null || formData.cost < 0) {
        errors.cost = '매입 단가를 입력하세요.';
      }
    }
    if (formData.cost !== null && formData.cost !== undefined) {
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

    try {
      const result = product?.id
        ? await updateProduct(product.id, form)
        : await createProduct(form);

      if (result?.error) {
        setError(result.error);
        setLoading(false);
      } else {
        onSuccess();
      }
    } catch (err: any) {
      // 액션이 throw한 경우(네트워크·서버 오류 등) loading 상태 유지 방지
      console.error('[ProductModal] submit error:', err);
      setError(err?.message || '저장 중 오류가 발생했습니다.');
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!product?.id) return;
    if (!confirm('정말 삭제하시겠습니까?\n관련 BOM·재고·매출 항목이 있으면 자동 정리 후 삭제됩니다.')) return;

    setLoading(true);
    try {
      // 자식 행이 있는 경우 직접 DELETE는 FK로 실패 → 사전 정리 후 본 삭제.
      // 일괄 삭제와 동일한 흐름을 사용해 일관성 유지.
      const { bulkDeleteProducts } = await import('@/lib/actions');
      const res = await bulkDeleteProducts([product.id]);
      if ((res as any).error) {
        setError((res as any).error);
        setLoading(false);
        return;
      }
      const failed = res.failed || [];
      if (failed.length > 0) {
        setError(`삭제 실패: ${failed[0].reason}`);
        setLoading(false);
        return;
      }
      onSuccess();
    } catch (err: any) {
      console.error('[ProductModal] delete error:', err);
      setError(err?.message || '삭제 중 오류가 발생했습니다.');
      setLoading(false);
    }
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

          {/* 제품 타입 선택 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">제품 유형 *</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['FINISHED', 'RAW', 'SUB', 'SERVICE'] as const).map((t) => {
                const meta = TYPE_META[t];
                const active = formData.product_type === t;
                return (
                  <button
                    type="button"
                    key={t}
                    onClick={() => setFormData(prev => ({
                      ...prev,
                      product_type: t,
                      // SERVICE 선택 시 자동으로 재고 관리 off, 그 외는 사용자가 따로 끄지 않은 한 on
                      track_inventory: t === 'SERVICE' ? false : (prev.track_inventory ?? true),
                    }))}
                    className={`px-3 py-2.5 rounded-md border-2 text-sm font-medium transition-colors ${
                      active ? meta.color : 'border-slate-200 text-slate-500 bg-white hover:bg-slate-50'
                    }`}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-slate-400">{TYPE_META[formData.product_type].hint}</p>
          </div>

          {/* 재고 관리 여부 */}
          <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-md">
            <input
              type="checkbox"
              id="track_inventory"
              checked={formData.track_inventory}
              onChange={e => setFormData({ ...formData, track_inventory: e.target.checked })}
              className="w-4 h-4"
              disabled={formData.is_phantom}
            />
            <label htmlFor="track_inventory" className="text-sm text-slate-700 flex-1 cursor-pointer">
              재고 관리 대상
              <span className="text-xs text-slate-400 ml-2">
                해제 시 inventories/입출고 이력을 만들지 않음 (무형상품, 가상 항목 등에 적합)
              </span>
            </label>
          </div>

          {/* 세트 상품(Phantom BOM) — 판매 시 BOM 분해해서 구성품 차감 */}
          {formData.product_type === 'FINISHED' && (
            <div className={`p-3 rounded-md border ${
              formData.is_phantom ? 'bg-purple-50 border-purple-200' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id="is_phantom"
                  checked={!!formData.is_phantom}
                  onChange={e => {
                    const next = e.target.checked;
                    setFormData(prev => ({
                      ...prev,
                      is_phantom: next,
                      // phantom이면 본인 재고 안 잡으므로 track_inventory 자동 해제
                      track_inventory: next ? false : prev.track_inventory,
                    }));
                  }}
                  className="w-4 h-4 mt-0.5"
                />
                <label htmlFor="is_phantom" className="text-sm text-slate-700 flex-1 cursor-pointer">
                  🧩 세트 상품 (Phantom BOM)
                  <p className="text-xs text-slate-500 mt-0.5">
                    체크 시 판매되어도 <b>본인 재고는 차감되지 않고</b>, 아래 BOM에 등록된
                    구성품의 재고가 자동으로 차감됩니다. (예: "침향30환 +오)" → 침향30환 1개 + 오미자 1개)
                  </p>
                  {formData.is_phantom && bomLinesCount === 0 && (
                    <p className="text-xs text-red-600 mt-1">
                      ⚠️ BOM이 비어있습니다. 저장 후 BOM 화면에서 구성품을 등록해야 판매 가능합니다.
                    </p>
                  )}
                </label>
              </div>

              {/* Phantom 구성품 노출 — 세트가 체크되어 있고 BOM 등록되어 있을 때 */}
              {formData.is_phantom && bomLines.length > 0 && (
                <div className="mt-3 pt-3 border-t border-purple-200">
                  <p className="text-xs font-semibold text-purple-800 mb-1.5">
                    📦 구성품 {bomLines.length}종 — 판매 시 아래 항목의 재고가 자동 차감됩니다
                  </p>
                  <ul className="space-y-1">
                    {bomLines.map(line => {
                      const typeBadge =
                        line.productType === 'RAW' ? { label: '원자재', cls: 'bg-emerald-100 text-emerald-700' }
                        : line.productType === 'SUB' ? { label: '부자재', cls: 'bg-amber-100 text-amber-700' }
                        : line.productType === 'SERVICE' ? { label: '무형', cls: 'bg-purple-100 text-purple-700' }
                        : { label: '완제품', cls: 'bg-blue-100 text-blue-700' };
                      return (
                        <li key={line.materialId} className="flex items-center gap-2 text-xs bg-white rounded px-2 py-1.5 border border-purple-100">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${typeBadge.cls}`}>
                            {typeBadge.label}
                          </span>
                          <span className="font-medium text-slate-800 flex-1 truncate">{line.name}</span>
                          <span className="font-mono text-[10px] text-slate-400 shrink-0">{line.code}</span>
                          <span className="text-slate-600 shrink-0">×{line.quantity}</span>
                          {line.lossRate > 0 && (
                            <span className="text-[10px] text-orange-500 shrink-0">손실 {line.lossRate}%</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    구성품 자체는 단독으로도 판매·재고 관리되며, 세트 판매 시 분해되어 차감됩니다.
                    상세 편집은 <b>생산 → BOM 목록</b> 화면에서 가능합니다.
                  </p>
                </div>
              )}
            </div>
          )}

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

          <div>
            <label className="block text-sm font-medium text-gray-700">
              제품코드 {!product?.id && <span className="text-xs text-slate-400 font-normal">(선택 — 비워두면 자동 생성)</span>}
            </label>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              placeholder={product?.id ? undefined : "예: FSM10 (비워두면 KYO-XXXX-XXXXXX 형식 자동 생성)"}
              className="mt-1 input font-mono"
            />
            <p className="mt-1 text-xs text-slate-400">
              {product?.id
                ? '고유 코드 — 중복 불가'
                : '직접 지정하면 중복 시 등록 거부됩니다. 자동 생성을 원하면 비워두세요.'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">카테고리</label>
            {(() => {
              const info = buildCategoryInfo(categories as CategoryRow[]);
              const options = sortedCategoryOptions(info);
              const selectedInfo = formData.category_id ? info.get(formData.category_id) : null;
              return (
                <>
                  <select
                    value={formData.category_id || ''}
                    onChange={(e) => setFormData({ ...formData, category_id: e.target.value || null })}
                    className="mt-1 input"
                  >
                    <option value="">선택하세요</option>
                    {options.map(c => (
                      <option key={c.id} value={c.id}>{categoryOptionLabel(c)}</option>
                    ))}
                  </select>
                  {/* 선택된 카테고리의 전체 경로 — 상·하위 관계 직관적으로 노출 */}
                  {selectedInfo && (
                    <p className="mt-1 text-xs text-blue-600">
                      <span className="font-mono text-slate-400 mr-1">[{selectedInfo.pathCode}]</span>
                      {selectedInfo.pathName}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-slate-400">
                    카테고리는 시스템 코드 → 카테고리 탭에서 트리 구조로 관리합니다.
                  </p>
                </>
              );
            })()}
          </div>

          {/* 가격 섹션 — 타입별 분기 */}
          {formData.product_type === 'FINISHED' ? (
            <>
              {/* 완제품: 원가 산정 방식 선택 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">원가 산정 방식</label>
                <div className="flex gap-2">
                  {([
                    ['MANUAL', '수동 입력', '원가를 직접 기입합니다'],
                    ['BOM', 'BOM 자동 산정', 'BOM 구성 자재 합계로 자동 계산됩니다'],
                  ] as [CostSource, string, string][]).map(([v, label, hint]) => {
                    const active = formData.cost_source === v;
                    return (
                      <button
                        type="button"
                        key={v}
                        onClick={() => setFormData({ ...formData, cost_source: v })}
                        className={`flex-1 px-3 py-2 rounded-md border-2 text-sm font-medium text-left transition-colors ${
                          active ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                        }`}
                        title={hint}
                      >
                        <div>{label}</div>
                        <div className={`text-[11px] mt-0.5 ${active ? 'text-blue-600' : 'text-slate-400'}`}>{hint}</div>
                      </button>
                    );
                  })}
                </div>
                {formData.cost_source === 'BOM' && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    {product?.id
                      ? bomLinesCount > 0
                        ? <>BOM {bomLinesCount}종 기준 <span className="font-semibold text-blue-700">{(bomComputedCost ?? 0).toLocaleString()}원</span> 으로 자동 산정됩니다.</>
                        : <span className="text-amber-600">⚠ 이 완제품에 등록된 BOM이 없습니다. 먼저 BOM 조립에서 자재를 추가하세요.</span>
                      : '저장 후 BOM을 조립하면 원가가 자동 산정됩니다.'}
                  </p>
                )}
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
                  <label className="block text-sm font-medium text-gray-700">
                    원가
                    {formData.cost_source === 'BOM' && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 align-middle">자동</span>
                    )}
                  </label>
                  <input
                    type="number"
                    value={formData.cost || ''}
                    onChange={(e) => {
                      if (formData.cost_source === 'BOM') return;
                      setFormData({ ...formData, cost: parseInt(e.target.value) || null });
                      setFieldErrors({ ...fieldErrors, cost: '' });
                    }}
                    onFocus={(e) => e.target.select()}
                    readOnly={formData.cost_source === 'BOM'}
                    min="0"
                    className={`mt-1 input ${fieldErrors.cost ? 'border-red-500' : ''} ${formData.cost_source === 'BOM' ? 'bg-slate-100 cursor-not-allowed' : ''}`}
                  />
                  {fieldErrors.cost && (
                    <p className="mt-1 text-xs text-red-500">{fieldErrors.cost}</p>
                  )}
                </div>
              </div>
            </>
          ) : (
            /* RAW/SUB: 판매가 숨김, 원가만 */
            <div>
              <label className="block text-sm font-medium text-gray-700">매입 단가 (원가) *</label>
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
              <p className="mt-1 text-xs text-slate-500">
                원자재·부자재는 판매가를 쓰지 않습니다. 이 단가가 BOM 원가 계산에 반영됩니다.
              </p>
              {fieldErrors.cost && (
                <p className="mt-1 text-xs text-red-500">{fieldErrors.cost}</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">재고 단위 (base unit)</label>
              <input
                type="text"
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                placeholder="예: 환, 포, 개"
                className="mt-1 input"
              />
              <p className="mt-1 text-[11px] text-slate-400">시스템이 차감·추적하는 최소 단위</p>
              {/* 입고/유통 단위 환산 (예: 30환 1통) */}
              {(formData.product_type === 'FINISHED' || formData.product_type === 'RAW' || formData.product_type === 'SUB') && (
                <div className="mt-2 p-2 rounded-md bg-amber-50 border border-amber-200 space-y-1.5">
                  <p className="text-[11px] text-amber-700 font-medium">📦 입고/유통 단위 환산 (선택)</p>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-slate-600">1</span>
                    <input
                      type="text"
                      value={formData.unit_label ?? ''}
                      onChange={e => setFormData({ ...formData, unit_label: e.target.value || null })}
                      placeholder="통"
                      className="input text-xs py-1 w-16"
                    />
                    <span className="text-slate-600">=</span>
                    <input
                      type="number"
                      min={1}
                      value={formData.unit_size ?? ''}
                      onChange={e => {
                        const v = parseInt(e.target.value);
                        setFormData({ ...formData, unit_size: Number.isFinite(v) && v > 0 ? v : null });
                      }}
                      placeholder="30"
                      className="input text-xs py-1 w-20"
                    />
                    <span className="text-slate-600">{formData.unit || 'base'}</span>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    설정하면 입고·재고 화면에서 "통 단위" 입력 토글이 활성화됩니다 (자동 ×{formData.unit_size || 'N'} 환산).
                  </p>
                </div>
              )}
            </div>
            {/* 바코드 — 완제품에만 노출 (RAW/SUB는 통상 별도 바코드가 없음, SERVICE는 무형) */}
            {formData.product_type === 'FINISHED' ? (
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
            ) : (
              <div className="flex items-center text-xs text-slate-400 pt-6">
                ※ 바코드는 완제품 유형에서만 입력
              </div>
            )}
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

          {/* Where-used: 원자재·부자재 수정 시, 이 자재를 쓰는 완제품 목록 */}
          {product?.id && (formData.product_type === 'RAW' || formData.product_type === 'SUB') && (
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-slate-700">이 자재를 사용하는 완제품</p>
                <span className="text-xs text-slate-400">{whereUsed.length}종</span>
              </div>
              {whereUsed.length === 0 ? (
                <p className="text-xs text-slate-400">아직 이 자재를 쓰는 완제품이 없습니다.</p>
              ) : (
                <div className="rounded-md border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left px-3 py-1.5 text-xs text-slate-500 font-medium">완제품</th>
                        <th className="text-right px-3 py-1.5 text-xs text-slate-500 font-medium">소요량</th>
                        <th className="text-right px-3 py-1.5 text-xs text-slate-500 font-medium">손실률</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {whereUsed.map((w: any) => (
                        <tr key={w.id} className="border-t border-slate-100">
                          <td className="px-3 py-1.5">
                            <p className="font-medium text-slate-700">{w.product?.name}</p>
                            <p className="text-[11px] text-slate-400 font-mono">{w.product?.code}</p>
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {Number(w.quantity || 0)}
                            <span className="text-xs text-slate-400 ml-1">{w.product?.unit || ''}</span>
                          </td>
                          <td className="px-3 py-1.5 text-right text-xs">
                            {Number(w.loss_rate || 0) > 0 ? `${w.loss_rate}%` : '-'}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <Link
                              href="/production"
                              onClick={() => onClose()}
                              className="text-xs text-blue-600 hover:underline"
                              title="BOM 조립으로 이동"
                            >
                              보기 →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-1.5 text-[11px] text-slate-400">
                이 자재의 매입 단가를 변경하면 위 완제품 중 BOM 자동 산정 모드인 경우 원가가 즉시 갱신됩니다.
              </p>
            </div>
          )}

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
