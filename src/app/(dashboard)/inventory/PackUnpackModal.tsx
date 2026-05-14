'use client';

import { useState, useEffect } from 'react';
import { packUnpackInventory } from '@/lib/inventory-actions';
import { createClient } from '@/lib/supabase/client';

interface Branch {
  id: string;
  name: string;
}

interface Props {
  parentProduct: {
    id: string;
    name: string;
    code: string;
    packChildId: string;
    packChildQty: number;
    /** Phantom(세트) 부모는 본인 재고 없음 → 자식 SKU 만 증감. */
    isPhantom?: boolean;
  };
  /** 모달에서 선택 가능한 지점 목록 (호출자가 BRANCH 사용자 제한 필터링). */
  branches: Branch[];
  /** 미리 선택해둘 지점 — 없으면 비어있고 사용자가 직접 고름. */
  initialBranchId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function PackUnpackModal({ parentProduct, branches, initialBranchId, onClose, onSuccess }: Props) {
  const isPhantomParent = parentProduct.isPhantom === true;
  const [branchId, setBranchId] = useState(initialBranchId || branches[0]?.id || '');
  const [direction, setDirection] = useState<'UNPACK' | 'PACK'>('UNPACK');
  const [parentQty, setParentQty] = useState<number>(1);
  const [memo, setMemo] = useState('');
  const [child, setChild] = useState<{ name: string; code: string } | null>(null);
  // 현재 지점의 부모/자식 재고 미리보기 (Phantom 부모는 parentStock 사용 안 함)
  const [parentStock, setParentStock] = useState<number | null>(null);
  const [childStock, setChildStock] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 자식 SKU 정보 로드
  useEffect(() => {
    const supabase = createClient();
    (supabase.from('products') as any)
      .select('id, name, code')
      .eq('id', parentProduct.packChildId)
      .single()
      .then(({ data }: any) => {
        if (data) setChild({ name: data.name, code: data.code });
      });
  }, [parentProduct.packChildId]);

  // 선택된 지점의 부모·자식 재고
  useEffect(() => {
    if (!branchId) { setParentStock(null); setChildStock(null); return; }
    const supabase = createClient();
    (supabase.from('inventories') as any)
      .select('product_id, quantity')
      .eq('branch_id', branchId)
      .in('product_id', [parentProduct.id, parentProduct.packChildId])
      .then(({ data }: any) => {
        const rows = (data || []) as Array<{ product_id: string; quantity: number }>;
        const p = rows.find(r => r.product_id === parentProduct.id);
        const c = rows.find(r => r.product_id === parentProduct.packChildId);
        setParentStock(p ? p.quantity : 0);
        setChildStock(c ? c.quantity : 0);
      });
  }, [branchId, parentProduct.id, parentProduct.packChildId]);

  const childDelta = parentQty * parentProduct.packChildQty;
  // Phantom 부모는 재고가 없으므로 항상 변화 없음.
  const parentAfter = isPhantomParent
    ? parentStock
    : (parentStock == null ? null : parentStock + (direction === 'UNPACK' ? -parentQty : parentQty));
  const childAfter  = childStock  == null ? null : childStock  + (direction === 'UNPACK' ? childDelta : -childDelta);
  const willGoNegativeParent = isPhantomParent ? false : (direction === 'PACK' ? false : (parentAfter != null && parentAfter < 0));
  const willGoNegativeChild  = direction === 'UNPACK' ? false : (childAfter  != null && childAfter  < 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!branchId) { setError('지점을 선택해주세요.'); return; }
    if (parentQty <= 0) { setError('수량은 1 이상이어야 합니다.'); return; }
    setLoading(true);
    const r = await packUnpackInventory({
      parentProductId: parentProduct.id,
      branchId,
      parentQty,
      direction,
      memo: memo || undefined,
    });
    setLoading(false);
    if ((r as any).error) {
      setError((r as any).error);
      return;
    }
    onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-bold">📦 {isPhantomParent ? '세트 해체' : '박스 분해'} / 재포장</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className={`mb-4 p-3 rounded-md text-sm border ${isPhantomParent ? 'bg-indigo-50 border-indigo-200' : 'bg-amber-50 border-amber-200'}`}>
          <p className="font-medium text-slate-800">
            {isPhantomParent && <span className="mr-1 text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">세트</span>}
            {parentProduct.name} <span className="text-xs text-slate-400">({parentProduct.code})</span>
          </p>
          <p className="text-xs text-slate-600 mt-1">
            1{isPhantomParent ? '세트' : '박스'} = <b>{child?.name || '소포장'}</b> × <b>{parentProduct.packChildQty}</b>
          </p>
          {isPhantomParent && (
            <p className="text-[11px] text-indigo-700 mt-1">
              세트(Phantom) 본인 재고는 없어 변화 없음. 자식 SKU 재고만 증감됩니다.
            </p>
          )}
        </div>

        {error && (
          <div className="mb-3 p-2.5 bg-red-100 text-red-700 rounded-md text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">지점 *</label>
            <select
              value={branchId}
              onChange={e => setBranchId(e.target.value)}
              required
              className="input"
            >
              <option value="">선택하세요</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">방향 *</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDirection('UNPACK')}
                className={`flex-1 py-2 rounded-md text-sm ${
                  direction === 'UNPACK' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                📦→ {isPhantomParent ? '세트 해체' : '박스 분해'}
              </button>
              <button
                type="button"
                onClick={() => setDirection('PACK')}
                className={`flex-1 py-2 rounded-md text-sm ${
                  direction === 'PACK' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                →📦 재포장
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {(() => {
                const boxLabel = isPhantomParent ? '세트' : '박스';
                if (direction === 'UNPACK') {
                  return isPhantomParent
                    ? `세트를 해체해 소포장으로 변환합니다. (세트 본인 재고 없음, 소포장 +N×${parentProduct.packChildQty})`
                    : `${boxLabel}를 뜯어 소포장으로 변환합니다. (${boxLabel} -N, 소포장 +N×${parentProduct.packChildQty})`;
                }
                return isPhantomParent
                  ? `소포장 ${parentProduct.packChildQty}개를 세트로 묶습니다. (소포장 -N×${parentProduct.packChildQty}, 세트 본인 재고 없음)`
                  : `소포장 ${parentProduct.packChildQty}개를 ${boxLabel}로 묶습니다. (소포장 -N×${parentProduct.packChildQty}, ${boxLabel} +N)`;
              })()}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {(() => {
                const boxLabel = isPhantomParent ? '세트' : '박스';
                return direction === 'UNPACK' ? `해체할 ${boxLabel} 수량 *` : `만들 ${boxLabel} 수량 *`;
              })()}
            </label>
            <input
              type="number"
              min={1}
              value={parentQty}
              onChange={e => setParentQty(parseInt(e.target.value, 10) || 0)}
              onFocus={e => e.target.select()}
              required
              className="input"
            />
          </div>

          {childStock != null && (
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-md text-xs space-y-1">
              {isPhantomParent ? (
                <div className="flex justify-between text-slate-400 italic">
                  <span>📦 {parentProduct.name}</span>
                  <span className="tabular-nums">세트 — 본인 재고 없음 (변화 없음)</span>
                </div>
              ) : (parentStock != null && (
                <div className="flex justify-between">
                  <span className="text-slate-600">📦 {parentProduct.name}</span>
                  <span className="tabular-nums">
                    {parentStock} → <b className={willGoNegativeParent ? 'text-red-600' : 'text-slate-800'}>{parentAfter}</b>
                  </span>
                </div>
              ))}
              <div className="flex justify-between">
                <span className="text-slate-600">📄 {child?.name || '소포장'}</span>
                <span className="tabular-nums">
                  {childStock} → <b className={willGoNegativeChild ? 'text-red-600' : 'text-slate-800'}>{childAfter}</b>
                </span>
              </div>
              {(willGoNegativeParent || willGoNegativeChild) && (
                <p className="text-[11px] text-red-600 pt-1">
                  ⚠️ 재고가 음수가 됩니다. (시스템은 허용하지만 실제 박스/소포장이 부족한지 확인하세요)
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">메모</label>
            <input
              type="text"
              value={memo}
              onChange={e => setMemo(e.target.value)}
              placeholder="자동 메모 사용하려면 비워두세요"
              className="input"
            />
          </div>

          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-2 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading || !branchId || parentQty <= 0}
              className="flex-1 py-2 rounded-md bg-amber-500 text-white font-medium hover:bg-amber-600 disabled:opacity-50"
            >
              {loading ? '처리 중...' : (() => {
                const boxLabel = isPhantomParent ? '세트' : '박스';
                return direction === 'UNPACK' ? `${boxLabel} 해체` : '재포장';
              })()}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
