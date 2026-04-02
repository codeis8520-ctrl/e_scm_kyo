'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  createBranch, updateBranch, deleteBranch,
  createCustomerGrade, updateCustomerGrade, deleteCustomerGrade,
  createCustomerTag, updateCustomerTag, deleteCustomerTag,
  createCategory, updateCategory, deleteCategory,
  createUser, updateUser, deleteUser,
} from '@/lib/actions';
import { validators } from '@/lib/validators';

interface Branch {
  id: string;
  name: string;
  code: string;
  channel: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
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

interface NotificationTemplate {
  id: string;
  template_code: string;
  template_name: string;
  message_template: string;
  buttons: any[];
  is_active: boolean;
  created_at: string;
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

const SCREENS = [
  { path: '/', name: '대시보드' },
  { path: '/pos', name: 'POS' },
  { path: '/pos/manual', name: '수기 입력' },
  { path: '/products', name: '제품' },
  { path: '/production', name: '생산' },
  { path: '/inventory', name: '재고' },
  { path: '/customers', name: '고객' },
  { path: '/notifications', name: '알림' },
  { path: '/system-codes', name: '코드 관리' },
  { path: '/branches', name: '지점' },
  { path: '/reports', name: '보고서' },
];

interface ScreenPermission {
  id: string;
  role: string;
  screen_path: string;
  can_view: boolean;
  can_edit: boolean;
}

export default function SystemCodesPage() {
  const [activeTab, setActiveTab] = useState<'branches' | 'grades' | 'tags' | 'categories' | 'staff' | 'templates' | 'permissions'>('branches');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [grades, setGrades] = useState<CustomerGrade[]>([]);
  const [tags, setTags] = useState<CustomerTag[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [permissions, setPermissions] = useState<ScreenPermission[]>([]);
  const [loading, setLoading] = useState(true);

  const [showBranchModal, setShowBranchModal] = useState(false);
  const [showGradeModal, setShowGradeModal] = useState(false);
  const [showTagModal, setShowTagModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [editingGrade, setEditingGrade] = useState<CustomerGrade | null>(null);
  const [editingTag, setEditingTag] = useState<CustomerTag | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<NotificationTemplate | null>(null);

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    const supabase = createClient();

    if (activeTab === 'branches') {
      const { data } = await supabase.from('branches').select('*').order('created_at', { ascending: true });
      setBranches(data || []);
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
      const { data } = await supabase.from('users').select('*, branch:branches(name)').order('created_at', { ascending: false });
      setUsers((data || []) as User[]);
    } else if (activeTab === 'templates') {
      const { data } = await supabase.from('notification_templates').select('*').order('created_at', { ascending: false });
      setTemplates((data || []) as NotificationTemplate[]);
    } else if (activeTab === 'permissions') {
      const { data } = await supabase.from('screen_permissions').select('*').order('role', { ascending: true });
      setPermissions((data || []) as ScreenPermission[]);
    }

    setLoading(false);
  };

  const handleDeleteBranch = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await deleteBranch(id);
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
        <h1 className="text-2xl font-bold">시스템 코드 관리</h1>
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('branches')}
          className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'branches'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          지점 관리
        </button>
        <button
          onClick={() => setActiveTab('grades')}
          className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'grades'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          고객 등급
        </button>
        <button
          onClick={() => setActiveTab('tags')}
          className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'tags'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          고객 태그
        </button>
        <button
          onClick={() => setActiveTab('categories')}
          className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'categories'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          카테고리
        </button>
        <button
          onClick={() => setActiveTab('staff')}
          className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'staff'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          직원 관리
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'templates'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          알림톡 템플릿
        </button>
        <button
          onClick={() => setActiveTab('permissions')}
          className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'permissions'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          권한 관리
        </button>
      </div>

      {activeTab === 'branches' && (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">지점 목록</h3>
            <button
              onClick={() => { console.log('지점 추가 clicked'); setEditingBranch(null); setShowBranchModal(true); }}
              className="btn-primary"
            >
              + 지점 추가
            </button>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>지점코드</th>
                <th>지점명</th>
                <th>채널</th>
                <th>연락처</th>
                <th>주소</th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => (
                <tr key={branch.id}>
                  <td className="font-mono">{branch.code}</td>
                  <td className="font-medium">{branch.name}</td>
                  <td>
                    <span className={`badge ${CHANNEL_COLORS[branch.channel] || 'bg-slate-100'}`}>
                      {CHANNEL_OPTIONS.find(c => c.value === branch.channel)?.label || branch.channel}
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
                  <td colSpan={7} className="text-center text-slate-400 py-8">
                    등록된 지점이 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'grades' && (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">고객 등급 목록</h3>
            <button
              onClick={() => { setEditingGrade(null); setShowGradeModal(true); }}
              className="btn-primary"
            >
              + 등급 추가
            </button>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>코드</th>
                <th>등급명</th>
                <th>설명</th>
                <th>색상</th>
                <th>순서</th>
                <th>적립율</th>
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
      )}

      {activeTab === 'tags' && (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">고객 태그 목록</h3>
            <button
              onClick={() => { setEditingTag(null); setShowTagModal(true); }}
              className="btn-primary"
            >
              + 태그 추가
            </button>
          </div>

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
      )}

      {activeTab === 'categories' && (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">카테고리 목록</h3>
            <button
              onClick={() => { setEditingCategory(null); setShowCategoryModal(true); }}
              className="btn-primary"
            >
              + 카테고리 추가
            </button>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>카테고리명</th>
                <th>상위 카테고리</th>
                <th>정렬순서</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat.id}>
                  <td className="font-medium">{cat.name}</td>
                  <td className="text-slate-500">{cat.parent?.name || '-'}</td>
                  <td>{cat.sort_order}</td>
                  <td>
                    <button
                      onClick={() => { setEditingCategory(cat); setShowCategoryModal(true); }}
                      className="text-blue-600 hover:underline mr-2"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDeleteCategory(cat.id)}
                      className="text-red-600 hover:underline"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {categories.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-slate-400 py-8">
                    등록된 카테고리가 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'staff' && (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">직원 목록</h3>
            <button
              onClick={() => { setEditingUser(null); setShowUserModal(true); }}
              className="btn-primary"
            >
              + 직원 추가
            </button>
          </div>

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
      )}

      {activeTab === 'templates' && (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">알림톡 템플릿 목록</h3>
            <button
              onClick={() => { setEditingTemplate(null); setShowTemplateModal(true); }}
              className="btn-primary"
            >
              + 템플릿 추가
            </button>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>템플릿 코드</th>
                <th>템플릿명</th>
                <th>메시지 미리보기</th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id}>
                  <td className="font-mono text-sm">{template.template_code}</td>
                  <td>{template.template_name}</td>
                  <td className="max-w-xs text-sm truncate">{template.message_template}</td>
                  <td>
                    <span className={`badge ${template.is_active ? 'badge-success' : 'badge-error'}`}>
                      {template.is_active ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => { setEditingTemplate(template); setShowTemplateModal(true); }}
                      className="text-blue-600 hover:underline mr-2"
                    >
                      수정
                    </button>
                  </td>
                </tr>
              ))}
              {templates.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-slate-400 py-8">
                    등록된 템플릿이 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'permissions' && (
        <div className="card">
          <div className="mb-4">
            <h3 className="font-semibold">역할별 화면 권한</h3>
            <p className="text-sm text-slate-500 mt-1">
              각 역할이 접근할 수 있는 화면을 설정합니다
            </p>
          </div>

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
      )}

      {showBranchModal && (
        <>
          {console.log('Rendering BranchModal, showBranchModal:', showBranchModal, 'editingBranch:', editingBranch)}
          <BranchModal
            branch={editingBranch}
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
          onClose={() => setShowCategoryModal(false)}
          onSuccess={() => { setShowCategoryModal(false); fetchData(); }}
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

      {showTemplateModal && (
        <TemplateModal
          template={editingTemplate}
          onClose={() => setShowTemplateModal(false)}
          onSuccess={() => { setShowTemplateModal(false); fetchData(); }}
        />
      )}
    </div>
  );
}

function BranchModal({ branch, onClose, onSuccess }: { branch: Branch | null; onClose: () => void; onSuccess: () => void }) {
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
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
              {CHANNEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
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
              className="mt-1 input"
              placeholder="1.00"
            />
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
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
  onClose,
  onSuccess,
}: {
  category: Category | null;
  categories: Category[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    name: category?.name || '',
    parent_id: category?.parent_id || '',
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
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
          branch_id: formData.branch_id || null,
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
          branch_id: formData.branch_id || null,
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
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
            <label className="block text-sm font-medium text-gray-700">담당 지점</label>
            <select
              value={formData.branch_id}
              onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
              className="mt-1 input"
            >
              <option value="">없음 (본사)</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
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

function TemplateModal({ template, onClose, onSuccess }: { template: NotificationTemplate | null; onClose: () => void; onSuccess: () => void }) {
  const supabase = createClient();
  const [formData, setFormData] = useState({
    template_code: template?.template_code || '',
    template_name: template?.template_name || '',
    message_template: template?.message_template || '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const db = supabase as any;
      if (template?.id) {
        await db.from('notification_templates').update(formData).eq('id', template.id);
      } else {
        await db.from('notification_templates').insert({ ...formData, is_active: true });
      }
      onSuccess();
    } catch (err: any) {
      setError(err?.message || '오류가 발생했습니다.');
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!template?.id) return;
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await supabase.from('notification_templates').delete().eq('id', template.id);
    onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">{template?.id ? '템플릿 수정' : '템플릿 추가'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">템플릿 코드 *</label>
            <input
              type="text"
              value={formData.template_code}
              onChange={(e) => setFormData({ ...formData, template_code: e.target.value })}
              required
              disabled={!!template?.id}
              className="mt-1 input"
              placeholder="ORDER_COMPLETE"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">템플릿명 *</label>
            <input
              type="text"
              value={formData.template_name}
              onChange={(e) => setFormData({ ...formData, template_name: e.target.value })}
              required
              className="mt-1 input"
              placeholder="주문 완료 알림"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">메시지 템플릿 *</label>
            <textarea
              value={formData.message_template}
              onChange={(e) => setFormData({ ...formData, message_template: e.target.value })}
              required
              rows={6}
              className="mt-1 input"
              placeholder="{{customer_name}}님, 안녕하세요..."
            />
            <p className="text-xs text-slate-500 mt-1">
              변수: {'{{customer_name}}'}, {'{{product_name}}'}, {'{{amount}}'}, {'{{event_name}}'} 등
            </p>
          </div>

          <div className="flex gap-2 pt-4">
            <button type="submit" disabled={loading} className="flex-1 btn-primary">
              {loading ? '처리 중...' : (template?.id ? '수정' : '등록')}
            </button>
            {template?.id && (
              <button type="button" onClick={handleDelete} className="px-4 py-2 bg-red-100 text-red-600 rounded-md hover:bg-red-200">
                삭제
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
