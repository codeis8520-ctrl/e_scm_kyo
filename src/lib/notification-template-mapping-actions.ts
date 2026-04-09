'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/session';
import type { EventTypeKey, TemplateMapping } from './notification-event-types';

// 전체 매핑 조회 → { [solapi_template_id]: mapping } 형태로 반환
export async function getTemplateMappings(): Promise<{
  data: Record<string, TemplateMapping>;
  error?: string;
}> {
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from('notification_template_mappings')
    .select('*');

  if (error) return { data: {}, error: error.message };

  const map: Record<string, TemplateMapping> = {};
  for (const row of (data || [])) {
    map[row.solapi_template_id] = row;
  }
  return { data: map };
}

// Solapi 템플릿 ID 기준 upsert
export async function upsertTemplateMapping(params: {
  solapi_template_id: string;
  event_type: EventTypeKey | string;
  is_manual_sendable: boolean;
  description?: string | null;
}) {
  try {
    await requireSession();
  } catch (e: any) {
    return { error: e.message };
  }

  const supabase = (await createClient()) as any;
  const { solapi_template_id, event_type, is_manual_sendable, description } = params;

  if (!solapi_template_id) {
    return { error: 'solapi_template_id가 필요합니다.' };
  }

  const { error } = await supabase
    .from('notification_template_mappings')
    .upsert(
      {
        solapi_template_id,
        event_type,
        is_manual_sendable,
        description: description ?? null,
      },
      { onConflict: 'solapi_template_id' }
    );

  if (error) return { error: error.message };

  revalidatePath('/notifications');
  revalidatePath('/notifications/templates');
  return { success: true };
}

// 일괄 upsert (초기 등록 편의)
export async function upsertManyTemplateMappings(
  mappings: Array<{
    solapi_template_id: string;
    event_type: EventTypeKey | string;
    is_manual_sendable: boolean;
    description?: string | null;
  }>
) {
  try {
    await requireSession();
  } catch (e: any) {
    return { error: e.message };
  }

  const supabase = (await createClient()) as any;
  const rows = mappings.map(m => ({
    solapi_template_id: m.solapi_template_id,
    event_type: m.event_type,
    is_manual_sendable: m.is_manual_sendable,
    description: m.description ?? null,
  }));

  const { error } = await supabase
    .from('notification_template_mappings')
    .upsert(rows, { onConflict: 'solapi_template_id' });

  if (error) return { error: error.message };

  revalidatePath('/notifications');
  revalidatePath('/notifications/templates');
  return { success: true, count: rows.length };
}

// 삭제 (미지정으로 되돌리기)
export async function deleteTemplateMapping(solapi_template_id: string) {
  try {
    await requireSession();
  } catch (e: any) {
    return { error: e.message };
  }

  const supabase = (await createClient()) as any;
  const { error } = await supabase
    .from('notification_template_mappings')
    .delete()
    .eq('solapi_template_id', solapi_template_id);

  if (error) return { error: error.message };

  revalidatePath('/notifications');
  revalidatePath('/notifications/templates');
  return { success: true };
}
