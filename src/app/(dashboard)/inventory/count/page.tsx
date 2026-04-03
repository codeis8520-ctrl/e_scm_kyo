'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

interface CountRow {
  inventoryId: string;
  productId: string;
  productName: string;
  productCode: string;
  unit: string;
  systemQty: number;
  countQty: number | '';  // 실사 입력값
  diff: number;
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    acc[k] = decodeURIComponent(v || '');
    return acc;
  }, {} as Record<string, string>);
  return cookies[name] || null;
}

export default function InventoryCountPage() {
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [rows, setRows] = useState<CountRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [memo, setMemo] = useState('');
  const [search, setSearch] = useState('');
  const [showDiffOnly, setShowDiffOnly] = useState(false);
  const [done, setDone] = useState(false);

  const userRole     = getCookie('user_role');
  const userBranchId = getCookie('user_branch_id');
  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';

  useEffect(() => {
    const sb = createClient() as any;
    sb.from('branches').select('id, name').eq('is_active', true).order('name')
      .then(({ data }: any) => {
        setBranches(data || []);
        if (isBranchUser && userBranchId) {
          setSelectedBranch(userBranchId);
        } else if ((data || []).length > 0) {
          setSelectedBranch(data[0].id);
        }
      });
  }, []);

  const loadInventory = async () => {
    if (!selectedBranch) return;
    setLoading(true);
    const sb = createClient() as any;
    const { data } = await sb
      .from('inventories')
      .select('id, quantity, product:products(id, name, code, unit, is_active)')
      .eq('branch_id', selectedBranch)
      .order('product(name)');

    setRows(
      (data || [])
        .filter((inv: any) => inv.product?.is_active)
        .map((inv: any) => ({
          inventoryId: inv.id,
          productId: inv.product.id,
          productName: inv.product.name,
          productCode: inv.product.code,
          unit: inv.product.unit || '개',
          systemQty: inv.quantity,
          countQty: '',
          diff: 0,
        }))
    );
    setDone(false);
    setLoading(false);
  };

  useEffect(() => { if (selectedBranch) loadInventory(); }, [selectedBranch]);

  const updateCountQty = (inventoryId: string, val: string) => {
    setRows(prev => prev.map(r => {
      if (r.inventoryId !== inventoryId) return r;
      const num = val === '' ? '' : Math.max(0, parseInt(val) || 0);
      const diff = num === '' ? 0 : (num as number) - r.systemQty;
      return { ...r, countQty: num, diff };
    }));
  };

  const setAll = (val: 'system' | 'zero') => {
    setRows(prev => prev.map(r => {
      const qty = val === 'system' ? r.systemQty : 0;
      return { ...r, countQty: qty, diff: qty - r.systemQty };
    }));
  };

  const handleSubmit = async () => {
    const adjustments = rows.filter(r => r.countQty !== '' && r.diff !== 0);
    if (adjustments.length === 0) {
      alert('차이가 발생한 항목이 없습니다.');
      return;
    }
    if (!confirm(`${adjustments.length}개 항목을 실사 수량으로 조정하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;

    setSaving(true);
    const sb = createClient() as any;
    const userId = getCookie('user_id');
    const countDate = new Date().toISOString().slice(0, 10);
    let errors = 0;

    for (const row of adjustments) {
      // 재고 업데이트
      const { error: invErr } = await sb
        .from('inventories')
        .update({ quantity: row.countQty })
        .eq('id', row.inventoryId);

      if (invErr) { errors++; continue; }

      // 이동 기록
      await sb.from('inventory_movements').insert({
        branch_id: selectedBranch,
        product_id: row.productId,
        movement_type: 'ADJUST',
        quantity: Math.abs(row.diff as number),
        reference_type: 'STOCK_COUNT',
        memo: `재고 실사 조정 (실사: ${row.countQty}, 시스템: ${row.systemQty}, 차이: ${row.diff > 0 ? '+' : ''}${row.diff}) — ${memo || countDate}`,
      });
    }

    setSaving(false);
    if (errors > 0) {
      alert(`${errors}개 항목 처리 중 오류 발생`);
    } else {
      setDone(true);
      alert(`실사 완료: ${adjustments.length}개 항목 조정됨`);
      loadInventory();
    }
  };

  const filtered = rows.filter(r => {
    if (search && !r.productName.toLowerCase().includes(search.toLowerCase()) &&
        !r.productCode.toLowerCase().includes(search.toLowerCase())) return false;
    if (showDiffOnly && r.diff === 0) return false;
    return true;
  });

  const diffCount     = rows.filter(r => r.countQty !== '' && r.diff !== 0).length;
  const countedCount  = rows.filter(r => r.countQty !== '').length;
  const totalDiffQty  = rows.reduce((s, r) => s + (r.diff || 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/inventory" className="text-sm text-slate-500 hover:text-slate-700">← 재고 관리</Link>
          <h1 className="text-lg font-bold text-slate-800">재고 실사</h1>
        </div>
        <select
          value={selectedBranch}
          onChange={e => setSelectedBranch(e.target.value)}
          disabled={isBranchUser}
          className={`input w-44 ${isBranchUser ? 'bg-slate-100 cursor-not-allowed' : ''}`}
        >
          <option value="">지점 선택</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {/* 진행 요약 */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card text-center">
          <p className="text-sm text-slate-500">전체 품목</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{rows.length}</p>
        </div>
        <div className="card text-center">
          <p className="text-sm text-slate-500">실사 완료</p>
          <p className="text-2xl font-bold text-blue-700 mt-1">{countedCount}</p>
        </div>
        <div className="card text-center">
          <p className="text-sm text-slate-500">차이 발생</p>
          <p className={`text-2xl font-bold mt-1 ${diffCount > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{diffCount}</p>
        </div>
        <div className="card text-center">
          <p className="text-sm text-slate-500">순 차이 수량</p>
          <p className={`text-2xl font-bold mt-1 ${totalDiffQty > 0 ? 'text-green-600' : totalDiffQty < 0 ? 'text-red-600' : 'text-slate-400'}`}>
            {totalDiffQty > 0 ? '+' : ''}{totalDiffQty}
          </p>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-wrap gap-3 items-center mb-4">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="제품명/코드 검색..." className="input w-52" />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={showDiffOnly} onChange={e => setShowDiffOnly(e.target.checked)} />
            차이 항목만
          </label>
          <div className="ml-auto flex gap-2">
            <button onClick={() => setAll('system')} className="text-xs text-blue-600 hover:underline">시스템값으로 채우기</button>
            <span className="text-slate-300">|</span>
            <button onClick={() => setAll('zero')} className="text-xs text-slate-400 hover:underline">전체 0으로</button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-10 text-slate-400">로딩 중...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>제품</th>
                  <th className="w-16 text-center">단위</th>
                  <th className="w-24 text-center">시스템 재고</th>
                  <th className="w-32 text-center">실사 수량</th>
                  <th className="w-24 text-center">차이</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => (
                  <tr key={row.inventoryId}
                    className={row.diff !== 0 && row.countQty !== '' ? 'bg-amber-50' : ''}>
                    <td>
                      <p className="font-medium text-sm">{row.productName}</p>
                      <p className="text-xs text-slate-400">{row.productCode}</p>
                    </td>
                    <td className="text-center text-sm text-slate-500">{row.unit}</td>
                    <td className="text-center font-medium">{row.systemQty}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={row.countQty}
                        onChange={e => updateCountQty(row.inventoryId, e.target.value)}
                        placeholder="입력"
                        className={`input text-center w-24 mx-auto block ${
                          row.countQty !== '' && row.diff !== 0 ? 'border-amber-400 bg-amber-50' : ''
                        }`}
                      />
                    </td>
                    <td className="text-center font-bold">
                      {row.countQty === '' ? (
                        <span className="text-slate-300">-</span>
                      ) : row.diff === 0 ? (
                        <span className="text-green-600">±0</span>
                      ) : (
                        <span className={row.diff > 0 ? 'text-green-600' : 'text-red-600'}>
                          {row.diff > 0 ? '+' : ''}{row.diff}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-10 text-slate-400">항목 없음</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {diffCount > 0 && (
          <div className="mt-5 pt-4 border-t flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <input value={memo} onChange={e => setMemo(e.target.value)}
              placeholder="실사 메모 (담당자, 특이사항 등)" className="input flex-1" />
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="btn-primary px-6 py-2.5 whitespace-nowrap disabled:opacity-50"
            >
              {saving ? '처리 중...' : `실사 적용 (${diffCount}개 조정)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
