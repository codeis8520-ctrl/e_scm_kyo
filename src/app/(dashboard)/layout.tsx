'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from '@/app/login/actions';

const navItems = [
  { href: '/', label: '대시보드', icon: '📊' },
  { href: '/pos', label: 'POS', icon: '💰' },
  { href: '/pos/manual', label: '수기 입력', icon: '✏️' },
  { href: '/products', label: '제품 관리', icon: '📦' },
  { href: '/inventory', label: '재고 관리', icon: '🏪' },
  { href: '/customers', label: '고객 관리', icon: '👥' },
  { href: '/branches', label: '지점 관리', icon: '🏢' },
  { href: '/reports', label: '보고서', icon: '📈' },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      <aside className="sidebar flex flex-col">
        <div className="mb-8">
          <h1 className="text-xl font-bold">경옥채</h1>
          <p className="text-xs text-slate-400">사내 통합시스템</p>
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${pathname === item.href ? 'active' : ''}`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="pt-4 border-t border-slate-700">
          <button
            onClick={() => signOut()}
            className="nav-item w-full text-left"
          >
            <span>🚪</span>
            <span>로그아웃</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="bg-white border-b border-slate-200 px-6 py-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-slate-800">
              {navItems.find((item) => item.href === pathname)?.label || '페이지'}
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-500">관리자</span>
            </div>
          </div>
        </header>

        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
