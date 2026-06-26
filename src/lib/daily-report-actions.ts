'use server';

// ════════════════════════════════════════════════════════════════════════════
// 판매일보 (Daily Sales Report) — Phase 1 기록 전용 서버액션
//
//  🚨 LOCKED: 기록 전용. inventories / sales_orders / journal_entries 에 일절 write 안 함.
//     재고차감·매출분개·포인트 전부 Phase 2. 이 파일은 daily_sales_reports / _lines 만 다룬다.
//  RBAC: requireSession 게이트. BRANCH_STAFF/PHARMACY_STAFF 는 본인 branch 강제(클라 branch_id 불신).
//  마감재고 = opening + in_return − onsite_sold − sample_damage (자동, 사원 수정 가능 → closing_stock 최종값 저장).
//  오픈재고 = 직전(report_date<해당일, 같은 branch) 일보의 같은 product_id 라인 closing_stock 이월(없으면 0).
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';

const MANAGER_ROLES = new Set(['SUPER_ADMIN', 'HQ_OPERATOR', 'EXECUTIVE']);

export interface DailyReportLineInput {
  product_id: string | null;
  product_code: string | null;
  product_name: string;
  unit_price: number;
  opening_stock: number;
  onsite_sold: number;
  sample_damage: number;
  in_return: number;
  closing_stock: number;
  hq_parcel: number;
  onsite_revenue: number;
  parcel_revenue: number;
  sort_order: number;
}

export interface DailyReportHeader {
  id: string;
  branch_id: string;
  report_date: string;
  author_user_id: string | null;
  author_name: string | null;
  status: 'DRAFT' | 'SUBMITTED';
  daily_total: number;
  note: string | null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// 비관리자는 세션 branch 로 강제. 관리자는 요청 branch 허용(없으면 세션 branch). 결과 branchId 반환.
async function resolveBranchId(session: { role: string; branch_id: string | null }, requested?: string | null): Promise<string> {
  if (MANAGER_ROLES.has(session.role)) {
    const b = (requested || session.branch_id || '').trim();
    if (!b) throw new Error('매장을 선택하세요.');
    return b;
  }
  // BRANCH_STAFF / PHARMACY_STAFF — 세션 branch 강제(클라 값 무시)
  if (!session.branch_id) throw new Error('소속 매장 정보가 없습니다. 관리자에게 문의하세요.');
  return session.branch_id;
}

function isValidDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
}

// 헤더+라인 조회. 없으면 { report: null }.
export async function getDailyReport(branchId: string, reportDate: string) {
  const session = await requireSession();
  if (!isValidDate(reportDate)) return { error: '날짜 형식이 올바르지 않습니다.' };
  let resolved: string;
  try { resolved = await resolveBranchId(session, branchId); } catch (e: any) { return { error: e.message }; }

  const sb = (await createClient()) as any;
  const { data: header, error } = await sb
    .from('daily_sales_reports')
    .select('id, branch_id, report_date, author_user_id, author_name, status, daily_total, note')
    .eq('branch_id', resolved)
    .eq('report_date', reportDate)
    .maybeSingle();
  if (error) { console.error('[daily-report] getDailyReport header error:', error); return { error: error.message }; }
  if (!header) return { report: null, branchId: resolved };

  const { data: lines, error: lErr } = await sb
    .from('daily_sales_report_lines')
    .select('product_id, product_code, product_name, unit_price, opening_stock, onsite_sold, sample_damage, in_return, closing_stock, hq_parcel, onsite_revenue, parcel_revenue, sort_order')
    .eq('report_id', header.id)
    .order('sort_order', { ascending: true });
  if (lErr) { console.error('[daily-report] getDailyReport lines error:', lErr); return { error: lErr.message }; }

  return { report: { header, lines: (lines as DailyReportLineInput[]) || [] }, branchId: resolved };
}

