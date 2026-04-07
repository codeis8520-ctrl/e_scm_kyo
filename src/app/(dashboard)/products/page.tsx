'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import ProductModal from './ProductModal';

interface Product {
  id: string;
  name: string;
  code: string;
  category_id: string | null;
  unit: string;
  price: number;
  cost: number | null;
  barcode: string | null;
  is_active: boolean;
  is_taxable: boolean;
  image_url: string | null;
  category?: { id: string; name: string };
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'' | 'true' | 'false'>('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from('products')
      .select('*, category:categories(*)')
      .order('name');

    if (activeFilter !== '') query = (query as any).eq('is_active', activeFilter === 'true');

    const { data } = await query;
    setProducts(data || []);
    setLoading(false);
  }, [activeFilter]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // 클라이언트 사이드 실시간 검색
  const filtered = search
    ? products.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.code.toLowerCase().includes(search.toLowerCase()) ||
        (p.barcode || '').toLowerCase().includes(search.toLowerCase())
      )
    : products;

  const marginPct = (p: Product) => {
    if (!p.cost || !p.price) return null;
    return Math.round((1 - p.cost / p.price) * 100);
  };

  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <div>
          <h3 className="font-semibold text-lg">제품 목록</h3>
          <p className="text-sm text-slate-400 mt-0.5">{filtered.length}개</p>
        </div>
        <button onClick={() => { setEditProduct(null); setShowModal(true); }} className="btn-primary">
          + 제품 추가
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-start sm:items-center mb-4">
        <input
          type="text"
          placeholder="제품명 / 코드 / 바코드 검색..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input w-full sm:w-64"
        />
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
          {([['', '전체'], ['true', '활성'], ['false', '비활성']] as [string, string][]).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setActiveFilter(v as '' | 'true' | 'false')}
              className={`px-3 py-1.5 font-medium transition-colors ${
                activeFilter === v ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="table min-w-[750px]">
          <thead>
            <tr>
              <th></th>
              <th>제품코드</th>
              <th>제품명</th>
              <th>바코드</th>
              <th>카테고리</th>
              <th>단위</th>
              <th className="text-right">판매가</th>
              <th className="text-right">원가</th>
              <th className="text-right">마진율</th>
              <th>부가세</th>
              <th>상태</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="text-center text-slate-400 py-8">로딩 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={11} className="text-center text-slate-400 py-8">
                {search ? `"${search}" 검색 결과 없음` : '등록된 제품이 없습니다'}
              </td></tr>
            ) : filtered.map(product => {
              const m = marginPct(product);
              return (
                <tr key={product.id} className={!product.is_active ? 'opacity-50' : ''}>
                  <td>
                    {product.image_url
                      ? <img
                          src={product.image_url}
                          alt=""
                          className="w-8 h-8 object-cover rounded cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => setPreviewUrl(product.image_url)}
                        />
                      : <div className="w-8 h-8 bg-slate-100 rounded" />}
                  </td>
                  <td className="font-mono text-xs text-slate-500">{product.code}</td>
                  <td className="font-medium">{product.name}</td>
                  <td className="font-mono text-xs text-slate-400">{product.barcode || '-'}</td>
                  <td className="text-sm text-slate-500">{product.category?.name || '-'}</td>
                  <td className="text-sm text-slate-500">{product.unit}</td>
                  <td className="text-right font-medium">{product.price.toLocaleString()}원</td>
                  <td className="text-right text-slate-500">
                    {product.cost != null ? `${product.cost.toLocaleString()}원` : '-'}
                  </td>
                  <td className="text-right">
                    {m !== null ? (
                      <span className={`text-sm font-medium ${m >= 30 ? 'text-green-600' : m >= 10 ? 'text-amber-600' : 'text-red-500'}`}>
                        {m}%
                      </span>
                    ) : <span className="text-slate-300">-</span>}
                  </td>
                  <td>
                    <span className={product.is_taxable !== false
                      ? 'badge bg-blue-100 text-blue-700'
                      : 'badge bg-slate-100 text-slate-600'}>
                      {product.is_taxable !== false ? '과세' : '면세'}
                    </span>
                  </td>
                  <td>
                    <span className={product.is_active ? 'badge badge-success' : 'badge badge-error'}>
                      {product.is_active ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => handleEdit(product)} className="text-blue-600 hover:underline text-sm">
                      수정
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            alt="제품 이미지"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white text-3xl leading-none hover:text-slate-300"
            onClick={() => setPreviewUrl(null)}
          >
            ×
          </button>
        </div>
      )}

      {showModal && (
        <ProductModal
          product={editProduct}
          onClose={() => { setShowModal(false); setEditProduct(null); }}
          onSuccess={() => { setShowModal(false); setEditProduct(null); fetchProducts(); }}
        />
      )}
    </div>
  );

  function handleEdit(product: Product) {
    setEditProduct(product);
    setShowModal(true);
  }
}
