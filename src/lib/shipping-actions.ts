'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { fireNotificationTrigger } from '@/lib/notification-triggers';
import { syncReceiptStatusFromShipment } from '@/lib/receipt-sync';
import { confirmCafe24OrderAsSale } from '@/lib/cafe24/webhook';
import { requireSession } from '@/lib/session';
import { kstTodayString } from '@/lib/date';
import { Cafe24Client } from '@/lib/cafe24/client';
import { getValidAccessToken } from '@/lib/cafe24/token-store';

export interface ShipmentInput {
  source: 'CAFE24' | 'STORE';
  cafe24_order_id?: string;
  sales_order_id?: string;
  member_id?: string;       // confirm 전용(카페24 주문 확정 시 고객 dedup). shipments 컬럼 아님 — insert payload 제외.
  sender_name: string;
  sender_phone: string;
  sender_zipcode?: string;
  sender_address?: string;
  sender_address_detail?: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_zipcode?: string;
  recipient_address: string;
  recipient_address_detail?: string;
  delivery_message?: string;
  items_summary?: string;
  branch_id?: string;
  created_by?: string;
}

export async function getShipments(status?: string) {
  const supabase = await createClient() as any;

  // 매출처(=판매 발생 지점) 보강(#21): shipments.branch_id 는 출고처라 매출처와 다름.
  //   매출처 = 연결된 sales_order.branch. 신규는 sales_order_id(FK), 과거 카페24는 cafe24_order_id.
  let query = supabase
    .from('shipments')
    .select('*, sales_order:sales_orders(receipt_date, receipt_status, branch:branches(id, name), items:sales_order_items(order_option))')
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);

  let { data, error } = await query;
  if (error) {
    // 임베드 실패(관계 모호 등) → 기본 select 폴백
    let q2 = supabase.from('shipments').select('*').order('created_at', { ascending: false });
    if (status) q2 = q2.eq('status', status);
    const retry = await q2;
    data = retry.data; error = retry.error;
    if (error) { console.error('getShipments error:', error); return { data: [] }; }
  }

  const rows: any[] = data || [];

  // sales_order_id 로 매출처/수령일을 못 얻은 카페24 행은 cafe24_order_id 로 보강
  const needCafe24 = rows.filter(r => !r?.sales_order && r.cafe24_order_id);
  const cafe24Map = new Map<string, { name?: string; receipt_date?: string | null }>();
  if (needCafe24.length > 0) {
    const ids = [...new Set(needCafe24.map(r => String(r.cafe24_order_id)))];
    const { data: sos } = await supabase
      .from('sales_orders')
      .select('cafe24_order_id, receipt_date, branch:branches(name)')
      .in('cafe24_order_id', ids);
    for (const s of (sos as any[]) || []) {
      cafe24Map.set(String(s.cafe24_order_id), { name: s.branch?.name, receipt_date: s.receipt_date });
    }
  }

  const result = rows.map(r => {
    const cm = cafe24Map.get(String(r.cafe24_order_id));
    // 주문 옵션 도출(#40, Approach B): 연결 sales_order 의 order_option 을 dedup 합성.
    //   cafe24 historical(sales_order 없음)은 items_summary 에 옵션이 이미 포함돼 null 허용(best-effort).
    let orderOptions: string | null = null;
    const items = r?.sales_order?.items;
    if (Array.isArray(items)) {
      const opts = [...new Set(
        items
          .map((it: any) => (it?.order_option ?? '').toString().trim())
          .filter((o: string) => o.length > 0)
      )];
      orderOptions = opts.length > 0 ? opts.join(', ') : null;
    }
    return {
      ...r,
      // 매출처명: sales_order.branch → cafe24_order_id 매칭 → null(미연결)
      sale_branch_name: r?.sales_order?.branch?.name ?? cm?.name ?? null,
      // 수령일/택배예정일(#26): 연결 sales_order.receipt_date
      sale_receipt_date: r?.sales_order?.receipt_date ?? cm?.receipt_date ?? null,
      // 주문 옵션(#40): 표시·export 시점에 합성. 저장 데이터 무손상.
      order_options: orderOptions,
    };
  });

  return { data: result };
}

