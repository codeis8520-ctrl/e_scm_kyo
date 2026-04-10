'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from '@/app/login/actions';
import { createClient } from '@/lib/supabase/client';
import AgentFloatingIcon from '@/components/AgentFloatingIcon';

const ALL_NAV_ITEMS = [
  { href: '/', label: '대시보드', icon: '📊' },
  { href: '/pos', label: 'POS', icon: '💰' },
  { href: '/products', label: '제품', icon: '📦' },
  { href: '/production', label: '생산', icon: '🏭' },
  { href: '/inventory', label: '재고', icon: '🏪' },
  { href: '/purchases', label: '매입', icon: '🚚' },
  { href: '/shipping', label: '배송', icon: '📫' },
  { href: '/accounting', label: '회계', icon: '📒' },
  { href: '/trade', label: '거래 관리', icon: '🤝' },
  { href: '/customers', label: '고객 관리', icon: '👥' },
  { href: '/notifications', label: '알림', icon: '📱' },
  { href: '/system-codes', label: '코드', icon: '⚙️' },
  { href: '/reports', label: '보고서', icon: '📈' },
  { href: '/agent-memory', label: 'AI 메모리', icon: '🧠' },
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
            <h1 className="text-xl font-bold">경옥채</h1>
            <p className="text-xs text-slate-400">사내 통합시스템</p>
          </div>

          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            {loading ? (
              <p className="text-slate-400 text-sm p-3">로딩중...</p>
            ) : (
              navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    (item.href === '/' ? pathname === '/' : pathname.startsWith(item.href))
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  <span className="text-lg">{item.icon}</span>
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              ))
            )}
          </nav>

          <div className="p-3 border-t border-slate-700">
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
          <h1 className="text-xl font-bold">경옥채</h1>
          <p className="text-xs text-slate-400">사내 통합시스템</p>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {loading ? (
            <p className="text-slate-400 text-sm p-3">로딩중...</p>
          ) : (
            navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  pathname === item.href
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="text-sm font-medium">{item.label}</span>
              </Link>
            ))
          )}
        </nav>

        <div className="p-3 border-t border-slate-700">
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
        {/* Desktop header */}
        <header className="hidden lg:block bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-20">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-slate-800">
              {navItems.find((item) => item.href === '/' ? pathname === '/' : pathname.startsWith(item.href))?.label || '페이지'}
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-500">
                {userName} ({userRole})
              </span>
            </div>
          </div>
        </header>

        {/* Mobile header spacer */}
        <div className="lg:hidden h-14" />

        <div className="p-4 lg:p-6">
          {children}
        </div>
      </main>

      <AgentFloatingIcon />
    </div>
  );
}
