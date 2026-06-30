'use client';

// 재고변동전표 통합 조회(#86) — 창고이동·자가사용·강제조정을 전표 1건으로.
//   유형/일자/기준·대상 지점 필터 + 전표 상세(품목·수량·창고·담당자·사유) + 출력.
import { useState, useEffect, useCallback } from 'react';
import { getStockMovementDocs, getStockMovementDocDetail } from '@/lib/actions';
import { fmtStock } from '@/lib/validators';

interface Props {
  branches: { id: string; name: string }[];
}

type MoveType = 'TRANSFER' | 'USAGE' | 'ADJUST';

const TYPE_META: Record<MoveType, { label: string; badge: string }> = {
  TRANSFER: { label: '창고이동', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  USAGE: { label: '자가사용', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  ADJUST: { label: '강제조정', badge: 'bg-rose-50 text-rose-700 border-rose-200' },
};
const typeMeta = (t: string) => TYPE_META[t as MoveType] ?? { label: t || '-', badge: 'bg-slate-50 text-slate-600 border-slate-200' };

export default function StockTransferList({ branches }: Props) {
  const [moveType, setMoveType] = useState<'' | MoveType>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [fromBranchId, setFromBranchId] = useState('');
  const [toBranchId, setToBranchId] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<{ header: any; items: any[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getStockMovementDocs({
      moveType: moveType || undefined,
      from: from || undefined, to: to || undefined,
      fromBranchId: fromBranchId || undefined, toBranchId: toBranchId || undefined,
    });
    setRows(res.data || []);
    setLoading(false);
  }, [moveType, from, to, fromBranchId, toBranchId]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    const res = await getStockMovementDocDetail(id);
    setDetailLoading(false);
    if (res.error) { alert(res.error); return; }
    setDetail({ header: res.header, items: res.items || [] });
  };

  // 이동만 출발→도착 분리 표기. 그 외(사용/조정)는 기준창고 단일.
  const branchLabel = (h: any) =>
    h.move_type === 'TRANSFER'
      ? `${h.from_branch?.name || '-'} → ${h.to_branch?.name || '-'}`
      : (h.from_branch?.name || '-');
  const qtyHeader = (t: string) => (t === 'ADJUST' ? '목표수량' : '수량');

  const printDetail = () => {
    if (!detail) return;
    const h = detail.header;
    const tm = typeMeta(h.move_type);
    const rowsHtml = detail.items.map(it => `
      <tr><td>${it.product_name || '-'}</td><td style="font-family:monospace;color:#888">${it.product_code || ''}</td><td style="text-align:right">${Number(it.quantity).toLocaleString()}</td></tr>`).join('');
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) return;
    w.document.write(`
      <html><head><title>재고변동전표 ${h.doc_no}</title>
      <style>
        body{font-family:-apple-system,sans-serif;padding:32px;color:#1e293b}
        h1{font-size:20px;margin:0 0 4px} .no{font-family:monospace;color:#2563eb}
        table{width:100%;border-collapse:collapse;margin-top:16px}
        th,td{border:1px solid #e2e8f0;padding:8px;font-size:13px}
        th{background:#f8fafc;text-align:left}
        .meta{margin-top:8px;font-size:13px;color:#475569;line-height:1.8}
        .meta b{color:#1e293b}
      </style></head><body>
      <h1>재고변동전표 — ${tm.label}</h1>
      <div class="no">${h.doc_no}</div>
      <div class="meta">
        ${h.move_type === 'TRANSFER'
          ? `<div><b>출발창고</b> ${h.from_branch?.name || '-'} &nbsp;→&nbsp; <b>도착창고</b> ${h.to_branch?.name || '-'}</div>
             <div><b>출발(출고)일</b> ${h.ship_date || '-'} &nbsp; <b>도착예정일</b> ${h.arrival_date || '-'}</div>`
          : `<div><b>기준창고</b> ${h.from_branch?.name || '-'}</div>`}
        ${h.usage_type?.name ? `<div><b>사용유형</b> ${h.usage_type.name}</div>` : ''}
        <div><b>처리일</b> ${(h.created_at || '').slice(0, 10) || '-'} &nbsp; <b>담당자</b> ${h.creator?.name || '-'} &nbsp; <b>품목수</b> ${h.item_count ?? detail.items.length} &nbsp; <b>총수량</b> ${Number(h.total_qty ?? 0).toLocaleString()}</div>
        ${h.memo ? `<div><b>메모</b> ${h.memo}</div>` : ''}
      </div>
      <table><thead><tr><th>품목</th><th>코드</th><th style="text-align:right">${qtyHeader(h.move_type)}</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      <script>window.onload=()=>{setTimeout(()=>window.print(),300)}</script>
      </body></html>`);
    w.document.close();
  };

  const hasFilter = moveType || from || to || fromBranchId || toBranchId;

  return (
    <div className="space-y-4">
      <h3 className="text-base font-bold">재고변동전표 조회</h3>

      {/* 필터 */}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-slate-500 mb-1">변동유형</label>
          <select value={moveType} onChange={e => setMoveType(e.target.value as '' | MoveType)} className="input text-sm py-1.5">
            <option value="">전체</option>
            <option value="TRANSFER">창고이동</option>
            <option value="USAGE">자가사용</option>
            <option value="ADJUST">강제조정</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">처리일 ~부터</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">~까지</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">기준/출발창고</label>
          <select value={fromBranchId} onChange={e => setFromBranchId(e.target.value)} className="input text-sm py-1.5">
            <option value="">전체</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">도착창고(이동)</label>
          <select value={toBranchId} onChange={e => setToBranchId(e.target.value)} className="input text-sm py-1.5">
            <option value="">전체</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        {hasFilter && (
          <button onClick={() => { setMoveType(''); setFrom(''); setTo(''); setFromBranchId(''); setToBranchId(''); }}
            className="text-xs text-slate-500 hover:text-slate-700 underline pb-2">필터 초기화</button>
        )}
      </div>

      {/* 목록 */}
      {loading ? (
        <p className="text-center text-slate-400 py-8 text-sm">불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="text-center text-slate-400 py-8 text-sm">재고변동전표가 없습니다. (재고변동전표 입력 시 생성됩니다)</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="table text-sm w-full min-w-[820px]">
            <thead>
              <tr className="bg-slate-50 text-[11px] text-slate-500 uppercase">
                <th className="px-3 py-2 text-left">전표번호</th>
                <th className="px-3 py-2 text-left">처리일</th>
                <th className="px-3 py-2 text-left">유형</th>
                <th className="px-3 py-2 text-left">창고</th>
                <th className="px-3 py-2 text-right">품목수</th>
                <th className="px-3 py-2 text-right">총수량</th>
                <th className="px-3 py-2 text-left">담당자</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => {
                const tm = typeMeta(r.move_type);
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-blue-700">{r.doc_no}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.created_at?.slice(0, 10) || '-'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-medium ${tm.badge}`}>{tm.label}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{branchLabel(r)}</td>
                    <td className="px-3 py-2 text-right">{r.item_count ?? '-'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(r.total_qty ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{r.creator?.name || '-'}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => openDetail(r.id)} className="text-xs text-blue-600 hover:underline">상세</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 상세 모달 */}
      {(detail || detailLoading) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-lg w-full max-w-lg max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {detailLoading || !detail ? (
              <div className="p-8 text-center text-slate-400 text-sm">불러오는 중...</div>
            ) : (
              <>
                <div className="flex items-start justify-between px-5 py-3 border-b">
                  <div>
                    <h2 className="font-bold flex items-center gap-2">
                      재고변동전표
                      <span className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-medium ${typeMeta(detail.header.move_type).badge}`}>{typeMeta(detail.header.move_type).label}</span>
                    </h2>
                    <p className="font-mono text-blue-700 text-sm mt-0.5">{detail.header.doc_no}</p>
                  </div>
                  <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
                </div>
                <div className="px-5 py-3 text-sm text-slate-700 space-y-1 border-b bg-slate-50">
                  {detail.header.move_type === 'TRANSFER' ? (
                    <>
                      <p><span className="text-slate-500 text-xs mr-2">출발 → 도착</span><b>{detail.header.from_branch?.name || '-'}</b> → <b>{detail.header.to_branch?.name || '-'}</b></p>
                      <p><span className="text-slate-500 text-xs mr-2">출발일/도착예정</span>{detail.header.ship_date || '-'} / {detail.header.arrival_date || '-'}</p>
                    </>
                  ) : (
                    <p><span className="text-slate-500 text-xs mr-2">기준창고</span><b>{detail.header.from_branch?.name || '-'}</b></p>
                  )}
                  {detail.header.usage_type?.name && <p><span className="text-slate-500 text-xs mr-2">사용유형</span>{detail.header.usage_type.name}</p>}
                  <p><span className="text-slate-500 text-xs mr-2">처리일/담당자</span>{detail.header.created_at?.slice(0, 10) || '-'} / {detail.header.creator?.name || '-'}</p>
                  {detail.header.memo && <p><span className="text-slate-500 text-xs mr-2">메모</span>{detail.header.memo}</p>}
                </div>
                <div className="p-5">
                  <table className="table text-sm w-full">
                    <thead><tr className="text-[11px] text-slate-500 uppercase border-b"><th className="text-left py-1.5">품목</th><th className="text-right py-1.5">{qtyHeader(detail.header.move_type)}</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {detail.items.map(it => (
                        <tr key={it.id}>
                          <td className="py-1.5"><span className="font-medium">{it.product_name || '-'}</span> <span className="text-[11px] text-slate-400 font-mono">{it.product_code || ''}</span></td>
                          <td className="py-1.5 text-right tabular-nums font-semibold">{fmtStock(Number(it.quantity), false)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-5 py-3 border-t flex justify-end gap-2">
                  <button onClick={printDetail} className="btn-secondary text-sm">🖨️ 출력</button>
                  <button onClick={() => setDetail(null)} className="btn-primary text-sm">닫기</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
