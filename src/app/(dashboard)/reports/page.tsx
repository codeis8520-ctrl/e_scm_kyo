'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getMonthlyTrend, getProductMargins } from '@/lib/accounting-actions';
import { fmtDateTimeKST, fmtDateKST, kstDayStart, kstDayEnd, kstTodayString } from '@/lib/date';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    acc[key] = decodeURIComponent(value || '');
    return acc;
  }, {} as Record<string, string>);
  return cookies[name] || null;
}

interface Branch {
  id: string;
  name: string;
  code: string;
  channel: string;
}

interface SalesData {
  totalAmount: number;
  totalOrders: number;
  totalDiscount: number;
  totalPointsEarned: number;
  totalPointsUsed: number;
  avgOrderValue: number;
}

interface ChannelSales {
  channel: string;
  channelName: string;
  amount: number;
  count: number;
  percentage: number;
}

interface BranchSales {
  branchId: string;
  branchName: string;
  amount: number;
  count: number;
  percentage: number;
}

interface ProductSales {
  productId: string;
  productName: string;
  quantity: number;
  amount: number;
}

const CHANNEL_NAMES: Record<string, string> = {
  STORE: '한약국',
  DEPT_STORE: '백화점',
  ONLINE: '자사몰',
  EVENT: '이벤트',
};

const PO_STATUS_LABELS: Record<string, string> = {
  DRAFT: '초안',
  CONFIRMED: '확정',
  PARTIALLY_RECEIVED: '부분입고',
  RECEIVED: '입고완료',
  CANCELLED: '취소',
};

const RETURN_REASON_LABELS: Record<string, string> = {
  DEFECTIVE: '불량품',
  WRONG_ITEM: '상품 오류',
  CHANGE_OF_MIND: '단순 반품',
  DUPLICATE: '중복 주문',
  OTHER: '기타',
};

const REFUND_METHOD_LABELS: Record<string, string> = {
  cash: '현금',
  card: '카드',
  kakao: '카카오페이',
  point: '포인트',
};

type ReportTab = 'sales' | 'purchase' | 'pl' | 'trend' | 'margin';

interface PaymentSales {
  method: string;
  label: string;
  amount: number;
  count: number;
  percentage: number;
}

interface TaxSales {
  taxableAmount: number;   // 과세 매출 (VAT 포함)
  taxableSupply: number;   // 과세 공급가액 (÷1.1)
  vatAmount: number;       // 부가세액
  exemptAmount: number;    // 면세 매출
}

const PAYMENT_LABELS_KO: Record<string, string> = {
  cash: '현금', card: '카드', kakao: '카카오페이', point: '포인트', mixed: '복합결제',
  card_keyin: '카드(키인)', credit: '외상',
};