export async function createShipment(data: ShipmentInput) {
  const supabase = await createClient() as any;

  // member_id 는 confirm 전용 입력(shipments 컬럼 아님) — insert payload 에서 제외.
  const { member_id, ...shipmentData } = data;
  let salesOrderId = shipmentData.sales_order_id;

  // 매출 인식 분리(#25): 카페24 주문은 "배송 추가" 확정 시점에만 sales_order·매출분개 생성.
  //   confirm 호출로 전표 생성 후 그 sales_order.id 를 shipment 에 직접 연결한다.
  //   confirm 실패 시 배송도 만들지 않는다(전표 없는 배송 방지).
  if (shipmentData.source === 'CAFE24' && shipmentData.cafe24_order_id) {
    // 중복 수집 방지(#44): 같은 카페24 주문에 배송이 이미 있으면 재생성하지 않는다.
    //   (DB 부분 UNIQUE uq_shipments_cafe24_order_id 와 이중 방어 — 여기선 깔끔한 메시지 제공.)
    const { data: dup } = await supabase
      .from('shipments')
      .select('id')
      .eq('cafe24_order_id', shipmentData.cafe24_order_id)
      .limit(1);
    if (dup && dup.length > 0) {
      return { success: false, error: '이미 배송 추가된 카페24 주문입니다(중복 방지).' };
    }

    const confirm = await confirmCafe24OrderAsSale(shipmentData.cafe24_order_id, member_id || '');
    if (!confirm.success || !confirm.orderId) {
      return { success: false, error: confirm.message || '판매전표 생성 실패' };
    }
    salesOrderId = confirm.orderId;
  }

  // 2중배송 가드(#48 Phase 2a): 전표당 배송 1건(1전표=1발송지). salesOrderId 확정 후·insert 전
  //   단일 위치 — STORE/CAFE24 공통 커버. 이미 그 전표에 배송이 있으면 2번째를 만들지 않는다.
  //   (마이그094 uq_shipments_sales_order_id 와 이중 방어 — 여기선 깔끔한 메시지 제공.)
  if (salesOrderId) {
    const { data: existing } = await supabase
      .from('shipments')
      .select('id')
      .eq('sales_order_id', salesOrderId)
      .limit(1);
    if (existing && existing.length > 0) {
      return { success: false, error: '이미 배송이 추가된 전표입니다(전표당 1배송).' };
    }
  }

  const { error } = await supabase
    .from('shipments')
    .insert([{ ...shipmentData, sales_order_id: salesOrderId }]);

  if (error) {
    console.error('createShipment error:', error);
    // 부분 UNIQUE(uq_shipments_cafe24_order_id / uq_shipments_sales_order_id) 경합 — 친절 메시지.
    if ((error as any).code === '23505' || /duplicate key|unique/i.test(String(error.message))) {
      if (/sales_order/i.test(String((error as any).message))) {
        return { success: false, error: '이미 배송이 추가된 전표입니다(전표당 1배송).' };
      }
      return { success: false, error: '이미 배송 추가된 카페24 주문입니다(중복 방지).' };
    }
    return { success: false, error: error.message };
  }

  revalidatePath('/shipping');
  return { success: true };
}

