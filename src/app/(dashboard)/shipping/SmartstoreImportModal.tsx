'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useEscClose } from '@/hooks/useEscClose';
import {
  previewSmartstoreOrders, commitSmartstoreOrders, saveSmartstoreMapping,
  type SSPreviewResult,
} from '@/lib/smartstore/actions';

interface Props { onClose: () => void; onImported: () => void; }
type Product = { id: string; name: string; code: string };

export default function SmartstoreImportModal({ onClose, onImported }: Props) {
  useEscClose(onClose);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<SSPreviewResult | null>(null);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<string>('');
  // 미매핑 매핑용
  const [products, setProducts] = useState<Product[]>([]);
  const [mapQuery, setMapQuery] = useState<Record<string, string>>({}); // key(productNo\noption) → 검색어
  const [savingKey, setSavingKey] = useState('');

  useEffect(() => {
    const sb = createClient() as any;
    sb.from('products').select('id, name, code').eq('is_active', true).order('name')
      .then((r: any) => setProducts((r.data as Product[]) || []));
  }, []);

  const analyze = async () => {
    if (!file) { setError('파일을 선택하세요.'); return; }
    setError(''); setResult(''); setLoading(true); setPreview(null);
    const fd = new FormData(); fd.set('file', file); fd.set('password', password);
    const res = await previewSmartstoreOrders(fd);
    setLoading(false);
    if (!('ok' in res) || !res.ok) { setError((res as any).error || '분석 실패'); return; }
    setPreview(res);
  };

  const doMap = async (productNo: string, option: string, productName: string, product: Product) => {
    const key = `${productNo}\n${option}`;
    setSavingKey(key);
    const res = await saveSmartstoreMapping({ smartstore_product_no: productNo, option_value: option, product_id: product.id, product_name: productName });
    setSavingKey('');
    if ('error' in res) { setError(res.error); return; }
    await analyze(); // 재분석 → 매핑 반영
  };

  const commit = async () => {
    if (!file) return;
    if (!confirm('신규·전량매핑된 주문을 매출 전표로 가져옵니다. 진행할까요?')) return;
    setCommitting(true); setError('');
    const fd = new FormData(); fd.set('file', file); fd.set('password', password);
    const res = await commitSmartstoreOrders(fd);
    setCommitting(false);
    if ('error' in res) { setError(res.error); return; }
    setResult(`가져오기 완료 — 생성 ${res.created}건 · 중복제외 ${res.skippedDuplicate}건 · 미매핑제외 ${res.skippedUnmapped}건`);
    await analyze();
    onImported();
  };

  const s = preview?.summary;
  const canCommit = !!preview && (s?.newOrders ?? 0) > 0 && (preview.unmapped.length === 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="flex justify-between items-center px-5 py-3 border-b sticky top-0 bg-white">
          <h2 className="font-bold text-slate-800">스마트스토어 주문 가져오기</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* 1) 파일 + 비번 */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">발주발송관리 엑셀 (.xlsx)</label>
              <input type="file" accept=".xlsx" onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); setResult(''); }}
                className="text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">엑셀 비밀번호</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="다운로드 시 설정한 비번"
                className="input text-sm py-1.5 w-44" />
            </div>
            <button className="btn-primary" onClick={analyze} disabled={loading || !file}>
              {loading ? '분석 중...' : '분석'}
            </button>
            <p className="text-[11px] text-slate-400 w-full">네이버 판매자센터 → 주문 → 발주(주문)확인/발송관리 → 전체 다운로드(암호 엑셀) 그대로 업로드하세요.</p>
          </div>

          {error && <div className="px-3 py-2 bg-red-100 text-red-700 rounded text-sm">{error}</div>}
          {result && <div className="px-3 py-2 bg-emerald-100 text-emerald-800 rounded text-sm">{result}</div>}

          {/* 2) 요약 */}
          {s && (
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge label={`총 ${s.total}건`} cls="bg-slate-100 text-slate-700" />
              <Badge label={`신규 ${s.newOrders}`} cls="bg-blue-100 text-blue-700" />
              <Badge label={`중복 ${s.duplicates}`} cls="bg-amber-100 text-amber-700" />
              <Badge label={`회원매칭 ${s.matchedMembers}`} cls="bg-violet-100 text-violet-700" />
              <Badge label={`미매핑품목 ${s.unmappedItems}`} cls={s.unmappedItems ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'} />
            </div>
          )}

          {/* 3) 미매핑 상품 매핑 */}
          {preview && preview.unmapped.length > 0 && (
            <div className="border border-red-200 rounded-lg p-3 bg-red-50/40 space-y-2">
              <p className="text-sm font-semibold text-red-700">미매핑 상품 — 내부 제품에 연결해야 가져올 수 있습니다</p>
              {preview.unmapped.map(u => {
                const key = `${u.productNo}\n${u.option}`;
                const q = (mapQuery[key] || '').trim().toLowerCase();
                const cands = q ? products.filter(p => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)).slice(0, 6) : [];
                return (
                  <div key={key} className="bg-white border border-slate-200 rounded p-2">
                    <p className="text-sm">{u.productName} <span className="text-slate-400 text-xs">상품#{u.productNo}{u.option ? ` · ${u.option}` : ''}</span></p>
                    <div className="relative mt-1">
                      <input value={mapQuery[key] || ''} onChange={e => setMapQuery(m => ({ ...m, [key]: e.target.value }))}
                        placeholder="내부 제품 검색(이름/코드)" className="input text-sm py-1 w-full" />
                      {cands.length > 0 && (
                        <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded shadow max-h-44 overflow-y-auto">
                          {cands.map(p => (
                            <li key={p.id}>
                              <button type="button" disabled={savingKey === key}
                                onClick={() => doMap(u.productNo, u.option, u.productName, p)}
                                className="w-full text-left px-2 py-1.5 hover:bg-blue-50 text-sm disabled:opacity-50">
                                {p.name} <span className="text-slate-400 text-xs">{p.code}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 4) 주문 미리보기 */}
          {preview && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="table text-xs w-full">
                <thead><tr>
                  <th>주문번호</th><th>결제일</th><th className="text-right">매출</th><th>구매자</th><th>회원</th><th>상태</th>
                </tr></thead>
                <tbody>
                  {preview.orders.map(o => (
                    <tr key={o.orderNo} className={o.alreadyImported ? 'opacity-50' : ''}>
                      <td className="font-mono">{o.orderNo}</td>
                      <td>{o.paidAt?.slice(0, 10) || '-'}</td>
                      <td className="text-right tabular-nums">{o.revenue.toLocaleString()}</td>
                      <td>{o.buyerName}</td>
                      <td>{o.customerName ? <span className="text-violet-700">{o.customerName}</span> : <span className="text-slate-400">비회원</span>}</td>
                      <td>
                        {o.alreadyImported ? <span className="text-amber-600">중복(제외)</span>
                          : o.unmappedCount > 0 ? <span className="text-red-600">미매핑 {o.unmappedCount}</span>
                          : <span className="text-emerald-600">가져오기 대상</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 5) 가져오기 */}
          {preview && (
            <div className="flex items-center gap-3">
              <button className="btn-primary" onClick={commit} disabled={committing || !canCommit}>
                {committing ? '가져오는 중...' : `가져오기 (${s?.newOrders ?? 0}건)`}
              </button>
              {!canCommit && (s?.newOrders ?? 0) > 0 && preview.unmapped.length > 0 && (
                <span className="text-xs text-red-600">미매핑 상품을 모두 연결한 뒤 가져올 수 있습니다.</span>
              )}
              {(s?.newOrders ?? 0) === 0 && <span className="text-xs text-slate-500">가져올 신규 주문이 없습니다.</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Badge({ label, cls }: { label: string; cls: string }) {
  return <span className={`px-2 py-0.5 rounded ${cls}`}>{label}</span>;
}
