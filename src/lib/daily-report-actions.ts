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
import { requireSession, writeAuditLog } from '@/lib/session';
import { createSaleJournal } from '@/lib/accounting-actions';
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
  system_stock?: number | null;   // 표시/대조용 — 현재 시스템 재고(inventories.quantity). DB 저장 안 함.
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

  // 현재 시스템 재고(inventories.quantity) 대조용 — 저장 라인엔 없으므로 라이브 조회해 주입.
  //   오픈재고(저장 스냅샷)와 다르면 UI 가 ⚠ 경고(승인 지연 또는 외부 재고변동).
  const { data: invRows } = await sb
    .from('inventories')
    .select('product_id, quantity')
    .eq('branch_id', resolved);
  const stockByProduct = new Map<string, number>();
  for (const r of (invRows as any[]) || []) {
    if (r.product_id) stockByProduct.set(r.product_id, num(r.quantity));
  }
  const linesWithStock = ((lines as DailyReportLineInput[]) || []).map(l => ({
    ...l,
    system_stock: l.product_id ? (stockByProduct.get(l.product_id) ?? 0) : null,
  }));

  return { report: { header, lines: linesWithStock }, branchId: resolved };
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
    .select('product_id, quantity, product:products(id, code, name, price, is_active, product_type)')
    .eq('branch_id', resolved);
  if (invErr) { console.error('[daily-report] template inventories error:', invErr); return { error: invErr.message }; }

  const products = ((inv as any[]) || [])
    .map(r => r.product)
    .filter((p: any) => p && p.is_active && p.product_type === 'FINISHED')
    .sort((a: any, b: any) => String(a.code || '').localeCompare(String(b.code || '')));

  // 2) 시스템 재고 맵(현재 inventories.quantity) — 표시/대조용. 승인 시 movements 로 갱신됨.
  const stockByProduct = new Map<string, number>();
  for (const r of (inv as any[]) || []) {
    if (r.product_id) stockByProduct.set(r.product_id, num(r.quantity));
  }

  // 3) 오픈재고 = 직전 일보(같은 branch, report_date < 해당일) 마감재고 이월(없으면 0).
  //    승인 지연과 무관하게 연속(어제 마감→오늘 오픈). 실재고와의 차이는 system_stock 으로 대조·경고
  //    (관리자 승인 지연 또는 외부 재고변동 감지). 오픈재고를 실재고로 직접 연동하지 않는 이유=승인 시점에만
  //    inventories 가 갱신돼 미승인분이 누락되기 때문.
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
      system_stock: stockByProduct.get(p.id) ?? 0,
    };
  });

  return { template: { lines }, branchId: resolved };
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

  // E3 수정 잠금(Phase2a): 승인(APPROVED)·posting 완료 일보는 재고/분개가 이미 반영돼 재저장 시 정합 깨짐 → 차단.
  //   수정하려면 승인취소(unpostDailyReport) 선행. (UNIQUE branch_id,report_date 로 기존 1건 조회.)
  const { data: existing } = await sb
    .from('daily_sales_reports')
    .select('status, posted')
    .eq('branch_id', branchId)
    .eq('report_date', input.report_date)
    .maybeSingle();
  if (existing && (existing.status === 'APPROVED' || existing.posted === true)) {
    return { error: '승인된 일보는 수정할 수 없습니다. 승인취소 후 수정하세요.' };
  }

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
      status: (r.status as 'SUBMITTED' | 'DRAFT' | 'APPROVED'), daily_total: num(r.daily_total),
      submitted_at: r.updated_at || r.created_at || null,
      sort_order: b.sort_order ?? 0,
    };
  });

  // 미제출(MISSING) 먼저 부각 → 임시(DRAFT) → 제출(SUBMITTED) → 승인(APPROVED), 동순위는 매장 sort_order.
  const rank = (s: string) => (s === 'MISSING' ? 0 : s === 'DRAFT' ? 1 : s === 'SUBMITTED' ? 2 : 3);
  rows.sort((a, b) => rank(a.status) - rank(b.status) || (a.sort_order - b.sort_order));

  const summary = {
    total: rows.length,
    approved: rows.filter(r => r.status === 'APPROVED').length,
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

// ════════════════════════════════════════════════════════════════════════════
// Phase 2a — 승인(approve) → 재고이동 + 매출분개 / 승인취소(unpost) → 역연동
//   🔴 실재고+회계 이동. 안전원칙: 분개 먼저 검증→실패 시 전체 throw(재고 미적용),
//      posting/unposting 각 1회(posted 조건부 update 동시성 멱등).
// ════════════════════════════════════════════════════════════════════════════

interface ProductMeta { is_phantom: boolean; cost: number; allow_decimal: boolean; }

// 라인 집계 → 실제 재고변동 단위(자재) 맵 산출. 팬텀은 BOM 분해. 반환: outMap/inMap(product_id→qty), cogs(onsite_sold분만).
async function computeStockDeltas(
  sb: any,
  lines: { product_id: string | null; onsite_sold: number; sample_damage: number; in_return: number }[]
): Promise<{ outMap: Map<string, number>; inMap: Map<string, number>; cogs: number; error?: string }> {
  const pids = Array.from(new Set(lines.map(l => l.product_id).filter(Boolean))) as string[];
  const meta = new Map<string, ProductMeta>();
  if (pids.length) {
    let res: any = await sb.from('products').select('id, is_phantom, cost, allow_decimal_stock').in('id', pids);
    if (res.error) res = await sb.from('products').select('id, cost').in('id', pids); // 폴백(컬럼 부재)
    for (const p of (res.data as any[]) || []) {
      meta.set(p.id, { is_phantom: p.is_phantom === true, cost: Number(p.cost) || 0, allow_decimal: p.allow_decimal_stock === true });
    }
  }
  // 팬텀 BOM 로드
  const phantomIds = pids.filter(id => meta.get(id)?.is_phantom);
  const bom = new Map<string, { material_id: string; quantity: number }[]>();
  const matIds = new Set<string>();
  if (phantomIds.length) {
    const { data: bomRows } = await sb.from('product_bom').select('product_id, material_id, quantity').in('product_id', phantomIds);
    for (const r of (bomRows as any[]) || []) {
      const arr = bom.get(r.product_id) || [];
      arr.push({ material_id: r.material_id, quantity: Number(r.quantity) || 0 });
      bom.set(r.product_id, arr);
      matIds.add(r.material_id);
    }
    for (const pid of phantomIds) {
      if (!(bom.get(pid) || []).length) return { outMap: new Map(), inMap: new Map(), cogs: 0, error: '세트(팬텀) 품목에 BOM이 없어 승인할 수 없습니다.' };
    }
  }
  // 자재 cost 보강
  if (matIds.size) {
    const { data: matRows } = await sb.from('products').select('id, cost').in('id', [...matIds]);
    for (const m of (matRows as any[]) || []) {
      const cur = meta.get(m.id);
      if (cur) cur.cost = Number(m.cost) || 0;
      else meta.set(m.id, { is_phantom: false, cost: Number(m.cost) || 0, allow_decimal: false });
    }
  }

  const outMap = new Map<string, number>();
  const inMap = new Map<string, number>();
  let cogs = 0;
  const addTo = (map: Map<string, number>, id: string, q: number) => { if (q) map.set(id, (map.get(id) || 0) + q); };

  for (const l of lines) {
    if (!l.product_id) continue;
    const m = meta.get(l.product_id);
    const out = num(l.onsite_sold) + num(l.sample_damage);
    const inn = num(l.in_return);
    const onsite = num(l.onsite_sold);
    if (m?.is_phantom) {
      // 팬텀 → 구성 자재로 분해(수량 비례). COGS=onsite_sold분 자재 cost.
      for (const c of bom.get(l.product_id) || []) {
        const mm = meta.get(c.material_id);
        if (out) addTo(outMap, c.material_id, out * c.quantity);
        if (inn) addTo(inMap, c.material_id, inn * c.quantity);
        if (onsite) cogs += onsite * c.quantity * (mm?.cost || 0);
      }
    } else {
      if (out) addTo(outMap, l.product_id, out);
      if (inn) addTo(inMap, l.product_id, inn);
      if (onsite) cogs += onsite * (m?.cost || 0);
    }
  }
  return { outMap, inMap, cogs };
}

// inventories 증감 1건(음수 허용) + inventory_movements 기록.
async function applyMovement(
  sb: any, branchId: string, productId: string, qty: number,
  movementType: 'IN' | 'OUT', referenceType: string, referenceId: string, createdBy: string, memo: string
) {
  const signed = movementType === 'IN' ? qty : -qty;
  const { data: curArr } = await sb.from('inventories').select('quantity').eq('branch_id', branchId).eq('product_id', productId);
  const cur = curArr?.[0];
  if (!cur) {
    await sb.from('inventories').insert({ branch_id: branchId, product_id: productId, quantity: signed, safety_stock: 0 });
  } else {
    await sb.from('inventories').update({ quantity: (Number(cur.quantity) || 0) + signed }).eq('branch_id', branchId).eq('product_id', productId);
  }
  await sb.from('inventory_movements').insert({
    branch_id: branchId, product_id: productId, movement_type: movementType,
    quantity: qty, reference_type: referenceType, reference_id: referenceId, created_by: createdBy, memo,
  });
}

// 승인 → 매출분개(먼저·검증) + 재고이동(OUT 현장판매+시음파손 / IN 입고반품) + posted 멱등.
export async function approveDailyReport(reportId: string) {
  const session = await requireSession();
  if (!MANAGER_ROLES.has(session.role)) return { error: '승인 권한이 없습니다.' };

  const sb = (await createClient()) as any;
  const { data: header } = await sb
    .from('daily_sales_reports')
    .select('id, branch_id, report_date, status, posted, daily_total, branch:branches(code)')
    .eq('id', reportId).maybeSingle();
  if (!header) return { error: '일보를 찾을 수 없습니다.' };
  if (header.status !== 'SUBMITTED' || header.posted === true) {
    return { error: '제출(SUBMITTED) 상태의 미반영 일보만 승인할 수 있습니다.' };
  }

  const { data: lines } = await sb
    .from('daily_sales_report_lines')
    .select('product_id, onsite_sold, sample_damage, in_return, onsite_revenue, parcel_revenue')
    .eq('report_id', reportId);
  const lineArr = (lines as any[]) || [];

  // 재고 변동·COGS 산출(팬텀 분해). 슬롯 점유 전 계산만(부작용 없음). 실패 시 슬롯 미점유라 안전.
  const { outMap, inMap, cogs, error: calcErr } = await computeStockDeltas(sb, lineArr);
  if (calcErr) return { error: calcErr };

  const totalRevenue = lineArr.reduce((s, l) => s + num(l.onsite_revenue) + num(l.parcel_revenue), 0);

  // ★ 슬롯 선점(MF): 부작용(분개·재고) **이전에** posted false→true 조건부 update 로 단 1회만 통과.
  //   영향행 0이면 부작용 0으로 즉시 중단(동시/더블서밋 패배자 = 깨끗). 이후 단계 실패 시 반드시 posted=false 해제(재시도 가능).
  const { data: claimed, error: claimErr } = await sb
    .from('daily_sales_reports')
    .update({ posted: true, posted_at: new Date().toISOString() })
    .eq('id', reportId).eq('posted', false).eq('status', 'SUBMITTED')
    .select('id');
  if (claimErr) return { error: claimErr.message };
  if (!claimed?.length) return { error: '이미 승인 중이거나 승인 완료된 일보입니다.' };

  // 슬롯 해제 헬퍼 — 점유 후 단계 실패 시 영구잠금 방지(posted=false 원복).
  const releaseSlot = async () => {
    await sb.from('daily_sales_reports')
      .update({ posted: false, posted_at: null })
      .eq('id', reportId).then(() => {}, () => {});
  };

  // ① 매출분개(검증). 차변=미수금 1115(credit), 대변 매출/VAT, COGS 5110/1130. 실패/대차불일치 → 슬롯 해제 후 error.
  let journalId: string | null = null;
  if (totalRevenue > 0 || cogs > 0) {
    journalId = await createSaleJournal({
      orderId: reportId,
      orderNumber: `DR-${header.branch?.code || header.branch_id}-${header.report_date}`,
      orderDate: header.report_date,
      totalAmount: totalRevenue,
      paymentMethod: 'credit',            // 백화점 월정산 → 미수금 1115 차변(PO E1)
      cogs,
      sourceType: 'DAILY_REPORT',
      createdBy: session.id,
      // taxableAmount 미전달 → 전액 과세 가정(Phase2a 범위).
    });
    if (!journalId) {
      await releaseSlot();
      return { error: '매출분개 생성에 실패했습니다(대차 불일치 가능). 재고는 반영되지 않았습니다.' };
    }
  }

  // ② 재고 이동(OUT/IN). 슬롯 점유 + 분개 성공 후에만. NUMERIC 소수 안전.
  const memo = `판매일보 승인 ${header.report_date}`;
  try {
    for (const [pid, q] of outMap) await applyMovement(sb, header.branch_id, pid, q, 'OUT', 'DAILY_REPORT', reportId, session.id, memo);
    for (const [pid, q] of inMap) await applyMovement(sb, header.branch_id, pid, q, 'IN', 'DAILY_REPORT', reportId, session.id, memo);
  } catch (e: any) {
    // 재고 적용 중 예외: 분개만 롤백, **슬롯은 해제하지 않음(posted=true 유지)**.
    //   releaseSlot 으로 posted=false 원복하면 partial movements/inventories 가 남은 채 재승인 → 이중차감.
    //   따라서 예외 경로를 프로세스 크래시와 동일한 safe-limbo(posted=true·status=SUBMITTED)로 통일한다:
    //   재승인(posted=true 차단)·승인취소(status≠APPROVED 차단) 모두 막혀 자동 이중차감 0, 운영 수동개입으로만 복구.
    if (journalId) await sb.from('journal_entries').delete().eq('id', journalId).then(() => {}, () => {});
    return { error: `재고 반영 실패: ${e?.message || e}. 분개는 롤백됐으나 일부 재고가 적용됐을 수 있어 잠금 상태입니다(관리자 확인 필요).` };
  }

  // ③ 마무리 확정 update(이미 posted=true 슬롯 점유 상태) — approved_by/at·journal_entry_id·status 확정.
  const { error: upErr } = await sb
    .from('daily_sales_reports')
    .update({
      status: 'APPROVED', approved_by: session.id, approved_at: new Date().toISOString(),
      journal_entry_id: journalId, updated_at: new Date().toISOString(),
    })
    .eq('id', reportId);
  if (upErr) return { error: upErr.message };

  await writeAuditLog({ userId: session.id, action: 'DAILY_REPORT_APPROVE', tableName: 'daily_sales_reports', recordId: reportId, description: `판매일보 승인(분개 ${journalId || '없음'}, 매출 ${totalRevenue})` });
  revalidatePath('/daily-report');
  return { success: true, journalId, cogs, totalRevenue };
}

// 승인취소 → 역분개(먼저) + 반대 movements(DAILY_REPORT_CANCEL) + posted=false. 멱등.
export async function unpostDailyReport(reportId: string) {
  const session = await requireSession();
  if (!MANAGER_ROLES.has(session.role)) return { error: '승인취소 권한이 없습니다.' };

  const sb = (await createClient()) as any;
  const { data: header } = await sb
    .from('daily_sales_reports')
    .select('id, branch_id, report_date, status, posted, journal_entry_id, branch:branches(code)')
    .eq('id', reportId).maybeSingle();
  if (!header) return { error: '일보를 찾을 수 없습니다.' };
  if (header.status !== 'APPROVED' || header.posted !== true) {
    return { error: '승인(반영)된 일보만 승인취소할 수 있습니다.' };
  }

  // 멱등 1차(저렴한 사전 차단): 이미 취소 movements 있으면 중복복원 차단(슬롯 점유가 권위 가드).
  const { data: prevCancel } = await sb
    .from('inventory_movements').select('id')
    .eq('reference_type', 'DAILY_REPORT_CANCEL').eq('reference_id', reportId).limit(1);
  if (prevCancel?.length) return { error: '이미 승인취소가 진행된 일보입니다.' };

  const journalEntryId = header.journal_entry_id;   // 슬롯 점유 후 헤더가 비워지므로 미리 캡처.

  // ★ 슬롯 선점(approve 대칭): 부작용(역분개·복원) 이전에 posted true→false 조건부 update 로 단 1회만 통과.
  //   영향행 0이면 부작용 0으로 즉시 중단(동시 취소 패배자 = 깨끗). 이후 단계 실패 시 posted=true 로 해제(재시도 가능).
  const { data: claimed, error: claimErr } = await sb
    .from('daily_sales_reports')
    .update({ posted: false, posted_at: null })
    .eq('id', reportId).eq('posted', true).eq('status', 'APPROVED')
    .select('id');
  if (claimErr) return { error: claimErr.message };
  if (!claimed?.length) return { error: '이미 승인취소되었거나 처리 중인 일보입니다.' };

  // 슬롯 해제(원복) — 점유 후 단계 실패 시 posted=true 로 되돌려 재시도 가능.
  const restoreSlot = async () => {
    await sb.from('daily_sales_reports')
      .update({ posted: true, posted_at: new Date().toISOString() })
      .eq('id', reportId).then(() => {}, () => {});
  };

  // 역분개용 COGS·매출 재계산(라인 잠금 상태라 승인 시점과 동일).
  const { data: lines } = await sb
    .from('daily_sales_report_lines')
    .select('product_id, onsite_sold, sample_damage, in_return, onsite_revenue, parcel_revenue')
    .eq('report_id', reportId);
  const lineArr = (lines as any[]) || [];
  const { cogs } = await computeStockDeltas(sb, lineArr);
  const totalRevenue = lineArr.reduce((s, l) => s + num(l.onsite_revenue) + num(l.parcel_revenue), 0);

  // ① 역분개(음수 totalAmount + reversalOf). 분개 있었던 경우만. 실패 시 슬롯 해제 후 error.
  if (journalEntryId && (totalRevenue > 0 || cogs > 0)) {
    const revId = await createSaleJournal({
      orderId: reportId,
      orderNumber: `DR-${header.branch?.code || header.branch_id}-${header.report_date}`,
      orderDate: header.report_date,
      totalAmount: -totalRevenue,         // 음수 → 역분개
      paymentMethod: 'credit',
      cogs,
      sourceType: 'DAILY_REPORT_CANCEL',
      reversalOf: journalEntryId,
      createdBy: session.id,
    });
    if (!revId) { await restoreSlot(); return { error: '역분개 생성에 실패했습니다. 재고는 복원되지 않았습니다.' }; }
  }

  // ② 재고 복원 — 기존 DAILY_REPORT movements 조회 후 반대 movement 신규 insert(원본 삭제 금지).
  const memo = `판매일보 승인취소 ${header.report_date}`;
  try {
    const { data: orig } = await sb
      .from('inventory_movements')
      .select('product_id, movement_type, quantity')
      .eq('reference_type', 'DAILY_REPORT').eq('reference_id', reportId);
    for (const m of (orig as any[]) || []) {
      const opposite: 'IN' | 'OUT' = m.movement_type === 'OUT' ? 'IN' : 'OUT';
      await applyMovement(sb, header.branch_id, m.product_id, Number(m.quantity) || 0, opposite, 'DAILY_REPORT_CANCEL', reportId, session.id, memo);
    }
  } catch (e: any) {
    await restoreSlot();
    return { error: `재고 복원 실패: ${e?.message || e}. 슬롯 해제됨(재시도 가능).` };
  }

  // ③ 마무리 확정(이미 posted=false 슬롯) — status·approved·journal_entry_id 비움.
  const { error: upErr } = await sb
    .from('daily_sales_reports')
    .update({
      status: 'SUBMITTED', approved_by: null, approved_at: null, journal_entry_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', reportId);
  if (upErr) return { error: upErr.message };

  await writeAuditLog({ userId: session.id, action: 'DAILY_REPORT_UNPOST', tableName: 'daily_sales_reports', recordId: reportId, description: `판매일보 승인취소(역분개 reversalOf ${journalEntryId})` });
  revalidatePath('/daily-report');
  return { success: true };
}