// ─── #62 Phase2: 우리 송장 → 카페24 자동 역연동 (best-effort·멱등·실패격리) ───────────────
//   호출 조건은 updateShipment 에서 판정. 여기선 멱등체크→env게이트→인증→createShipment→sync_logs 기록.
//   throw 절대 안 함(반환값 무시 가능) — 카페24 실패해도 우리 송장저장·알림톡·배송처리 진행.
//   sync_type='shipment_writeback' 의 success 레코드가 멱등 단일 진실원(shipments 컬럼 추가 없음).
async function writebackTrackingToCafe24(
  supabase: any,
  cafe24OrderId: string,
  trackingNo: string
): Promise<void> {
  try {
    // 1) 멱등: 이미 success 기록 있으면 skip(재전송 안 함).
    const { data: done } = await supabase
      .from('cafe24_sync_logs')
      .select('id')
      .eq('sync_type', 'shipment_writeback')
      .eq('cafe24_order_id', cafe24OrderId)
      .eq('status', 'success')
      .limit(1);
    if (done?.length) return;

    const logFailed = async (msg: string) => {
      try {
        await supabase.from('cafe24_sync_logs').insert({
          sync_type: 'shipment_writeback', cafe24_order_id: cafe24OrderId,
          data: { tracking_no: trackingNo }, status: 'failed',
          error_message: msg, processed_at: new Date().toISOString(),
        });
      } catch { /* 로그 실패도 흐름 무영향 */ }
    };

    // 2) env 게이트: CJ 택배사 코드(카페24 carriers 고유값, SweetTracker t_code와 무관) 미설정 → 조용한 누락 금지.
    const carrierCode = process.env.CAFE24_CJ_CARRIER_CODE;
    if (!carrierCode) {
      await logFailed('CAFE24_CJ_CARRIER_CODE 미설정 — 운영 env 주입 필요(carriers 코드 확인 후)');
      return;
    }

    // 3) 인증: getValidAccessToken(만료 시 갱신). 미인증/권한거부(write_order 재인증 전)는 createShipment 가 success:false.
    const mallId = process.env.CAFE24_MALL_ID;
    const clientId = process.env.CAFE24_CLIENT_ID;
    const clientSecret = process.env.CAFE24_CLIENT_SECRET;
    if (!mallId || !clientId || !clientSecret) { await logFailed('카페24 env(mall/client) 미설정'); return; }
    const token = await getValidAccessToken();
    if (!token) { await logFailed('카페24 토큰 없음/만료 — 재인증 필요'); return; }

    const client = new Cafe24Client(mallId, clientId, clientSecret);
    client.setAccessToken(token);

    // 4) 송장 등록(배송중). 응답 검사: 성공 또는 dup(이미 등록)=success 취급 → 다음부터 skip.
    const res = await client.createShipment(cafe24OrderId, {
      shipping_company_code: carrierCode,
      tracking_no: trackingNo,
      shipment_status: 'shipping',
    });
    const errMsg = String(res.error?.message || '').toLowerCase();
    const errCode = String(res.error?.code || '');
    const isDup = errMsg.includes('already') || errMsg.includes('duplicate') || errMsg.includes('exist') || errCode === '409';
    if (res.success || isDup) {
      await supabase.from('cafe24_sync_logs').insert({
        sync_type: 'shipment_writeback', cafe24_order_id: cafe24OrderId,
        data: { tracking_no: trackingNo, dup: isDup && !res.success },
        status: 'success', processed_at: new Date().toISOString(),
      });
      return;
    }
    // 5) 실패 → failed 로그(error_message). throw 안 함.
    await logFailed(`${errCode || 'WRITE_FAIL'}: ${res.error?.message || '카페24 송장 등록 실패'}`);
  } catch (e: any) {
    // 어떤 예외든 격리 — 호출부 흐름 무영향.
    try {
      await supabase.from('cafe24_sync_logs').insert({
        sync_type: 'shipment_writeback', cafe24_order_id: cafe24OrderId,
        data: { tracking_no: trackingNo }, status: 'failed',
        error_message: `예외: ${e?.message || String(e)}`, processed_at: new Date().toISOString(),
      });
    } catch { /* noop */ }
  }
}

