'use server';

import QRCode from 'qrcode';

/**
 * QR 코드를 base64 data URL (PNG)로 생성
 */
export async function generateQrDataUrl(text: string, size = 400): Promise<{ dataUrl?: string; error?: string }> {
  try {
    const dataUrl = await QRCode.toDataURL(text, {
      width: size,
      margin: 2,
      color: { dark: '#065f46', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });
    return { dataUrl };
  } catch (e: any) {
    return { error: e?.message || 'QR 생성 실패' };
  }
}
