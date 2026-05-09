'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { generateQrDataUrl } from '@/lib/qr-actions';
import {
  createBranch, updateBranch, deleteBranch,
  createCustomerGrade, updateCustomerGrade, deleteCustomerGrade,
  createCustomerTag, updateCustomerTag, deleteCustomerTag,
  createCategory, updateCategory, deleteCategory,
  createUser, updateUser, deleteUser,
  createChannel, updateChannel, deleteChannel,
} from '@/lib/actions';
import { setHeadquarters, unsetHeadquarters } from '@/lib/oem-actions';
import { validators } from '@/lib/validators';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const map = document.cookie.split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    acc[k] = decodeURIComponent(v || '');
    return acc;
  }, {} as Record<string, string>);
  return map[name] || null;
}

interface Channel {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  is_active: boolean;
}

interface Branch {
  id: string;
  name: string;
  code: string;
  channel: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  is_headquarters?: boolean;
}

interface User {
  id: string;
  login_id: string;
  email: string;
  name: string;
  phone: string | null;
  role: string;
  branch_id: string | null;
  is_active: boolean;
  branch?: { name: string };
}

interface CustomerGrade {
  id: string;
  code: string;
  name: string;
  description: string | null;
  color: string;
  sort_order: number;
  is_active: boolean;
  point_rate: number;
  upgrade_threshold: number | null;
}

interface CustomerTag {
  id: string;
  name: string;
  description: string | null;
  color: string;
}

interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  parent?: { name: string } | null;
}

const CHANNEL_OPTIONS = [
  { value: 'STORE', label: '한약국' },
  { value: 'DEPT_STORE', label: '백화점' },
  { value: 'ONLINE', label: '자사몰' },
  { value: 'EVENT', label: '이벤트' },
];

const CHANNEL_COLORS: Record<string, string> = {
  STORE: 'bg-emerald-100 text-emerald-700',
  DEPT_STORE: 'bg-purple-100 text-purple-700',
  ONLINE: 'bg-blue-100 text-blue-700',
  EVENT: 'bg-amber-100 text-amber-700',
};

const ROLE_OPTIONS = [
  { value: 'SUPER_ADMIN', label: '본부 대표', description: '모든 권한' },
  { value: 'HQ_OPERATOR', label: '본부 운영자', description: '본부 업무' },
  { value: 'PHARMACY_STAFF', label: '약사', description: '한약국 직원' },
  { value: 'BRANCH_STAFF', label: '지점 직원', description: '지점 업무' },
  { value: 'EXECUTIVE', label: '임원', description: '경영진' },
];

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-red-100 text-red-700',
  HQ_OPERATOR: 'bg-purple-100 text-purple-700',
  PHARMACY_STAFF: 'bg-blue-100 text-blue-700',
  BRANCH_STAFF: 'bg-green-100 text-green-700',
  EXECUTIVE: 'bg-amber-100 text-amber-700',
};

// 좌측 네비게이션(layout.tsx ALL_NAV_ITEMS)과 동일 순서로 유지.
//   변경 시 layout.tsx 와 함께 갱신할 것.
const SCREENS = [
  { path: '/', name: '대시보드' },
  { path: '/pos', name: '판매관리' },
  { path: '/products', name: '제품' },
  { path: '/production', name: '생산' },
  { path: '/inventory', name: '재고' },
  { path: '/purchases', name: '매입' },
  { path: '/shipping', name: '배송' },
  { path: '/accounting', name: '회계' },
  { path: '/trade', name: '거래 관리' },
  { path: '/customers', name: '고객 관리' },
  { path: '/notifications', name: '알림' },
  { path: '/system-codes', name: '코드' },
  { path: '/reports', name: '보고서' },
  { path: '/agent-memory', name: 'AI 메모리' },
  { path: '/agent-conversations', name: 'AI 대화 기록' },
  // 좌측 nav에 직접 노출되지 않지만 라우트가 살아 있는 보조 화면
  { path: '/branches', name: '지점 (직접 URL)' },
];

interface ScreenPermission {
  id: string;
  role: string;
  screen_path: string;
  can_view: boolean;
  can_edit: boolean;
}

