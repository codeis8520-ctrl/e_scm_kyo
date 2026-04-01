import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '경옥채 사내 통합시스템',
  description: 'ERP + CRM + 대시보드 통합 시스템',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
