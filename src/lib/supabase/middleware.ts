import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  const supabaseResponse = NextResponse.next({
    request,
  });

  // 자체 세션 쿠키로 인증 확인
  const sessionToken = request.cookies.get('session_token')?.value;
  const userId = request.cookies.get('user_id')?.value;

  const publicPaths = ['/login', '/api/cafe24/auth', '/api/cafe24/callback', '/api/cafe24/debug', '/api/webhooks'];
  const isPublicPath = publicPaths.some(path => request.nextUrl.pathname.startsWith(path));

  if (!sessionToken && !userId && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (sessionToken && userId && request.nextUrl.pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