export default function SystemCodesPage() {
  const [activeTab, setActiveTab] = useState<'channels' | 'branches' | 'grades' | 'tags' | 'categories' | 'staff' | 'permissions' | 'campaign_types'>('channels');
  const [role] = useState<string | null>(() => getCookie('user_role'));
  const canConfigureHq = role === 'SUPER_ADMIN' || role === 'HQ_OPERATOR';
  const [channels, setChannels] = useState<Channel[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [grades, setGrades] = useState<CustomerGrade[]>([]);
  const [tags, setTags] = useState<CustomerTag[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [permissions, setPermissions] = useState<ScreenPermission[]>([]);
  const [campaignTypes, setCampaignTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [showChannelModal, setShowChannelModal] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [qrBranch, setQrBranch] = useState<Branch | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [showGradeModal, setShowGradeModal] = useState(false);
  const [showTagModal, setShowTagModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [categoryParentPreset, setCategoryParentPreset] = useState<string | null>(null);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<Set<string>>(new Set());
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [editingGrade, setEditingGrade] = useState<CustomerGrade | null>(null);
  const [editingTag, setEditingTag] = useState<CustomerTag | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    const supabase = createClient();

    if (activeTab === 'channels') {
      const { data } = await supabase.from('channels').select('*').order('sort_order');
      setChannels((data || []) as Channel[]);
    } else if (activeTab === 'branches') {
      const [branchesRes, channelsRes] = await Promise.all([
        supabase.from('branches').select('*').order('created_at', { ascending: true }),
        supabase.from('channels').select('*').order('sort_order'),
      ]);
      setBranches(branchesRes.data || []);
      setChannels((channelsRes.data || []) as Channel[]);
    } else if (activeTab === 'grades') {
      const { data } = await supabase.from('customer_grades').select('*').order('sort_order');
      setGrades(data || []);
    } else if (activeTab === 'tags') {
      const { data } = await supabase.from('customer_tags').select('*').order('created_at');
      setTags(data || []);
    } else if (activeTab === 'categories') {
      const { data } = await supabase.from('categories').select('*, parent:categories(name)').order('sort_order');
      setCategories(data || []);
    } else if (activeTab === 'staff') {
      const [{ data: usersData }, { data: branchesData }] = await Promise.all([
        supabase.from('users').select('*, branch:branches(name)').order('created_at', { ascending: false }),
        supabase.from('branches').select('*').eq('is_active', true).order('name'),
      ]);
      setUsers((usersData || []) as User[]);
      setBranches(branchesData || []);
    } else if (activeTab === 'campaign_types') {
      const { data } = await supabase.from('campaign_event_types').select('*').order('sort_order');
      setCampaignTypes(data || []);
    } else if (activeTab === 'permissions') {
      const { data } = await supabase.from('screen_permissions').select('*').order('role', { ascending: true });
      setPermissions((data || []) as ScreenPermission[]);
    }

    setLoading(false);
  };

  const handleDeleteChannel = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    const result = await deleteChannel(id);
    if (result?.error) {
      alert(result.error);
      return;
    }
    fetchData();
  };

  const handleDeleteBranch = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?\n\n※ 이 지점을 참조하는 직원·재고·판매전표 등이 있으면 삭제할 수 없습니다.\n   대신 지점 수정에서 "비활성"으로 전환해주세요.')) return;
    const result = await deleteBranch(id);
    if (result?.error) {
      alert(`삭제 실패: ${result.error}\n\n참조 데이터가 있는 지점은 삭제 대신 비활성으로 전환해야 합니다.`);
      return;
    }
    fetchData();
  };

  const handleToggleHq = async (b: Branch) => {
    if (!canConfigureHq) return;
    if (b.is_headquarters) {
      if (!confirm(`"${b.name}"을(를) 본사에서 해제하시겠습니까? 해제 시 생산 지시 기본 입고 지점이 비워집니다.`)) return;
      const r = await unsetHeadquarters(b.id);
      if (r.error) { alert(r.error); return; }
    } else {
      const current = branches.find(x => x.is_headquarters);
      const msg = current
        ? `현재 본사 "${current.name}"이 해제되고 "${b.name}"이 본사로 지정됩니다. 계속할까요?`
        : `"${b.name}"을(를) 본사로 지정할까요?`;
      if (!confirm(msg)) return;
      const r = await setHeadquarters(b.id);
      if (r.error) { alert(r.error); return; }
    }
    fetchData();
  };

  const handleDeleteGrade = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await deleteCustomerGrade(id);
    fetchData();
  };

  const handleDeleteTag = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await deleteCustomerTag(id);
    fetchData();
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await deleteCategory(id);
    fetchData();
  };

  const handleDeleteUser = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await deleteUser(id);
    fetchData();
  };

  const handlePermissionChange = async (role: string, screenPath: string, field: 'can_view' | 'can_edit', value: boolean) => {
    const supabase = createClient();
    const db = supabase as any;

    const existing = permissions.find(
      p => p.role === role && p.screen_path === screenPath
    );

    if (existing) {
      await db.from('screen_permissions').update({ [field]: value }).eq('id', existing.id);
    } else {
      await db.from('screen_permissions').insert({
        role,
        screen_path: screenPath,
        can_view: field === 'can_view' ? value : false,
        can_edit: field === 'can_edit' ? value : false,
      });
    }

    fetchData();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-xl sm:text-2xl font-bold">시스템 코드 관리</h1>
      </div>

      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        <button
          onClick={() => setActiveTab('channels')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
            activeTab === 'channels'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          채널 관리
        </button>
        <button
          onClick={() => setActiveTab('branches')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
            activeTab === 'branches'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          지점 관리
        </button>
        <button
          onClick={() => setActiveTab('grades')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
            activeTab === 'grades'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          고객 등급
        </button>
        <button
          onClick={() => setActiveTab('tags')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
            activeTab === 'tags'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          고객 태그
        </button>
        <button
          onClick={() => setActiveTab('categories')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
            activeTab === 'categories'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          카테고리
        </button>
        <button
          onClick={() => setActiveTab('staff')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
            activeTab === 'staff'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          직원 관리
        </button>
        <button
          onClick={() => setActiveTab('campaign_types')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
            activeTab === 'campaign_types'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          캠페인 유형
        </button>
        <button
          onClick={() => setActiveTab('permissions')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
            activeTab === 'permissions'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          권한 관리
        </button>
      </div>

      {activeTab === 'channels' && (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">채널 목록</h3>
            <button
              onClick={() => { setEditingChannel(null); setShowChannelModal(true); }}
              className="btn-primary text-sm"
            >
              + 채널 추가
            </button>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="table">
            <thead>
              <tr>
                <th>색상</th>
                <th>코드</th>
                <th>채널명</th>
                <th>정렬순서</th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((channel) => (
                <tr key={channel.id}>
                  <td>
                    <span
                      className="inline-block w-6 h-6 rounded-full border-2"
                      style={{ backgroundColor: channel.color }}
                    />
                  </td>
                  <td className="font-mono">{channel.id}</td>
                  <td className="font-medium">{channel.name}</td>
                  <td>{channel.sort_order}</td>
                  <td>
                    <span className={`badge ${channel.is_active ? 'badge-success' : 'badge-error'}`}>
                      {channel.is_active ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => { setEditingChannel(channel); setShowChannelModal(true); }}
                      className="text-blue-600 hover:underline mr-2"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDeleteChannel(channel.id)}
                      className="text-red-600 hover:underline"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {channels.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-slate-400 py-8">
                    등록된 채널이 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {activeTab === 'branches' && (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">지점 목록</h3>
            <button
              onClick={() => { setEditingBranch(null); setShowBranchModal(true); }}
              className="btn-primary text-sm"
            >
              + 지점 추가
            </button>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="table">
            <thead>
              <tr>
                <th>지점코드</th>
                <th>지점명</th>
                <th>채널</th>
                <th>연락처</th>
                <th>주소</th>
                <th>상태</th>
                <th>본사</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => (
                <tr key={branch.id}>
                  <td className="font-mono">{branch.code}</td>
                  <td className="font-medium">
                    {branch.name}
                    {branch.is_headquarters && <span className="ml-2 inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-700">본사</span>}
                  </td>
                  <td>
                    <span className="badge bg-slate-100">
                      {channels.find(c => c.id === branch.channel)?.name || branch.channel}
                    </span>
                  </td>
                  <td>{branch.phone || '-'}</td>
                  <td className="text-slate-500 text-sm max-w-xs truncate">{branch.address || '-'}</td>
                  <td>
                    <span className={`badge ${branch.is_active ? 'badge-success' : 'badge-error'}`}>
                      {branch.is_active ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td>
                    {canConfigureHq ? (
                      <button
                        onClick={() => handleToggleHq(branch)}
                        className={`text-xs px-2 py-1 rounded font-medium ${
                          branch.is_headquarters
                            ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                        title={branch.is_headquarters ? '본사 해제' : '본사로 지정'}
                      >
                        {branch.is_headquarters ? '본사 ✓' : '지정'}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">{branch.is_headquarters ? '본사' : '-'}</span>
                    )}
                  </td>
                  <td>
                    <button
                      onClick={async () => {
                        setQrBranch(branch);
                        setQrLoading(true);
                        setQrDataUrl('');
                        const url = `${window.location.origin}/join/${branch.id}`;
                        const res = await generateQrDataUrl(url, 512);
                        setQrDataUrl(res.dataUrl || '');
                        setQrLoading(false);
                      }}
                      className="text-emerald-600 hover:underline mr-2"
                      title="고객 셀프 가입 QR"
                    >
                      QR
                    </button>
                    <button
                      onClick={() => { setEditingBranch(branch); setShowBranchModal(true); }}
                      className="text-blue-600 hover:underline mr-2"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDeleteBranch(branch.id)}
                      className="text-red-600 hover:underline"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {branches.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-slate-400 py-8">
                    등록된 지점이 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>

          {/* QR 모달 */}
          {qrBranch && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white w-full max-w-md mx-auto max-h-[92vh] overflow-y-auto rounded-xl p-6">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-emerald-800">고객 셀프 가입 QR</h2>
                    <p className="text-sm text-slate-500 mt-0.5">{qrBranch.name}</p>
                  </div>
                  <button onClick={() => setQrBranch(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
                </div>
                {qrLoading ? (
                  <div className="py-20 text-center text-slate-400">QR 생성 중...</div>
                ) : qrDataUrl ? (
                  <>
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 text-center">
                      <img src={qrDataUrl} alt="가입 QR" className="mx-auto w-56 h-56" />
                      <p className="mt-4 text-xs text-slate-500">고객이 휴대폰 카메라로 스캔하여 가입</p>
                    </div>
                    <div className="mt-4">
                      <label className="text-xs text-slate-500 font-medium">가입 URL</label>
                      <div className="flex gap-2 mt-1">
                        <input
                          type="text"
                          value={`${window.location.origin}/join/${qrBranch.id}`}
                          readOnly
                          className="input text-xs font-mono flex-1"
                        />
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/join/${qrBranch.id}`);
                            alert('URL이 복사되었습니다.');
                          }}
                          className="px-3 py-1.5 rounded text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200"
                        >
                          복사
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-6">
                      <button
                        onClick={() => {
                          const link = document.createElement('a');
                          link.href = qrDataUrl;
                          link.download = `경옥채_${qrBranch.name}_가입QR.png`;
                          link.click();
                        }}
                        className="flex-1 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
                      >
                        📥 다운로드
                      </button>
                      <button
                        onClick={() => {
                          const w = window.open('', '_blank', 'width=600,height=800');
                          if (!w) return;
                          w.document.write(`<html><head><title>${qrBranch.name} 가입 QR</title><style>body{font-family:-apple-system,sans-serif;padding:40px;text-align:center}h1{color:#065f46;font-size:32px;margin-bottom:8px}h2{color:#059669;font-size:20px;font-weight:normal;margin-top:0}.qr{margin:32px auto}.qr img{border:2px solid #065f46;border-radius:12px;padding:16px;background:white}.guide{margin-top:24px;padding:20px;background:#ecfdf5;border-radius:12px;max-width:400px;margin-left:auto;margin-right:auto}.guide h3{margin:0 0 12px;color:#065f46}.guide ol{text-align:left;color:#475569;line-height:1.8}.footer{margin-top:32px;font-size:12px;color:#94a3b8}</style></head><body><h1>🌿 경옥채</h1><h2>${qrBranch.name} 회원 가입</h2><div class="qr"><img src="${qrDataUrl}" width="360"/></div><div class="guide"><h3>가입 방법</h3><ol><li>휴대폰 카메라로 QR 코드를 비춰주세요</li><li>링크를 눌러 가입 폼을 엽니다</li><li>이름과 휴대폰 번호를 입력합니다</li><li>가입 완료 후 직원에게 알려주세요</li></ol></div><div class="footer">구매 시 포인트 적립 · 생일 축하 혜택 · VIP 등급 제공</div><script>window.onload=()=>{setTimeout(()=>window.print(),300)}</script></body></html>`);
                          w.document.close();
                        }}
                        className="flex-1 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                      >
                        🖨️ 인쇄
                      </button>
                    </div>
                    <p className="text-xs text-slate-400 mt-4 text-center">인쇄 후 매장 계산대나 입구에 부착해주세요</p>
                  </>
                ) : (
                  <div className="py-10 text-center text-red-500">QR 생성 실패</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'grades' && (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">고객 등급 목록</h3>
            <button
              onClick={() => { setEditingGrade(null); setShowGradeModal(true); }}
              className="btn-primary text-sm"
            >
              + 등급 추가
            </button>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="table">
            <thead>
              <tr>
                <th>코드</th>
                <th>등급명</th>
                <th>설명</th>
                <th>색상</th>
                <th>순서</th>
                <th>적립율</th>
                <th>업그레이드 기준</th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {grades.map((grade) => (
                <tr key={grade.id}>
                  <td className="font-mono">
                    <span
                      className="inline-block w-3 h-3 rounded-full mr-2"
                      style={{ backgroundColor: grade.color }}
                    />
                    {grade.code}
                  </td>
                  <td className="font-medium">{grade.name}</td>
                  <td className="text-slate-500 text-sm">{grade.description || '-'}</td>
                  <td>
                    <span
                      className="inline-block px-2 py-1 rounded text-xs font-medium text-white"
                      style={{ backgroundColor: grade.color }}
                    >
                      {grade.color}
                    </span>
                  </td>
                  <td>{grade.sort_order}</td>
                  <td>{grade.point_rate}%</td>
                  <td className="text-sm">
                    {grade.upgrade_threshold != null
                      ? `${grade.upgrade_threshold.toLocaleString()}원↑`
                      : <span className="text-slate-400">-</span>}
                  </td>
                  <td>
                    <span className={`badge ${grade.is_active ? 'badge-success' : 'badge-error'}`}>
                      {grade.is_active ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => { setEditingGrade(grade); setShowGradeModal(true); }}
                      className="text-blue-600 hover:underline mr-2"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDeleteGrade(grade.id)}
                      className="text-red-600 hover:underline"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {grades.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-slate-400 py-8">
                    등록된 등급이 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {activeTab === 'tags' && (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">고객 태그 목록</h3>
            <button
              onClick={() => { setEditingTag(null); setShowTagModal(true); }}
              className="btn-primary text-sm"
            >
              + 태그 추가
            </button>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="table">
            <thead>
              <tr>
                <th>태그명</th>
                <th>설명</th>
                <th>색상</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => (
                <tr key={tag.id}>
                  <td className="font-medium">
                    <span
                      className="inline-block w-3 h-3 rounded-full mr-2"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </td>
                  <td className="text-slate-500 text-sm">{tag.description || '-'}</td>
                  <td>
                    <span
                      className="inline-block px-2 py-1 rounded text-xs font-medium text-white"
                      style={{ backgroundColor: tag.color }}
                    >
                      {tag.color}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => { setEditingTag(tag); setShowTagModal(true); }}
                      className="text-blue-600 hover:underline mr-2"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDeleteTag(tag.id)}
                      className="text-red-600 hover:underline"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {tags.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-slate-400 py-8">
                    등록된 태그가 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {activeTab === 'categories' && (() => {
        // ── 트리 빌드: parent_id로 그룹화 후 sort_order, name으로 정렬 ─────────
        type TreeNode = Category & { children: TreeNode[] };
        const byParent = new Map<string | null, TreeNode[]>();
        for (const c of categories) {
          const node: TreeNode = { ...c, children: [] };
          const key = c.parent_id || null;
          const list = byParent.get(key) || [];
          list.push(node);
          byParent.set(key, list);
        }
        const sortNodes = (arr: TreeNode[]) => {
          arr.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
          for (const n of arr) {
            n.children = byParent.get(n.id) || [];
            sortNodes(n.children);
          }
        };
        const roots = byParent.get(null) || [];
        sortNodes(roots);

        const toggleCollapse = (id: string) => {
          setCollapsedCategoryIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          });
        };

        // 재귀 렌더 — pathCode = [1-1-1] 형태로 위치 기반 자동 생성
        const renderRow = (node: TreeNode, parentCode: string, indexInSiblings: number, depth: number): React.ReactNode => {
          const code = parentCode ? `${parentCode}-${indexInSiblings + 1}` : String(indexInSiblings + 1);
          const hasChildren = node.children.length > 0;
          const isCollapsed = collapsedCategoryIds.has(node.id);
          return (
            <div key={node.id}>
              <div
                className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 hover:bg-slate-50 transition-colors"
                style={{ paddingLeft: `${12 + depth * 22}px` }}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggleCollapse(node.id)}
                    className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-700"
                    title={isCollapsed ? '펼치기' : '접기'}
                  >
                    <span className={`inline-block transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>▶</span>
                  </button>
                ) : (
                  <span className="w-5 h-5 inline-block" />
                )}
                <span className="text-[11px] font-mono text-slate-400 min-w-[60px]">[{code}]</span>
                <span className="text-sm font-medium text-slate-800 flex-1 truncate">{node.name}</span>
                <span className="text-[11px] text-slate-400">정렬 {node.sort_order}</span>
                <div className="flex gap-1.5 ml-2">
                  <button
                    onClick={() => {
                      setCategoryParentPreset(node.id);
                      setEditingCategory(null);
                      setShowCategoryModal(true);
                    }}
                    className="text-[11px] text-emerald-600 hover:underline"
                    title="이 카테고리 아래에 하위 카테고리 추가"
                  >+ 하위</button>
                  <button
                    onClick={() => { setCategoryParentPreset(null); setEditingCategory(node); setShowCategoryModal(true); }}
                    className="text-[11px] text-blue-600 hover:underline"
                  >수정</button>
                  <button
                    onClick={() => {
                      if (hasChildren) {
                        alert('하위 카테고리가 있어 삭제할 수 없습니다. 하위 항목을 먼저 정리해 주세요.');
                        return;
                      }
                      handleDeleteCategory(node.id);
                    }}
                    className="text-[11px] text-red-500 hover:underline"
                  >삭제</button>
                </div>
              </div>
              {!isCollapsed && hasChildren && (
                <div>
                  {node.children.map((child, i) => renderRow(child, code, i, depth + 1))}
                </div>
              )}
            </div>
          );
        };

        return (
          <div className="card">
            <div className="flex justify-between items-center mb-3">
              <div>
                <h3 className="font-semibold">품목 계층</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  대분류 → 중분류 → 소분류 형태로 트리 구성. 코드는 위치 기반으로 자동 표시됩니다 (예: [1-1-1]).
                </p>
              </div>
              <button
                onClick={() => { setCategoryParentPreset(null); setEditingCategory(null); setShowCategoryModal(true); }}
                className="btn-primary text-sm"
              >
                + 최상위 추가
              </button>
            </div>

            {/* 트리 본문 */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              {roots.length === 0 ? (
                <div className="text-center text-slate-400 py-12 text-sm">
                  등록된 카테고리가 없습니다. <span className="text-slate-300">"+ 최상위 추가"로 시작하세요.</span>
                </div>
              ) : (
                <div className="bg-white">
                  {roots.map((root, i) => renderRow(root, '', i, 0))}
                </div>
              )}
            </div>

            {roots.length > 0 && (
              <p className="mt-3 text-[11px] text-slate-400">
                ※ 같은 단계에서는 "정렬" 값이 작은 항목이 위에 오고, 같으면 이름 가나다순. 정렬 변경은 수정 버튼에서.
              </p>
            )}
          </div>
        );
      })()}

      {activeTab === 'staff' && (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">직원 목록</h3>
            <button
              onClick={() => { setEditingUser(null); setShowUserModal(true); }}
              className="btn-primary text-sm"
            >
              + 직원 추가
            </button>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="table">
            <thead>
              <tr>
                <th>이름</th>
                <th>이메일</th>
                <th>역할</th>
                <th>담당 지점</th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="font-medium">{user.name}</td>
                  <td className="text-slate-500">{user.email}</td>
                  <td>
                    <span className={`badge ${ROLE_COLORS[user.role] || 'bg-slate-100'}`}>
                      {ROLE_OPTIONS.find(r => r.value === user.role)?.label || user.role}
                    </span>
                  </td>
                  <td>{user.branch?.name || '-'}</td>
                  <td>
                    <span className={`badge ${user.is_active ? 'badge-success' : 'badge-error'}`}>
                      {user.is_active ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => { setEditingUser(user); setShowUserModal(true); }}
                      className="text-blue-600 hover:underline mr-2"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDeleteUser(user.id)}
                      className="text-red-600 hover:underline"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-slate-400 py-8">
                    등록된 직원이 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {activeTab === 'campaign_types' && (
        <CampaignEventTypeManager
          data={campaignTypes}
          loading={loading}
          onRefresh={fetchData}
        />
      )}

      {activeTab === 'permissions' && (
        <div className="card">
          <div className="mb-4">
            <h3 className="font-semibold">역할별 화면 권한</h3>
            <p className="text-sm text-slate-500 mt-1">
              각 역할이 접근할 수 있는 화면을 설정합니다
            </p>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="table">
            <thead>
              <tr>
                <th>화면</th>
                {ROLE_OPTIONS.map(role => (
                  <th key={role.value} className="text-center">
                    <div className="flex flex-col items-center">
                      <span>{role.label}</span>
                      <span className="text-xs font-normal text-slate-400">{role.value}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SCREENS.map(screen => (
                <tr key={screen.path}>
                  <td className="font-medium">
                    <div>
                      <p>{screen.name}</p>
                      <p className="text-xs text-slate-400">{screen.path}</p>
                    </div>
                  </td>
                  {ROLE_OPTIONS.map(role => {
                    const perm = permissions.find(
                      p => p.role === role.value && p.screen_path === screen.path
                    );
                    return (
                      <td key={role.value} className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <input
                            type="checkbox"
                            checked={perm?.can_view ?? false}
                            onChange={(e) => handlePermissionChange(role.value, screen.path, 'can_view', e.target.checked)}
                            className="rounded"
                          />
                          <span className="text-xs text-slate-400">보기</span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {showChannelModal && (
        <ChannelModal
          channel={editingChannel}
          onClose={() => setShowChannelModal(false)}
          onSuccess={() => { setShowChannelModal(false); fetchData(); }}
        />
      )}

      {showBranchModal && (
        <>
          <BranchModal
            branch={editingBranch}
            channels={channels}
            onClose={() => setShowBranchModal(false)}
            onSuccess={() => { setShowBranchModal(false); fetchData(); }}
          />
        </>
      )}

      {showGradeModal && (
        <GradeModal
          grade={editingGrade}
          onClose={() => setShowGradeModal(false)}
          onSuccess={() => { setShowGradeModal(false); fetchData(); }}
        />
      )}

      {showTagModal && (
        <TagModal
          tag={editingTag}
          onClose={() => setShowTagModal(false)}
          onSuccess={() => { setShowTagModal(false); fetchData(); }}
        />
      )}

      {showCategoryModal && (
        <CategoryModal
          category={editingCategory}
          categories={categories}
          presetParentId={categoryParentPreset}
          onClose={() => { setShowCategoryModal(false); setCategoryParentPreset(null); }}
          onSuccess={() => { setShowCategoryModal(false); setCategoryParentPreset(null); fetchData(); }}
        />
      )}

      {showUserModal && (
        <UserModal
          user={editingUser}
          branches={branches}
          onClose={() => setShowUserModal(false)}
          onSuccess={() => { setShowUserModal(false); fetchData(); }}
        />
      )}

    </div>
  );
}

function ChannelModal({ channel, onClose, onSuccess }: { channel: Channel | null; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    name: channel?.name || '',
    color: channel?.color || '#6366f1',
    sort_order: channel?.sort_order || 0,
    is_active: channel?.is_active ?? true,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setFieldErrors({});

    const errors: Record<string, string> = {};
    const nameError = validators.required(formData.name, '채널명');
    if (nameError) errors.name = nameError;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setLoading(false);
      return;
    }

    const form = new FormData();
    Object.entries(formData).forEach(([key, value]) => {
      form.append(key, String(value));
    });

    const result = channel
      ? await updateChannel(channel.id, form)
      : await createChannel(form);

    if (result?.error) {
      setError(result.error);
      setLoading(false);
    } else {
      onSuccess();
    }
  };

  const presetColors = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#f97316'];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">{channel ? '채널 수정' : '채널 추가'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {channel && (
            <div>
              <label className="block text-sm font-medium text-gray-700">코드</label>
              <input type="text" value={channel.id} disabled className="mt-1 input bg-slate-100 text-slate-500" />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700">채널명 *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => { setFormData({ ...formData, name: e.target.value }); setFieldErrors({ ...fieldErrors, name: '' }); }}
              placeholder="한약국"
              className={`mt-1 input ${fieldErrors.name ? 'border-red-500' : ''}`}
            />
            {fieldErrors.name && <p className="mt-1 text-xs text-red-500">{fieldErrors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">색상</label>
            <div className="flex gap-2 mt-1">
              {presetColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setFormData({ ...formData, color })}
                  className={`w-8 h-8 rounded-full border-2 ${formData.color === color ? 'border-slate-800' : 'border-transparent'}`}
                  style={{ backgroundColor: color }}
                />
              ))}
              <input
                type="color"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">정렬순서</label>
            <input
              type="number"
              value={formData.sort_order}
              onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
              onFocus={(e) => e.target.select()}
              min="0"
              className="mt-1 input"
            />
          </div>

          {channel && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              />
              <label htmlFor="is_active" className="text-sm text-gray-700">활성 상태</label>
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <button type="submit" disabled={loading} className="flex-1 btn-primary">
              {loading ? '처리 중...' : (channel ? '수정' : '추가')}
            </button>
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BranchModal({ branch, channels, onClose, onSuccess }: { branch: Branch | null; channels: Channel[]; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    name: branch?.name || '',
    channel: branch?.channel || 'STORE',
    address: branch?.address || '',
    phone: branch?.phone || '',
    is_active: branch?.is_active ?? true,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setFieldErrors({});

    const errors: Record<string, string> = {};
    const nameError = validators.required(formData.name, '지점명');
    if (nameError) errors.name = nameError;
    if (formData.phone) {
      const phoneError = validators.phone(formData.phone);
      if (phoneError) errors.phone = phoneError;
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setLoading(false);
      return;
    }

    const form = new FormData();
    Object.entries(formData).forEach(([key, value]) => {
      form.append(key, String(value));
    });

    const result = branch
      ? await updateBranch(branch.id, form)
      : await createBranch(form);

    if (result?.error) {
      setError(result.error);
      setLoading(false);
    } else {
      onSuccess();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">{branch ? '지점 수정' : '지점 추가'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">지점명 *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => { setFormData({ ...formData, name: e.target.value }); setFieldErrors({ ...fieldErrors, name: '' }); }}
              className={`mt-1 input ${fieldErrors.name ? 'border-red-500' : ''}`}
            />
            {fieldErrors.name && <p className="mt-1 text-xs text-red-500">{fieldErrors.name}</p>}
          </div>

          {branch && (
            <div>
              <label className="block text-sm font-medium text-gray-700">지점코드</label>
              <input type="text" value={branch.code} disabled className="mt-1 input bg-slate-50 text-slate-500" />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700">채널 *</label>
            <select
              value={formData.channel}
              onChange={(e) => setFormData({ ...formData, channel: e.target.value })}
              className="mt-1 input"
            >
              <option value="">채널 선택</option>
              {channels.map((ch) => (
                <option key={ch.id} value={ch.id}>{ch.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">연락처</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => { setFormData({ ...formData, phone: e.target.value }); setFieldErrors({ ...fieldErrors, phone: '' }); }}
              placeholder="02-1234-5678"
              className={`mt-1 input ${fieldErrors.phone ? 'border-red-500' : ''}`}
            />
            {fieldErrors.phone && <p className="mt-1 text-xs text-red-500">{fieldErrors.phone}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">주소</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="mt-1 input"
            />
          </div>

          {branch && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              />
              <label htmlFor="is_active" className="text-sm text-gray-700">활성 상태</label>
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <button type="submit" disabled={loading} className="flex-1 btn-primary">
              {loading ? '처리 중...' : (branch ? '수정' : '추가')}
            </button>
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function GradeModal({ grade, onClose, onSuccess }: { grade: CustomerGrade | null; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    code: grade?.code || '',
    name: grade?.name || '',
    description: grade?.description || '',
    color: grade?.color || '#6366f1',
    sort_order: grade?.sort_order || 0,
    is_active: grade?.is_active ?? true,
    point_rate: grade?.point_rate || 1.00,
    upgrade_threshold: grade?.upgrade_threshold ?? '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setFieldErrors({});

    const errors: Record<string, string> = {};
    const codeError = validators.required(formData.code, '등급코드');
    if (codeError) errors.code = codeError;
    const nameError = validators.required(formData.name, '등급명');
    if (nameError) errors.name = nameError;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setLoading(false);
      return;
    }

    const form = new FormData();
    Object.entries(formData).forEach(([key, value]) => {
      form.append(key, String(value));
    });

    const result = grade
      ? await updateCustomerGrade(grade.id, form)
      : await createCustomerGrade(form);

    if (result?.error) {
      setError(result.error);
      setLoading(false);
    } else {
      onSuccess();
    }
  };

  const presetColors = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#94a3b8'];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">{grade ? '등급 수정' : '등급 추가'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">등급코드 *</label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => { setFormData({ ...formData, code: e.target.value.toUpperCase() }); setFieldErrors({ ...fieldErrors, code: '' }); }}
                placeholder="VIP"
                className={`mt-1 input ${fieldErrors.code ? 'border-red-500' : ''}`}
              />
              {fieldErrors.code && <p className="mt-1 text-xs text-red-500">{fieldErrors.code}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">정렬순서</label>
              <input
                type="number"
                value={formData.sort_order}
                onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
                onFocus={(e) => e.target.select()}
                min="0"
                className="mt-1 input"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">등급명 *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => { setFormData({ ...formData, name: e.target.value }); setFieldErrors({ ...fieldErrors, name: '' }); }}
              placeholder="VIP 고객"
              className={`mt-1 input ${fieldErrors.name ? 'border-red-500' : ''}`}
            />
            {fieldErrors.name && <p className="mt-1 text-xs text-red-500">{fieldErrors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">설명</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="mt-1 input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">색상</label>
            <div className="flex gap-2 mt-1">
              {presetColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setFormData({ ...formData, color })}
                  className={`w-8 h-8 rounded-full border-2 ${formData.color === color ? 'border-slate-800' : 'border-transparent'}`}
                  style={{ backgroundColor: color }}
                />
              ))}
              <input
                type="color"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">적립율 (%)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={formData.point_rate}
              onChange={(e) => setFormData({ ...formData, point_rate: parseFloat(e.target.value) || 0 })}
              onFocus={(e) => e.target.select()}
              className="mt-1 input"
              placeholder="1.00"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">자동 업그레이드 기준 누적 구매액 (원)</label>
            <input
              type="number"
              min="0"
              step="10000"
              value={formData.upgrade_threshold}
              onChange={(e) => setFormData({ ...formData, upgrade_threshold: e.target.value })}
              onFocus={(e) => e.target.select()}
              className="mt-1 input"
              placeholder="미설정 시 자동 업그레이드 없음"
            />
            <p className="mt-1 text-xs text-slate-400">비워두면 자동 업그레이드 대상에서 제외됩니다 (예: 일반 등급)</p>
          </div>

          {grade && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              />
              <label htmlFor="is_active" className="text-sm text-gray-700">활성 상태</label>
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <button type="submit" disabled={loading} className="flex-1 btn-primary">
              {loading ? '처리 중...' : (grade ? '수정' : '추가')}
            </button>
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TagModal({ tag, onClose, onSuccess }: { tag: CustomerTag | null; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    name: tag?.name || '',
    description: tag?.description || '',
    color: tag?.color || '#6366f1',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setFieldErrors({});

    const errors: Record<string, string> = {};
    const nameError = validators.required(formData.name, '태그명');
    if (nameError) errors.name = nameError;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setLoading(false);
      return;
    }

    const form = new FormData();
    Object.entries(formData).forEach(([key, value]) => {
      form.append(key, String(value));
    });

    const result = tag
      ? await updateCustomerTag(tag.id, form)
      : await createCustomerTag(form);

    if (result?.error) {
      setError(result.error);
      setLoading(false);
    } else {
      onSuccess();
    }
  };

  const presetColors = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#84cc16', '#f97316'];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">{tag ? '태그 수정' : '태그 추가'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">태그명 *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => { setFormData({ ...formData, name: e.target.value }); setFieldErrors({ ...fieldErrors, name: '' }); }}
              placeholder="행사참여"
              className={`mt-1 input ${fieldErrors.name ? 'border-red-500' : ''}`}
            />
            {fieldErrors.name && <p className="mt-1 text-xs text-red-500">{fieldErrors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">설명</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="mt-1 input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">색상</label>
            <div className="flex gap-2 mt-1 flex-wrap">
              {presetColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setFormData({ ...formData, color })}
                  className={`w-8 h-8 rounded-full border-2 ${formData.color === color ? 'border-slate-800' : 'border-transparent'}`}
                  style={{ backgroundColor: color }}
                />
              ))}
              <input
                type="color"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <button type="submit" disabled={loading} className="flex-1 btn-primary">
              {loading ? '처리 중...' : (tag ? '수정' : '추가')}
            </button>
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CategoryModal({
  category,
  categories,
  presetParentId,
  onClose,
  onSuccess,
}: {
  category: Category | null;
  categories: Category[];
  presetParentId?: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    name: category?.name || '',
    parent_id: category?.parent_id || presetParentId || '',
    sort_order: category?.sort_order || 0,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setFieldErrors({});

    const errors: Record<string, string> = {};
    const nameError = validators.required(formData.name, '카테고리명');
    if (nameError) errors.name = nameError;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setLoading(false);
      return;
    }

    const form = new FormData();
    Object.entries(formData).forEach(([key, value]) => {
      form.append(key, String(value));
    });

    const result = category
      ? await updateCategory(category.id, form)
      : await createCategory(form);

    if (result?.error) {
      setError(result.error);
      setLoading(false);
    } else {
      onSuccess();
    }
  };

  const parentCategories = categories.filter((c) => c.id !== category?.id);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">{category ? '카테고리 수정' : '카테고리 추가'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">카테고리명 *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => { setFormData({ ...formData, name: e.target.value }); setFieldErrors({ ...fieldErrors, name: '' }); }}
              placeholder="한방식품"
              className={`mt-1 input ${fieldErrors.name ? 'border-red-500' : ''}`}
            />
            {fieldErrors.name && <p className="mt-1 text-xs text-red-500">{fieldErrors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">상위 카테고리</label>
            <select
              value={formData.parent_id}
              onChange={(e) => setFormData({ ...formData, parent_id: e.target.value })}
              className="mt-1 input"
            >
              <option value="">없음 (최상위)</option>
              {parentCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">정렬순서</label>
            <input
              type="number"
              value={formData.sort_order}
              onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
              onFocus={(e) => e.target.select()}
              min="0"
              className="mt-1 input"
            />
          </div>

          <div className="flex gap-2 pt-4">
            <button type="submit" disabled={loading} className="flex-1 btn-primary">
              {loading ? '처리 중...' : (category ? '수정' : '추가')}
            </button>
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function UserModal({
  user,
  branches,
  onClose,
  onSuccess,
}: {
  user: User | null;
  branches: Branch[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    login_id: (user as any)?.login_id || '',
    password: '',
    name: user?.name || '',
    phone: user?.phone || '',
    role: user?.role || 'BRANCH_STAFF',
    branch_id: user?.branch_id || '',
    is_active: user?.is_active ?? true,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setFieldErrors({});

    const errors: Record<string, string> = {};
    const loginIdError = validators.required(formData.login_id, '아이디');
    if (loginIdError) errors.login_id = loginIdError;

    const nameError = validators.required(formData.name, '이름');
    if (nameError) errors.name = nameError;

    // 담당 지점 필수 — 본사도 별도 지점(is_headquarters=true)으로 등록되어 있어야 함.
    //   기존에 branch_id=null로 두던 관리자는 본사 지점을 선택하도록 유도.
    if (!formData.branch_id) {
      errors.branch_id = '담당 지점을 선택하세요 (본사 직원은 본사 지점을 선택)';
    }

    if (!user) {
      const passwordError = validators.required(formData.password, '비밀번호');
      if (passwordError) errors.password = passwordError;
      else if (formData.password.length < 6) {
        errors.password = '비밀번호는 6자 이상이어야 합니다';
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setLoading(false);
      return;
    }

    try {
      const db = supabase as any;
      if (user) {
        // 수정 모드
        const { error: updateError } = await db.from('users').update({
          name: formData.name,
          phone: formData.phone || null,
          role: formData.role,
          branch_id: formData.branch_id,
          is_active: formData.is_active,
        }).eq('id', user.id);

        if (updateError) throw updateError;
      } else {
        // 추가 모드 - login_id 사용
        // SHA256으로 비밀번호 해싱
        const hashPassword = (pwd: string) => {
          const crypto = require('crypto');
          return crypto.createHash('sha256').update(pwd).digest('hex');
        };

        const { error: insertError } = await db.from('users').insert({
          login_id: formData.login_id,
          email: `${formData.login_id}@kyo.local`,
          password_hash: hashPassword(formData.password),
          name: formData.name,
          phone: formData.phone || null,
          role: formData.role,
          branch_id: formData.branch_id,
          is_active: formData.is_active,
        });

        if (insertError) throw insertError;
      }
      onSuccess();
    } catch (err: any) {
      setError(err?.message || '오류가 발생했습니다.');
    }

    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">{user ? '직원 수정' : '직원 추가'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              {user ? '아이디' : '아이디 *'}
            </label>
            <input
              type="text"
              value={formData.login_id}
              onChange={(e) => { setFormData({ ...formData, login_id: e.target.value }); setFieldErrors({ ...fieldErrors, login_id: '' }); }}
              disabled={!!user}
              placeholder="로그인할 아이디"
              className={`mt-1 input ${fieldErrors.login_id ? 'border-red-500' : ''}`}
            />
            {fieldErrors.login_id && <p className="mt-1 text-xs text-red-500">{fieldErrors.login_id}</p>}
          </div>

          {!user && (
            <div>
              <label className="block text-sm font-medium text-gray-700">비밀번호 *</label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => { setFormData({ ...formData, password: e.target.value }); setFieldErrors({ ...fieldErrors, password: '' }); }}
                placeholder="6자 이상"
                className={`mt-1 input ${fieldErrors.password ? 'border-red-500' : ''}`}
              />
              {fieldErrors.password && <p className="mt-1 text-xs text-red-500">{fieldErrors.password}</p>}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700">이름 *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => { setFormData({ ...formData, name: e.target.value }); setFieldErrors({ ...fieldErrors, name: '' }); }}
              className={`mt-1 input ${fieldErrors.name ? 'border-red-500' : ''}`}
            />
            {fieldErrors.name && <p className="mt-1 text-xs text-red-500">{fieldErrors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">연락처</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="010-0000-0000"
              className="mt-1 input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">역할 *</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              className="mt-1 input"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} ({opt.description})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">담당 지점 *</label>
            <select
              value={formData.branch_id}
              onChange={(e) => { setFormData({ ...formData, branch_id: e.target.value }); setFieldErrors({ ...fieldErrors, branch_id: '' }); }}
              className={`mt-1 input ${fieldErrors.branch_id ? 'border-red-500' : ''}`}
            >
              <option value="" disabled>지점을 선택하세요</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}{(branch as any).is_headquarters ? ' (본사)' : ''}
                </option>
              ))}
            </select>
            {fieldErrors.branch_id && <p className="mt-1 text-xs text-red-500">{fieldErrors.branch_id}</p>}
            <p className="mt-1 text-[11px] text-slate-400">
              본사 소속 직원도 반드시 본사 지점을 선택해야 합니다.
            </p>
          </div>

          {user && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              />
              <label htmlFor="is_active" className="text-sm text-gray-700">활성 상태</label>
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <button type="submit" disabled={loading} className="flex-1 btn-primary">
              {loading ? '처리 중...' : (user ? '수정' : '추가')}
            </button>
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 캠페인 이벤트 유형 관리
// ═══════════════════════════════════════════════════════════════════════

function CampaignEventTypeManager({ data, loading, onRefresh }: { data: any[]; loading: boolean; onRefresh: () => void }) {
  const supabase = createClient() as any;
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ code: '', name: '', emoji: '📢', is_recurring_default: false, default_month: '', default_day: '', default_duration_days: '7', sort_order: '0' });
  const [saving, setSaving] = useState(false);

  const resetForm = (item?: any) => {
    if (item) {
      setForm({
        code: item.code, name: item.name, emoji: item.emoji || '📢',
        is_recurring_default: item.is_recurring_default ?? false,
        default_month: item.default_month ? String(item.default_month) : '',
        default_day: item.default_day ? String(item.default_day) : '',
        default_duration_days: String(item.default_duration_days || 7),
        sort_order: String(item.sort_order || 0),
      });
      setEditing(item);
    } else {
      setForm({ code: '', name: '', emoji: '📢', is_recurring_default: false, default_month: '', default_day: '', default_duration_days: '7', sort_order: '0' });
      setEditing(null);
    }
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code || !form.name) return;
    setSaving(true);
    const row = {
      code: form.code.toUpperCase().replace(/[^A-Z0-9_]/g, ''),
      name: form.name,
      emoji: form.emoji || '📢',
      is_recurring_default: form.is_recurring_default,
      default_month: form.default_month ? parseInt(form.default_month) : null,
      default_day: form.default_day ? parseInt(form.default_day) : null,
      default_duration_days: parseInt(form.default_duration_days) || 7,
      sort_order: parseInt(form.sort_order) || 0,
      is_active: true,
    };
    if (editing) {
      await supabase.from('campaign_event_types').update(row).eq('code', editing.code);
    } else {
      const { error } = await supabase.from('campaign_event_types').insert(row);
      if (error) { alert(error.message); setSaving(false); return; }
    }
    setSaving(false);
    setShowForm(false);
    onRefresh();
  };

  const handleToggle = async (code: string, active: boolean) => {
    await supabase.from('campaign_event_types').update({ is_active: !active }).eq('code', code);
    onRefresh();
  };

  const handleDelete = async (code: string) => {
    if (!confirm(`"${code}" 이벤트 유형을 삭제하시겠습니까?`)) return;
    await supabase.from('campaign_event_types').delete().eq('code', code);
    onRefresh();
  };

  return (
    <div className="card">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="font-semibold">캠페인 이벤트 유형</h3>
          <p className="text-xs text-slate-500 mt-1">캠페인 생성 시 선택할 이벤트 유형을 관리합니다.</p>
        </div>
        <button onClick={() => resetForm()} className="btn-primary text-sm">+ 유형 추가</button>
      </div>

      {loading ? (
        <div className="py-8 text-center text-slate-400">로딩 중...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>아이콘</th>
                <th>코드</th>
                <th>유형명</th>
                <th>매년 반복</th>
                <th>기본 월/일</th>
                <th>기간(일)</th>
                <th>순서</th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {data.map(t => (
                <tr key={t.code} className={!t.is_active ? 'opacity-50' : ''}>
                  <td className="text-lg">{t.emoji}</td>
                  <td className="font-mono text-sm">{t.code}</td>
                  <td className="font-medium">{t.name}</td>
                  <td>{t.is_recurring_default ? '✅' : '-'}</td>
                  <td className="text-sm">{t.default_month ? `${t.default_month}월 ${t.default_day || ''}일` : '-'}</td>
                  <td className="text-sm">{t.default_duration_days || '-'}일</td>
                  <td className="text-sm">{t.sort_order}</td>
                  <td>
                    <span className={`badge text-xs ${t.is_active ? 'badge-success' : 'badge-error'}`}>
                      {t.is_active ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => resetForm(t)} className="text-blue-600 hover:underline mr-2 text-sm">수정</button>
                    <button onClick={() => handleToggle(t.code, t.is_active)} className="text-amber-600 hover:underline mr-2 text-sm">
                      {t.is_active ? '비활성' : '활성'}
                    </button>
                    <button onClick={() => handleDelete(t.code)} className="text-red-600 hover:underline text-sm">삭제</button>
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr><td colSpan={9} className="text-center text-slate-400 py-8">등록된 이벤트 유형이 없습니다</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-md mx-auto rounded-xl p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">{editing ? '유형 수정' : '유형 추가'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-1">
                  <label className="block text-xs font-medium mb-1">아이콘</label>
                  <input value={form.emoji} onChange={e => setForm({ ...form, emoji: e.target.value })} className="input text-center text-lg" maxLength={4} />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs font-medium mb-1">유형명 *</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required className="input" placeholder="추석" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">코드 * <span className="text-slate-400">(영문 대문자+숫자+_)</span></label>
                <input
                  value={form.code}
                  onChange={e => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
                  required disabled={!!editing} className="input font-mono" placeholder="CHUSEOK"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">기본 월</label>
                  <input type="number" min={1} max={12} value={form.default_month} onChange={e => setForm({ ...form, default_month: e.target.value })} className="input" placeholder="9" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">기본 일</label>
                  <input type="number" min={1} max={31} value={form.default_day} onChange={e => setForm({ ...form, default_day: e.target.value })} className="input" placeholder="10" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">기간(일)</label>
                  <input type="number" min={1} value={form.default_duration_days} onChange={e => setForm({ ...form, default_duration_days: e.target.value })} className="input" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">정렬 순서</label>
                  <input type="number" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: e.target.value })} className="input" />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.is_recurring_default} onChange={e => setForm({ ...form, is_recurring_default: e.target.checked })} className="w-4 h-4" />
                    <span className="text-sm">매년 반복 기본값</span>
                  </label>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={saving} className="flex-1 btn-primary">{saving ? '저장 중...' : editing ? '수정' : '추가'}</button>
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 btn-secondary">취소</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
