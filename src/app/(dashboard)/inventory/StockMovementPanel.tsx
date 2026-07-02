'use client';

// 재고변동전표(#79) — 창고이동·자가사용·강제조정을 하나의 전표로 통합. 변동유형만 선택하고
//   나머지는 동일 입력 구조. 기준창고/대상창고 해석은 유형별로 달라지고, 재고 반영 방식만 분기.
//   백엔드: transferInventoryBatch / recordStockUsage / adjustInventoryBatch 로 디스패치(검증로직 재사용).

import { useState, useMemo, useEffect } from 'react';
import { transferInventoryBatch, recordStockUsage, adjustInventoryBatch, getInventory } from '@/lib/actions';
import { toNum, fmtStock } from '@/lib/validators';
import { fmtDateKST } from '@/lib/date';

type MoveType = 'TRANSFER' | 'USAGE' | 'ADJUST';

const TYPE_LABEL: Record<MoveType, string> = {
  TRANSFER: '창고이동', USAGE: '자가사용', ADJUST: '강제조정',
};
// 유형별 안내 — 기준/대상창고 해석 + 재고 반영 방식.
const TYPE_GUIDE: Record<MoveType, string> = {
  TRANSFER: '기준창고(보내는 창고)에서 차감하고 대상창고(받는 창고)로 증가합니다. 두 창고 재고가 함께 움직입니다.',
  USAGE: '기준창고의 재고를 차감합니다(판매 아님 · 시음/파손/폐기/직원사용 등). 품목마다 사유를 개별 지정할 수 있습니다. 음수 입력 시 재고가 복원(반대 처리)됩니다.',
  ADJUST: '⚠ 재고를 입력한 목표 수량으로 강제로 맞춥니다(실사·오류 보정 전용). 재고를 임의로 맞추는 마지막 보루이므로 신중히 사용하세요. 본사 권한자만 가능합니다.',
};

interface Inventory {
  id: string; branch_id: string; product_id: string; quantity: number;
  product?: { id: string; name: string; code: string; allow_decimal_stock?: boolean; is_phantom?: boolean; track_inventory?: boolean };
}
// #107 usage_type_id: 자가사용 품목별 사유(라인 우선, 미지정 시 헤더 기본값).
interface Row { product_id: string; name: string; code: string; quantity: number; usage_type_id?: string; }

interface Props {
  branches: { id: string; name: string; is_headquarters?: boolean }[];
  usageTypes: { id: string; code: string; name: string }[];
  isHQUser: boolean;
  defaultBranchId?: string;
  branchLocked?: boolean;   // 지점고정 직원 — 기준창고 본인지점 잠금
  preset?: { type?: MoveType; productId?: string; branchId?: string } | null;
  onSuccess: () => void;
}

