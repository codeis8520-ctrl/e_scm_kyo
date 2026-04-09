import { NextResponse } from 'next/server';
import { getSolapiBalance } from '@/lib/solapi/client';

export async function GET() {
  const result = await getSolapiBalance();
  return NextResponse.json(result);
}
