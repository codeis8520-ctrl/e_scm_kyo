'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from '@/app/login/actions';
import { createClient } from '@/lib/supabase/client';
import AgentFloatingIcon from '@/components/AgentFloatingIcon';

// 사이드바 IA — 핵심 업무는 경옥채 실제 운영 흐름(#88) 순서로 그룹핑.
//   판매(출발점) → 재고·유통 → 생산 → 구매 = 제조업 표준의 역순. 판매전표 중심 설계.
//   group 키로 묶고, 그 아래 관리/기타(admin) 구분선.
const ALL_NAV_ITEMS = [
  // ── 핵심 업무 (판매 → 재고·유통 → 생산 → 구매 → 기준정보) ──
  { href: '/pos', label: '판매', icon: '💰', section: 'core', group: 'sales' },
  { href: '/daily-report', label: '판매일보', icon: '📝', section: 'core', group: 'sales' },
  { href: '/customers', label: '고객', icon: '👥', section: 'core', group: 'sales' },
  { href: '/inventory', label: '재고', icon: '🏪', section: 'core', group: 'stock' },
  { href: '/production', label: '생산', icon: '🏭', section: 'core', group: 'production' },
  { href: '/purchases', label: '구매', icon: '🚚', section: 'core', group: 'purchase' },
  { href: '/products', label: '제품', icon: '📦', section: 'core', group: 'master' },
  { href: '/accounting', label: '회계', icon: '📒', section: 'core', group: 'master' },
  // ── 관리/기타 ──
  { href: '/', label: '대시보드', icon: '📊', section: 'admin', group: 'admin' },
  { href: '/trade', label: '거래 관리', icon: '🤝', section: 'admin', group: 'admin' },
  { href: '/notifications', label: '알림', icon: '📱', section: 'admin', group: 'admin' },
  { href: '/system-codes', label: '코드', icon: '⚙️', section: 'admin', group: 'admin' },
  { href: '/reports', label: '보고서', icon: '📈', section: 'admin', group: 'admin' },
  { href: '/agent-memory', label: 'AI 메모리', icon: '🧠', section: 'admin', group: 'admin' },
  { href: '/agent-conversations', label: 'AI 대화 기록', icon: '💬', section: 'admin', group: 'admin' },
];

