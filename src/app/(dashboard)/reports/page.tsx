'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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

type ReportTab = 'sales' | 'purchase' | 'pl';

export default function ReportsPage() {
  const [reportTab, setReportTab] = useState<ReportTab>('sales');
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
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
  const [purchaseData, setPurchaseData] = useState<any[]>([]);
  const [returnData, setReturnData] = useState<any[]>([]);

  const userRole = getCookie('user_role');
  const userBranchId = getCookie('user_branch_id');
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
    fetchReportData();
  }, [startDate, endDate, filterBranch, filterChannel]);

  const fetchReportData = async () => {
    setLoading(true);
    const supabase = createClient();

    let query = supabase
      .from('sales_orders')
      .select(`
        id,
        total_amount,
        discount_amount,
        points_earned,
        points_used,
        channel,
        branch_id,
        branch:branches(name),
        ordered_at
      `)
      .eq('status', 'COMPLETED')
      .gte('ordered_at', `${startDate}T00:00:00`)
      .lte('ordered_at', `${endDate}T23:59:59`);

    const { data: orders } = await query;

    let { data: orderItems } = await supabase
      .from('sales_order_items')
      .select(`
        product_id,
        product:products(name),
        quantity,
        total_price,
        created_at
      `)
      .gte('created_at', `${startDate}T00:00:00`)
      .lte('created_at', `${endDate}T23:59:59`);

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
      .gte('ordered_at', `${startDate}T00:00:00`)
      .lte('ordered_at', `${endDate}T23:59:59`)
      .order('ordered_at', { ascending: false }) as any;
    setPurchaseData((purchaseRows || []) as any[]);

    // 환불 데이터
    const { data: returnRows } = await supabase
      .from('return_orders')
      .select('id, return_number, refund_amount, reason, refund_method, processed_at, branch:branches(name)')
      .eq('status', 'COMPLETED')
      .gte('processed_at', `${startDate}T00:00:00`)
      .lte('processed_at', `${endDate}T23:59:59`)
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
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(end.toISOString().slice(0, 10));
  };

  const downloadPDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let yPos = 20;

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('경옥채 매출 보고서', pageWidth / 2, yPos, { align: 'center' });
    yPos += 12;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`기간: ${startDate} ~ ${endDate}`, pageWidth / 2, yPos, { align: 'center' });
    yPos += 8;

    const filterText: string[] = [];
    if (filterBranch) {
      const branch = branches.find(b => b.id === filterBranch);
      filterText.push(`지점: ${branch?.name || filterBranch}`);
    }
    if (filterChannel) {
      filterText.push(`채널: ${CHANNEL_NAMES[filterChannel] || filterChannel}`);
    }
    if (filterText.length > 0) {
      doc.text(filterText.join(' | '), pageWidth / 2, yPos, { align: 'center' });
      yPos += 8;
    }

    yPos += 5;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('매출 요약', 14, yPos);
    yPos += 8;

    const summaryData = [
      ['총 매출 (정상가)', `${salesData.totalAmount.toLocaleString()}원`],
      ['포인트 할인', `-${salesData.totalDiscount.toLocaleString()}원`],
      ['순매출', `${(salesData.totalAmount - salesData.totalDiscount).toLocaleString()}원`],
      ['총 주문 건수', `${salesData.totalOrders}건`],
      ['평균 객단가', `${salesData.avgOrderValue.toLocaleString()}원`],
      ['적립 포인트', `+${salesData.totalPointsEarned.toLocaleString()}P`],
      ['사용 포인트', `-${salesData.totalPointsUsed.toLocaleString()}P`],
    ];

    autoTable(doc, {
      startY: yPos,
      head: [['항목', '금액']],
      body: summaryData,
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246] },
      columnStyles: { 1: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });

    yPos = (doc as any).lastAutoTable.finalY + 15;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('채널별 매출', 14, yPos);
    yPos += 8;

    const channelData = channelSales.map(ch => [
      ch.channelName,
      `${ch.amount.toLocaleString()}원`,
      `${ch.count}건`,
      `${ch.percentage}%`,
    ]);

    autoTable(doc, {
      startY: yPos,
      head: [['채널', '매출액', '주문수', '비율']],
      body: channelData,
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246] },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });

    yPos = (doc as any).lastAutoTable.finalY + 15;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('지점별 매출', 14, yPos);
    yPos += 8;

    const branchData = branchSales.map(br => [
      br.branchName,
      `${br.amount.toLocaleString()}원`,
      `${br.count}건`,
      `${br.percentage}%`,
    ]);

    autoTable(doc, {
      startY: yPos,
      head: [['지점', '매출액', '주문수', '비율']],
      body: branchData,
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246] },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });

    yPos = (doc as any).lastAutoTable.finalY + 15;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('인기 제품 (판매금액 기준)', 14, yPos);
    yPos += 8;

    const productData = productSales.map((p, i) => [
      `${i + 1}`,
      p.productName,
      `${p.quantity.toLocaleString()}`,
      `${p.amount.toLocaleString()}원`,
    ]);

    autoTable(doc, {
      startY: yPos,
      head: [['순위', '제품명', '판매수량', '판매금액']],
      body: productData,
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246] },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });

    const date = new Date().toISOString().slice(0, 10);
    doc.save(`매출보고서_${date}.pdf`);
  };

  const totalPurchaseAmount = purchaseData.reduce((s: number, p: any) => s + (p.total_amount || 0), 0);
  const totalReturnAmount   = returnData.reduce((s: number, r: any) => s + (r.refund_amount || 0), 0);
  const netSales = salesData.totalAmount - salesData.totalDiscount - totalReturnAmount;
  const REPORT_TABS = [
    { key: 'sales' as ReportTab, label: '매출' },
    { key: 'purchase' as ReportTab, label: `매입 (${purchaseData.length}건)` },
    { key: 'pl' as ReportTab, label: '손익 요약' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div className="flex gap-1 border-b border-slate-200">
          {REPORT_TABS.map(t => (
            <button key={t.key} onClick={() => setReportTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                reportTab === t.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500'
              }`}>{t.label}</button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
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
          <button onClick={downloadPDF} className="btn-primary">
            PDF 다운로드
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">로딩 중...</div>
      ) : reportTab === 'purchase' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
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
              <table className="table">
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
                      <td><span className="badge bg-blue-100 text-blue-700 text-xs">{p.status}</span></td>
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
              <table className="table">
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
                      <td className="text-slate-600">{r.reason}</td>
                      <td>{r.refund_method}</td>
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
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
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

          <div className="card">
            <h3 className="font-semibold mb-4">인기 제품 (판매금액 기준)</h3>
            {productSales.length > 0 ? (
              <table className="table">
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
            ) : (
              <p className="text-center text-slate-400 py-8">데이터가 없습니다</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

