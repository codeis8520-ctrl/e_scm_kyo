import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/cafe24/token-store';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');

  if (error || !code) {
    return NextResponse.json({ error: error || '인증 코드 없음' }, { status: 400 });
  }

  const redirectUri =
    process.env.CAFE24_REDIRECT_URI ||
    `${req.nextUrl.protocol}//${req.nextUrl.host}/api/cafe24/callback`;

  try {
    await exchangeCodeForTokens(code, redirectUri);
    // 성공 시 시스템 메인 페이지로 이동
    return NextResponse.redirect(new URL('/?cafe24=connected', req.url));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
