// ════════════════════════════════════════════════════════════════════════════
// 스마트스토어 "발주발송관리" 엑셀(암호화) → 정규화된 주문 구조 파싱
//
//  - 네이버 판매자센터 엑셀은 MS 암호화(OLE2). office-crypto(순수 JS, msoffcrypto
//    포팅)로 비밀번호 복호화 → SheetJS 파싱. Vercel Node 함수에서 동작 검증됨.
//  - 헤더는 "컬럼명 기준"으로 매핑(고정 인덱스 X) — 사용자가 항목을 다르게 내려받아도
//    이름만 맞으면 인식. 헤더행은 '상품주문번호'·'주문번호'가 들어있는 행으로 자동 탐지.
//  - 행 단위 = 상품주문번호(품목). 주문번호로 그룹핑 → 1 주문 = N 품목.
//  - 날짜는 엑셀 시리얼(예: 46196.98) → KST ISO 문자열.
// ════════════════════════════════════════════════════════════════════════════
import * as XLSX from 'xlsx';
import { OfficeFile, isEncrypted } from 'office-crypto';

export interface SmartstoreItem {
  productOrderNo: string;   // 상품주문번호(품목 고유 — dedup 키)
  productNo: string;        // 상품번호(네이버 상품 id — 매핑 안정 키)
  productName: string;      // 상품명(예: "차 | 쌍화(10포)")
  option: string;           // 옵션정보
  optionCode: string;       // 옵션관리코드
  quantity: number;
  unitPrice: number;        // 상품가격(+옵션가격)
  discount: number;         // 최종 상품별 할인액
  lineTotal: number;        // 최종 상품별 총 주문금액(매출 인식 금액)
}

export interface SmartstoreOrder {
  orderNo: string;          // 주문번호(그룹)
  channel: string;          // 판매채널(스마트스토어)
  status: string;           // 주문상태
  orderedAt: string | null; // 주문일시(KST ISO)
  paidAt: string | null;    // 결제일(KST ISO) — 매출 인식일
  payMethod: string;        // 결제수단
  shippingFee: number;      // 배송비 합계
  buyer: { name: string; id: string; phone: string };
  recipient: {
    name: string; phone: string; phone2: string;
    zipcode: string; address: string; addressDetail: string; message: string;
  };
  shipping: { courier: string; trackingNo: string; shippedAt: string | null };
  items: SmartstoreItem[];
}

// 엑셀 시리얼(1900 날짜계) → KST ISO. 시리얼은 KST 벽시계값으로 간주.
function serialToKstIso(v: any): string | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  // (serial - 25569) * 86400000 = 시리얼을 UTC로 본 ms. 그 UTC 벽시계 성분이 곧 KST 벽시계.
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  const p = (x: number, l = 2) => String(x).padStart(l, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+09:00`;
}

const toNum = (v: any): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const toStr = (v: any): string => (v === undefined || v === null ? '' : String(v)).trim();
// 전화 정규화 — 비교/저장용(숫자만). customers.phone 매칭 키.
export const normalizePhone = (v: any): string => toStr(v).replace(/[^0-9]/g, '');

/** 복호화 + 파싱 → 정규화된 주문 목록. 비번 틀리면 throw('비밀번호'). */
export function parseSmartstoreExcel(buf: Buffer | Uint8Array, password: string): SmartstoreOrder[] {
  const u8 = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);

  // 1) 복호화(암호화된 경우만)
  let plain: Buffer = u8;
  if (isEncrypted(u8)) {
    if (!password) throw new Error('PASSWORD_REQUIRED');
    try {
      const file = OfficeFile(u8);
      file.loadKey({ password, verifyPassword: true });
      const dec = file.decrypt();
      plain = Buffer.isBuffer(dec) ? dec : Buffer.from(dec as any);
    } catch {
      throw new Error('PASSWORD_INVALID');
    }
  }

  // 2) 시트 → 행배열
  const wb = XLSX.read(plain, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('NO_SHEET');
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // 3) 헤더행 탐지 — '상품주문번호'+'주문번호' 포함 행
  let headerIdx = -1;
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    const set = new Set(rows[i].map((c) => toStr(c)));
    if (set.has('상품주문번호') && set.has('주문번호')) { headerIdx = i; break; }
  }
  if (headerIdx < 0) throw new Error('HEADER_NOT_FOUND');
  const headers = rows[headerIdx].map((c) => toStr(c));
  const col = (name: string): number => headers.indexOf(name);
  const get = (r: any[], name: string): any => { const i = col(name); return i >= 0 ? r[i] : ''; };

  // 4) 데이터행 → 품목, 주문번호로 그룹핑
  const byOrder = new Map<string, SmartstoreOrder>();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const productOrderNo = toStr(get(r, '상품주문번호'));
    const orderNo = toStr(get(r, '주문번호'));
    if (!productOrderNo && !orderNo) continue; // 빈 행

    let order = byOrder.get(orderNo);
    if (!order) {
      order = {
        orderNo,
        channel: toStr(get(r, '판매채널')) || '스마트스토어',
        status: toStr(get(r, '주문상태')),
        orderedAt: serialToKstIso(get(r, '주문일시')),
        paidAt: serialToKstIso(get(r, '결제일')),
        payMethod: toStr(get(r, '결제수단')),
        shippingFee: toNum(get(r, '배송비 합계')),
        buyer: {
          name: toStr(get(r, '구매자명')),
          id: toStr(get(r, '구매자ID')),
          phone: toStr(get(r, '구매자연락처')),
        },
        recipient: {
          name: toStr(get(r, '수취인명')),
          phone: toStr(get(r, '수취인연락처1')),
          phone2: toStr(get(r, '수취인연락처2')),
          zipcode: toStr(get(r, '우편번호')),
          // 통합배송지 = 기본+상세 합본인 경우가 많음. 기본/상세가 따로 있으면 그것을 우선.
          address: toStr(get(r, '기본배송지')) || toStr(get(r, '통합배송지')),
          addressDetail: toStr(get(r, '상세배송지')),
          message: toStr(get(r, '배송메세지')),
        },
        shipping: {
          courier: toStr(get(r, '택배사')),
          trackingNo: toStr(get(r, '송장번호')),
          shippedAt: serialToKstIso(get(r, '발송일')),
        },
        items: [],
      };
      byOrder.set(orderNo, order);
    }

    order.items.push({
      productOrderNo,
      productNo: toStr(get(r, '상품번호')),
      productName: toStr(get(r, '상품명')),
      option: toStr(get(r, '옵션정보')),
      optionCode: toStr(get(r, '옵션관리코드')),
      quantity: toNum(get(r, '수량')) || 1,
      unitPrice: toNum(get(r, '상품가격')) + toNum(get(r, '옵션가격')),
      discount: toNum(get(r, '최종 상품별 할인액')),
      lineTotal: toNum(get(r, '최종 상품별 총 주문금액')),
    });
  }

  return [...byOrder.values()];
}
