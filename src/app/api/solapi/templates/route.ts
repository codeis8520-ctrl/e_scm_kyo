import { NextResponse } from 'next/server';
import { getKakaoTemplates } from '@/lib/solapi/client';

export async function GET() {
  const templates = await getKakaoTemplates();
  return NextResponse.json({ templates });
}