export default function ReportsPage() {
  const [reportTab, setReportTab] = useState<ReportTab>('sales');
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  // 서버·클라이언트 날짜 차이로 인한 hydration mismatch 방지 — 마운트 후 세팅.
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  useEffect(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    setStartDate(fmtDateKST(d));
    setEndDate(kstTodayString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterBranch, setFilterBranch] = useState('');
  const [filterChannel, setFilterChannel] = useState('');

  const [salesData, setSalesData] = useState<SalesData>({
    totalAmount: 0,
    totalOrders: 0,
    totalDiscount: 0,
    totalPointsEarned: 0,
    totalPointsUsed: 0,
    avgOrderValue: 0,
  });
  const [channelSales, setChannelSales] = useState<ChannelSales[]>([]);
  const [branchSales, setBranchSales] = useState<BranchSales[]>([]);
  const [productSales, setProductSales] = useState<ProductSales[]>([]);
  const [rawOrders, setRawOrders] = useState<any[]>([]);
  const [paymentSales, setPaymentSales] = useState<PaymentSales[]>([]);
  const [taxSales, setTaxSales] = useState<TaxSales>({ taxableAmount: 0, taxableSupply: 0, vatAmount: 0, exemptAmount: 0 });
  const [purchaseData, setPurchaseData]   = useState<any[]>([]);
  const [returnData, setReturnData]       = useState<any[]>([]);
  const [trendData, setTrendData]         = useState<any[]>([]);
  const [marginData, setMarginData]       = useState<any[]>([]);
  const [trendLoading, setTrendLoading]   = useState(false);
  const [marginLoading, setMarginLoading] = useState(false);

  // 서버 SSR에선 cookie 접근 불가(null) → hydration mismatch 방지차 useEffect로 세팅
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userBranchId, setUserBranchId] = useState<string | null>(null);
  useEffect(() => {
    setUserRole(getCookie('user_role'));
    setUserBranchId(getCookie('user_branch_id'));
  }, []);
  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';

  useEffect(() => {
    const fetchBranches = async () => {
      const supabase = createClient();
      const { data } = await supabase.from('branches').select('*').eq('is_active', true).order('created_at');
      setBranches(data || []);
      if (isBranchUser && userBranchId) {
        setFilterBranch(userBranchId);
      }
    };
    fetchBranches();
  }, []);

  useEffect(() => {
    // 마운트 직후 startDate/endDate가 비어 있을 때(hydration 회피용) 쿼리 스킵.
    // useEffect로 날짜가 채워지면 다시 트리거되어 정상 fetch.
    if (!startDate || !endDate) return;
    fetchReportData();
  }, [startDate, endDate, filterBranch, filterChannel]);

  const fetchReportData = async () => {
    setLoading(true);
    const supabase = createClient();

    // 058 과세/면세 스냅샷 우선 조회. 컬럼 부재(58 미적용) 시 미선택 폴백.
    const baseSelect = `
        id,
        total_amount,
        discount_amount,
        points_earned,
        points_used,
        channel,
        branch_id,
        payment_method,
        branch:branches(name),
        ordered_at`;
    const fullSelect = baseSelect + `,
        taxable_amount,
        exempt_amount,
        vat_amount`;

    let resp = await supabase
      .from('sales_orders')
      .select(fullSelect)
      .eq('status', 'COMPLETED')
      .gte('ordered_at', kstDayStart(startDate))
      .lte('ordered_at', kstDayEnd(endDate));
    if (resp.error) {
      // 058 미적용 환경: 스냅샷 없이 폴백
      resp = await supabase
        .from('sales_orders')
        .select(baseSelect)
        .eq('status', 'COMPLETED')
        .gte('ordered_at', kstDayStart(startDate))
        .lte('ordered_at', kstDayEnd(endDate));
    }
    const orders = resp.data;

    let { data: orderItems } = await supabase
      .from('sales_order_items')
      .select(`
        order_id,
        product_id,
        product:products(name, is_taxable),
        quantity,
        total_price,
        created_at
      `)
      .gte('created_at', kstDayStart(startDate))
      .lte('created_at', kstDayEnd(endDate));

    if (!orders) {
      setLoading(false);
      return;
    }

    let ordersData = (orders as any[]).map(o => ({
      ...o,
      branchName: o.branch?.name || o.branch_id || '알 수 없음',
    }));

    if (isBranchUser && userBranchId) {
      ordersData = ordersData.filter(o => o.branch_id === userBranchId);
    }

    if (filterBranch) {
      ordersData = ordersData.filter(o => o.branch_id === filterBranch);
    }

    if (filterChannel) {
      ordersData = ordersData.filter(o => o.channel === filterChannel);
    }

    setRawOrders(ordersData);

    // ── 결제수단별 집계
    const filteredOrderIds = new Set(ordersData.map((o: any) => o.id));
    const paymentMap = new Map<string, { amount: number; count: number }>();
    ordersData.forEach((o: any) => {
      const method = o.payment_method || 'cash';
      const e = paymentMap.get(method) || { amount: 0, count: 0 };
      paymentMap.set(method, { amount: e.amount + (o.total_amount || 0), count: e.count + 1 });
    });
    const totalAmountForPayment = ordersData.reduce((s: number, o: any) => s + (o.total_amount || 0), 0);
    const paymentArr: PaymentSales[] = [];
    paymentMap.forEach((v, method) => {
      paymentArr.push({
        method,
        label: PAYMENT_LABELS_KO[method] || method,
        amount: v.amount,
        count: v.count,
        percentage: totalAmountForPayment > 0 ? Math.round((v.amount / totalAmountForPayment) * 100) : 0,
      });
    });
    setPaymentSales(paymentArr.sort((a, b) => b.amount - a.amount));

    // ── 과세/면세 집계
    //   058 스냅샷이 있는 주문은 그 값을 사용, 없는 주문(=과거 데이터)은 사후 집계로 폴백.
    let taxableAmt = 0;
    let exemptAmt = 0;
    let vatAmt = 0;
    const ordersWithoutSnapshot: string[] = [];
    ordersData.forEach((o: any) => {
      const hasSnapshot =
        o.taxable_amount != null || o.exempt_amount != null || o.vat_amount != null;
      if (hasSnapshot && (Number(o.taxable_amount) || Number(o.exempt_amount))) {
        taxableAmt += Number(o.taxable_amount || 0);
        exemptAmt += Number(o.exempt_amount || 0);
        vatAmt += Number(o.vat_amount || 0);
      } else {
        ordersWithoutSnapshot.push(o.id);
      }
    });
    if (ordersWithoutSnapshot.length > 0) {
      const fallbackSet = new Set(ordersWithoutSnapshot);
      const filteredItems = (orderItems || []).filter((item: any) => fallbackSet.has(item.order_id));
      let legacyTaxable = 0;
      let legacyExempt = 0;
      filteredItems.forEach((item: any) => {
        if ((item.product as any)?.is_taxable !== false) legacyTaxable += item.total_price || 0;
        else legacyExempt += item.total_price || 0;
      });
      taxableAmt += legacyTaxable;
      exemptAmt += legacyExempt;
      vatAmt += Math.round((legacyTaxable * 10) / 110);
    }
    setTaxSales({
      taxableAmount: taxableAmt,
      taxableSupply: taxableAmt - vatAmt,
      vatAmount: vatAmt,
      exemptAmount: exemptAmt,
    });

    const totalAmount = ordersData.reduce((sum, o) => sum + (o.total_amount || 0), 0);
    const totalDiscount = ordersData.reduce((sum, o) => sum + (o.discount_amount || 0), 0);
    const totalPointsEarned = ordersData.reduce((sum, o) => sum + (o.points_earned || 0), 0);
    const totalPointsUsed = ordersData.reduce((sum, o) => sum + (o.points_used || 0), 0);

    setSalesData({
      totalAmount,
      totalOrders: ordersData.length,
      totalDiscount,
      totalPointsEarned,
      totalPointsUsed,
      avgOrderValue: ordersData.length > 0 ? Math.round(totalAmount / ordersData.length) : 0,
    });

    const channelMap = new Map<string, { amount: number; count: number }>();
    ordersData.forEach(o => {
      const ch = o.channel || 'STORE';
      const existing = channelMap.get(ch) || { amount: 0, count: 0 };
      channelMap.set(ch, {
        amount: existing.amount + (o.total_amount || 0),
        count: existing.count + 1,
      });
    });

    const channelData: ChannelSales[] = [];
    channelMap.forEach((val, key) => {
      channelData.push({
        channel: key,
        channelName: CHANNEL_NAMES[key] || key,
        amount: val.amount,
        count: val.count,
        percentage: totalAmount > 0 ? Math.round((val.amount / totalAmount) * 100) : 0,
      });
    });
    setChannelSales(channelData.sort((a, b) => b.amount - a.amount));

    const branchMap = new Map<string, { name: string; amount: number; count: number }>();
    ordersData.forEach(o => {
      const existing = branchMap.get(o.branch_id) || { name: o.branchName, amount: 0, count: 0 };
      branchMap.set(o.branch_id, {
        name: o.branchName,
        amount: existing.amount + (o.total_amount || 0),
        count: existing.count + 1,
      });
    });

    const branchData: BranchSales[] = [];
    branchMap.forEach((val, key) => {
      branchData.push({
        branchId: key,
        branchName: val.name,
        amount: val.amount,
        count: val.count,
        percentage: totalAmount > 0 ? Math.round((val.amount / totalAmount) * 100) : 0,
      });
    });
    setBranchSales(branchData.sort((a, b) => b.amount - a.amount));

    const productMap = new Map<string, { name: string; quantity: number; amount: number }>();
    (orderItems || []).forEach((item: any) => {
      const pid = item.product_id;
      const name = item.product?.name || '알 수 없음';
      const existing = productMap.get(pid) || { name, quantity: 0, amount: 0 };
      productMap.set(pid, {
        name,
        quantity: existing.quantity + item.quantity,
        amount: existing.amount + item.total_price,
      });
    });

    const productData: ProductSales[] = [];
    productMap.forEach((val, key) => {
      productData.push({
        productId: key,
        productName: val.name,
        quantity: val.quantity,
        amount: val.amount,
      });
    });
    setProductSales(productData.sort((a, b) => b.amount - a.amount).slice(0, 20));

    // 매입 데이터
    const { data: purchaseRows } = await supabase
      .from('purchase_orders')
      .select('id, po_number, total_amount, status, ordered_at, branch:branches(name), supplier:suppliers(name)')
      .in('status', ['CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED'])
      .gte('ordered_at', kstDayStart(startDate))
      .lte('ordered_at', kstDayEnd(endDate))
      .order('ordered_at', { ascending: false }) as any;
    setPurchaseData((purchaseRows || []) as any[]);

    // 환불 데이터
    const { data: returnRows } = await supabase
      .from('return_orders')
      .select('id, return_number, refund_amount, reason, refund_method, processed_at, branch:branches(name)')
      .eq('status', 'COMPLETED')
      .gte('processed_at', kstDayStart(startDate))
      .lte('processed_at', kstDayEnd(endDate))
      .order('processed_at', { ascending: false }) as any;
    setReturnData((returnRows || []) as any[]);

    setLoading(false);
  };

  const handlePeriodChange = (p: 'daily' | 'weekly' | 'monthly') => {
    setPeriod(p);
    const end = new Date();
    const start = new Date();
    if (p === 'daily') {
      start.setDate(end.getDate() - 30);
    } else if (p === 'weekly') {
      start.setDate(end.getDate() - 12 * 7);
    } else {
      start.setMonth(end.getMonth() - 12);
    }
    setStartDate(fmtDateKST(start));
    setEndDate(fmtDateKST(end));
  };

  const exportCSV = (filename: string, headers: string[], rows: (string | number)[]) => {
    const BOM = '\uFEFF'; // Excel 한글 깨짐 방지
    const lines = [headers, ...(rows as any[])].map((row: any[]) =>
      row.map((cell: any) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
    );
    const csv = BOM + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportSalesCSV = () => {
    const date = new Date().toISOString().slice(0, 10);
    exportCSV(
      `매출내역_${startDate}_${endDate}.csv`,
      ['주문일시', '지점', '채널', '결제수단', '매출액', '할인액', '순매출', '적립포인트', '사용포인트'],
      rawOrders.map((o: any) => [
        o.ordered_at?.slice(0, 16).replace('T', ' ') || '',
        o.branchName || '',
        CHANNEL_NAMES[o.channel] || o.channel || '',
        PAYMENT_LABELS_KO[o.payment_method] || o.payment_method || '',
        o.total_amount || 0,
        o.discount_amount || 0,
        (o.total_amount || 0) - (o.discount_amount || 0),
        o.points_earned || 0,
        o.points_used || 0,
      ]) as any
    );
  };

  const exportPurchaseCSV = () => {
    exportCSV(
      `매입내역_${startDate}_${endDate}.csv`,
      ['발주일', '발주번호', '공급업체', '입고지점', '상태', '발주금액'],
      purchaseData.map((p: any) => [
        p.ordered_at?.slice(0, 10) || '',
        p.po_number || '',
        (p.supplier as any)?.name || '',
        (p.branch as any)?.name || '',
        PO_STATUS_LABELS[p.status] || p.status || '',
        p.total_amount || 0,
      ]) as any
    );
  };

  const exportReturnCSV = () => {
    exportCSV(
      `환불내역_${startDate}_${endDate}.csv`,
      ['처리일', '환불번호', '사유', '방법', '지점', '환불금액'],
      returnData.map((r: any) => [
        r.processed_at?.slice(0, 10) || '',
        r.return_number || '',
        RETURN_REASON_LABELS[r.reason] || r.reason || '',
        REFUND_METHOD_LABELS[r.refund_method] || r.refund_method || '',
        (r.branch as any)?.name || '',
        r.refund_amount || 0,
      ]) as any
    );
  };

  const downloadPDF = () => {
    const branchLabel = filterBranch ? branches.find(b => b.id === filterBranch)?.name || '' : '전체 지점';
    const channelLabel = filterChannel ? (CHANNEL_NAMES[filterChannel] || filterChannel) : '전체 채널';
    const generatedAt = fmtDateTimeKST(new Date());
    const netSalesVal = salesData.totalAmount - salesData.totalDiscount;

    const buildTable = (headers: string[], rows: string[][], colAligns?: string[]) => {
      const thStyle = 'background:#1e3a5f;color:#fff;padding:8px 12px;text-align:left;font-weight:600;font-size:12px;border:none;';
      const tdBase  = 'padding:7px 12px;font-size:12px;border-bottom:1px solid #e5e7eb;';
      const ths = headers.map((h, i) => {
        const align = colAligns?.[i] === 'right' ? 'text-align:right;' : '';
        return `<th style="${thStyle}${align}">${h}</th>`;
      }).join('');
      const trs = rows.map((row, ri) => {
        const bg = ri % 2 === 0 ? '#ffffff' : '#f8fafc';
        const tds = row.map((cell, ci) => {
          const align = colAligns?.[ci] === 'right' ? 'text-align:right;' : '';
          return `<td style="${tdBase}${align}background:${bg};">${cell}</td>`;
        }).join('');
        return `<tr>${tds}</tr>`;
      }).join('');
      return `<table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <thead><tr>${ths}</tr></thead>
        <tbody>${trs}</tbody>
      </table>`;
    };

    const sectionTitle = (title: string) =>
      `<h2 style="font-size:14px;font-weight:700;color:#1e3a5f;margin:24px 0 10px;padding-bottom:6px;border-bottom:2px solid #1e3a5f;">${title}</h2>`;

    const summaryRows = [
      ['총 매출 (정상가)', `${salesData.totalAmount.toLocaleString()}원`],
      ['할인액', `-${salesData.totalDiscount.toLocaleString()}원`],
      ['순매출', `<strong>${netSalesVal.toLocaleString()}원</strong>`],
      ['총 주문 건수', `${salesData.totalOrders}건`],
      ['평균 객단가', `${Math.round(salesData.avgOrderValue).toLocaleString()}원`],
      ['적립 포인트', `+${salesData.totalPointsEarned.toLocaleString()}P`],
      ['사용 포인트', `-${salesData.totalPointsUsed.toLocaleString()}P`],
    ];

    const channelRows = channelSales.map(ch => [
      ch.channelName,
      `${ch.amount.toLocaleString()}원`,
      `${ch.count}건`,
      `${ch.percentage}%`,
    ]);

    const branchRows = branchSales.map(br => [
      br.branchName,
      `${br.amount.toLocaleString()}원`,
      `${br.count}건`,
      `${br.percentage}%`,
    ]);

    const productRows = productSales.map((p, i) => [
      `${i + 1}`,
      p.productName,
      `${p.quantity.toLocaleString()}개`,
      `${p.amount.toLocaleString()}원`,
    ]);

    const paymentRows = paymentSales.map(pm => [
      pm.label,
      `${pm.amount.toLocaleString()}원`,
      `${pm.count}건`,
      `${pm.percentage}%`,
    ]);

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif; color:#1f2937; background:#fff; padding:32px 40px; font-size:13px; }
  .header { text-align:center; margin-bottom:28px; padding-bottom:20px; border-bottom:3px solid #1e3a5f; }
  .header h1 { font-size:22px; font-weight:800; color:#1e3a5f; margin-bottom:6px; }
  .header .meta { font-size:12px; color:#6b7280; margin-top:4px; }
  .summary-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:24px; }
  .summary-card { background:#f0f4ff; border-radius:8px; padding:14px 16px; }
  .summary-card .label { font-size:11px; color:#6b7280; margin-bottom:4px; }
  .summary-card .value { font-size:17px; font-weight:700; color:#1e3a5f; }
  .summary-card.accent { background:#1e3a5f; }
  .summary-card.accent .label { color:#93c5fd; }
  .summary-card.accent .value { color:#fff; }
  .two-col { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
  .footer { margin-top:32px; text-align:center; font-size:11px; color:#9ca3af; border-top:1px solid #e5e7eb; padding-top:12px; }
  @media print {
    body { padding:20px 28px; }
    @page { size:A4; margin:15mm 15mm; }
  }
</style>
</head>
<body>
<div class="header">
  <h1>경옥채 매출 보고서</h1>
  <div class="meta">조회 기간: ${startDate} ~ ${endDate}</div>
  <div class="meta">${branchLabel} · ${channelLabel}</div>
  <div class="meta" style="margin-top:6px;color:#9ca3af;">생성일시: ${generatedAt}</div>
</div>

<div class="summary-grid">
  <div class="summary-card accent">
    <div class="label">순매출</div>
    <div class="value">${netSalesVal.toLocaleString()}원</div>
  </div>
  <div class="summary-card">
    <div class="label">총 주문</div>
    <div class="value">${salesData.totalOrders}건</div>
  </div>
  <div class="summary-card">
    <div class="label">평균 객단가</div>
    <div class="value">${Math.round(salesData.avgOrderValue).toLocaleString()}원</div>
  </div>
  <div class="summary-card">
    <div class="label">총 매출 (정상가)</div>
    <div class="value">${salesData.totalAmount.toLocaleString()}원</div>
  </div>
  <div class="summary-card">
    <div class="label">할인액</div>
    <div class="value" style="color:#ef4444;">-${salesData.totalDiscount.toLocaleString()}원</div>
  </div>
  <div class="summary-card">
    <div class="label">포인트 적립/사용</div>
    <div class="value" style="font-size:14px;">+${salesData.totalPointsEarned.toLocaleString()} / -${salesData.totalPointsUsed.toLocaleString()}P</div>
  </div>
</div>

<div class="two-col">
  <div>
    ${sectionTitle('채널별 매출')}
    ${buildTable(['채널', '매출액', '주문수', '비율'], channelRows, ['left','right','right','right'])}
  </div>
  <div>
    ${sectionTitle('결제 수단별')}
    ${buildTable(['결제수단', '금액', '건수', '비율'], paymentRows, ['left','right','right','right'])}
  </div>
</div>

${sectionTitle('지점별 매출')}
${buildTable(['지점', '매출액', '주문수', '비율'], branchRows, ['left','right','right','right'])}

${sectionTitle('인기 제품 TOP ' + productRows.length + ' (판매금액 기준)')}
${buildTable(['순위', '제품명', '판매수량', '판매금액'], productRows, ['left','left','right','right'])}

<div class="footer">경옥채 사내 ERP · 본 문서는 내부용입니다</div>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { alert('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.'); return; }
    win.document.write(html);
    win.document.close();
    win.onload = () => {
      win.focus();
      win.print();
    };
  };

  const totalPurchaseAmount = purchaseData.reduce((s: number, p: any) => s + (p.total_amount || 0), 0);
  const totalReturnAmount   = returnData.reduce((s: number, r: any) => s + (r.refund_amount || 0), 0);
  const netSales = salesData.totalAmount - salesData.totalDiscount - totalReturnAmount;
  // 트렌드 탭 진입 시 로드
  useEffect(() => {
    if (reportTab !== 'trend') return;
    setTrendLoading(true);
    getMonthlyTrend(12, filterBranch || undefined).then(r => {
      setTrendData(r.data || []);
      setTrendLoading(false);
    });
  }, [reportTab, filterBranch]);

  // 마진 탭 진입 시 로드
  useEffect(() => {
    if (reportTab !== 'margin') return;
    setMarginLoading(true);
    getProductMargins(startDate, endDate, filterBranch || undefined).then(r => {
      setMarginData(r.data || []);
      setMarginLoading(false);
    });
  }, [reportTab, startDate, endDate, filterBranch]);

  const REPORT_TABS = [
    { key: 'sales'   as ReportTab, label: '매출' },
    { key: 'purchase' as ReportTab, label: `매입 (${purchaseData.length}건)` },
    { key: 'pl'      as ReportTab, label: '손익 요약' },
    { key: 'trend'   as ReportTab, label: '월별 트렌드' },
    { key: 'margin'  as ReportTab, label: '제품별 마진' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <div className="overflow-x-auto w-full sm:w-auto">
        <div className="flex gap-1 border-b border-slate-200 whitespace-nowrap">
          {REPORT_TABS.map(t => (
            <button key={t.key} onClick={() => setReportTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                reportTab === t.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500'
              }`}>{t.label}</button>
          ))}
        </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={period}
            onChange={(e) => handlePeriodChange(e.target.value as any)}
            className="input"
          >
            <option value="daily">일별 (30일)</option>
            <option value="weekly">주별 (12주)</option>
            <option value="monthly">월별 (12개월)</option>
          </select>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="input"
          />
          <span className="self-center text-slate-400">~</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="input"
          />
          <select
            value={filterChannel}
            onChange={(e) => setFilterChannel(e.target.value)}
            className="input"
          >
            <option value="">전체 채널</option>
            {Object.entries(CHANNEL_NAMES).map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
          <select
            value={filterBranch}
            onChange={(e) => setFilterBranch(e.target.value)}
            className="input"
            disabled={isBranchUser}
          >
            <option value="">전체 지점</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <button onClick={fetchReportData} className="btn-secondary">
            조회
          </button>
          {reportTab === 'sales' && rawOrders.length > 0 && (
            <button onClick={exportSalesCSV} className="btn-secondary">
              <span className="hidden sm:inline">매출 </span>CSV
            </button>
          )}
          {reportTab === 'purchase' && purchaseData.length > 0 && (
            <button onClick={exportPurchaseCSV} className="btn-secondary">
              <span className="hidden sm:inline">매입 </span>CSV
            </button>
          )}
          {reportTab === 'purchase' && returnData.length > 0 && (
            <button onClick={exportReturnCSV} className="btn-secondary">
              <span className="hidden sm:inline">환불 </span>CSV
            </button>
          )}
          <button onClick={downloadPDF} className="btn-primary">
            PDF
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">로딩 중...</div>
      ) : reportTab === 'purchase' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
            <div className="card text-center">
              <p className="text-sm text-slate-500">발주 건수</p>
              <p className="text-2xl font-bold text-slate-800 mt-1">{purchaseData.length}건</p>
            </div>
            <div className="card text-center">
              <p className="text-sm text-slate-500">총 매입액</p>
              <p className="text-2xl font-bold text-amber-700 mt-1">{totalPurchaseAmount.toLocaleString()}원</p>
            </div>
            <div className="card text-center">
              <p className="text-sm text-slate-500">환불 금액</p>
              <p className="text-2xl font-bold text-red-600 mt-1">{totalReturnAmount.toLocaleString()}원</p>
            </div>
          </div>
          <div className="card overflow-x-auto">
            <h3 className="font-semibold mb-4">매입 발주 내역</h3>
            {purchaseData.length === 0 ? (
              <p className="text-center text-slate-400 py-8">해당 기간 매입 데이터가 없습니다</p>
            ) : (
              <table className="table min-w-[500px]">
                <thead>
                  <tr>
                    <th>발주일</th>
                    <th>발주번호</th>
                    <th>공급업체</th>
                    <th>입고 지점</th>
                    <th>상태</th>
                    <th className="text-right">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseData.map((p: any) => (
                    <tr key={p.id}>
                      <td className="text-sm">{p.ordered_at?.slice(0, 10)}</td>
                      <td className="font-mono text-sm text-blue-700">{p.po_number}</td>
                      <td>{(p.supplier as any)?.name || '-'}</td>
                      <td className="text-slate-500">{(p.branch as any)?.name || '-'}</td>
                      <td><span className="badge bg-blue-100 text-blue-700 text-xs">{PO_STATUS_LABELS[p.status] || p.status}</span></td>
                      <td className="text-right font-medium">{(p.total_amount || 0).toLocaleString()}원</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50">
                    <td colSpan={5} className="text-right font-semibold pr-4">합계</td>
                    <td className="text-right font-bold text-amber-700">{totalPurchaseAmount.toLocaleString()}원</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
          {returnData.length > 0 && (
            <div className="card overflow-x-auto">
              <h3 className="font-semibold mb-4">환불 내역</h3>
              <table className="table min-w-[500px]">
                <thead>
                  <tr>
                    <th>일자</th>
                    <th>환불번호</th>
                    <th>사유</th>
                    <th>방법</th>
                    <th>지점</th>
                    <th className="text-right">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {returnData.map((r: any) => (
                    <tr key={r.id}>
                      <td className="text-sm">{r.processed_at?.slice(0, 10)}</td>
                      <td className="font-mono text-sm text-red-700">{r.return_number}</td>
                      <td className="text-slate-600">{RETURN_REASON_LABELS[r.reason] || r.reason || '-'}</td>
                      <td>{REFUND_METHOD_LABELS[r.refund_method] || r.refund_method || '-'}</td>
                      <td className="text-slate-500">{(r.branch as any)?.name || '-'}</td>
                      <td className="text-right font-medium text-red-600">{(r.refund_amount || 0).toLocaleString()}원</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : reportTab === 'pl' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="font-semibold mb-5">간이 손익계산서</h3>
            <div className="space-y-2 text-sm">
              {[
                { label: '총 매출', value: salesData.totalAmount, bold: false },
                { label: '(-) 포인트 할인', value: -salesData.totalDiscount, indent: true },
                { label: '(-) 환불', value: -totalReturnAmount, indent: true },
                null,
                { label: '순매출', value: netSales, bold: true },
                null,
                { label: '(참고) 매입 발주액', value: totalPurchaseAmount, indent: true },
              ].map((row, i) =>
                row === null ? <hr key={i} className="border-slate-200" /> : (
                  <div key={i} className={`flex justify-between py-1 ${row.indent ? 'pl-4 text-slate-500' : ''}`}>
                    <span className={row.bold ? 'font-semibold text-slate-800' : ''}>{row.label}</span>
                    <span className={`font-mono ${row.bold ? 'font-bold' : ''} ${row.value < 0 ? 'text-red-500' : ''}`}>
                      {row.value.toLocaleString()}원
                    </span>
                  </div>
                )
              )}
            </div>
          </div>
          <div className="card">
            <h3 className="font-semibold mb-4">주요 지표</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: '매출 주문', value: `${salesData.totalOrders}건` },
                { label: '환불 건수', value: `${returnData.length}건` },
                { label: '평균 객단가', value: `${salesData.avgOrderValue.toLocaleString()}원` },
                { label: '환불률', value: `${salesData.totalOrders > 0 ? Math.round(returnData.length / salesData.totalOrders * 100) : 0}%` },
                { label: '적립 포인트', value: `${salesData.totalPointsEarned.toLocaleString()}P` },
                { label: '사용 포인트', value: `${salesData.totalPointsUsed.toLocaleString()}P` },
              ].map(s => (
                <div key={s.label} className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-500">{s.label}</p>
                  <p className="font-bold text-slate-800 mt-1">{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : reportTab === 'trend' ? (
        <TrendTab data={trendData} loading={trendLoading} />
      ) : reportTab === 'margin' ? (
        <MarginTab data={marginData} loading={marginLoading} />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
            <div className="stat-card">
              <p className="text-sm text-slate-500">총 매출 (정상가)</p>
              <p className="text-xl font-bold text-slate-800">{salesData.totalAmount.toLocaleString()}원</p>
              <p className="text-xs text-slate-400">{salesData.totalOrders}건</p>
            </div>
            <div className="stat-card">
              <p className="text-sm text-slate-500">포인트 할인</p>
              <p className="text-xl font-bold text-red-500">-{salesData.totalDiscount.toLocaleString()}원</p>
            </div>
            <div className="stat-card">
              <p className="text-sm text-slate-500">순매출</p>
              <p className="text-xl font-bold text-green-600">
                {(salesData.totalAmount - salesData.totalDiscount).toLocaleString()}원
              </p>
            </div>
            <div className="stat-card">
              <p className="text-sm text-slate-500">평균 객단가</p>
              <p className="text-xl font-bold text-slate-800">{salesData.avgOrderValue.toLocaleString()}원</p>
            </div>
            <div className="stat-card">
              <p className="text-sm text-slate-500">적립 포인트</p>
              <p className="text-xl font-bold text-blue-600">+{salesData.totalPointsEarned.toLocaleString()}P</p>
            </div>
            <div className="stat-card">
              <p className="text-sm text-slate-500">사용 포인트</p>
              <p className="text-xl font-bold text-amber-600">-{salesData.totalPointsUsed.toLocaleString()}P</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="font-semibold mb-4">채널별 매출</h3>
              {channelSales.length > 0 ? (
                <div className="space-y-3">
                  {channelSales.map((ch) => (
                    <div key={ch.channel}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-slate-600">{ch.channelName}</span>
                        <span className="font-semibold">{ch.amount.toLocaleString()}원 ({ch.percentage}%)</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full"
                          style={{ width: `${ch.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-slate-400 py-8">데이터가 없습니다</p>
              )}
            </div>

            <div className="card">
              <h3 className="font-semibold mb-4">지점별 매출</h3>
              {branchSales.length > 0 ? (
                <div className="space-y-3">
                  {branchSales.map((br) => (
                    <div key={br.branchId}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-slate-600">{br.branchName}</span>
                        <span className="font-semibold">{br.amount.toLocaleString()}원 ({br.percentage}%)</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2">
                        <div
                          className="bg-green-500 h-2 rounded-full"
                          style={{ width: `${br.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-slate-400 py-8">데이터가 없습니다</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="font-semibold mb-4">결제수단별 매출</h3>
              {paymentSales.length > 0 ? (
                <div className="space-y-3">
                  {paymentSales.map((pm) => (
                    <div key={pm.method}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-slate-600">{pm.label}</span>
                        <span className="font-semibold">
                          {pm.amount.toLocaleString()}원
                          <span className="text-slate-400 text-xs ml-1">({pm.count}건, {pm.percentage}%)</span>
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2">
                        <div className="bg-amber-500 h-2 rounded-full" style={{ width: `${pm.percentage}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-slate-400 py-8">데이터가 없습니다</p>
              )}
            </div>

            <div className="card">
              <h3 className="font-semibold mb-4">과세/면세 매출 구분
                <span className="text-xs text-slate-400 font-normal ml-2">(부가세 포함가 기준)</span>
              </h3>
              {(taxSales.taxableAmount + taxSales.exemptAmount) > 0 ? (
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between py-2 border-b border-slate-100">
                    <span className="text-slate-500">과세 매출 (VAT포함)</span>
                    <span className="font-semibold">{taxSales.taxableAmount.toLocaleString()}원</span>
                  </div>
                  <div className="flex justify-between py-1 pl-3">
                    <span className="text-slate-400">ㄴ 공급가액</span>
                    <span>{taxSales.taxableSupply.toLocaleString()}원</span>
                  </div>
                  <div className="flex justify-between py-1 pl-3 border-b border-slate-100">
                    <span className="text-slate-400">ㄴ 부가세액</span>
                    <span className="text-blue-600">{taxSales.vatAmount.toLocaleString()}원</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-100">
                    <span className="text-slate-500">면세 매출</span>
                    <span className="font-semibold">{taxSales.exemptAmount.toLocaleString()}원</span>
                  </div>
                  <div className="flex justify-between py-2 bg-slate-50 px-3 rounded-lg">
                    <span className="font-semibold">합계</span>
                    <span className="font-bold">{(taxSales.taxableAmount + taxSales.exemptAmount).toLocaleString()}원</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">* 공급가액 = 과세매출 ÷ 1.1, 부가세 = 과세매출 × 10/110</p>
                </div>
              ) : (
                <p className="text-center text-slate-400 py-8">데이터가 없습니다</p>
              )}
            </div>
          </div>

          <div className="card">
            <h3 className="font-semibold mb-4">인기 제품 (판매금액 기준)</h3>
            {productSales.length > 0 ? (
              <div className="overflow-x-auto">
              <table className="table min-w-[400px]">
                <thead>
                  <tr>
                    <th>순위</th>
                    <th>제품명</th>
                    <th className="text-right">판매수량</th>
                    <th className="text-right">판매금액</th>
                  </tr>
                </thead>
                <tbody>
                  {productSales.map((p, i) => (
                    <tr key={p.productId}>
                      <td>{i + 1}</td>
                      <td className="font-medium">{p.productName}</td>
                      <td className="text-right">{p.quantity.toLocaleString()}</td>
                      <td className="text-right font-semibold">{p.amount.toLocaleString()}원</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            ) : (
              <p className="text-center text-slate-400 py-8">데이터가 없습니다</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── 월별 트렌드 탭

function TrendTab({ data, loading }: { data: any[]; loading: boolean }) {
  if (loading) return <div className="text-center py-16 text-slate-400">로딩 중...</div>;
  if (!data.length) return <div className="text-center py-16 text-slate-400">데이터가 없습니다</div>;
  const maxRevenue = Math.max(...data.map(d => d.grossRevenue), 1);
  return (
    <div className="space-y-6">
      <div className="card">
        <h3 className="font-semibold mb-6">월별 매출 / 매출이익 트렌드 (최근 12개월)</h3>
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${data.length * 56} 210`} className="w-full min-w-[560px] h-52">
            {data.map((d, i) => {
              const x = i * 56 + 4;
              const revH = Math.max(2, Math.round((d.grossRevenue / maxRevenue) * 160));
              const profH = Math.max(0, Math.round((Math.max(0, d.grossProfit) / maxRevenue) * 160));
              const barW = 22;
              return (
                <g key={d.month}>
                  <rect x={x} y={170 - revH} width={barW} height={revH} fill="#3b82f6" opacity="0.75" rx="2" />
                  <rect x={x + barW + 2} y={170 - profH} width={barW} height={profH}
                    fill={d.grossProfit >= 0 ? "#10b981" : "#ef4444"} opacity="0.8" rx="2" />
                  <text x={x + barW} y={184} textAnchor="middle" fontSize="9" fill="#94a3b8">{d.month.slice(5)}월</text>
                  {d.cogs > 0 && d.grossMargin !== 0 && (
                    <text x={x + barW + 2} y={170 - profH - 3} textAnchor="middle" fontSize="8"
                      fill={d.grossMargin >= 0 ? "#059669" : "#dc2626"}>{d.grossMargin}%</text>
                  )}
                </g>
              );
            })}
            <rect x={4} y={197} width={10} height={6} fill="#3b82f6" opacity="0.75" rx="1" />
            <text x={17} y={203} fontSize="8" fill="#64748b">매출</text>
            <rect x={50} y={197} width={10} height={6} fill="#10b981" opacity="0.8" rx="1" />
            <text x={63} y={203} fontSize="8" fill="#64748b">이익</text>
          </svg>
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="table text-sm">
          <thead><tr>
            <th>월</th>
            <th className="text-right">총매출</th>
            <th className="text-right">환불</th>
            <th className="text-right">순매출</th>
            <th className="text-right">매출원가</th>
            <th className="text-right">매출이익</th>
            <th className="text-right">마진율</th>
            <th className="text-right">주문수</th>
          </tr></thead>
          <tbody>
            {data.map(d => (
              <tr key={d.month}>
                <td className="font-medium">{d.month}</td>
                <td className="text-right">{d.grossRevenue.toLocaleString()}</td>
                <td className="text-right text-red-500">{d.refunds > 0 ? `-${d.refunds.toLocaleString()}` : '-'}</td>
                <td className="text-right font-medium">{d.netRevenue.toLocaleString()}</td>
                <td className="text-right text-slate-500">{d.cogs > 0 ? d.cogs.toLocaleString() : '-'}</td>
                <td className={`text-right font-semibold ${d.grossProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {d.grossProfit.toLocaleString()}
                </td>
                <td className={`text-right ${d.grossMargin >= 40 ? 'text-green-600' : d.grossMargin >= 20 ? 'text-amber-600' : 'text-slate-400'}`}>
                  {d.cogs > 0 ? `${d.grossMargin}%` : '-'}
                </td>
                <td className="text-right text-slate-500">{d.orderCount}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 font-semibold"><tr>
            <td>합계</td>
            <td className="text-right">{data.reduce((s,d)=>s+d.grossRevenue,0).toLocaleString()}</td>
            <td className="text-right text-red-500">-{data.reduce((s,d)=>s+d.refunds,0).toLocaleString()}</td>
            <td className="text-right">{data.reduce((s,d)=>s+d.netRevenue,0).toLocaleString()}</td>
            <td className="text-right text-slate-500">{data.reduce((s,d)=>s+d.cogs,0).toLocaleString()}</td>
            <td className="text-right text-green-600">{data.reduce((s,d)=>s+d.grossProfit,0).toLocaleString()}</td>
            <td className="text-right">{(() => {
              const nr = data.reduce((s,d)=>s+d.netRevenue,0);
              const gp = data.reduce((s,d)=>s+d.grossProfit,0);
              return nr > 0 && data.some(d=>d.cogs>0) ? `${Math.round(gp/nr*100)}%` : '-';
            })()}</td>
            <td className="text-right">{data.reduce((s,d)=>s+d.orderCount,0)}</td>
          </tr></tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── 제품별 마진 탭

function MarginTab({ data, loading }: { data: any[]; loading: boolean }) {
  const [sortKey, setSortKey] = useState<'revenue'|'grossProfit'|'marginPct'>('revenue');
  const [minMargin, setMinMargin] = useState('');
  if (loading) return <div className="text-center py-16 text-slate-400">로딩 중...</div>;
  if (!data.length) return <div className="text-center py-16 text-slate-400">데이터가 없습니다</div>;
  const hasCogs = data.some(d => d.cogs > 0);
  const filtered = data
    .filter(d => minMargin === '' || d.marginPct >= parseInt(minMargin))
    .sort((a, b) => b[sortKey] - a[sortKey]);
  const totalRevenue = filtered.reduce((s, d) => s + d.revenue, 0);
  const totalCogs    = filtered.reduce((s, d) => s + d.cogs, 0);
  const totalProfit  = filtered.reduce((s, d) => s + d.grossProfit, 0);
  const avgMargin    = totalRevenue > 0 && hasCogs ? Math.round(totalProfit / totalRevenue * 100) : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-2">
          {([
            { k: 'revenue'     as const, label: '매출순' },
            { k: 'grossProfit' as const, label: '이익순' },
            { k: 'marginPct'   as const, label: '마진율순' },
          ]).map(s => (
            <button key={s.k} onClick={() => setSortKey(s.k)}
              className={`px-3 py-1.5 rounded text-sm font-medium ${sortKey === s.k ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
              {s.label}
            </button>
          ))}
        </div>
        <select value={minMargin} onChange={e => setMinMargin(e.target.value)} className="input text-sm w-36 py-1.5">
          <option value="">마진율 전체</option>
          <option value="50">50% 이상</option>
          <option value="30">30% 이상</option>
          <option value="0">흑자만</option>
        </select>
        {!hasCogs && (
          <span className="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded border border-amber-200">
            ⚠️ 제품 원가(cost)가 등록돼야 마진 계산됩니다
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: '총 매출',    value: `${totalRevenue.toLocaleString()}원`, color: 'text-slate-800' },
          { label: '총 원가',    value: `${totalCogs.toLocaleString()}원`,    color: 'text-amber-700' },
          { label: '총 이익',    value: `${totalProfit.toLocaleString()}원`,  color: totalProfit >= 0 ? 'text-green-600' : 'text-red-600' },
          { label: '평균 마진율', value: avgMargin !== null ? `${avgMargin}%` : '-', color: avgMargin !== null && avgMargin >= 30 ? 'text-green-600' : 'text-amber-600' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <p className="text-sm text-slate-500">{s.label}</p>
            <p className={`text-xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="table text-sm">
          <thead><tr>
            <th>순위</th><th>제품명</th><th>코드</th>
            <th className="text-right">수량</th>
            <th className="text-right">매출액</th>
            <th className="text-right">원가합계</th>
            <th className="text-right">매출이익</th>
            <th className="text-right">마진율</th>
            <th>매출 비중</th>
          </tr></thead>
          <tbody>
            {filtered.map((d, i) => {
              const sharePct = totalRevenue > 0 ? Math.round(d.revenue / totalRevenue * 100) : 0;
              return (
                <tr key={d.id}>
                  <td className="text-slate-400">{i + 1}</td>
                  <td className="font-medium">{d.name}</td>
                  <td className="font-mono text-xs text-slate-400">{d.code}</td>
                  <td className="text-right">{d.qty.toLocaleString()}</td>
                  <td className="text-right">{d.revenue.toLocaleString()}</td>
                  <td className="text-right text-slate-500">{d.cogs > 0 ? d.cogs.toLocaleString() : '-'}</td>
                  <td className={`text-right font-semibold ${d.cogs > 0 ? (d.grossProfit >= 0 ? 'text-green-600' : 'text-red-600') : 'text-slate-400'}`}>
                    {d.cogs > 0 ? d.grossProfit.toLocaleString() : '-'}
                  </td>
                  <td className="text-right">
                    {d.cogs > 0 ? (
                      <span className={`font-medium ${d.marginPct >= 40 ? 'text-green-600' : d.marginPct >= 20 ? 'text-amber-600' : 'text-red-500'}`}>
                        {d.marginPct}%
                      </span>
                    ) : '-'}
                  </td>
                  <td className="w-24">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                        <div className="bg-blue-400 h-1.5 rounded-full" style={{ width: `${sharePct}%` }} />
                      </div>
                      <span className="text-xs text-slate-400 w-8 text-right">{sharePct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
