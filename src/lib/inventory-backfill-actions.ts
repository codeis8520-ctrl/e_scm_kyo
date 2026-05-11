'use server';

import { createClient } from '@/lib/supabase/server';

/**
 * 누락된 inventories 행 자가 치유 (idempotent)
 *
 * "재고 추적 대상" 제품 × "활성 지점"의 곱집합 중에서
 * inventories 행이 없는 (branch_id, product_id) 쌍에 한해 qty=0 으로 INSERT.
 *
 * 재고 추적 대상 정의:
 *   - is_active = true
 *   - track_inventory IS NULL 또는 true (구버전 호환: 컬럼 자체가 없으면 모두 추적)
 *   - is_phantom IS NULL 또는 false (phantom은 본인 재고 미추적)
 *
 * 호출 시점: 재고 페이지 진입 시 1회 (사용자에겐 무음). DB 일관성 유지용.
 *
 * 발생 원인:
 *   - 과거 createProduct 가 track_inventory=false 로 생성 후 사후 true 로 바꾼 경우
 *   - 새 지점 추가 시 createBranch 의 인벤토리 백필이 일부 실패한 경우
 *   - 마이그레이션 도입 전·후 데이터 갭
 */
export async function backfillMissingInventories(): Promise<{
  inserted: number;
  scanned: number;
  error?: string;
}> {
  const supabase = await createClient() as any;

  // 1) 활성 지점 모음
  const { data: branches, error: brErr } = await supabase
    .from('branches').select('id').eq('is_active', true);
  if (brErr) return { inserted: 0, scanned: 0, error: brErr.message };
  const branchIds: string[] = (branches || []).map((b: any) => b.id);
  if (branchIds.length === 0) return { inserted: 0, scanned: 0 };

  // 2) 재고 추적 대상 제품 모음
  //    정책: 세트상품(Phantom)은 묶음 명칭일 뿐 본인 재고 관리 대상 아님 — 구성품 각각이
  //         개별 재고 관리됨. 따라서 phantom 은 제외. SERVICE 무형상품도 제외.
  //    포함: is_active && is_phantom != true && product_type != 'SERVICE'
  //         track_inventory=false 라도 visibility/관리를 위해 포함 (UI 에 "재고 추적 해제" 배지)
  let productsRes: any = await supabase
    .from('products')
    .select('id, product_type, track_inventory, is_phantom')
    .eq('is_active', true);
  if (productsRes.error) {
    // is_phantom 컬럼 미적용 폴백
    productsRes = await supabase.from('products').select('id, product_type, track_inventory').eq('is_active', true);
  }
  if (productsRes.error) {
    productsRes = await supabase.from('products').select('id, product_type').eq('is_active', true);
  }
  if (productsRes.error) {
    productsRes = await supabase.from('products').select('id').eq('is_active', true);
  }
  if (productsRes.error) return { inserted: 0, scanned: 0, error: productsRes.error.message };

  const trackable: string[] = (productsRes.data || [])
    .filter((p: any) => {
      const pt = p.product_type;            // 없으면 undefined
      const ph = p.is_phantom ?? false;     // 없으면 false 가정
      return pt !== 'SERVICE' && ph !== true;
    })
    .map((p: any) => p.id);

  if (trackable.length === 0) return { inserted: 0, scanned: 0 };

  // 3) 기존 inventories 행 모음 (Set으로 빠른 조회)
  //    ⚠️ Supabase 기본 응답 1000행 제한 우회 — range(0, 99999) 명시.
  //       제품 200+ × 지점 5+ 이면 기본 limit 에 걸려 일부 행이 누락된 것으로 잘못 판정해
  //       이미 존재하는 (branch, product) 쌍에 다시 INSERT 시도 → unique violation 으로 chunk 전체 실패.
  const { data: existing, error: invErr } = await supabase
    .from('inventories')
    .select('branch_id, product_id')
    .in('product_id', trackable)
    .range(0, 99999);
  if (invErr) return { inserted: 0, scanned: 0, error: invErr.message };

  const existingSet = new Set<string>(
    (existing || []).map((r: any) => `${r.branch_id}__${r.product_id}`)
  );

  // 4) 누락된 (branch × product) 쌍 INSERT
  const missing: { product_id: string; branch_id: string; quantity: number; safety_stock: number }[] = [];
  for (const pid of trackable) {
    for (const bid of branchIds) {
      if (!existingSet.has(`${bid}__${pid}`)) {
        missing.push({ product_id: pid, branch_id: bid, quantity: 0, safety_stock: 0 });
      }
    }
  }

  const scanned = trackable.length * branchIds.length;
  if (missing.length === 0) return { inserted: 0, scanned };

  // 청크로 INSERT (대용량 안전)
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    const { error } = await supabase.from('inventories').insert(chunk);
    if (error) {
      console.error('[backfillMissingInventories] insert chunk 실패:', error.message);
      // 일부 성공일 수 있으니 계속
      continue;
    }
    inserted += chunk.length;
  }

  return { inserted, scanned };
}
