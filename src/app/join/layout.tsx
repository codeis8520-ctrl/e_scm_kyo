import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '경옥채 회원 가입',
  description: '경옥채 매장 방문 고객 셀프 등록',
};

// 공개 레이아웃 — 대시보드 사이드바/헤더 없음
export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-white">
      {children}
    </div>
  );
}
