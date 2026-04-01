'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { validators } from '@/lib/validators';

export default function ProductionPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [bomList, setBomList] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBomModal, setShowBomModal] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const supabase = createClient();

    const [productsRes, bomRes, ordersRes] = await Promise.all([
      supabase.from('products').select('id, name, code').eq('is_active', true).order('name'),
      supabase.from('product_bom').select('*, product:products(*), material:products!product_bom_material_id_fkey(*)').order('created_at', { ascending: false }),
      supabase.from('production_orders').select('*, product:products(*)').order('created_at', { ascending: false }),
    ]);

    setProducts(productsRes.data || []);
    setBomList(bomRes.data || []);
    setOrders(ordersRes.data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getBomByProduct = (productId: string) => {
    return bomList.filter((bom: any) => bom.product_id === productId);
  };

  const handleCreateOrder = async (productId: string, quantity: number, memo: string) => {
    if (!productId) {
      alert('완제품을 선택해주세요.');
      return;
    }
    if (quantity < 1) {
      alert('생산 수량은 1 이상이어야 합니다.');
      return;
    }

    const supabase = createClient();
    const bomItems = getBomByProduct(productId);

    if (bomItems.length === 0) {
      alert('이 제품에는 BOM 정보가 없습니다.');
      return;
    }

    for (const item of bomItems) {
      const { data: inv } = await supabase
        .from('inventories')
        .select('quantity')
        .eq('product_id', item.material_id)
        .maybeSingle();

      const inventory = inv as any;
      const required = (item as any).quantity * quantity;
      if (!inventory || inventory.quantity < required) {
        alert(`원재료 ${(item as any).material?.name}의 재고가 부족합니다.`);
        return;
      }
    }

    const orderNumber = `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
    
    const db = supabase as any;
    await db.from('production_orders').insert({
      order_number: orderNumber,
      product_id: productId,
      quantity: quantity,
      status: 'COMPLETED',
      memo: memo,
      produced_at: new Date().toISOString(),
    });

    for (const item of bomItems) {
      const required = (item as any).quantity * quantity;
      
      const { data: inv } = await supabase
        .from('inventories')
        .select('id, quantity')
        .eq('product_id', (item as any).material_id)
        .single();

      if (inv) {
        const inventory = inv as any;
        await db.from('inventories').update({
          quantity: inventory.quantity - required,
        }).eq('id', inventory.id);
      }

      await db.from('inventory_movements').insert({
        product_id: (item as any).material_id,
        movement_type: 'PRODUCTION',
        quantity: -required,
        reference_type: 'PRODUCTION_ORDER',
        memo: `생산 차감: ${orderNumber}`,
      });
    }

    const { data: productInv } = await supabase
      .from('inventories')
      .select('id, quantity')
      .eq('product_id', productId)
      .single();

    if (productInv) {
      const pInv = productInv as any;
      await db.from('inventories').update({
        quantity: pInv.quantity + quantity,
      }).eq('id', pInv.id);
    } else {
      await db.from('inventories').insert({
        product_id: productId,
        quantity: quantity,
        safety_stock: 0,
      });
    }

    alert('생산이 완료되었습니다.');
    setShowOrderModal(false);
    fetchData();
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="font-semibold text-lg">BOM (제품 구성 정보)</h3>
            <p className="text-sm text-slate-500">완제품에 필요한 원재료/부자재 구성</p>
          </div>
          <button onClick={() => setShowBomModal(true)} className="btn-primary">+ BOM 등록</button>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>완제품</th>
              <th>원재료</th>
              <th>수량</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} className="text-center py-8">로딩 중...</td></tr>
            ) : bomList.length === 0 ? (
              <tr><td colSpan={3} className="text-center py-8">등록된 BOM이 없습니다</td></tr>
            ) : bomList.map((bom: any) => (
              <tr key={bom.id}>
                <td>{bom.product?.name}</td>
                <td>{bom.material?.name}</td>
                <td>{bom.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="font-semibold text-lg">생산 지시</h3>
            <p className="text-sm text-slate-500">BOM 기반으로 원재료 자동 소모 처리</p>
          </div>
          <button onClick={() => setShowOrderModal(true)} className="btn-primary">+ 생산 지시</button>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>지시번호</th>
              <th>제품</th>
              <th>수량</th>
              <th>상태</th>
              <th>일시</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8">생산 지시 이력이 없습니다</td></tr>
            ) : orders.map((order: any) => (
              <tr key={order.id}>
                <td className="font-mono text-sm">{order.order_number}</td>
                <td>{order.product?.name}</td>
                <td>{order.quantity}</td>
                <td>
                  <span className={`badge ${order.status === 'COMPLETED' ? 'badge-success' : 'badge-warning'}`}>
                    {order.status === 'COMPLETED' ? '완료' : '진행중'}
                  </span>
                </td>
                <td className="text-sm">{new Date(order.created_at).toLocaleString('ko-KR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showBomModal && (
        <BomModal products={products} bomList={bomList} onClose={() => setShowBomModal(false)} onSuccess={() => { setShowBomModal(false); fetchData(); }} />
      )}

      {showOrderModal && (
        <ProductionOrderModal products={products.filter((p: any) => getBomByProduct(p.id).length > 0)} onClose={() => setShowOrderModal(false)} onSubmit={handleCreateOrder} />
      )}
    </div>
  );
}

function BomModal({ products, bomList, onClose, onSuccess }: any) {
  const supabase = createClient();
  const [productId, setProductId] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [quantity, setQuantity] = useState(1);

  const existingBom = bomList.filter((b: any) => b.product_id === productId);
  const availableMaterials = products.filter((p: any) => p.id !== productId && !existingBom.some((e: any) => e.material_id === p.id));

  const handleSubmit = async () => {
    if (!productId || !materialId || quantity <= 0) {
      alert('모든 항목을 입력해주세요.');
      return;
    }

    const db = supabase as any;
    await db.from('product_bom').insert({
      product_id: productId,
      material_id: materialId,
      quantity: quantity,
    });

    onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-bold mb-4">BOM 등록</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium">완제품 *</label>
            <select value={productId} onChange={(e) => { setProductId(e.target.value); setMaterialId(''); }} className="mt-1 input">
              <option value="">선택하세요</option>
              {products.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium">원재료 *</label>
            <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} className="mt-1 input">
              <option value="">선택하세요</option>
              {availableMaterials.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium">수량 *</label>
            <input type="number" value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 1)} min="1" className="mt-1 input" />
          </div>
          <div className="flex gap-2 pt-4">
            <button onClick={handleSubmit} className="flex-1 btn-primary">등록</button>
            <button onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductionOrderModal({ products, onClose, onSubmit }: any) {
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [memo, setMemo] = useState('');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-bold mb-4">생산 지시</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium">완제품 *</label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className="mt-1 input">
              <option value="">선택하세요</option>
              {products.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">BOM이 등록된 제품만 표시됩니다</p>
          </div>
          <div>
            <label className="block text-sm font-medium">생산 수량 *</label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
              min="1"
              className="mt-1 input"
            />
            {quantity < 1 && (
              <p className="mt-1 text-xs text-red-500">수량은 1 이상이어야 합니다</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium">메모</label>
            <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="생산 메모..." className="mt-1 input" />
          </div>
          <div className="bg-yellow-50 p-3 rounded-lg text-sm">
            ⚠️ 생산 완료 시 원재료 재고가 자동 차감됩니다.
          </div>
          <div className="flex gap-2 pt-4">
            <button onClick={() => onSubmit(productId, quantity, memo)} className="flex-1 btn-primary">생산 실행</button>
            <button onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
        </div>
      </div>
    </div>
  );
}