export async function updateShipment(
  id: string,
  data: Partial<ShipmentInput & { tracking_number: string | null; status: string }> & Record<string, unknown>
) {
  const supabase = await createClient() as any;

  // 이전 상태 조회 (송장번호 신규 등록 + SHIPPED 전환 감지용)
  const { data: prev } = await supabase
    .from('shipments')
    .select('tracking_number, status, recipient_name, recipient_phone, items_summary, cafe24_order_id, sales_order_id')
    .eq('id', id)
    .maybeSingle();

  // 실제 shipments 컬럼만 허용 — 호출부가 파생필드(sale_branch_name·sale_receipt_date)나
  // 임베드 객체(sales_order)가 섞인 전체 객체를 넘겨도 update 가 깨지지 않도록 방어.
  const UPDATABLE = new Set([
    'source', 'cafe24_order_id', 'sales_order_id',
    'sender_name', 'sender_phone', 'sender_zipcode', 'sender_address', 'sender_address_detail',
    'recipient_name', 'recipient_phone', 'recipient_zipcode', 'recipient_address', 'recipient_address_detail',
    'delivery_message', 'items_summary', 'branch_id', 'created_by',
    'tracking_number', 'status',
  ]);
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (UPDATABLE.has(k)) clean[k] = v;
  }

  // 발송일(shipped_at) 캡처 — 상태가 SHIPPED로 새로 전환될 때 발송 시점 기록(택배관리 발송일 열).
  const _prevStatus = (prev as any)?.status || null;
  const _newStatus = (data.status as string | undefined) ?? _prevStatus;
  const becameShippedNow = _prevStatus !== 'SHIPPED' && _newStatus === 'SHIPPED';
  if (becameShippedNow) clean.shipped_at = new Date().toISOString();

  let { error } = await supabase
    .from('shipments')
    .update({ ...clean, updated_at: new Date().toISOString() })
    .eq('id', id);
  // 마이그112 미적용(shipped_at 컬럼 부재) 폴백 — 발송일 제외하고 재시도.
  if (error && /shipped_at/i.test(String(error.message))) {
    delete clean.shipped_at;
    ({ error } = await supabase.from('shipments').update({ ...clean, updated_at: new Date().toISOString() }).eq('id', id));
  }

  if (error) {
    console.error('updateShipment error:', error);
    return { success: false, error: error.message };
  }

  const prevTracking = (prev as any)?.tracking_number || null;
  const prevStatus = (prev as any)?.status || null;
  const newTracking = (data.tracking_number as string | null | undefined) ?? prevTracking;
  const newStatus = (data.status as string | undefined) ?? prevStatus;

  // 배송 상태 → 판매현황 수령상태 자동 연동 (#19, #90) — 상태 전환 시에만.
  //   #90: 송장 출력(PRINTED)·번호입력(SHIPPED)·배송완료(DELIVERED) 모두 수령완료로 연동.
  try {
    const salesOrderId = (prev as any)?.sales_order_id;
    if (salesOrderId && newStatus && newStatus !== prevStatus &&
        (newStatus === 'PRINTED' || newStatus === 'SHIPPED' || newStatus === 'DELIVERED')) {
      await syncReceiptStatusFromShipment(supabase, salesOrderId, newStatus);
      revalidatePath('/pos');
    }
  } catch (e) {
    console.error('updateShipment receipt-sync error:', e);
    /* 연동 실패가 배송 처리를 막지 않음 */
  }

  // 송장번호가 신규 부여되었고, 상태가 SHIPPED로 전환된 경우 알림톡 발송
  try {
    const becameShipped = prevStatus !== 'SHIPPED' && newStatus === 'SHIPPED';
    const gotTracking = !prevTracking && !!newTracking;

    if ((becameShipped || gotTracking) && prev?.recipient_name && prev?.recipient_phone && newTracking) {
      fireNotificationTrigger({
        eventType: 'SHIPMENT',
        customer: {
          name: (prev as any).recipient_name,
          phone: (prev as any).recipient_phone,
        },
        context: {
          trackingNo: String(newTracking),
          productName: (prev as any).items_summary || '',
          orderNo: (prev as any).cafe24_order_id || '',
        },
      }).catch(() => {});
    }
  } catch {
    /* 알림톡 실패가 업무 흐름을 막지 않음 */
  }

  // #62 Phase2: 우리 송장 신규부여/SHIPPED 전환 시 카페24 주문에 송장 자동 역연동(best-effort).
  //   cafe24_order_id 있는 자사몰 배송만(직접입력 STORE 는 없어 자동 skip). throw 없음 — 우리 흐름 무영향.
  try {
    const becameShipped = prevStatus !== 'SHIPPED' && newStatus === 'SHIPPED';
    const gotTracking = !prevTracking && !!newTracking;
    const cafe24OrderId = (prev as any)?.cafe24_order_id;
    if ((becameShipped || gotTracking) && cafe24OrderId && newTracking) {
      await writebackTrackingToCafe24(supabase, String(cafe24OrderId), String(newTracking));
    }
  } catch {
    /* 역연동 실패가 배송 처리를 막지 않음(헬퍼 내부도 격리됨, 이중 방어) */
  }

  revalidatePath('/shipping');
  return { success: true };
}

