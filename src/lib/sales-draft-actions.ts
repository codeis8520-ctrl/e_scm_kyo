'use server';

// ═══════════════════════════════════════════════════════════════════════
// POS 판매 전표 임시저장 서버 액션
//
// - 결제 직전 상태(고객/카트/배송/메모)를 통째로 저장 → 나중에 다시 불러와 이어 작성
// - 본인 지점의 임시저장만 조회/삭제 (HQ는 전 지점)
// - 결제 완료(processPosCheckout)와 무관한 별도 라이프사이클
// ═══════════════════════════════════════════════════════════════════════

import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';

const HQ_ROLES = ['SUPER_ADMIN', 'HQ_OPERATOR', 'EXECUTIVE'];

export interface DraftPayload {
  branch_id: string;
  customer_id?: string | null;
  customer_snapshot?: { name?: string; phone?: string; grade?: string } | null;
  cart_items: any[];
  delivery_info?: any;
  payment_info?: any;
  meta_info?: any;
  memo?: string | null;
  title?: string | null;
  total_amount?: number;
  item_count?: number;
}

export interface DraftRow {
  id: string;
  branch_id: string;
  customer_id: string | null;
  customer_snapshot: any;
  cart_items: any[];
  delivery_info: any;
  payment_info: any;
  meta_info: any;
  memo: string | null;
  title: string | null;
  total_amount: number;
  item_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  branch?: { id: string; name: string } | null;
  customer?: { id: string; name: string; phone: string } | null;
  creator?: { id: string; name: string } | null;
}

// ─── 저장 (신규/덮어쓰기) ──────────────────────────────────────────────────

export async function saveDraft(
  payload: DraftPayload,
  draftId?: string,
): Promise<{ success?: boolean; id?: string; error?: string }> {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

  if (!payload.branch_id) return { error: '판매 지점이 지정되지 않았습니다.' };
  if (!payload.cart_items || payload.cart_items.length === 0) {
    return { error: '저장할 품목이 없습니다.' };
  }

  const supabase = (await createClient()) as any;

  const row = {
    branch_id: payload.branch_id,
    customer_id: payload.customer_id || null,
    customer_snapshot: payload.customer_snapshot || null,
    cart_items: payload.cart_items || [],
    delivery_info: payload.delivery_info || {},
    payment_info: payload.payment_info || {},
    meta_info: payload.meta_info || {},
    memo: payload.memo || null,
    title: payload.title || null,
    total_amount: payload.total_amount || 0,
    item_count: payload.item_count || (payload.cart_items?.length || 0),
    created_by: session.id,
  };

  if (draftId) {
    const { data, error } = await supabase
      .from('sales_order_drafts')
      .update(row)
      .eq('id', draftId)
      .select('id')
      .single();
    if (error) return { error: error.message };
    revalidatePath('/pos');
    return { success: true, id: data.id };
  }

  const { data, error } = await supabase
    .from('sales_order_drafts')
    .insert(row)
    .select('id')
    .single();
  if (error) return { error: error.message };

  revalidatePath('/pos');
  return { success: true, id: data.id };
}

// ─── 목록 조회 ─────────────────────────────────────────────────────────────
//   - HQ 역할: 전 지점
//   - BRANCH/PHARMACY: 본인 지점만
//   - 작성자 본인 + 같은 지점 동료 작성건 모두 조회 (인계 시나리오)

export async function listDrafts(): Promise<{ data?: DraftRow[]; error?: string }> {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

  const supabase = (await createClient()) as any;

  let q = supabase
    .from('sales_order_drafts')
    .select(`
      *,
      branch:branches(id, name),
      customer:customers(id, name, phone),
      creator:users!sales_order_drafts_created_by_fkey(id, name)
    `)
    .order('updated_at', { ascending: false })
    .limit(100);

  if (!HQ_ROLES.includes(session.role) && session.branch_id) {
    q = q.eq('branch_id', session.branch_id);
  }

  const { data, error } = await q;
  if (error) return { error: error.message };
  return { data: (data || []) as DraftRow[] };
}

// ─── 단건 조회 (불러오기) ──────────────────────────────────────────────────

export async function getDraft(id: string): Promise<{ data?: DraftRow; error?: string }> {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

  const supabase = (await createClient()) as any;

  const { data, error } = await supabase
    .from('sales_order_drafts')
    .select(`
      *,
      branch:branches(id, name),
      customer:customers(id, name, phone),
      creator:users!sales_order_drafts_created_by_fkey(id, name)
    `)
    .eq('id', id)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: '임시저장 전표를 찾을 수 없습니다.' };

  // 비-HQ는 본인 지점만 접근
  if (!HQ_ROLES.includes(session.role) && session.branch_id && data.branch_id !== session.branch_id) {
    return { error: '다른 지점의 임시저장은 불러올 수 없습니다.' };
  }

  return { data: data as DraftRow };
}

// ─── 삭제 ──────────────────────────────────────────────────────────────────

export async function deleteDraft(id: string): Promise<{ success?: boolean; error?: string }> {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

  const supabase = (await createClient()) as any;

  // 권한 체크 — 본인 지점 (또는 HQ)
  const { data: existing, error: fetchErr } = await supabase
    .from('sales_order_drafts')
    .select('branch_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) return { error: fetchErr.message };
  if (!existing) return { error: '임시저장 전표를 찾을 수 없습니다.' };

  if (!HQ_ROLES.includes(session.role) && session.branch_id && existing.branch_id !== session.branch_id) {
    return { error: '다른 지점의 임시저장은 삭제할 수 없습니다.' };
  }

  const { error } = await supabase
    .from('sales_order_drafts')
    .delete()
    .eq('id', id);

  if (error) return { error: error.message };

  revalidatePath('/pos');
  return { success: true };
}