// 핵심 업무 그룹 — 운영 흐름 순서대로 라벨 표시(#88).
const CORE_GROUPS: { key: string; label: string }[] = [
  { key: 'sales', label: '판매' },
  { key: 'stock', label: '재고 · 유통' },
  { key: 'production', label: '생산' },
  { key: 'purchase', label: '구매' },
  { key: 'master', label: '기준정보 · 회계' },
];

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: '본부대표',
  HQ_OPERATOR: '본부운영자',
  PHARMACY_STAFF: '약사',
  BRANCH_STAFF: '지점직원',
  EXECUTIVE: '임원',
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('');
  const [navItems, setNavItems] = useState(ALL_NAV_ITEMS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUserInfo = async () => {
      const cookies = document.cookie.split(';').reduce((acc, cookie) => {
        const [key, value] = cookie.trim().split('=');
        acc[key] = decodeURIComponent(value || '');
        return acc;
      }, {} as Record<string, string>);
      
      const name = cookies.user_name || '';
      const role = cookies.user_role || '';
      
      setUserName(name);
      setUserRole(ROLE_LABELS[role] || role);

      if (role) {
        const supabase = createClient();
        const { data: permissions } = await supabase
          .from('screen_permissions')
          .select('screen_path, can_view')
          .eq('role', role)
          .eq('can_view', true);

        if (permissions) {
          const allowedPaths = new Set(permissions.map((p: any) => p.screen_path));
          const filtered = ALL_NAV_ITEMS.filter(item => allowedPaths.has(item.href));
          setNavItems(filtered);
        }
      }
      setLoading(false);
    };

    loadUserInfo();
  }, []);

  // 브라우저 탭 제목 — 현재 화면명 표시 (다중 탭 동시 작업 시 구분 용이)
  useEffect(() => {
    const match = [...ALL_NAV_ITEMS]
      .sort((a, b) => b.href.length - a.href.length)
      .find(i =>
        i.href === '/'
          ? pathname === '/'
          : pathname === i.href || pathname.startsWith(i.href + '/')
      );
    document.title = match ? `${match.label} · 경옥채` : '경옥채 사내 통합시스템';
  }, [pathname]);

  // 사이드바 링크 렌더 — 핵심/관리 2섹션(구분선). 모바일·데스크톱 공용.
  const renderNavLinks = (onNavigate?: () => void) => {
    const core = navItems.filter(i => i.section !== 'admin');
    const admin = navItems.filter(i => i.section === 'admin');
    const linkClass = (href: string) =>
      `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
        (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/'))
          ? 'bg-blue-600 text-white'
          : 'text-slate-300 hover:bg-slate-700 hover:text-white'
      }`;
    const renderItem = (i: typeof ALL_NAV_ITEMS[number]) => (
      <Link key={i.href} href={i.href} onClick={onNavigate} className={linkClass(i.href)}>
        <span className="text-lg">{i.icon}</span>
        <span className="text-sm font-medium">{i.label}</span>
      </Link>
    );
    return (
      <>
        {/* 핵심 업무 — 운영 흐름(판매→재고·유통→생산→구매→기준정보) 순 그룹 라벨 (#88) */}
        {CORE_GROUPS.map(g => {
          const items = core.filter(i => i.group === g.key);
          if (items.length === 0) return null;
          return (
            <div key={g.key} className="space-y-1">
              <p className="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-slate-500">{g.label}</p>
              {items.map(renderItem)}
            </div>
          );
        })}
        {admin.length > 0 && (
          <div className="pt-3 mt-2 border-t border-slate-700/70 space-y-1">
            <p className="px-3 pb-1 text-[10px] uppercase tracking-wider text-slate-500">관리 / 기타</p>
            {admin.map(renderItem)}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="flex min-h-screen">
      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 -ml-2 rounded-lg hover:bg-slate-100 lg:hidden"
              aria-label="메뉴"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {sidebarOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
            <img src="/CI.jpg" alt="경옥채" className="h-8 w-8 object-contain rounded" />
            <h1 className="text-lg font-bold text-slate-800">경옥채</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500 hidden sm:inline">
              {userName} ({userRole})
            </span>
            <button
              onClick={() => signOut()}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
              aria-label="로그아웃"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 z-50 h-full w-64 bg-slate-800 text-white
          transform transition-transform duration-200 ease-in-out
          lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex flex-col h-full">
          <div className="p-4 border-b border-slate-700">
            <div className="bg-white rounded-lg px-3 py-2 flex items-center justify-center shadow-sm">
              <img src="/CI.jpg" alt="경옥채" className="h-10 w-auto object-contain" />
            </div>
            <p className="text-xs text-slate-400 text-center mt-2 tracking-wide">사내 통합시스템</p>
          </div>

          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            {loading ? (
              <p className="text-slate-400 text-sm p-3">로딩중...</p>
            ) : (
              renderNavLinks(() => setSidebarOpen(false))
            )}
          </nav>

          <div className="p-3 border-t border-slate-700 space-y-2">
            {userName && (
              <div className="px-3 py-2 rounded-lg bg-slate-700/50 text-xs">
                <p className="font-medium text-white truncate">{userName}</p>
                <p className="text-slate-400">{userRole}</p>
              </div>
            )}
            <button
              onClick={() => signOut()}
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            >
              <span className="text-lg">🚪</span>
              <span className="text-sm font-medium">로그아웃</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Desktop sidebar (fixed for larger screens) */}
      <aside className="hidden lg:flex fixed top-0 left-0 z-30 h-full w-64 bg-slate-800 text-white flex-col">
        <div className="p-4 border-b border-slate-700">
          <div className="bg-white rounded-lg px-3 py-2 flex items-center justify-center shadow-sm">
            <img src="/CI.jpg" alt="경옥채" className="h-10 w-auto object-contain" />
          </div>
          <p className="text-xs text-slate-400 text-center mt-2 tracking-wide">사내 통합시스템</p>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {loading ? (
            <p className="text-slate-400 text-sm p-3">로딩중...</p>
          ) : (
            renderNavLinks()
          )}
        </nav>

        <div className="p-3 border-t border-slate-700 space-y-2">
          {userName && (
            <div className="px-3 py-2 rounded-lg bg-slate-700/50 text-xs">
              <p className="font-medium text-white truncate">{userName}</p>
              <p className="text-slate-400">{userRole}</p>
            </div>
          )}
          <button
            onClick={() => signOut()}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            <span className="text-lg">🚪</span>
            <span className="text-sm font-medium">로그아웃</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 lg:ml-64 min-h-screen bg-slate-50">
        {/* Mobile header spacer (모바일 상단 고정 헤더 보정) */}
        <div className="lg:hidden h-14" />

        {/* 데스크톱 페이지 제목은 사이드바 활성 메뉴로 갈음, 사용자 정보는 사이드바 하단으로 이동 */}
        <div className="px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>

      <AgentFloatingIcon />
    </div>
  );
}