// 일보 없을 때 prefill 템플릿: 취급 완제품 + 전일 마감 이월 오픈재고.
export async function getReportTemplate(branchId: string, reportDate: string) {
  const session = await requireSession();
  if (!isValidDate(reportDate)) return { error: '날짜 형식이 올바르지 않습니다.' };
  let resolved: string;
  try { resolved = await resolveBranchId(session, branchId); } catch (e: any) { return { error: e.message }; }

  const sb = (await createClient()) as any;

  // 1) 취급 완제품 = 해당 branch inventories 행 존재 + products.is_active + product_type='FINISHED'.
  //    (제품생성 시 전 지점 inventories 행이 깔리므로 이게 매장 취급목록 역할 — 별도 테이블 불요.)
  const { data: inv, error: invErr } = await sb
    .from('inventories')
    .select('product_id, product:products(id, code, name, price, is_active, product_type)')
    .eq('branch_id', resolved);
  if (invErr) { console.error('[daily-report] template inventories error:', invErr); return { error: invErr.message }; }

  const products = ((inv as any[]) || [])
    .map(r => r.product)
    .filter((p: any) => p && p.is_active && p.product_type === 'FINISHED')
    .sort((a: any, b: any) => String(a.code || '').localeCompare(String(b.code || '')));

  // 2) 직전 일보(같은 branch, report_date < 해당일) 마감재고 → 오픈재고 이월.
  const { data: prevHeader } = await sb
    .from('daily_sales_reports')
    .select('id')
    .eq('branch_id', resolved)
    .lt('report_date', reportDate)
    .order('report_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const carryByProduct = new Map<string, number>();
  if (prevHeader?.id) {
    const { data: prevLines } = await sb
      .from('daily_sales_report_lines')
      .select('product_id, closing_stock')
      .eq('report_id', prevHeader.id);
    for (const l of (prevLines as any[]) || []) {
      if (l.product_id) carryByProduct.set(l.product_id, num(l.closing_stock));
    }
  }

  const lines: DailyReportLineInput[] = products.map((p: any, i: number) => {
    const opening = carryByProduct.get(p.id) ?? 0;
    return {
      product_id: p.id,
      product_code: p.code ?? null,
      product_name: p.name,
      unit_price: num(p.price),
      opening_stock: opening,
      onsite_sold: 0,
      sample_damage: 0,
      in_return: 0,
      closing_stock: opening,   // 자동 마감 초기값 = opening(아직 변동 0)
      hq_parcel: 0,
      onsite_revenue: 0,
      parcel_revenue: 0,
      sort_order: i,
    };
  });

  return { template: { lines, hasPrev: !!prevHeader?.id }, branchId: resolved };
}

// 헤더+라인 upsert. daily_total 서버 재계산, branch_id 비관리자 세션강제.
export async function saveDailyReport(input: {
  branch_id: string;
  report_date: string;
  status: 'DRAFT' | 'SUBMITTED';
  note?: string | null;
  lines: DailyReportLineInput[];
}) {
  const session = await requireSession();
  if (!isValidDate(input.report_date)) return { error: '날짜 형식이 올바르지 않습니다.' };
  if (input.status !== 'DRAFT' && input.status !== 'SUBMITTED') return { error: '상태값이 올바르지 않습니다.' };
  let branchId: string;
  try { branchId = await resolveBranchId(session, input.branch_id); } catch (e: any) { return { error: e.message }; }

  const sb = (await createClient()) as any;

  // 당일매출 = Σ(현장매출 + 택배매출) 서버 재계산(클라값 무시).
  const dailyTotal = (input.lines || []).reduce(
    (s, l) => s + num(l.onsite_revenue) + num(l.parcel_revenue), 0
  );

  // 1) 헤더 upsert (UNIQUE branch_id, report_date). 기존이면 갱신(SUBMITTED 유지·재수정 허용).
  const { data: header, error: hErr } = await sb
    .from('daily_sales_reports')
    .upsert({
      branch_id: branchId,
      report_date: input.report_date,
      author_user_id: session.id,
      author_name: session.name || null,
      status: input.status,
      daily_total: dailyTotal,
      note: (input.note ?? '').trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'branch_id,report_date' })
    .select('id')
    .single();
  if (hErr || !header) {
    console.error('[daily-report] save header error:', hErr);
    return { error: hErr?.message || '일보 저장에 실패했습니다.' };
  }

  // 2) 라인 delete + insert (report_id 기준 전량 교체 — 추가/삭제/순서변경 단순 반영).
  const { error: delErr } = await sb.from('daily_sales_report_lines').delete().eq('report_id', header.id);
  if (delErr) { console.error('[daily-report] save lines delete error:', delErr); return { error: delErr.message }; }

  const rows = (input.lines || []).map((l, i) => ({
    report_id: header.id,
    product_id: l.product_id || null,
    product_code: l.product_code ?? null,
    product_name: (l.product_name || '').trim() || '(이름없음)',
    unit_price: num(l.unit_price),
    opening_stock: num(l.opening_stock),
    onsite_sold: num(l.onsite_sold),
    sample_damage: num(l.sample_damage),
    in_return: num(l.in_return),
    closing_stock: num(l.closing_stock),   // 클라 최종값(자동 또는 사원 수정값) 저장
    hq_parcel: num(l.hq_parcel),
    onsite_revenue: num(l.onsite_revenue),
    parcel_revenue: num(l.parcel_revenue),
    sort_order: typeof l.sort_order === 'number' ? l.sort_order : i,
  }));
  if (rows.length > 0) {
    const { error: insErr } = await sb.from('daily_sales_report_lines').insert(rows);
    if (insErr) { console.error('[daily-report] save lines insert error:', insErr); return { error: insErr.message }; }
  }

  revalidatePath('/daily-report');
  return { success: true, reportId: header.id, dailyTotal, status: input.status };
}

// ── 제출 현황(Phase 1.2) — 제출 대상 매장 정의 헬퍼 ─────────────────────────
//   PO 결정 (A): 활성 + channel='DEPT_STORE'(백화점). 일보=백화점 판매사원 종이양식 대체.
//   ⚠️ 분모 전환점: PO 가 (B)전 활성 / (C)직원배정으로 바꾸면 이 쿼리 한 줄만 수정.
async function getTargetBranches(sb: any): Promise<{ id: string; name: string; sort_order: number | null }[]> {
  const { data } = await sb
    .from('branches')
    .select('id, name, sort_order')
    .eq('is_active', true)
    .eq('channel', 'DEPT_STORE')      // (A) 백화점 채널. (B)→이 줄 제거, (C)→users.branch_id distinct 로 교체.
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  return (data as any[]) || [];
}

// 특정 날짜 제출 현황 — 대상 매장 전체 기준 머지(일보 없으면 MISSING). 읽기 전용·관리자 전용.
export async function listDailyReports(reportDate: string) {
  const session = await requireSession();
  if (!MANAGER_ROLES.has(session.role)) {
    return { error: '제출 현황은 본사 관리자만 조회할 수 있습니다.', rows: [] };
  }
  if (!isValidDate(reportDate)) return { error: '날짜 형식이 올바르지 않습니다.', rows: [] };

  const sb = (await createClient()) as any;
  const targets = await getTargetBranches(sb);

  const { data: reports, error } = await sb
    .from('daily_sales_reports')
    .select('id, branch_id, author_name, status, daily_total, created_at, updated_at')
    .eq('report_date', reportDate);
  if (error) { console.error('[daily-report] listDailyReports error:', error); return { error: error.message, rows: [] }; }

  const byBranch = new Map<string, any>();
  for (const r of (reports as any[]) || []) byBranch.set(r.branch_id, r);

  const rows = targets.map(b => {
    const r = byBranch.get(b.id);
    if (!r) {
      return {
        branch_id: b.id, branch_name: b.name, report_id: null, author_name: null,
        status: 'MISSING' as const, daily_total: 0, submitted_at: null,
        sort_order: b.sort_order ?? 0,
      };
    }
    return {
      branch_id: b.id, branch_name: b.name, report_id: r.id, author_name: r.author_name,
      status: (r.status as 'SUBMITTED' | 'DRAFT'), daily_total: num(r.daily_total),
      submitted_at: r.updated_at || r.created_at || null,
      sort_order: b.sort_order ?? 0,
    };
  });

  // 미제출(MISSING) 먼저 부각 → 임시(DRAFT) → 제출(SUBMITTED), 동순위는 매장 sort_order.
  const rank = (s: string) => (s === 'MISSING' ? 0 : s === 'DRAFT' ? 1 : 2);
  rows.sort((a, b) => rank(a.status) - rank(b.status) || (a.sort_order - b.sort_order));

  const summary = {
    total: rows.length,
    submitted: rows.filter(r => r.status === 'SUBMITTED').length,
    draft: rows.filter(r => r.status === 'DRAFT').length,
    missing: rows.filter(r => r.status === 'MISSING').length,
  };
  return { rows, summary };
}

// 관리자 매장 드롭다운용 — 활성 지점 목록.
export async function getDailyReportBranches() {
  const session = await requireSession();
  const sb = (await createClient()) as any;
  // 비관리자는 본인 매장만(드롭다운 미사용이지만 일관 반환).
  if (!MANAGER_ROLES.has(session.role)) {
    if (!session.branch_id) return { branches: [] };
    const { data } = await sb.from('branches').select('id, name').eq('id', session.branch_id);
    return { branches: (data as any[]) || [] };
  }
  const { data } = await sb.from('branches').select('id, name').eq('is_active', true).order('sort_order').order('name');
  return { branches: (data as any[]) || [] };
}
