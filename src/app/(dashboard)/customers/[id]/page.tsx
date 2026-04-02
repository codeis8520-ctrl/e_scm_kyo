'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { formatPhone } from '@/lib/validators';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    acc[key] = decodeURIComponent(value || '');
    return acc;
  }, {} as Record<string, string>);
  return cookies[name] || null;
}

interface CustomerDetail {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  grade: string;
  primary_branch_id: string | null;
  health_note: string | null;
  total_points: number;
  is_active: boolean;
  cafe24_member_id: string | null;
  created_at: string;
  primary_branch?: { id: string; name: string };
  tags?: { id: string; name: string; color: string }[];
  assigned_to?: { id: string; name: string } | null;
}

interface PurchaseItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  ordered_at: string;
  branch_id: string;
  branch_name: string;
  status: string;
}

interface Consultation {
  id: string;
  consultation_type: string;
  content: Record<string, any>;
  consulted_by?: { name: string };
  created_at: string;
}

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface Branch {
  id: string;
  name: string;
}

interface User {
  id: string;
  name: string;
}

const GRADE_COLORS: Record<string, string> = {
  NORMAL: 'bg-slate-100 text-slate-700',
  VIP: 'bg-blue-100 text-blue-700',
  VVIP: 'bg-amber-100 text-amber-700',
};

const GRADE_LABELS: Record<string, string> = {
  NORMAL: '일반',
  VIP: 'VIP',
  VVIP: 'VVIP',
};

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getDefaultDateRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return { start: formatDate(start), end: formatDate(end) };
}

