'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { requireRole, requireSession, writeAuditLog } from '@/lib/session';

const ADMIN_ROLES = ['SUPER_ADMIN', 'HQ_OPERATOR'];

export type OemFactoryInput = {
  code?: string | null;
  name: string;
  business_number?: string | null;
  representative?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  memo?: string | null;
  is_active?: boolean;
};

export async function listFactories(opts?: { includeInactive?: boolean }) {
  const supabase = await createClient();
  let q = (supabase as any).from('oem_factories').select('*').order('name');
  if (!opts?.includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

export async function createFactory(input: OemFactoryInput) {
  let session;
  try { session = await requireRole(ADMIN_ROLES); } catch (e: any) { return { error: e.message }; }

  if (!input.name?.trim()) return { error: '공장명을 입력해주세요.' };

  const supabase = await createClient();
  const { data, error } = await (supabase as any).from('oem_factories').insert({
    code: input.code || null,
    name: input.name.trim(),
    business_number: input.business_number || null,
    representative: input.representative || null,
    contact_name: input.contact_name || null,
    phone: input.phone || null,
    email: input.email || null,
    address: input.address || null,
    memo: input.memo || null,
    is_active: input.is_active ?? true,
  }).select('id').single();

  if (error) return { error: error.message };

  writeAuditLog({ userId: session.id, action: 'CREATE', tableName: 'oem_factories', recordId: data?.id, description: `OEM 공장 등록: ${input.name}` }).catch(() => {});
  revalidatePath('/production');
  return { success: true, id: data?.id };
}

export async function updateFactory(id: string, patch: Partial<OemFactoryInput>) {
  if (!id) return { error: 'id가 필요합니다.' };
  let session;
  try { session = await requireRole(ADMIN_ROLES); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();
  const update: any = {};
  for (const k of ['code','name','business_number','representative','contact_name','phone','email','address','memo','is_active'] as const) {
    if (k in patch) update[k] = (patch as any)[k];
  }
  update.updated_at = new Date().toISOString();

  const { error } = await (supabase as any).from('oem_factories').update(update).eq('id', id);
  if (error) return { error: error.message };

  writeAuditLog({ userId: session.id, action: 'UPDATE', tableName: 'oem_factories', recordId: id, description: `OEM 공장 수정` }).catch(() => {});
  revalidatePath('/production');
  return { success: true };
}

// 소프트 삭제: is_active=false. 생산 지시에서 참조 중이면 hard delete 금지.
export async function deactivateFactory(id: string) {
  return updateFactory(id, { is_active: false });
}

export async function activateFactory(id: string) {
  return updateFactory(id, { is_active: true });
}

// 본사 지정: 기존 본사를 해제하고 지정한 지점만 본사로 표시.
// DB 파셜 유니크 인덱스(ux_branches_single_hq)가 있어 동시 true 2건은 거부됨.
export async function setHeadquarters(branchId: string) {
  if (!branchId) return { error: 'branchId가 필요합니다.' };
  let session;
  try { session = await requireRole(ADMIN_ROLES); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();
  const db = supabase as any;

  const { error: unsetErr } = await db
    .from('branches')
    .update({ is_headquarters: false })
    .eq('is_headquarters', true)
    .neq('id', branchId);
  if (unsetErr) return { error: unsetErr.message };

  const { error } = await db
    .from('branches')
    .update({ is_headquarters: true })
    .eq('id', branchId);
  if (error) return { error: error.message };

  writeAuditLog({ userId: session.id, action: 'UPDATE', tableName: 'branches', recordId: branchId, description: '본사 지점 지정' }).catch(() => {});
  revalidatePath('/branches');
  revalidatePath('/production');
  return { success: true };
}

export async function unsetHeadquarters(branchId: string) {
  if (!branchId) return { error: 'branchId가 필요합니다.' };
  let session;
  try { session = await requireRole(ADMIN_ROLES); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();
  const { error } = await (supabase as any)
    .from('branches')
    .update({ is_headquarters: false })
    .eq('id', branchId);
  if (error) return { error: error.message };

  writeAuditLog({ userId: session.id, action: 'UPDATE', tableName: 'branches', recordId: branchId, description: '본사 해제' }).catch(() => {});
  revalidatePath('/branches');
  revalidatePath('/production');
  return { success: true };
}

// 완전 삭제는 참조 없을 때만
export async function deleteFactory(id: string) {
  if (!id) return { error: 'id가 필요합니다.' };
  let session;
  try { session = await requireRole(ADMIN_ROLES); } catch (e: any) { return { error: e.message }; }

  const supabase = await createClient();
  const db = supabase as any;

  const { count, error: refErr } = await db
    .from('production_orders')
    .select('id', { count: 'exact', head: true })
    .eq('oem_factory_id', id);

  if (refErr) return { error: refErr.message };
  if ((count || 0) > 0) {
    return { error: '이 공장에 연결된 생산 지시가 있어 삭제할 수 없습니다. 비활성화를 사용하세요.' };
  }

  const { error } = await db.from('oem_factories').delete().eq('id', id);
  if (error) return { error: error.message };

  writeAuditLog({ userId: session.id, action: 'DELETE', tableName: 'oem_factories', recordId: id }).catch(() => {});
  revalidatePath('/production');
  return { success: true };
}
