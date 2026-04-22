'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { kstTodayString } from '@/lib/date';

interface CountRow {
  inventoryId: string;
  productId: string;
  productName: string;
  productCode: string;
  unit: string;
  systemQty: number;
  countQty: number | '';
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
    setMemo('');
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
    const countedRows  = rows.filter(r => r.countQty !== '');
    const adjustments  = countedRows.filter(r => r.diff !== 0);

    if (countedRows.length === 0) {
      alert('실사 수량을 1개 이상 입력해주세요.');
      return;
    }

    const branchName = branches.find(b => b.id === selectedBranch)?.name || '';
    const confirmMsg = adjustments.length > 0
      ? `${branchName} — 실사 수량 입력: ${countedRows.length}개 품목\n재고 보정 필요: ${adjustments.length}개 품목\n\n보정 항목의 실제 재고를 실사 수량으로 변경합니다.\n계속하시겠습니까?`
      : `${branchName} — 실사 수량 입력: ${countedRows.length}개 품목\n재고 차이: 없음 (모두 일치)\n\n실사 확인 기록을 저장합니다.\n계속하시겠습니까?`;

    if (!confirm(confirmMsg)) return;

    setSaving(true);
    const sb = createClient() as any;
    const countDate = kstTodayString();
    let errors = 0;

    // 차이가 있는 항목: 재고 업데이트 + 이동 기록
    for (const row of adjustments) {
      const { error: invErr } = await sb
        .from('inventories')
        .update({ quantity: row.countQty })
        .eq('id', row.inventoryId);

      if (invErr) { errors++; continue; }

      await sb.from('inventory_movements').insert({
        branch_id: selectedBranch,
        product_id: row.productId,
        movement_type: 'ADJUST',
        quantity: Math.abs(row.diff as number),
        reference_type: 'STOCK_COUNT',
        memo: `[재고실사] 실사: ${row.countQty}${row.unit}, 시스템: ${row.systemQty}${row.unit}, 차이: ${row.diff > 0 ? '+' : ''}${row.diff} — ${memo || countDate}`,
      });
    }

    // 차이 없는 항목도 확인 기록 저장 (이동 없이 메모만)
    if (adjustments.length === 0 && countedRows.length > 0) {
      // 대표로 1건의 ADJUST 0 기록 (실사 완료 기록용)
      const first = countedRows[0];
      await sb.from('inventory_movements').insert({
        branch_id: selectedBranch,
        product_id: first.productId,
        movement_type: 'ADJUST',
        quantity: 0,
        reference_type: 'STOCK_COUNT',
        memo: `[재고실사 확인] 전품목 일치 (${countedRows.length}개 품목 실사) — ${memo || countDate}`,
      });
    }

