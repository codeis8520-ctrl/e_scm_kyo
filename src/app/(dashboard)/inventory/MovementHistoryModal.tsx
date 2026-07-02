'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getInventoryMovements } from '@/lib/inventory-actions';
import { fmtDateTimeKST, fmtDateKST, kstTodayString } from '@/lib/date';
import { useEscClose } from '@/hooks/useEscClose';

type Movement = {
  id: string;
  branch_id: string;
  product_id: string;
  movement_type: string;
  quantity: number;
  reference_id: string | null;
  reference_type: string | null;
  memo: string | null;
  created_at: string;
  created_by?: string | null;
  creator_name?: string | null; // 처리자명 (getInventoryMovements 에서 부착)
  branch?: { id: string; name: string } | null;
};

// movement_type 시각 표현
const MOVEMENT_TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  IN:         { label: '입고',     cls: 'bg-emerald-50 text-emerald-700' },
  OUT:        { label: '출고',     cls: 'bg-slate-100 text-slate-600' },
  ADJUST:     { label: '조정',     cls: 'bg-blue-50 text-blue-700' },
  PRODUCTION: { label: '생산차감', cls: 'bg-amber-50 text-amber-700' },
  TRANSFER:   { label: '이동',     cls: 'bg-purple-50 text-purple-700' },
};

// reference_type을 사람이 읽기 쉬운 라벨로
const REFERENCE_LABEL: Record<string, string> = {
  MANUAL:            '수동 조정',
  TRANSFER:          '지점 이동',
  USAGE:             '자가 소모',
  POS_SALE:          '판매',
  ONLINE_SALE:       '온라인 판매',
  ONLINE_SALE_CANCEL:'온라인 취소',
  ONLINE_REFUND:     '온라인 환불',
  B2B_SALE:          'B2B 판매',
  B2B_CANCEL:        'B2B 취소',
  SALE_REVISE_ADD:   '전표 수정(추가)',
  SALE_REVISE_REMOVE:'전표 수정(삭제)',
  SALE_REVISE_EDIT:  '전표 수정',
  SALE_CANCEL:       '판매 취소',
  PHANTOM_DECOMPOSE: '세트 분해',
  PURCHASE_RECEIPT:  '매입 입고',
  PRODUCTION_ORDER:  '생산 완료',
  PRODUCTION:        '생산',
  STOCK_COUNT:       '재고 실사',
  CREDIT_CANCEL:     '외상 취소 복원',
  RETURN:            '반품',
  DAILY_REPORT:      '판매일보',
  DAILY_REPORT_CANCEL:'판매일보 취소',
  PACK_UNPACK:       '박스 분해/재포장',
};

// #107 각 이력 행 → 원본 전표 화면으로 연결.
//   reference_id 가 있으면 해당 전표를 딥링크로 열고, 없으면(재고변동전표 등) 조회 화면으로 이동.
const SALE_REF_TYPES = new Set([
  'POS_SALE', 'PHANTOM_DECOMPOSE', 'SALE_REVISE_ADD', 'SALE_REVISE_REMOVE',
  'SALE_REVISE_EDIT', 'SALE_CANCEL', 'CREDIT_CANCEL', 'DAILY_REPORT', 'DAILY_REPORT_CANCEL',
]);
const STOCK_DOC_REF_TYPES = new Set(['TRANSFER', 'USAGE', 'MANUAL']);
function resolveSourceHref(m: { reference_type: string | null; reference_id: string | null }): string | null {
  const rt = m.reference_type;
  if (!rt) return null;
  // 재고변동전표(이동/소모/강제조정) — 전표조회 화면으로 이동(정확 전표 매칭은 조회 화면에서).
  if (STOCK_DOC_REF_TYPES.has(rt)) return '/inventory?view=transferList';
  // 판매 계열 — reference_id = 판매전표 id → 판매현황 상세 자동 오픈.
  if (SALE_REF_TYPES.has(rt) && m.reference_id) return `/pos?tab=list&order=${m.reference_id}`;
  if (rt === 'ONLINE_SALE' || rt === 'ONLINE_SALE_CANCEL' || rt === 'ONLINE_REFUND') return '/pos?tab=online';
  if (rt === 'B2B_SALE' || rt === 'B2B_CANCEL') return '/pos?tab=list';
  if (rt === 'RETURN') return '/pos?tab=list';
  if (rt === 'PRODUCTION_ORDER' || rt === 'PRODUCTION') return '/production';
  if (rt === 'PURCHASE_RECEIPT') return '/purchases';
  return null;
}

function fmtDateTime(iso: string): string {
  return fmtDateTimeKST(iso);
}

interface Props {
  product: { id: string; name: string; code: string };
  /** 모달 내 지점 드롭다운에 표시할 지점 목록. BRANCH 사용자 제한은 호출자가 필터링. */
  branches: { id: string; name: string }[];
  /** 최초 지점 필터값. undefined면 '전체 지점'. */
  initialBranchId?: string;
  onClose: () => void;
}

const PAGE_SIZE = 30;

// 기본 조회 기간: 오늘 기준 1개월 전 ~ 오늘 (KST 캘린더 date)
function defaultDateRange(): { from: string; to: string } {
  const today = new Date();
  const oneMonthAgo = new Date(today);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  return { from: fmtDateKST(oneMonthAgo), to: kstTodayString() };
}

