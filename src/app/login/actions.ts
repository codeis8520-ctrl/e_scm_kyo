'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createHash } from 'crypto';

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

export async function login(formData: FormData) {
  const supabase = await createClient();

  const loginId = formData.get('login_id') as string;
  const password = formData.get('password') as string;

  // login_id로 사용자 찾기
  const { data: userData } = await supabase
    .from('users')
    .select('id, login_id, password_hash')
    .eq('login_id', loginId)
    .single();
  
  const user = userData as { id: string; login_id: string; password_hash: string } | null;
  
  if (!user) {
    redirect(`/login?error=${encodeURIComponent('존재하지 않는 아이디입니다')}`);
  }

  // 비밀번호 검증 (SHA256 해시 비교)
  const inputHash = hashPassword(password);
  if (user.password_hash && user.password_hash !== inputHash) {
    redirect(`/login?error=${encodeURIComponent('비밀번호가 일치하지 않습니다')}`);
  }

  // Supabase Auth 세션 생성 (간단히 아이디@kyo.local 형식 사용)
  const { error } = await supabase.auth.signInWithPassword({
    email: `${loginId}@kyo.local`,
    password: password
  });

  if (error) {
    // 자체 검증 통과했으면 자체 세션 처리 후 진행
    // (임시: 쿠키에 사용자 ID 저장하는 등의 처리 필요)
    redirect('/');
  }

  redirect('/');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
