'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createHash, randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { writeAuditLog } from '@/lib/session';
import bcrypt from 'bcryptjs';

// 레거시 SHA-256 해시 (기존 사용자 호환용 — 로그인 시 bcrypt로 자동 전환)
function hashPasswordLegacy(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

// bcrypt 해시 생성 (신규 사용자 + 전환 후)
async function hashPasswordBcrypt(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function login(formData: FormData): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient();

  const loginId = formData.get('login_id') as string;
  const password = formData.get('password') as string;

  // login_id로 사용자 찾기
  const { data: userData, error: queryError } = await supabase
    .from('users')
    .select('id, login_id, password_hash, name, role, branch_id')
    .eq('login_id', loginId)
    .single();
  
  if (queryError || !userData) {
    return { error: '존재하지 않는 아이디입니다' };
  }
  
  const user = userData as { id: string; login_id: string; password_hash: string; name: string; role: string; branch_id: string | null };

  // 비밀번호 검증 — bcrypt 또는 레거시 SHA-256 호환
  if (user.password_hash) {
    const isBcrypt = user.password_hash.startsWith('$2');
    let valid = false;
    if (isBcrypt) {
      valid = await bcrypt.compare(password, user.password_hash);
    } else {
      // 레거시 SHA-256 비교
      valid = user.password_hash === hashPasswordLegacy(password);
      // 성공 시 자동으로 bcrypt로 전환 (마이그레이션)
      if (valid) {
        const newHash = await hashPasswordBcrypt(password);
        await (supabase as any).from('users').update({ password_hash: newHash }).eq('id', user.id);
      }
    }
    if (!valid) {
      return { error: '비밀번호가 일치하지 않습니다' };
    }
  }

  // 자체 세션 토큰 생성 — 암호학적으로 안전한 랜덤 (Math.random 대체)
  const sessionToken = randomBytes(32).toString('hex');

  // session_tokens 테이블에 저장 (서버 측 무효화 가능)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await (supabase as any).from('session_tokens').insert({
    user_id: user.id,
    token_hash: sessionToken,
    expires_at: expiresAt,
  });

  // 만료된 세션 정리 (백그라운드)
  ;(supabase as any).from('session_tokens')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .then(() => {});

  // 감사 로그
  writeAuditLog({ userId: user.id, action: 'LOGIN', description: `로그인: ${user.name}` }).catch(() => {});

  // 쿠키에 세션 저장
  const cookieStore = await cookies();
  cookieStore.set('session_token', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
  cookieStore.set('user_id', user.id, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
  cookieStore.set('user_name', user.name, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
  cookieStore.set('user_role', user.role, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
  if (user.branch_id) {
    cookieStore.set('user_branch_id', user.branch_id, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });
  }

  return { success: true };
}

export async function signOut() {
  const cookieStore = await cookies();
  const token  = (cookieStore as any).get('session_token')?.value as string | undefined;
  const userId = (cookieStore as any).get('user_id')?.value as string | undefined;

  if (token) {
    const supabase = await createClient();
    await (supabase as any).from('session_tokens').delete().eq('token_hash', token);
  }

  writeAuditLog({ userId: userId || null, action: 'LOGOUT' }).catch(() => {});

  cookieStore.delete('session_token');
  cookieStore.delete('user_id');
  cookieStore.delete('user_name');
  cookieStore.delete('user_role');
  cookieStore.delete('user_branch_id');
  redirect('/login');
}
