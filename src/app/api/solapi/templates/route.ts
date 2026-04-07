import { NextResponse } from 'next/server';
import { createHmac, randomBytes } from 'crypto';

const BASE_URL = 'https://api.solapi.com';

function makeAuthHeader(): string {
  const apiKey    = process.env.SOLAPI_API_KEY!;
  const apiSecret = process.env.SOLAPI_API_SECRET!;
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString('hex');
  const signature = createHmac('sha256', apiSecret).update(date + salt).digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

export async function GET() {
  const hasKey    = !!process.env.SOLAPI_API_KEY;
  const hasSecret = !!process.env.SOLAPI_API_SECRET;
  const pfId      = process.env.SOLAPI_KAKAO_PFID;

  if (!hasKey || !hasSecret) {
    return NextResponse.json({ templates: [], debug: { error: '환경변수 미설정', hasKey, hasSecret } });
  }

  // 여러 엔드포인트 시도
  const endpoints = [
    `/kakao/v2/templates?status=APPROVED&limit=100${pfId ? `&pfId=${pfId}` : ''}`,
    `/kakao/v2/templates?limit=100${pfId ? `&pfId=${pfId}` : ''}`,
    `/kakao/v1/templates?limit=100`,
  ];

  const debugResults: any[] = [];

  for (const ep of endpoints) {
    try {
      const res = await fetch(`${BASE_URL}${ep}`, {
        headers: { Authorization: makeAuthHeader() },
        cache: 'no-store',
      });
      const body = await res.json().catch(() => null);
      debugResults.push({ endpoint: ep, status: res.status, body });

      if (res.ok) {
        const list: any[] = body?.templateList ?? body?.data ?? body?.templates ?? [];
        if (list.length > 0) {
          const templates = list.map((t: any) => ({
            templateId: t.templateId ?? t.id ?? '',
            name: t.name ?? t.templateName ?? '',
            content: t.content ?? t.templateContent ?? '',
            status: t.status ?? '',
            variables: Array.isArray(t.variables) ? t.variables : [],
            pfId: t.pfId ?? '',
          }));
          return NextResponse.json({ templates });
        }
      }
    } catch (e: any) {
      debugResults.push({ endpoint: ep, error: e.message });
    }
  }

  return NextResponse.json({ templates: [], debug: { tried: debugResults } });
}
