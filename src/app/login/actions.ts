'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createHash } from 'crypto';
import { cookies } from 'next/headers';

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
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

  // 비밀번호 검증 (SHA256 해시 비교)
  const inputHash = hashPassword(password);
  if (user.password_hash && user.password_hash !== inputHash) {
    return { error: '비밀번호가 일치하지 않습니다' };
  }

  // 자체 세션 토큰 생성
  const sessionToken = createHash('sha256').update(`${user.id}-${Date.now()}`).digest('hex');
  
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
    httpOnly: true,
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
  cookieStore.delete('session_token');
  cookieStore.delete('user_id');
  cookieStore.delete('user_name');
  cookieStore.delete('user_role');
  cookieStore.delete('user_branch_id');
  redirect('/login');
}