// #90 CJ 송장 출력(엑셀 다운로드) = 출력완료 확정 + 판매현황 수령완료 연동.
//   PENDING → PRINTED 전환(race 가드)하고, 전환된 건의 연결 전표 수령상태를 RECEIVED로 동기화.
//   기존 클라이언트 직접 update를 대체 — 송장출력이 곧 수령완료가 되도록 서버에서 일괄 처리.
export async function bulkMarkShipmentsPrinted(ids: string[]): Promise<{ updated: number; error?: string }> {
  if (!ids || ids.length === 0) return { updated: 0 };
  const supabase = await createClient() as any;
  const { data: rows, error } = await supabase
    .from('shipments')
    .update({ status: 'PRINTED', updated_at: new Date().toISOString() })
    .in('id', ids)
    .eq('status', 'PENDING')          // 이미 PRINTED/SHIPPED/DELIVERED는 보존(재출력 보호)
    .select('id, sales_order_id');
  if (error) { console.error('bulkMarkShipmentsPrinted error:', error); return { updated: 0, error: error.message }; }

  // 전환된 건만 수령완료 연동(#90). 연결 전표 없는 과거 카페24분은 자동 skip.
  for (const r of (rows as any[] ?? [])) {
    if (r.sales_order_id) {
      try { await syncReceiptStatusFromShipment(supabase, r.sales_order_id, 'PRINTED'); } catch { /* 연동 실패가 출력 처리를 막지 않음 */ }
    }
  }
  revalidatePath('/shipping');
  revalidatePath('/pos');
  return { updated: (rows as any[] ?? []).length };
}

// #62 Phase2: 카페24 송장 역연동 실패건 조회(본사 전용) — 배송화면 실패목록/배지용.
//   PO "실패 주문·사유 확인" 충족. 최근 실패 200건(주문번호 + 사유 + 시각).
export async function getShipmentWritebackFailures() {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message, rows: [] }; }
  // 본사/관리자만(지점직원 제외) — 자사몰 운영 데이터.
  if (session.role === 'BRANCH_STAFF' || session.role === 'PHARMACY_STAFF') {
    return { error: '권한이 없습니다.', rows: [] };
  }
  const supabase = await createClient() as any;
  const { data, error } = await supabase
    .from('cafe24_sync_logs')
    .select('cafe24_order_id, error_message, processed_at')
    .eq('sync_type', 'shipment_writeback')
    .eq('status', 'failed')
    .order('processed_at', { ascending: false })
    .limit(200);
  if (error) { console.error('getShipmentWritebackFailures error:', error); return { error: error.message, rows: [] }; }
  return { rows: (data as any[]) || [] };
}

export async function deleteShipment(id: string) {
  const supabase = await createClient() as any;

  const { error } = await supabase.from('shipments').delete().eq('id', id);

  if (error) {
    console.error('deleteShipment error:', error);
    return { success: false, error: error.message };
  }

  revalidatePath('/shipping');
  return { success: true };
}

/**
 * 전표 취소 ↔ 택배 연동 (#48 Phase 1, STORE 경로)
 *
 * 전표 취소 시 연결된 shipment(택배)를 일괄 정리한다. 호출자(cancelSalesOrder/cancelCreditOrder)가
 * 재고·포인트·분개 등 어떤 mutation보다 **먼저** 호출해 가드해야 한다.
 *
 * 동작:
 *   - 연결 shipment를 다건 조회: sales_order_id 우선, 0건이면 cafe24_order_id 폴백.
 *   - 가드: SHIPPED/DELIVERED가 하나라도 있으면 즉시 { blocked: true } 반환(아무것도 변경 안 함).
 *           → 호출자는 취소를 차단하고 환불로 유도해야 한다.
 *   - PENDING/PRINTED만 연결됐으면 물리삭제(shipments.status enum에 CANCELLED 없음).
 *   - 0건이면 { blocked:false, deleted:0 } — 멱등(재호출 안전).
 *
 * @param db createClient() 기반 클라이언트(호출자가 보유한 세션 클라이언트 재사용)
 */
export async function voidShipmentsForOrder(
  db: any,
  params: { salesOrderId: string; cafe24OrderId?: string | null; reason?: string }
): Promise<{ blocked: boolean; deleted: number }> {
  // 연결 shipment 다건 조회 — sales_order_id 우선
  let shipments: { id: string; status: string }[] = [];
  const { data: bySo } = await db
    .from('shipments')
    .select('id, status')
    .eq('sales_order_id', params.salesOrderId);
  shipments = (bySo ?? []) as { id: string; status: string }[];

  // sales_order_id로 0건이고 cafe24_order_id 있으면 폴백 조회
  if (shipments.length === 0 && params.cafe24OrderId) {
    const { data: byCafe24 } = await db
      .from('shipments')
      .select('id, status')
      .eq('cafe24_order_id', params.cafe24OrderId);
    shipments = (byCafe24 ?? []) as { id: string; status: string }[];
  }

  if (shipments.length === 0) return { blocked: false, deleted: 0 };

  // 가드: 발송완료(SHIPPED/DELIVERED) 연결건이 하나라도 있으면 차단 — 아무것도 변경하지 않음
  const hasShipped = shipments.some((s) => s.status === 'SHIPPED' || s.status === 'DELIVERED');
  if (hasShipped) return { blocked: true, deleted: 0 };

  // PENDING/PRINTED만 남음 → 물리삭제
  const ids = shipments.map((s) => s.id);
  await db.from('shipments').delete().in('id', ids);

  return { blocked: false, deleted: ids.length };
}