export default function MovementHistoryModal({ product, branches, initialBranchId, onClose }: Props) {
  useEscClose(onClose);
  const [branchId, setBranchId] = useState<string>(initialBranchId || '');
  const [movementType, setMovementType] = useState<string>('');
  // YYYY-MM-DD — 기본값 오늘 기준 1개월
  const [dateFrom, setDateFrom] = useState<string>(() => defaultDateRange().from);
  const [dateTo, setDateTo] = useState<string>(() => defaultDateRange().to);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Movement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getInventoryMovements({
      productId: product.id,
      branchId: branchId || undefined,
      movementType: movementType || undefined,
      dateFrom: dateFrom ? new Date(dateFrom + 'T00:00:00').toISOString() : undefined,
      dateTo: dateTo ? new Date(dateTo + 'T23:59:59').toISOString() : undefined,
      page,
      pageSize: PAGE_SIZE,
    });
    if ((r as any).error) alert((r as any).error);
    setItems(((r as any).data || []) as Movement[]);
    setTotal(((r as any).count ?? 0) as number);
    setLoading(false);
  }, [product.id, branchId, movementType, dateFrom, dateTo, page]);

  useEffect(() => { load(); }, [load]);

  // 필터 변경 시 1페이지로 리셋 (page는 의존성에서 제외 — 페이지 이동 시에는 리셋하지 않음)
  useEffect(() => { setPage(1); }, [branchId, movementType, dateFrom, dateTo]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white w-full sm:max-w-3xl max-h-[90vh] overflow-y-auto rounded-t-xl sm:rounded-xl shadow-xl">
        <div className="flex justify-between items-center px-6 py-4 border-b">
          <div>
            <h2 className="font-bold text-slate-800">재고 변동 이력</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {product.name} <span className="font-mono text-slate-400">({product.code})</span>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>

        {/* 필터 */}
        <div className="p-4 sm:p-6 border-b bg-slate-50/60">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <select value={branchId} onChange={e => setBranchId(e.target.value)} className="input text-sm py-1.5">
              <option value="">전체 지점</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select value={movementType} onChange={e => setMovementType(e.target.value)} className="input text-sm py-1.5">
              <option value="">전체 유형</option>
              <option value="IN">입고</option>
              <option value="OUT">출고</option>
              <option value="ADJUST">조정</option>
              <option value="PRODUCTION">생산차감</option>
            </select>
            <input
              type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="input text-sm py-1.5" title="시작일"
            />
            <input
              type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="input text-sm py-1.5" title="종료일"
            />
          </div>
        </div>

        <div className="flex items-center justify-between px-4 sm:px-6 pt-3 text-xs text-slate-500">
          <span>총 <b className="text-slate-700">{total.toLocaleString()}</b>건</span>
          {total > 0 && <span>페이지 {page} / {totalPages}</span>}
        </div>

        <div className="p-4 sm:p-6">
          <div className="overflow-x-auto">
            <table className="table text-sm min-w-[620px]">
              <thead>
                <tr>
                  <th>일시</th>
                  <th>지점</th>
                  <th>유형</th>
                  <th className="text-right">증감</th>
                  <th>사유</th>
                  <th>처리자</th>
                  <th>메모</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="text-center text-slate-400 py-8">로딩 중...</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={7} className="text-center text-slate-400 py-8">이력이 없습니다</td></tr>
                ) : items.map(m => {
                  const typeDef = MOVEMENT_TYPE_LABEL[m.movement_type] || { label: m.movement_type, cls: 'bg-slate-100 text-slate-600' };
                  const refLabel = m.reference_type ? (REFERENCE_LABEL[m.reference_type] || m.reference_type) : '-';
                  const sourceHref = resolveSourceHref(m);
                  const rawQty = Number(m.quantity);
                  // inventory_movements.quantity 는 절대값으로 저장됨. movement_type 으로 방향 결정.
                  //   IN / TRANSFER 도착 / 복원 → +
                  //   OUT / PRODUCTION (BOM·세트 분해 차감) → -
                  //   ADJUST → 원본 부호 유지 (음수도 가능)
                  const OUT_TYPES = new Set(['OUT', 'PRODUCTION']);
                  const signedQty = OUT_TYPES.has(m.movement_type)
                    ? -Math.abs(rawQty)
                    : m.movement_type === 'ADJUST'
                      ? rawQty
                      : Math.abs(rawQty);
                  const isPositive = signedQty > 0;
                  const isNegative = signedQty < 0;
                  return (
                    <tr key={m.id}>
                      <td className="text-xs text-slate-500 whitespace-nowrap">{fmtDateTime(m.created_at)}</td>
                      <td className="text-sm">{m.branch?.name || '-'}</td>
                      <td>
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${typeDef.cls}`}>
                          {typeDef.label}
                        </span>
                      </td>
                      <td className={`text-right font-semibold tabular-nums ${isPositive ? 'text-emerald-700' : isNegative ? 'text-red-600' : 'text-slate-500'}`}>
                        {isPositive ? '+' : ''}{signedQty.toLocaleString()}
                      </td>
                      <td className="text-sm">
                        {sourceHref ? (
                          <Link
                            href={sourceHref}
                            className="text-blue-600 hover:underline inline-flex items-center gap-0.5"
                            title="원본 전표 화면으로 이동"
                          >
                            {refLabel}<span className="text-[10px]">↗</span>
                          </Link>
                        ) : (
                          <span className="text-slate-600">{refLabel}</span>
                        )}
                      </td>
                      <td className="text-xs text-slate-600 whitespace-nowrap">{m.creator_name || '-'}</td>
                      <td className="text-xs text-slate-500">{m.memo || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4 text-sm">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="px-3 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                이전
              </button>
              <span className="text-xs text-slate-500 tabular-nums">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="px-3 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                다음
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