    setSaving(false);
    if (errors > 0) {
      alert(`${errors}개 항목 처리 중 오류 발생`);
    } else {
      setDone(true);
      const msg = adjustments.length > 0
        ? `실사 완료\n• 재고 보정: ${adjustments.length}개 품목`
        : `실사 완료\n• 전 품목 일치, 보정 없음`;
      alert(msg);
      loadInventory();
    }
  };

  const filtered = rows.filter(r => {
    if (search && !r.productName.toLowerCase().includes(search.toLowerCase()) &&
        !r.productCode.toLowerCase().includes(search.toLowerCase())) return false;
    if (showDiffOnly && r.diff === 0) return false;
    return true;
  });

  const countedCount  = rows.filter(r => r.countQty !== '').length;
  const diffCount     = rows.filter(r => r.countQty !== '' && r.diff !== 0).length;
  const totalDiffQty  = rows.reduce((s, r) => s + (r.diff || 0), 0);
  const allCounted    = rows.length > 0 && countedCount === rows.length;

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

      {/* 실사 안내 */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
        <p className="font-medium mb-1">재고 실사 진행 방법</p>
        <ol className="list-decimal list-inside space-y-0.5 text-blue-600">
          <li>실제로 센 수량을 "실사 수량" 칸에 입력합니다</li>
          <li>차이가 있는 항목은 주황색으로 표시됩니다</li>
          <li>하단 <strong>"실사 적용"</strong> 버튼을 누르면 실제 재고가 실사 수량으로 변경됩니다</li>
        </ol>
      </div>

      {/* 진행 요약 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="card text-center">
          <p className="text-xs sm:text-sm text-slate-500">전체 품목</p>
          <p className="text-xl sm:text-2xl font-bold text-slate-800 mt-1">{rows.length}</p>
        </div>
        <div className="card text-center">
          <p className="text-xs sm:text-sm text-slate-500">실사 입력</p>
          <p className={`text-xl sm:text-2xl font-bold mt-1 ${allCounted ? 'text-green-600' : 'text-blue-700'}`}>
            {countedCount} / {rows.length}
          </p>
        </div>
        <div className="card text-center">
          <p className="text-xs sm:text-sm text-slate-500">차이 발생</p>
          <p className={`text-xl sm:text-2xl font-bold mt-1 ${diffCount > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{diffCount}</p>
        </div>
        <div className="card text-center">
          <p className="text-xs sm:text-sm text-slate-500">순 차이 수량</p>
          <p className={`text-xl sm:text-2xl font-bold mt-1 ${totalDiffQty > 0 ? 'text-green-600' : totalDiffQty < 0 ? 'text-red-600' : 'text-slate-400'}`}>
            {totalDiffQty > 0 ? '+' : ''}{totalDiffQty}
          </p>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3 mb-4 flex-wrap items-start sm:items-center">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="제품명/코드 검색..." className="input w-full sm:w-52" />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={showDiffOnly} onChange={e => setShowDiffOnly(e.target.checked)} />
            차이 항목만
          </label>
          <div className="sm:ml-auto flex gap-2">
            <button onClick={() => setAll('system')} className="text-xs text-blue-600 hover:underline">시스템값으로 채우기</button>
            <span className="text-slate-300">|</span>
            <button onClick={() => setAll('zero')} className="text-xs text-slate-400 hover:underline">전체 0으로</button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-10 text-slate-400">로딩 중...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[500px]">
              <thead>
                <tr>
                  <th>제품</th>
                  <th className="w-16 text-center">단위</th>
                  <th className="w-24 text-center">시스템 재고</th>
                  <th className="w-32 text-center">실사 수량 입력</th>
                  <th className="w-28 text-center">차이 (실사-시스템)</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => (
                  <tr key={row.inventoryId}
                    className={row.countQty !== '' && row.diff !== 0 ? 'bg-amber-50' : ''}>
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
                        placeholder="직접 입력"
                        className={`input text-center w-24 mx-auto block ${
                          row.countQty !== '' && row.diff !== 0 ? 'border-amber-400' : ''
                        }`}
                      />
                    </td>
                    <td className="text-center font-bold">
                      {row.countQty === '' ? (
                        <span className="text-slate-300">-</span>
                      ) : row.diff === 0 ? (
                        <span className="text-green-600 text-sm">일치 ✓</span>
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

        {/* 실사 적용 영역 — 항상 표시, 입력 여부에 따라 활성화 */}
        {rows.length > 0 && !loading && (
          <div className="mt-5 pt-4 border-t">
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <input value={memo} onChange={e => setMemo(e.target.value)}
                placeholder="실사 메모 (담당자, 특이사항 등)" className="input flex-1" />
              <button
                onClick={handleSubmit}
                disabled={saving || countedCount === 0}
                className="btn-primary px-6 py-2.5 whitespace-nowrap disabled:opacity-50"
              >
                {saving ? '처리 중...' : countedCount === 0
                  ? '실사 적용 (수량 입력 필요)'
                  : diffCount > 0
                    ? `실사 적용 — 재고 보정 ${diffCount}개`
                    : `실사 확인 저장 (차이 없음 ${countedCount}건)`
                }
              </button>
            </div>
            {countedCount > 0 && diffCount === 0 && (
              <p className="text-xs text-green-600 mt-2">
                ✓ 실사 수량이 시스템 재고와 모두 일치합니다. 저장하면 실사 완료 기록이 남습니다.
              </p>
            )}
            {diffCount > 0 && (
              <p className="text-xs text-amber-600 mt-2">
                ⚠ {diffCount}개 품목의 실제 재고가 시스템과 다릅니다. 적용 시 실제 재고를 실사 수량으로 변경합니다.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
