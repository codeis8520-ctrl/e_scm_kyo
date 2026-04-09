'use server';

// ═══════════════════════════════════════════════════════════════════════
// 매장 QR 셀프 고객 등록 — 공개 엔드포인트 (인증 없음)
//
// 보안 고려:
//   - 세션 검증 없음 (공개 폼)
//   - phone UNIQUE 제약으로 중복 차단
//   - 간단한 입력 검증 (전화번호/이름 패턴)
//   - 개인정보 수집 동의 체크 필수
//   - 알림 자동 발송은 옵션 (WELCOME 이벤트)
//
// 본 액션은 앱 레이어의 권한 체크를 하지 않으므로 악의적 대량 등록 가능성 有.
// 향후 rate limiting 또는 SMS 인증번호 발송으로 보완 필요.
// ═══════════════════════════════════════════════════════════════════════

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { fireNotificationTrigger } from '@/lib/notification-triggers';

export interface PublicRegisterParams {
  branchId: string;
  name: string;
  phone: string;
  email?: string | null;
  birthday?: string | null;   // YYYY-MM-DD
  address?: string | null;
  privacyAgreed: boolean;
  marketingAgreed?: boolean;
}

function sanitizeName(name: string): string {
  return String(name || '').trim().slice(0, 50);
}

function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, '');
  if (digits.length < 9 || digits.length > 11) return null;
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return digits;
}

function sanitizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const s = String(email).trim();
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s.slice(0, 120);
}

function sanitizeBirthday(birthday: string | null | undefined): string | null {
  if (!birthday) return null;
  const s = String(birthday).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  // 1900-01-01 ~ 오늘
  const now = new Date();
  if (d.getFullYear() < 1900 || d > now) return null;
  return s;
}

export async function publicRegisterCustomer(params: PublicRegisterParams) {
  if (!params.privacyAgreed) {
    return { error: '개인정보 수집 및 이용 동의가 필요합니다.' };
  }

  const name = sanitizeName(params.name);
  if (!name || name.length < 2) {
    return { error: '이름을 2자 이상 입력해주세요.' };
  }

  const phone = normalizePhone(params.phone);
  if (!phone) {
    return { error: '유효한 휴대폰 번호를 입력해주세요.' };
  }

  const email = sanitizeEmail(params.email);
  const birthday = sanitizeBirthday(params.birthday);
  const address = params.address ? String(params.address).trim().slice(0, 200) : null;

  if (!params.branchId) {
    return { error: '등록 지점 정보가 누락되었습니다.' };
  }

  const supabase = (await createClient()) as any;

  // 지점 유효성 검사
  const { data: branch } = await supabase
    .from('branches')
    .select('id, name, is_active')
    .eq('id', params.branchId)
    .maybeSingle();

  if (!branch || !branch.is_active) {
    return { error: '유효하지 않은 지점입니다.' };
  }

  // 전화번호 중복 체크
  const { data: existing } = await supabase
    .from('customers')
    .select('id, name, is_active')
    .eq('phone', phone)
    .maybeSingle();

  if (existing) {
    if (existing.is_active) {
      return { error: '이미 등록된 번호입니다. 매장 직원에게 문의해주세요.' };
    }
    // 비활성 회원은 재활성화
    const { error: upErr } = await supabase
      .from('customers')
      .update({
        name,
        email,
        birthday,
        address,
        primary_branch_id: branch.id,
        is_active: true,
      })
      .eq('id', existing.id);
    if (upErr) return { error: upErr.message };

    // WELCOME 알림톡 자동 발송 (매핑 등록 시)
    fireNotificationTrigger({
      eventType: 'WELCOME',
      customer: { id: existing.id, name, phone },
      context: { branchName: branch.name },
    }).catch(() => {});

    revalidatePath('/customers');
    return { success: true, reactivated: true, branchName: branch.name };
  }

  // 신규 삽입
  const { data: inserted, error: insertErr } = await supabase
    .from('customers')
    .insert({
      name,
      phone,
      email,
      birthday,
      address,
      grade: 'NORMAL',
      primary_branch_id: branch.id,
      source: 'SELF_REGISTER',
      is_active: true,
    })
    .select('id')
    .single();

  if (insertErr) {
    if (String(insertErr.message || '').includes('unique') || String(insertErr.message || '').includes('duplicate')) {
      return { error: '이미 등록된 번호입니다.' };
    }
    return { error: insertErr.message };
  }

  // WELCOME 알림톡 자동 발송 (매핑 등록 시)
  if (inserted?.id) {
    fireNotificationTrigger({
      eventType: 'WELCOME',
      customer: { id: inserted.id, name, phone },
      context: { branchName: branch.name },
    }).catch(() => {});
  }

  revalidatePath('/customers');
  return { success: true, branchName: branch.name };
}

// QR용 지점 정보 조회 (공개) — 이름만 반환
export async function getPublicBranchInfo(branchId: string) {
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from('branches')
    .select('id, name, channel, is_active')
    .eq('id', branchId)
    .maybeSingle();

  if (!data || !data.is_active) return null;
  return { id: data.id, name: data.name, channel: data.channel };
}
