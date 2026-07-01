'use client';

// 거래명세서 출력(#99) — 판매전표를 정식 명세서 문서로 미리보기 + 인쇄/PDF(브라우저 저장).
//   부가세 포함가 기준: 공급가액=합계/1.1(반올림), 부가세=합계−공급가액. VAT 규약(CLAUDE.md).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEscClose } from '@/hooks/useEscClose';
import { createClient } from '@/lib/supabase/client';

// 공급자 기본값(지점에 정보가 없을 때 폴백). 실제 값은 판매 담당자 소속 지점(#99)에서 채움.
const COMPANY_DEFAULT = {
  brand: '경옥채',
  name: '주식회사 더경옥',
  bizNo: '380-87-00872',
  ceo: '송근영',
  tel: '02-3013-1075',
  address: '서울시 강남구 청담동 11-1, 1층 경옥채한약국',
};
type Company = typeof COMPANY_DEFAULT;

interface StmtItem {
  name: string;
  quantity: number;
  unit_price: number;        // 부가세 포함 판매 단가
  discount_amount?: number;
}
interface Props {
  orderNumber: string;
  orderedAt: string;         // ISO
  clientName: string;        // 거래처/고객명
  handlerName?: string;
  items: StmtItem[];
  supplierBranchId?: string; // #99 공급자 = 이 지점(판매 담당자 소속) 정보로 채움
  onClose: () => void;
}

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const won2 = (n: number) => n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 숫자 → 한글 금액(원 정). 만/억 단위 처리.
function numToKorean(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return '영';
  const nums = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const small = ['', '십', '백', '천'];
  const big = ['', '만', '억', '조'];
  let out = '';
  let bi = 0;
  while (n > 0) {
    const chunk = n % 10000;
    if (chunk > 0) {
      let cs = '';
      let c = chunk, si = 0;
      while (c > 0) {
        const d = c % 10;
        if (d > 0) cs = nums[d] + small[si] + cs;
        c = Math.floor(c / 10); si++;
      }
      out = cs + big[bi] + out;
    }
    n = Math.floor(n / 10000); bi++;
  }
  return out;
}

