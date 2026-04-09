import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { processCafe24Webhook } from '@/lib/cafe24/webhook';
import { Cafe24WebhookEvent } from '@/lib/cafe24/types';

const CAFE24_CLIENT_SECRET = process.env.CAFE24_CLIENT_SECRET || '';

function verifyWebhookSignature(
  payload: string,
  signature: string,
  clientSecret: string
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', clientSecret)
    .update(payload)
    .digest('base64');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-cafe24-signature') || '';

    if (!CAFE24_CLIENT_SECRET) {
      console.error('CAFE24_CLIENT_SECRET 미설정 — webhook 거부');
      return NextResponse.json({ success: false, error: 'Webhook secret not configured' }, { status: 500 });
    }
    if (!signature) {
      return NextResponse.json({ success: false, error: 'Missing signature' }, { status: 401 });
    }
    const isValid = verifyWebhookSignature(rawBody, signature, CAFE24_CLIENT_SECRET);
    if (!isValid) {
      console.error('Invalid webhook signature');
      return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 401 });
    }

    const event: Cafe24WebhookEvent = JSON.parse(rawBody);

    console.log('Received Cafe24 webhook:', JSON.stringify(event, null, 2));

    const result = await processCafe24Webhook(event);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: result.message,
        orderId: result.orderId,
      });
    } else {
      return NextResponse.json(
        { success: false, error: result.message, orderId: result.orderId },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const challenge = searchParams.get('challenge');

  if (challenge) {
    return NextResponse.json({ challenge });
  }

  return NextResponse.json(
    { success: false, error: 'Invalid request' },
    { status: 400 }
  );
}
