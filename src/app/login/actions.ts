'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function login(formData: FormData) {
  const supabase = await createClient();

  let email = formData.get('email') as string;
  const password = formData.get('password') as string;

  // If email doesn't contain @, treat it as name and look up email from users table
  if (!email.includes('@')) {
    const { data: userData } = await supabase
      .from('users')
      .select('email')
      .ilike('name', email)
      .single();
    
    if (userData?.email) {
      email = userData.email;
    } else {
      redirect(`/login?error=${encodeURIComponent('사용자를 찾을 수 없습니다')}`);
    }
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect('/');
}

export async function signup(formData: FormData) {
  const supabase = await createClient();

  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
    options: {
      data: {
        name: formData.get('name') as string,
      }
    }
  };

  const { data: result, error } = await supabase.auth.signUp(data);

  if (error) {
    redirect(`/login/signup?error=${encodeURIComponent(error.message)}`);
  }

  if (result?.user && !result?.session) {
    redirect('/login/signup?message=이메일 확인 후 로그인해주세요');
  }

  redirect('/');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