function buildStatementHtml(p: Props, COMPANY: Company, logoUrl: string): { html: string; grandTotal: number } {
  const dt = new Date(p.orderedAt);
  const y = dt.getFullYear(), m = String(dt.getMonth() + 1).padStart(2, '0'), d = String(dt.getDate()).padStart(2, '0');
  const dateFull = `${y}/${m}/${d}`;
  const dateShort = `${m}/${d}`;

  const rows = p.items.map(it => {
    const qty = Number(it.quantity) || 0;
    const unit = Number(it.unit_price) || 0;                 // 포함가 단가
    const disc = Number(it.discount_amount) || 0;
    const lineTotal = unit * qty - disc;                     // 포함가 합계
    const supply = Math.round(lineTotal / 1.1);              // 공급가액
    const vat = lineTotal - supply;                          // 부가세
    const supplyUnit = qty !== 0 ? (unit / 1.1) : 0;         // 공급 단가(표시)
    return { name: it.name, qty, supplyUnit, supply, vat, lineTotal };
  });
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalSupply = rows.reduce((s, r) => s + r.supply, 0);
  const totalVat = rows.reduce((s, r) => s + r.vat, 0);
  const grandTotal = rows.reduce((s, r) => s + r.lineTotal, 0);

  const rowsHtml = rows.map(r => `
    <tr>
      <td class="c">${dateShort}</td>
      <td class="l">${r.name}</td>
      <td class="r">${won(r.qty)}</td>
      <td class="r">${won2(r.supplyUnit)}</td>
      <td class="r">${won(r.supply)}</td>
      <td class="r">${won(r.vat)}</td>
      <td class="r b">${won(r.lineTotal)}</td>
    </tr>`).join('');
  // 빈 줄 채우기(양식감) — 최소 6행
  const filler = Math.max(0, 6 - rows.length);
  const fillerHtml = Array.from({ length: filler }).map(() => `<tr><td class="c">&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('');

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>거래명세서 ${p.orderNumber}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Malgun Gothic','맑은 고딕',sans-serif; color:#111; margin:0; padding:16px; font-size:12px; }
    .sheet { max-width: 760px; margin:0 auto; }
    h1 { font-size: 26px; letter-spacing: 6px; margin:0; }
    table { border-collapse: collapse; width:100%; }
    td, th { border:1px solid #333; padding:3px 6px; }
    .top { display:flex; gap:10px; align-items:stretch; margin-bottom:6px; }
    .top .brand { flex:1; border:1px solid #333; padding:10px 14px; display:flex; flex-direction:column; justify-content:center; }
    .top .brand .client { margin-top:10px; font-size:15px; font-weight:bold; }
    .supplier { width:340px; }
    .supplier td { font-size:11px; }
    .supplier .hd { background:#f0f0f0; text-align:center; width:40px; font-weight:bold; }
    .amount { border:1px solid #333; border-top:none; padding:6px 10px; display:flex; justify-content:space-between; font-weight:bold; font-size:14px; }
    .items th { background:#f0f0f0; text-align:center; font-weight:bold; }
    .items td.l { text-align:left; } .items td.c { text-align:center; } .items td.r { text-align:right; }
    .items td.b, .items th.b { font-weight:bold; }
    .items .total td { background:#fafafa; font-weight:bold; text-align:right; }
    .items .total td.lbl { text-align:center; }
    .foot { margin-top:6px; }
    .foot td { text-align:center; font-size:12px; }
    .foot .k { background:#f0f0f0; font-weight:bold; width:60px; }
    @media print { body { padding:0; } .no-print { display:none; } }
  </style></head><body><div class="sheet">
    <div class="top">
      <div class="brand">
        <div style="display:flex;align-items:center;gap:14px;">
          <img src="${logoUrl}" alt="경옥채" style="height:60px;width:60px;object-fit:contain;flex-shrink:0;" onerror="this.style.display='none'" />
          <div>
            <h1>거래명세서</h1>
            <div style="font-size:11px;color:#555;margin-top:4px;letter-spacing:0;">${COMPANY.brand} · 전표번호 ${p.orderNumber}</div>
          </div>
        </div>
        <div class="client">${p.clientName} 貴中</div>
      </div>
      <table class="supplier">
        <tr>
          <td class="hd" rowspan="4">공<br>급<br>자</td>
          <td class="hd" style="width:64px">일련번호</td><td>${dateFull} -${totalQty}</td>
          <td class="hd" style="width:40px">TEL</td><td>${COMPANY.tel}</td>
        </tr>
        <tr>
          <td class="hd">등록번호</td><td>${COMPANY.bizNo}</td>
          <td class="hd">성명</td><td>${COMPANY.ceo}</td>
        </tr>
        <tr><td class="hd">상호</td><td colspan="3">${COMPANY.name}</td></tr>
        <tr><td class="hd">주소</td><td colspan="3">${COMPANY.address}</td></tr>
      </table>
    </div>
    <div class="amount"><span>금 액 : ${numToKorean(grandTotal)}원 정</span><span>(₩${won(grandTotal)})</span></div>

    <table class="items">
      <thead><tr>
        <th style="width:52px">일자</th><th>품목명</th><th style="width:52px">수량</th>
        <th style="width:90px">단가</th><th style="width:90px">공급가액</th><th style="width:80px">부가세</th><th class="b" style="width:90px">합계</th>
      </tr></thead>
      <tbody>
        ${rowsHtml}
        ${fillerHtml}
        <tr class="total"><td class="lbl" colspan="2">총 합 계</td><td>${won(totalQty)}</td><td></td><td>${won(totalSupply)}</td><td>${won(totalVat)}</td><td>${won(grandTotal)}</td></tr>
      </tbody>
    </table>

    <table class="foot"><tr>
      <td class="k">수량</td><td>${won(totalQty)}</td>
      <td class="k">공급가액</td><td>${won(totalSupply)}</td>
      <td class="k">VAT</td><td>${won(totalVat)}</td>
      <td class="k">합계</td><td><b>${won(grandTotal)}</b></td>
      <td class="k">인수</td><td style="width:80px">&nbsp;&nbsp;&nbsp;&nbsp;(인)</td>
    </tr></table>
    <div style="margin-top:8px;font-size:11px;color:#666;text-align:right;">담당/확인자: ${p.handlerName || '-'}</div>
  </div></body></html>`;
  return { html, grandTotal };
}

export default function StatementModal(props: Props) {
  const { onClose, supplierBranchId } = props;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  useEscClose(onClose);

  // #99 공급자 정보 = 판매 담당자 소속 지점(supplierBranchId)에서 조회, 빈 값은 기본값 폴백.
  const [company, setCompany] = useState<Company>(COMPANY_DEFAULT);
  useEffect(() => {
    if (!supplierBranchId) return;
    (async () => {
      try {
        const sb = createClient() as any;
        const { data } = await sb.from('branches')
          .select('name, company_name, business_number, ceo_name, address, phone')
          .eq('id', supplierBranchId).maybeSingle();
        if (!data) return;
        setCompany({
          brand: data.name || COMPANY_DEFAULT.brand,
          name: data.company_name || COMPANY_DEFAULT.name,
          bizNo: data.business_number || COMPANY_DEFAULT.bizNo,
          ceo: data.ceo_name || COMPANY_DEFAULT.ceo,
          tel: data.phone || COMPANY_DEFAULT.tel,
          address: data.address || COMPANY_DEFAULT.address,
        });
      } catch { /* 폴백 유지 */ }
    })();
  }, [supplierBranchId]);

  // 로고는 절대 URL(iframe srcDoc·인쇄에서 안정적으로 로드).
  const logoUrl = (typeof window !== 'undefined' ? window.location.origin : '') + '/CI.jpg';
  const { html } = useMemo(() => buildStatementHtml(props, company, logoUrl), [props, company, logoUrl]);

  const doPrint = () => {
    const w = iframeRef.current?.contentWindow;
    if (w) { w.focus(); w.print(); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4" onClick={onClose}>
      <div className="bg-white rounded-lg w-full max-w-3xl max-h-[92vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="font-bold text-slate-800">거래명세서</h2>
          <div className="flex gap-2">
            <button onClick={doPrint} className="btn-primary text-sm">🖨 인쇄 / PDF 저장</button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-slate-100 p-3">
          <iframe ref={iframeRef} srcDoc={html} title="거래명세서" className="w-full h-[70vh] bg-white border border-slate-200" />
        </div>
        <p className="px-5 py-2 text-[11px] text-slate-400 border-t">인쇄 대화상자에서 &lsquo;PDF로 저장&rsquo;을 선택하면 PDF로 받을 수 있습니다.</p>
      </div>
    </div>
  );
}
