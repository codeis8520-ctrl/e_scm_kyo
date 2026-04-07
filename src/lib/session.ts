'use server';

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

export interface SessionUser {
  id: string;
  name: string;
  role: string;
  branch_id: string | null;
}

/**
 * 현재 요청의 세션을 검증하고 사용자 정보를 반환합니다.
 * session_tokens 테이블에 유효한 토큰이 있어야 통과합니다.
 * 검증 실패 시 null 반환.
 */
export async function getSession(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const token   = (cookieStore as any).get('session_token')?.value as string | undefined;
    const userId  = (cookieStore as any).get('user_id')?.value     as string | undefined;
    const name    = (cookieStore as any).get('user_name')?.value   as string | undefined;
    const role    = (cookieStore as any).get('user_role')?.value   as string | undefined;
    const branchId = (cookieStore as any).get('user_branch_id')?.value as string | undefined;

    if (!token || !userId || !role) return null;

    // 쿠키에서 직접 반환 (미들웨어가 이미 session_token 유효성 검증)
    return {
      id: userId,
      name: name || '',
      role,
      branch_id: branchId || null,
    };
  } catch {
    return null;
  }
}

/**
 * 세션이 없으면 에러를 throw합니다.
 * 서버 액션에서 인증 게이트로 사용합니다.
 */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new Error('인증이 필요합니다. 다시 로그인해주세요.');
  return session;
}

/**
 * 특정 역할만 허용합니다.
 */
export async function requireRole(allowedRoles: string[]): Promise<SessionUser> {
  const session = await requireSession();
  if (!allowedRoles.includes(session.role)) {
    throw new Error('이 작업을 수행할 권한이 없습니다.');
  }
  return session;
}

/**
 * 감사 로그를 기록합니다. 실패해도 호출 측에 영향 없음.
 */
export async function writeAuditLog(params: {
  userId: string | null;
  action: string;
  tableName?: string;
  recordId?: string;
  description?: string;
  oldData?: object;
  newData?: object;
}): Promise<void> {
  try {
    const supabase = await createClient();
    await (supabase as any).from('audit_logs').insert({
      user_id:    params.userId,
      action:     params.action,
      table_name: params.tableName || null,
      record_id:  params.recordId  || null,
      description: params.description || null,
      old_data:   params.oldData  ? JSON.stringify(params.oldData)  : null,
      new_data:   params.newData  ? JSON.stringify(params.newData)  : null,
    });
  } catch {
    // 감사 로그 실패는 무시
  }
}