export default function StockMovementPanel({
  branches, usageTypes, isHQUser, defaultBranchId, branchLocked, preset, onSuccess,
}: Props) {
  const [moveType, setMoveType] = useState<MoveType>(preset?.type || 'TRANSFER');
  const [fromBranchId, setFromBranchId] = useState(preset?.branchId || defaultBranchId || '');  // 기준창고
  const [toBranchId, setToBranchId] = useState('');                                              // 대상창고(창고이동만)
  const [usageTypeId, setUsageTypeId] = useState('');
  const [memo, setMemo] = useState('');
  const [shipDate, setShipDate] = useState(fmtDateKST(new Date()));
  const [arrivalDate, setArrivalDate] = useState('');
  // #107 자가사용·강제조정 업무 기준일자(현황·이력 기준). 기본=오늘.
  const [movementDate, setMovementDate] = useState(fmtDateKST(new Date()));
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [srcInventories, setSrcInventories] = useState<Inventory[]>([]);
  const [loadingInv, setLoadingInv] = useState(false);

  const isAdjust = moveType === 'ADJUST';
  const isTransfer = moveType === 'TRANSFER';
  const isUsage = moveType === 'USAGE';
  const adjustBlocked = isAdjust && !isHQUser;

  // 기준창고 재고 페치
  useEffect(() => {
    if (!fromBranchId) { setSrcInventories([]); return; }
    let cancelled = false; setLoadingInv(true);
    getInventory(fromBranchId)
      .then(res => { if (!cancelled) setSrcInventories((res?.data || []) as Inventory[]); })
      .catch(() => { if (!cancelled) setSrcInventories([]); })
      .finally(() => { if (!cancelled) setLoadingInv(false); });
    return () => { cancelled = true; };
  }, [fromBranchId]);

  // preset(그리드 클릭)으로 들어온 품목 자동 추가
  useEffect(() => {
    if (!preset?.productId) return;
    const inv = srcInventories.find(i => i.product_id === preset.productId);
    if (inv?.product && !rows.some(r => r.product_id === preset.productId)) {
      setRows(prev => [...prev, { product_id: inv.product_id, name: inv.product!.name, code: inv.product!.code, quantity: 1 }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.productId, srcInventories]);

  const stockOf = (productId: string): number | null => {
    const inv = srcInventories.find(i => i.branch_id === fromBranchId && i.product_id === productId);
    return inv ? toNum(inv.quantity) : null;
  };
  const allowDecimalOf = (productId: string): boolean =>
    srcInventories.find(i => i.product_id === productId)?.product?.allow_decimal_stock === true;

  // 반영 후 재고 — 이동/사용=현재고−입력, 강제조정=입력값(목표)
  const afterStockOf = (r: Row): number => {
    const cur = stockOf(r.product_id) ?? 0;
    return isAdjust ? r.quantity : cur - r.quantity;
  };

  const BROWSE_CAP = 200;
  const browseAll = useMemo(() => {
    if (!fromBranchId) return [] as { product_id: string; name: string; code: string }[];
    const seen = new Set<string>(); const out: { product_id: string; name: string; code: string }[] = [];
    for (const inv of srcInventories) {
      const p = inv.product;
      if (!p || inv.branch_id !== fromBranchId || seen.has(inv.product_id)) continue;
      // #82: 옵션 포함 세트(팬텀)·재고 비관리 품목 제외 — 실제 재고 차감 대상(단품/기본)만 노출.
      //   재고변동전표는 실재고가 줄어드는 품목을 고르는 화면(판매용 옵션상품 선택 화면 아님).
      if (p.is_phantom === true || p.track_inventory === false) continue;
      seen.add(inv.product_id);
      out.push({ product_id: inv.product_id, name: p.name, code: p.code });
    }
    out.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
    return out;
  }, [srcInventories, fromBranchId]);

  const browseFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return browseAll;
    return browseAll.filter(c => (c.name || '').toLowerCase().includes(q) || (c.code || '').toLowerCase().includes(q));
  }, [browseAll, search]);
  const browseList = browseFiltered.slice(0, BROWSE_CAP);
  const overCap = browseFiltered.length > BROWSE_CAP;

  const addRow = (c: { product_id: string; name: string; code: string }) =>
    setRows(prev => [...prev, { ...c, quantity: 1 }]);
  const removeRow = (id: string) => setRows(prev => prev.filter(r => r.product_id !== id));
  const updateQty = (id: string, qty: number) => setRows(prev => prev.map(r => r.product_id === id ? { ...r, quantity: qty } : r));
  const updateRowUsageType = (id: string, utid: string) => setRows(prev => prev.map(r => r.product_id === id ? { ...r, usage_type_id: utid || undefined } : r));
  const toggleProduct = (c: { product_id: string; name: string; code: string }) =>
    rows.some(r => r.product_id === c.product_id) ? removeRow(c.product_id) : addRow(c);

  const handleFromChange = (id: string) => { setFromBranchId(id); setRows([]); setSearch(''); };

  const sameBranch = isTransfer && !!fromBranchId && !!toBranchId && fromBranchId === toBranchId;
  // 이동/사용: 현재고 초과 경고(이동은 차감 음수 허용). 강제조정: 목표값이라 초과 개념 없음.
  const hasOver = !isAdjust && rows.some(r => { const s = stockOf(r.product_id); return s !== null && r.quantity > s; });
  // #100 자가사용은 음수 허용(반품·복원·반대 처리) — 0만 차단. 이동은 양수만(반대는 반대전표 #94).
  const hasInvalidQty = rows.some(r =>
    isAdjust ? !Number.isFinite(r.quantity)
    : isUsage ? (!Number.isInteger(r.quantity) || r.quantity === 0)
    : r.quantity < 1);

  // #107 자가사용 — 품목마다 사유(라인 우선, 없으면 헤더 기본값)가 있어야 함.
  const usageReasonMissing = isUsage && rows.some(r => !(r.usage_type_id || usageTypeId));
  const submitDisabled =
    loading || adjustBlocked || hasInvalidQty || rows.length === 0 || !fromBranchId ||
    (isTransfer && (!toBranchId || sameBranch)) ||
    usageReasonMissing;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (adjustBlocked) { setError('강제 조정은 본사 권한만 가능합니다.'); return; }
    if (!fromBranchId) { setError('기준창고를 선택하세요.'); return; }
    if (rows.length === 0) { setError('품목을 1개 이상 추가하세요.'); return; }
    if (isTransfer) {
      if (!toBranchId) { setError('대상창고를 선택하세요.'); return; }
      if (sameBranch) { setError('창고이동은 기준창고와 대상창고가 달라야 합니다.'); return; }
      if (arrivalDate && shipDate && arrivalDate < shipDate) { setError('도착예정일은 출발일과 같거나 이후여야 합니다.'); return; }
    }
    for (const r of rows) {
      if (isAdjust) { if (!Number.isFinite(r.quantity)) { setError(`'${r.name}' 목표 수량을 올바르게 입력하세요.`); return; } }
      else if (isUsage) {
        if (!Number.isInteger(r.quantity) || r.quantity === 0) { setError(`'${r.name}' 수량은 0이 아닌 정수여야 합니다. (음수=복원)`); return; }
        if (!(r.usage_type_id || usageTypeId)) { setError(`'${r.name}' 사용유형(사유)을 선택하세요.`); return; }   // #107 품목별 사유
      }
      else if (!Number.isInteger(r.quantity) || r.quantity < 1) { setError(`'${r.name}' 수량은 1개 이상의 정수여야 합니다.`); return; }
    }

    setLoading(true);
    let result: { error?: string } | undefined;
    if (isTransfer) {
      result = await transferInventoryBatch({
        from_branch_id: fromBranchId, to_branch_id: toBranchId, memo: memo || undefined,
        ship_date: shipDate || undefined, arrival_date: arrivalDate || undefined,
        items: rows.map(r => ({ product_id: r.product_id, quantity: r.quantity })),
      }) as { error?: string };
    } else if (isUsage) {
      result = await recordStockUsage({
        branch_id: fromBranchId, usage_type_id: usageTypeId || undefined, memo: memo || undefined,
        movement_date: movementDate || undefined,   // #107 업무 기준일자
        // #107 품목별 사유(라인 usage_type_id, 미지정 시 헤더 기본값 서버 폴백)
        items: rows.map(r => ({ product_id: r.product_id, quantity: r.quantity, usage_type_id: r.usage_type_id || null })),
      }) as { error?: string };
    } else {
      result = await adjustInventoryBatch({
        branch_id: fromBranchId, memo: memo || undefined,
        movement_date: movementDate || undefined,   // #107 업무 기준일자
        items: rows.map(r => ({ product_id: r.product_id, target_quantity: r.quantity })),
      }) as { error?: string };
    }

    if (result?.error) { setError(result.error); setLoading(false); }
    else { setRows([]); setMemo(''); setSearch(''); setArrivalDate(''); setLoading(false); onSuccess(); }
  };

  const qtyLabel = isAdjust ? '목표수량' : '차감수량';

  return (
    <div className="border border-slate-200 rounded-lg p-5">
      <h3 className="text-base font-bold mb-1">재고변동전표</h3>
      <p className="text-xs text-slate-500 mb-4">창고이동·자가사용·강제조정을 하나의 전표로 — 변동유형을 선택하세요.</p>

      {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 변동유형 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">변동유형 *</label>
          <div className="flex flex-wrap gap-2">
            {(['TRANSFER', 'USAGE', 'ADJUST'] as MoveType[]).map(t => {
              const locked = t === 'ADJUST' && !isHQUser;
              const active = moveType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setMoveType(t); setError(''); }}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                    active
                      ? (t === 'ADJUST' ? 'bg-red-600 text-white border-red-600' : 'bg-blue-600 text-white border-blue-600')
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                  title={locked ? '강제 조정은 본사 권한만 가능합니다' : undefined}
                >
                  {t === 'ADJUST' && '⚠ '}{TYPE_LABEL[t]}{locked && ' 🔒'}
                </button>
              );
            })}
          </div>
          <p className={`mt-2 text-xs ${isAdjust ? 'text-red-600' : 'text-slate-500'}`}>{TYPE_GUIDE[moveType]}</p>
          {adjustBlocked && (
            <p className="mt-1 text-xs text-red-600 font-medium">🔒 강제 조정은 본사 권한(본부대표·HQ)만 가능합니다. 일상 소모·보정은 자가사용을 이용하세요.</p>
          )}
        </div>

        {/* 창고 정보 — 기준창고 / 대상창고(창고이동만) */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700">기준창고 *</label>
            <select
              value={fromBranchId}
              onChange={e => handleFromChange(e.target.value)}
              disabled={branchLocked}
              required
              className={`mt-1 input ${branchLocked ? 'bg-slate-100 cursor-not-allowed' : ''}`}
            >
              <option value="">창고 선택</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          {isTransfer ? (
            <>
              <div className="flex items-center justify-center pb-2 text-2xl text-slate-400 select-none">→</div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700">대상창고 *</label>
                <select value={toBranchId} onChange={e => setToBranchId(e.target.value)} required className="mt-1 input">
                  <option value="">창고 선택</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </>
          ) : (
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700">대상창고</label>
              <div className="mt-1 input bg-slate-100 text-slate-500 flex items-center">
                기준창고와 동일 {fromBranchId && `(${branches.find(b => b.id === fromBranchId)?.name || ''})`}
              </div>
            </div>
          )}
        </div>
        {sameBranch && <p className="text-sm text-red-600">창고이동은 기준창고와 대상창고가 달라야 합니다.</p>}

        {/* 사유 정보 — 자가사용=기본 사용유형(품목별로 재지정 가능), 창고이동/강제조정=메모 */}
        {isUsage && (
          <div>
            <label className="block text-sm font-medium text-gray-700">기본 사용유형(사유)</label>
            <select value={usageTypeId} onChange={e => setUsageTypeId(e.target.value)} className="mt-1 input">
              <option value="">품목별로 각각 선택</option>
              {usageTypes.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-400">전 품목 공통 사유를 먼저 정하면 편합니다. 품목마다 다른 사유는 아래 목록에서 개별 지정하세요.</p>
            {usageTypes.length === 0 && <p className="mt-1 text-xs text-amber-600">등록된 사용유형이 없습니다. 코드관리에서 먼저 추가하세요.</p>}
          </div>
        )}

        {/* 업무 기준일자 — 창고이동=출발/도착, 자가사용·강제조정=기준일자(#107 백데이트/정정 가능). */}
        {isTransfer ? (
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700">출발(출고)일 *</label>
              <input type="date" value={shipDate} onChange={e => setShipDate(e.target.value)} required className="mt-1 input" />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700">도착예정일</label>
              <input type="date" value={arrivalDate} min={shipDate || undefined} onChange={e => setArrivalDate(e.target.value)} className="mt-1 input" />
              <p className="mt-1 text-xs text-slate-400">미입력 시 출발일과 동일하게 기록됩니다.</p>
            </div>
          </div>
        ) : (
          <div className="sm:max-w-xs">
            <label className="block text-sm font-medium text-gray-700">업무 기준일자 *</label>
            <input type="date" value={movementDate} onChange={e => setMovementDate(e.target.value)} required className="mt-1 input" />
            <p className="mt-1 text-xs text-slate-400">현황·이력·재고에 반영되는 기준일입니다(전표생성일시는 내부 로그). 과거 일자로 정정할 수 있습니다.</p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700">메모</label>
          <input type="text" value={memo} onChange={e => setMemo(e.target.value)} placeholder={isAdjust ? '조정 사유 (실사 보정 등)' : isUsage ? '소모 메모 (선택)' : '이동 사유 (선택)'} className="mt-1 input" />
        </div>

        {/* 품목 선택 */}
        <div>
          <div className="flex items-center justify-between gap-2">
            <label className="block text-sm font-medium text-gray-700">품목 선택</label>
          </div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={fromBranchId ? '제품명 / 코드로 목록 필터...' : '먼저 기준창고를 선택하세요'}
            disabled={!fromBranchId}
            className={`mt-1 input ${!fromBranchId ? 'bg-slate-100 cursor-not-allowed' : ''}`}
          />
          {!fromBranchId && <p className="mt-2 text-sm text-slate-400">먼저 기준창고를 선택하세요.</p>}
          {fromBranchId && loadingInv && <p className="mt-2 text-xs text-slate-400">기준창고 재고 불러오는 중...</p>}
          {fromBranchId && !loadingInv && browseAll.length === 0 && <p className="mt-2 text-sm text-slate-400">대상 재고가 없습니다.</p>}
          {fromBranchId && !loadingInv && browseAll.length > 0 && (
            <>
              {browseList.length === 0 ? (
                <p className="mt-2 text-xs text-slate-400">검색 결과 없음</p>
              ) : (
                <div className="mt-1 border border-slate-200 rounded-lg max-h-72 overflow-y-auto divide-y">
                  {browseList.map(c => {
                    const checked = rows.some(r => r.product_id === c.product_id);
                    const stock = stockOf(c.product_id);
                    return (
                      <label key={c.product_id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                        <input type="checkbox" checked={checked} onChange={() => toggleProduct(c)} className="h-4 w-4 shrink-0" />
                        <span className="flex-1 min-w-0">
                          <span className="font-medium">{c.name}</span>
                          <span className="text-slate-500"> · {c.code}</span>
                        </span>
                        <span className="text-xs text-slate-500 shrink-0">현재고 <span className="font-semibold">{stock === null ? 0 : fmtStock(stock, allowDecimalOf(c.product_id))}</span></span>
                      </label>
                    );
                  })}
                </div>
              )}
              {overCap && <p className="mt-1 text-xs text-slate-400">상위 200개만 표시 — 검색으로 좁히세요</p>}
            </>
          )}
        </div>

        {/* 선택 품목 — 현재고 / 입력수량 / 반영 후 재고 */}
        {rows.length > 0 && (
          <div className="border border-slate-200 rounded-lg divide-y">
            <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase">
              <span className="flex-1">품목 · 현재고</span>
              <span className="w-24 text-center">{qtyLabel}</span>
              <span className="w-24 text-center">반영 후</span>
              <span className="w-6" />
            </div>
            {rows.map(r => {
              const stock = stockOf(r.product_id);
              const over = !isAdjust && stock !== null && r.quantity > stock;
              const after = afterStockOf(r);
              const dec = allowDecimalOf(r.product_id);
              return (
                <div key={r.product_id} className="flex items-center gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{r.name}</p>
                    <p className="text-xs text-slate-500">
                      {r.code} · 현재고: <span className="font-semibold">{stock === null ? '없음(0)' : fmtStock(stock, dec)}</span>
                      {over && <span className="ml-2 px-1.5 py-0.5 rounded bg-red-100 text-red-700">현재고 초과</span>}
                    </p>
                    {/* #107 자가사용 품목별 사유 — 미선택 시 헤더 기본 사유 적용 */}
                    {isUsage && (
                      <select
                        value={r.usage_type_id || ''}
                        onChange={e => updateRowUsageType(r.product_id, e.target.value)}
                        className={`mt-1 input py-1 text-xs ${!(r.usage_type_id || usageTypeId) ? 'border-amber-400' : ''}`}
                      >
                        <option value="">{usageTypeId ? '기본 사유 사용' : '사유 선택 *'}</option>
                        {usageTypes.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    )}
                  </div>
                  <input
                    type="number"
                    value={r.quantity}
                    min={(isAdjust || isUsage) ? undefined : '1'}
                    step={dec ? 'any' : '1'}
                    onChange={e => updateQty(r.product_id, dec ? (parseFloat(e.target.value) || 0) : (parseInt(e.target.value) || 0))}
                    title={isUsage ? '음수 입력 시 재고 복원(반대 처리)됩니다.' : undefined}
                    className={`input w-24 text-right ${over ? 'border-red-400' : ''} ${isUsage && r.quantity < 0 ? 'text-red-600' : ''}`}
                  />
                  <span className={`w-24 text-right text-sm font-semibold ${after < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                    {fmtStock(after, dec)}
                  </span>
                  <button type="button" onClick={() => removeRow(r.product_id)} className="text-slate-400 hover:text-red-600 px-1" aria-label="삭제">✕</button>
                </div>
              );
            })}
          </div>
        )}

        {hasOver && (
          <p className="text-xs text-amber-600 pt-1">⚠ 일부 품목이 현재고를 초과합니다 — 처리 후 기준창고 재고가 음수로 차감됩니다(허용).</p>
        )}

        <div className="pt-2">
          <button type="submit" disabled={submitDisabled} className={`${isAdjust ? 'bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 font-medium disabled:opacity-50' : 'btn-primary'}`}>
            {loading ? '처리 중...' : `${TYPE_LABEL[moveType]} 처리 (${rows.length})`}
          </button>
        </div>
      </form>
    </div>
  );
}