/**
 * webhook 전용 연결배송 정리 — 카페24 사후통보(주문취소)용 (#48 Phase 2b).
 *
 * Phase 1 voidShipmentsForOrder(STORE 취소 차단형, all-or-nothing)와 **별개**:
 *   - webhook은 사후통보 — 이미 취소된 주문이라 "취소 차단" 개념 없음. 부분처리한다.
 *   - 미발송(PENDING/PRINTED) 연결건 → 삭제.
 *   - 발송완료(SHIPPED/DELIVERED) 연결건 → **삭제 절대 금지**(물건 이미 나감). 보존 + 호출자가 경고로그.
 *   - 발송분이 섞여 있어도 미발송분은 그대로 삭제(blocked 없음). 이게 Phase 1과의 핵심 차이.
 *   - 0건 → no-op { deleted:0, preservedShipped:0, preservedIds:[] }. 멱등(재호출·이미삭제 안전).
 *
 * @param db createClient() 기반 클라이언트(호출자가 보유한 클라이언트 재사용)
 */
export async function voidUnshippedShipmentsForOrder(
  db: any,
  params: { salesOrderId: string; cafe24OrderId?: string | null }
): Promise<{ deleted: number; preservedShipped: number; preservedIds: string[] }> {
  // 연결 shipment 다건 조회 — sales_order_id 우선
  let shipments: { id: string; status: string }[] = [];
  const { data: bySo } = await db
    .from('shipments')
    .select('id, status')
    .eq('sales_order_id', params.salesOrderId);
  shipments = (bySo ?? []) as { id: string; status: string }[];

  // sales_order_id로 0건이고 cafe24_order_id 있으면 폴백 조회
  if (shipments.length === 0 && params.cafe24OrderId) {
    const { data: byCafe24 } = await db
      .from('shipments')
      .select('id, status')
      .eq('cafe24_order_id', params.cafe24OrderId);
    shipments = (byCafe24 ?? []) as { id: string; status: string }[];
  }

  if (shipments.length === 0) return { deleted: 0, preservedShipped: 0, preservedIds: [] };

  // 발송완료(SHIPPED/DELIVERED)는 보존, 그 외(PENDING/PRINTED)만 삭제대상
  const preservedIds = shipments
    .filter((s) => s.status === 'SHIPPED' || s.status === 'DELIVERED')
    .map((s) => s.id);
  const unshippedIds = shipments
    .filter((s) => s.status !== 'SHIPPED' && s.status !== 'DELIVERED')
    .map((s) => s.id);

  if (unshippedIds.length > 0) {
    await db.from('shipments').delete().in('id', unshippedIds);
  }

  return { deleted: unshippedIds.length, preservedShipped: preservedIds.length, preservedIds };
}

/**
 * 판매현황 수령상태 일괄 변경 (#38)
 *
 * 여러 주문의 수령상태를 한 번에 수령·배송완료(RECEIVED)로 변경.
 * 배송(shipments) 연결 건은 배송 상태(DELIVERED)도 함께 갱신한 뒤
 * syncReceiptStatusFromShipment(#19 공용 매핑)로 품목/주문 수령상태를 일관 반영 → 배송목록·판매현황 동기화.
 * 배송 레코드가 없는 건(방문/퀵/직접입력)은 주문·품목 수령상태만 직접 갱신.
 */
