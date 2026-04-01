'use client';

import { useState, useEffect } from 'react';
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
  category?: { id: string; name: string };
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);

  const fetchProducts = async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from('products')
      .select('*, category:categories(*)')
      .order('created_at', { ascending: false });

    if (search) {
      query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`);
    }

    const { data } = await query;
    setProducts(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const handleEdit = (product: Product) => {
    setEditProduct(product);
    setShowModal(true);
  };

  const handleClose = () => {
    setShowModal(false);
    setEditProduct(null);
  };

  const handleSuccess = () => {
    handleClose();
    fetchProducts();
  };

  return (
    <div className="card">
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-semibold text-lg">제품 목록</h3>
        <button
          onClick={() => setShowModal(true)}
          className="btn-primary"
        >
          + 제품 추가
        </button>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder="제품명 또는 코드 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchProducts()}
          className="input max-w-md"
        />
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>제품코드</th>
            <th>제품명</th>
            <th>카테고리</th>
            <th>판매가</th>
            <th>원가</th>
            <th>상태</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={7} className="text-center text-slate-400 py-8">
                로딩 중...
              </td>
            </tr>
          ) : products.map((product) => (
            <tr key={product.id}>
              <td className="font-mono">{product.code}</td>
              <td>{product.name}</td>
              <td>{product.category?.name || '-'}</td>
              <td>{product.price?.toLocaleString()}원</td>
              <td>{product.cost?.toLocaleString() || '-'}원</td>
              <td>
                <span className={product.is_active ? 'badge badge-success' : 'badge badge-error'}>
                  {product.is_active ? '활성' : '비활성'}
                </span>
              </td>
              <td>
                <button
                  onClick={() => handleEdit(product)}
                  className="text-blue-600 hover:underline mr-2"
                >
                  수정
                </button>
              </td>
            </tr>
          ))}
          {!loading && products.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center text-slate-400 py-8">
                등록된 제품이 없습니다
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {showModal && (
        <ProductModal
          product={editProduct}
          onClose={handleClose}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}
