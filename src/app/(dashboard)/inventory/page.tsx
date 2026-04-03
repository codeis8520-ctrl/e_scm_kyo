'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import InventoryModal from './InventoryModal';
import TransferModal from './TransferModal';

interface Inventory {
  id: string;
  branch_id: string;
  product_id: string;
  quantity: number;
  safety_stock: number;
  branch?: { id: string; name: string };
  product?: { id: string; name: string; code: string; barcode?: string };
}

interface Branch {
  id: string;
  name: string;
}

export default function InventoryPage() {
  const [inventories, setInventories] = useState<Inventory[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchFilter, setBranchFilter] = useState('');
  const [search, setSearch] = useState('');
  const [barcodeSearch, setBarcodeSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [editInventory, setEditInventory] = useState<Inventory | null>(null);
  const [transferInventory, setTransferInventory] = useState<Inventory | null>(null);

  useEffect(() => {
    fetchBranches();
    fetchInventory();
  }, []);

  const fetchBranches = async () => {
    const supabase = createClient();
    const { data } = await supabase.from('branches').select('id, name').eq('is_active', true).order('name');
    setBranches(data || []);
  };

  const fetchInventory = async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from('inventories')
      .select('*, branch:branches(*), product:products(*)')
      .order('updated_at', { ascending: false });

    if (branchFilter) {
      query = query.eq('branch_id', branchFilter);
    }

    const { data } = await query;
    
    let filteredData = data || [];
    
    if (search) {
      const searchLower = search.toLowerCase();
      filteredData = filteredData.filter((item: any) =>
        item.product?.name?.toLowerCase().includes(searchLower) ||
        item.product?.code?.toLowerCase().includes(searchLower)
      );
    }

    if (barcodeSearch) {
      const barcodeLower = barcodeSearch.toLowerCase();
      filteredData = filteredData.filter((item: any) =>
        item.product?.barcode?.toLowerCase().includes(barcodeLower)
      );
    }

    setInventories(filteredData);
    setLoading(false);
  };

  useEffect(() => {
    fetchInventory();
  }, [branchFilter]);

  const handleAdjust = (item: Inventory) => {
    setEditInventory(item);
    setShowModal(true);
  };

  const handleClose = () => {
    setShowModal(false);
    setEditInventory(null);
  };

  const handleSuccess = () => {
    handleClose();
    fetchInventory();
  };

  return (
    <div className="card">
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-semibold text-lg">재고 현황</h3>
        <div className="flex gap-2">
          <Link href="/inventory/count" className="btn-secondary py-2 px-4 text-sm">재고 실사</Link>
          <button
            onClick={() => {
              setEditInventory(null);
              setShowModal(true);
            }}
            className="btn-primary"
          >
            + 입출고
          </button>
        </div>
      </div>

      <div className="flex gap-4 mb-4">
        <select
          value={branchFilter}
          onChange={(e) => { setBranchFilter(e.target.value); }}
          className="input w-48"
        >
          <option value="">전체 지점</option>
          {branches.map(b => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="제품명 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchInventory()}
          className="input w-48"
        />
        <input
          type="text"
          placeholder="바코드 검색..."
          value={barcodeSearch}
          onChange={(e) => setBarcodeSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchInventory()}
          className="input w-40"
        />
        <button onClick={() => fetchInventory()} className="btn-secondary">
          조회
        </button>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>지점</th>
            <th>제품코드</th>
            <th>제품명</th>
            <th>바코드</th>
            <th>현재재고</th>
            <th>안전재고</th>
            <th>상태</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={8} className="text-center text-slate-400 py-8">
                로딩 중...
              </td>
            </tr>
          ) : inventories.map((item) => {
            const isLow = item.quantity < item.safety_stock;
            return (
              <tr key={item.id}>
                <td>{item.branch?.name}</td>
                <td className="font-mono">{item.product?.code}</td>
                <td>{item.product?.name}</td>
                <td className="font-mono text-sm text-slate-500">{item.product?.barcode || '-'}</td>
                <td className={isLow ? 'text-red-600 font-semibold' : ''}>
                  {item.quantity}
                </td>
                <td>{item.safety_stock}</td>
                <td>
                  {isLow ? (
                    <span className="badge badge-error">부족</span>
                  ) : (
                    <span className="badge badge-success">정상</span>
                  )}
                </td>
                <td>
                  <button
                    onClick={() => handleAdjust(item)}
                    className="text-blue-600 hover:underline mr-2"
                  >
                    입출고
                  </button>
                  <button
                    onClick={() => { setTransferInventory(item); setShowTransferModal(true); }}
                    className="text-green-600 hover:underline"
                  >
                    이동
                  </button>
                </td>
              </tr>
            );
          })}
          {!loading && inventories.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center text-slate-400 py-8">
                재고 데이터가 없습니다
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {showModal && (
        <InventoryModal
          inventory={editInventory}
          onClose={handleClose}
          onSuccess={handleSuccess}
        />
      )}

      {showTransferModal && transferInventory && (
        <TransferModal
          inventory={transferInventory}
          branches={branches}
          onClose={() => { setShowTransferModal(false); setTransferInventory(null); }}
          onSuccess={() => { setShowTransferModal(false); setTransferInventory(null); fetchInventory(); }}
        />
      )}
    </div>
  );
}