export default function CustomerDetailPage() {
  const params = useParams();
  const customerId = params.id as string;
  
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'info' | 'purchases' | 'consultations'>('info');
  const [showConsultModal, setShowConsultModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);

  const [purchaseDateRange, setPurchaseDateRange] = useState(getDefaultDateRange);
  const [consultDateRange, setConsultDateRange] = useState(getDefaultDateRange);
  const [purchaseProductSearch, setPurchaseProductSearch] = useState('');
  const [purchaseBranchFilter, setPurchaseBranchFilter] = useState('');

  useEffect(() => {
    fetchData();
  }, [customerId]);

  const fetchData = async () => {
    setLoading(true);
    const supabase = createClient();

    const { start, end } = purchaseDateRange;

    const [customerRes, purchasesRes, consultationsRes, tagsRes, branchesRes, usersRes] = await Promise.all([
      supabase
        .from('customers')
        .select(`
          *,
          primary_branch:branches(*),
          tags:customer_tag_map(
            tag:customer_tags(*)
          ),
          assigned_to:users!customers_assigned_to_fkey(*)
        `)
        .eq('id', customerId)
        .single(),
      supabase
        .from('sales_orders')
        .select(`
          id,
          ordered_at,
          status,
          branch_id,
          branch:branches(name, id),
          items:sales_order_items(
            id,
            quantity,
            unit_price,
            total_price,
            product:products(name)
          )
        `)
        .eq('customer_id', customerId)
        .gte('ordered_at', `${purchaseDateRange.start}T00:00:00`)
        .lte('ordered_at', `${purchaseDateRange.end}T23:59:59`)
        .order('ordered_at', { ascending: false }),
      supabase
        .from('customer_consultations')
        .select('*, consulted_by:users(name)')
        .eq('customer_id', customerId)
        .gte('created_at', `${consultDateRange.start}T00:00:00`)
        .lte('created_at', `${consultDateRange.end}T23:59:59`)
        .order('created_at', { ascending: false }),
      supabase.from('customer_tags').select('*').order('name'),
      supabase.from('branches').select('id, name').eq('is_active', true),
      supabase.from('users').select('id, name').eq('is_active', true),
    ]) as any;

    if (customerRes.data) {
      const c = customerRes.data as any;
      setCustomer({
        ...c,
        tags: c.tags?.map((t: any) => t.tag).filter(Boolean) || [],
      });
    }

    const items: PurchaseItem[] = (purchasesRes.data || []).flatMap((order: any) => 
      (order.items || []).map((item: any) => ({
        id: item.id,
        product_name: item.product?.name || '알 수 없음',
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
        ordered_at: order.ordered_at,
        branch_id: order.branch_id,
        branch_name: order.branch?.name || '-',
        status: order.status,
      }))
    ).filter((item: PurchaseItem) => {
      if (purchaseProductSearch && !item.product_name.toLowerCase().includes(purchaseProductSearch.toLowerCase())) {
        return false;
      }
      if (purchaseBranchFilter && item.branch_id !== purchaseBranchFilter) {
        return false;
      }
      return true;
    });
    setPurchaseItems(items);

    setConsultations((consultationsRes.data || []) as Consultation[]);
    setAllTags((tagsRes.data || []) as Tag[]);
    setBranches((branchesRes.data || []) as Branch[]);
    setUsers((usersRes.data || []) as User[]);
    setLoading(false);
  };

  const handleAddTag = async (tagId: string) => {
    const supabase = createClient() as any;
    await supabase.from('customer_tag_map').insert({
      customer_id: customerId,
      tag_id: tagId,
    });
    fetchData();
  };

  const handleRemoveTag = async (tagId: string) => {
    const supabase = createClient() as any;
    await supabase
      .from('customer_tag_map')
      .delete()
      .eq('customer_id', customerId)
      .eq('tag_id', tagId);
    fetchData();
  };

  const handleUpdateAssignedTo = async (userId: string | null) => {
    const supabase = createClient() as any;
    await supabase
      .from('customers')
      .update({ assigned_to: userId })
      .eq('id', customerId);
    fetchData();
    setShowAssignModal(false);
  };

  const handleAddConsultation = async (type: string, content: string) => {
    const supabase = createClient() as any;
    const userId = getCookie('user_id');
    
    await supabase.from('customer_consultations').insert({
      customer_id: customerId,
      consultation_type: type,
      content: { text: content },
      consulted_by: userId || null,
    });
    
    fetchData();
    setShowConsultModal(false);
  };

  const getTotalPurchaseAmount = () => {
    return purchaseItems.reduce((sum, p) => sum + p.total_price, 0);
  };

  const handleDateFilterChange = (type: 'purchase' | 'consult', field: 'start' | 'end', value: string) => {
    if (type === 'purchase') {
      const newRange = { ...purchaseDateRange, [field]: value };
      setPurchaseDateRange(newRange);
    } else {
      const newRange = { ...consultDateRange, [field]: value };
      setConsultDateRange(newRange);
    }
  };

  const applyDateFilter = (type: 'purchase' | 'consult') => {
    fetchData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-500">로딩 중...</div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="text-center py-8">
        <p className="text-slate-500">고객을 찾을 수 없습니다.</p>
        <Link href="/customers" className="text-blue-600 hover:underline mt-4 inline-block">
          고객 목록으로 돌아가기
        </Link>
      </div>
    );
  }

  const customerTags = customer.tags || [];
  const availableTags = allTags.filter(t => !customerTags.find(ct => ct.id === t.id));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/customers" className="text-slate-400 hover:text-slate-600">
            ← 목록
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{customer.name}</h1>
            <p className="text-slate-500">{formatPhone(customer.phone)}</p>
          </div>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${GRADE_COLORS[customer.grade] || ''}`}>
          {GRADE_LABELS[customer.grade] || customer.grade}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <div className="card">
            <h3 className="font-semibold mb-4">기본 정보</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">이메일</dt>
                <dd>{customer.email || '-'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">담당 지점</dt>
                <dd>{customer.primary_branch?.name || '-'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">적립 포인트</dt>
                <dd className="font-medium text-blue-600">{customer.total_points?.toLocaleString() || 0}P</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">고객 등급</dt>
                <dd>{GRADE_LABELS[customer.grade] || customer.grade}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">자사몰 ID</dt>
                <dd className="font-mono text-xs">{customer.cafe24_member_id || '-'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">등록일</dt>
                <dd>{new Date(customer.created_at).toLocaleDateString('ko-KR')}</dd>
              </div>
              {customer.assigned_to && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">담당자</dt>
                  <dd>{customer.assigned_to.name}</dd>
                </div>
              )}
            </dl>
            <button
              onClick={() => setShowAssignModal(true)}
              className="mt-4 w-full text-sm text-blue-600 hover:underline"
            >
              {customer.assigned_to ? '담당자 변경' : '담당자 지정'}
            </button>
          </div>

          <div className="card">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold">태그</h3>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {customerTags.map(tag => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium text-white"
                  style={{ backgroundColor: tag.color }}
                >
                  {tag.name}
                  <button
                    onClick={() => handleRemoveTag(tag.id)}
                    className="hover:opacity-70"
                  >
                    ×
                  </button>
                </span>
              ))}
              {customerTags.length === 0 && (
                <span className="text-slate-400 text-sm">등록된 태그 없음</span>
              )}
            </div>
            {availableTags.length > 0 && (
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    handleAddTag(e.target.value);
                    e.target.value = '';
                  }
                }}
                className="input text-sm"
                defaultValue=""
              >
                <option value="">+ 태그 추가</option>
                {availableTags.map(tag => (
                  <option key={tag.id} value={tag.id}>{tag.name}</option>
                ))}
              </select>
            )}
          </div>

          {customer.health_note && (
            <div className="card">
              <h3 className="font-semibold mb-3">건강 메모</h3>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{customer.health_note}</p>
            </div>
          )}

          <div className="card">
            <h3 className="font-semibold mb-3">구매 요약</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">총 구매 횟수</dt>
                <dd>{purchaseItems.length}회</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">총 구매 금액</dt>
                <dd className="font-medium">{getTotalPurchaseAmount().toLocaleString()}원</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="flex gap-2 border-b border-slate-200 mb-4">
            <button
              onClick={() => setActiveTab('info')}
              className={`px-4 py-2 font-medium border-b-2 -mb-px ${
                activeTab === 'info'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500'
              }`}
            >
              기본 정보
            </button>
            <button
              onClick={() => setActiveTab('purchases')}
              className={`px-4 py-2 font-medium border-b-2 -mb-px ${
                activeTab === 'purchases'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500'
              }`}
            >
              구매 이력 ({purchaseItems.length})
            </button>
            <button
              onClick={() => setActiveTab('consultations')}
              className={`px-4 py-2 font-medium border-b-2 -mb-px ${
                activeTab === 'consultations'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500'
              }`}
            >
              상담 기록 ({consultations.length})
            </button>
          </div>

          {activeTab === 'purchases' && (
            <div className="space-y-4">
              <div className="flex gap-2 items-center flex-wrap">
                <input
                  type="date"
                  value={purchaseDateRange.start}
                  onChange={(e) => handleDateFilterChange('purchase', 'start', e.target.value)}
                  className="input w-36"
                />
                <span className="text-slate-400">~</span>
                <input
                  type="date"
                  value={purchaseDateRange.end}
                  onChange={(e) => handleDateFilterChange('purchase', 'end', e.target.value)}
                  className="input w-36"
                />
                <input
                  type="text"
                  placeholder="제품명 검색"
                  value={purchaseProductSearch}
                  onChange={(e) => setPurchaseProductSearch(e.target.value)}
                  className="input w-36"
                />
                <select
                  value={purchaseBranchFilter}
                  onChange={(e) => setPurchaseBranchFilter(e.target.value)}
                  className="input w-36"
                >
                  <option value="">전체 지점</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <button onClick={() => fetchData()} className="btn-secondary">
                  조회
                </button>
                <button 
                  onClick={() => {
                    const range = getDefaultDateRange();
                    setPurchaseDateRange(range);
                    setPurchaseProductSearch('');
                    setPurchaseBranchFilter('');
                    setTimeout(() => fetchData(), 0);
                  }}
                  className="text-sm text-slate-500 hover:text-slate-700"
                >
                  초기화
                </button>
              </div>

              <div className="card">
                {purchaseItems.length > 0 ? (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>날짜</th>
                        <th>제품</th>
                        <th>수량</th>
                        <th>단가</th>
                        <th>금액</th>
                        <th>지점</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchaseItems.map(item => (
                        <tr key={item.id}>
                          <td className="text-sm">{new Date(item.ordered_at).toLocaleDateString('ko-KR')}</td>
                          <td className="font-medium">{item.product_name}</td>
                          <td>{item.quantity}</td>
                          <td>{item.unit_price.toLocaleString()}원</td>
                          <td className="font-semibold">{item.total_price.toLocaleString()}원</td>
                          <td className="text-slate-500">{item.branch_name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-center text-slate-400 py-8">구매 이력이 없습니다</p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'consultations' && (
            <div className="space-y-4">
              <div className="flex gap-2 items-center flex-wrap">
                <input
                  type="date"
                  value={consultDateRange.start}
                  onChange={(e) => handleDateFilterChange('consult', 'start', e.target.value)}
                  className="input w-36"
                />
                <span className="text-slate-400">~</span>
                <input
                  type="date"
                  value={consultDateRange.end}
                  onChange={(e) => handleDateFilterChange('consult', 'end', e.target.value)}
                  className="input w-36"
                />
                <button onClick={() => applyDateFilter('consult')} className="btn-secondary">
                  조회
                </button>
                <button 
                  onClick={() => {
                    const range = getDefaultDateRange();
                    setConsultDateRange(range);
                    setTimeout(() => fetchData(), 0);
                  }}
                  className="text-sm text-slate-500 hover:text-slate-700"
                >
                  초기화
                </button>
              </div>

              <button
                onClick={() => setShowConsultModal(true)}
                className="btn-primary"
              >
                + 상담 기록 추가
              </button>

              {consultations.length > 0 ? (
                <div className="space-y-3">
                  {consultations.map(consult => (
                    <div key={consult.id} className="card">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="font-medium">{consult.consultation_type}</span>
                          <span className="text-slate-400 mx-2">·</span>
                          <span className="text-sm text-slate-500">
                            {consult.consulted_by?.name || '시스템'}
                          </span>
                        </div>
                        <span className="text-xs text-slate-400">
                          {new Date(consult.created_at).toLocaleDateString('ko-KR')}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 whitespace-pre-wrap">
                        {consult.content?.text || JSON.stringify(consult.content)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="card text-center text-slate-400 py-8">
                  상담 기록이 없습니다
                </div>
              )}
            </div>
          )}

          {activeTab === 'info' && (
            <div className="card">
              <h3 className="font-semibold mb-4">추가 정보</h3>
              <p className="text-slate-500 text-sm">
                기본 정보 수정은 목록에서 "수정" 버튼을利用してください。
              </p>
            </div>
          )}
        </div>
      </div>

      {showConsultModal && (
        <ConsultModal
          onClose={() => setShowConsultModal(false)}
          onSubmit={handleAddConsultation}
        />
      )}

      {showAssignModal && (
        <AssignModal
          currentUserId={customer.assigned_to?.id}
          users={users}
          onClose={() => setShowAssignModal(false)}
          onSubmit={handleUpdateAssignedTo}
        />
      )}
    </div>
  );
}

function ConsultModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (type: string, content: string) => void }) {
  const [type, setType] = useState('전화 상담');
  const [content, setContent] = useState('');

  const handleSubmit = () => {
    if (!content.trim()) return;
    onSubmit(type, content);
  };

  const types = ['전화 상담', '방문 상담', '구매 상담', '민원 처리', '기타'];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">상담 기록 추가</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">상담 유형</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="input">
              {types.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">내용</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              className="input"
              placeholder="상담 내용을 입력하세요..."
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSubmit} className="flex-1 btn-primary">저장</button>
            <button onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssignModal({
  currentUserId,
  users,
  onClose,
  onSubmit,
}: {
  currentUserId?: string;
  users: User[];
  onClose: () => void;
  onSubmit: (userId: string | null) => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">담당자 지정</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => onSubmit(null)}
            className={`w-full text-left p-3 rounded-lg border ${
              !currentUserId ? 'border-blue-500 bg-blue-50' : 'border-slate-200'
            }`}
          >
            <span className="font-medium">담당자 없음</span>
          </button>
          {users.map(user => (
            <button
              key={user.id}
              onClick={() => onSubmit(user.id)}
              className={`w-full text-left p-3 rounded-lg border ${
                currentUserId === user.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200'
              }`}
            >
              <span className="font-medium">{user.name}</span>
            </button>
          ))}
        </div>

        <button onClick={onClose} className="w-full mt-4 btn-secondary">
          취소
        </button>
      </div>
    </div>
  );
}