export async function bulkUpdateReceiptStatus(
  orderIds: string[],
  target: 'RECEIVED'
): Promise<{ success?: true; updated?: number; skipped?: number; error?: string }> {
  try { await requireSession(); } catch (e: any) { return { error: e.message }; }
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (ids.length === 0) return { error: '선택된 주문이 없습니다.' };
  if (target !== 'RECEIVED') return { error: '지원하지 않는 상태입니다.' };

  const supabase = await createClient() as any;
  const today = kstTodayString();
  let updated = 0;
  let skipped = 0;

  for (const orderId of ids) {
    try {
      // 현재 수령상태 — 전진 전이만 허용(이미 완료/뒤로가기 방지).
      const { data: ord } = await supabase
        .from('sales_orders')
        .select('receipt_status')
        .eq('id', orderId)
        .maybeSingle();
      const cur = ord?.receipt_status || 'RECEIVED';
      // 수령완료 대상: 이미 수령완료가 아닌 건.
      if (cur === 'RECEIVED') { skipped++; continue; }

      const { data: ship } = await supabase
        .from('shipments')
        .select('id, status')
        .eq('sales_order_id', orderId)
        .maybeSingle();

      if (ship?.id) {
        // 배송 연결 건 — 배송완료(DELIVERED) 갱신 후 #19 공용 매핑으로 수령상태 반영.
        await supabase
          .from('shipments')
          .update({ status: 'DELIVERED', updated_at: new Date().toISOString() })
          .eq('id', ship.id);
        await syncReceiptStatusFromShipment(supabase, orderId, 'DELIVERED');
      } else {
        // 배송 없는 건(방문/퀵/직접) — 미수령 품목·주문을 수령완료로
        // #47: 상태만 전이 후, receipt_date가 비어있는 행만 오늘로 채움(기존 수령일 보존).
        await supabase
          .from('sales_order_items')
          .update({ receipt_status: 'RECEIVED' })
          .eq('sales_order_id', orderId)
          .neq('receipt_status', 'RECEIVED');
        await supabase
          .from('sales_order_items')
          .update({ receipt_date: today })
          .eq('sales_order_id', orderId)
          .eq('receipt_status', 'RECEIVED')
          .is('receipt_date', null);
        await supabase
          .from('sales_orders')
          .update({ receipt_status: 'RECEIVED' })
          .eq('id', orderId);
        await supabase
          .from('sales_orders')
          .update({ receipt_date: today })
          .eq('id', orderId)
          .is('receipt_date', null);
      }
      updated++;
    } catch (e: any) {
      console.error('[bulkUpdateReceiptStatus] order', orderId, 'failed:', e?.message);
    }
  }

  revalidatePath('/pos');
  revalidatePath('/shipping');
  return { success: true, updated, skipped };
}

/**
 * 배송건 일괄 배송완료 처리
 *
 * 배송목록(shipment.id 단위)에서 선택한 건을 한 번에 DELIVERED로 갱신.
 * sales_order 연결 건은 syncReceiptStatusFromShipment(#19 공용 매핑)로 판매현황 수령상태(RECEIVED) 자동연동.
 * cafe24 출처(sales_order_id=NULL)는 상태만 DELIVERED로 갱신(수령연동 스킵, 에러 아님).
 * 멱등: 이미 DELIVERED인 건은 skip. DELIVERED 전용(다른 status 거부). 알림톡 미발송.
 */
export async function bulkUpdateShipmentStatus(
  shipmentIds: string[],
  status: 'DELIVERED'
): Promise<{ success?: true; updated?: number; skipped?: number; error?: string }> {
  try { await requireSession(); } catch (e: any) { return { error: e.message }; }
  const ids = [...new Set((shipmentIds || []).filter(Boolean))];
  if (ids.length === 0) return { error: '선택된 배송건이 없습니다.' };
  if (status !== 'DELIVERED') return { error: '지원하지 않는 상태입니다.' };

  const supabase = await createClient() as any;
  let updated = 0;
  let skipped = 0;

  for (const shipmentId of ids) {
    try {
      const { data: ship } = await supabase
        .from('shipments')
        .select('status, sales_order_id')
        .eq('id', shipmentId)
        .maybeSingle();
      if (!ship) { skipped++; continue; }
      if (ship.status === 'DELIVERED') { skipped++; continue; }

      await supabase
        .from('shipments')
        .update({ status: 'DELIVERED', updated_at: new Date().toISOString() })
        .eq('id', shipmentId);

      if (ship.sales_order_id) {
        await syncReceiptStatusFromShipment(supabase, ship.sales_order_id, 'DELIVERED');
      }
      updated++;
    } catch (e: any) {
      console.error('[bulkUpdateShipmentStatus] shipment', shipmentId, 'failed:', e?.message);
    }
  }

  revalidatePath('/pos');
  revalidatePath('/shipping');
  return { success: true, updated, skipped };
}
