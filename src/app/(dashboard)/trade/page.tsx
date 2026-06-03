'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import PageTabs from '@/components/PageTabs';

const CreditTab = dynamic(() => import('./CreditTab'), { ssr: false, loading: () => <div className="py-8 text-center text-slate-400">로딩 중...</div> });
const B2bSalesTab = dynamic(() => import('./B2bSalesTab'), { ssr: false, loading: () => <div className="py-8 text-center text-slate-400">로딩 중...</div> });
const B2bPartnersTab = dynamic(() => import('./B2bPartnersTab'), { ssr: false, loading: () => <div className="py-8 text-center text-slate-400">로딩 중...</div> });

type Tab = 'credit' | 'b2b_sales' | 'b2b_partners';

export default function TradePage() {
  const [activeTab, setActiveTab] = useState<Tab>('credit');

  return (
    <div className="space-y-4">
      <PageTabs
        tabs={[
          { key: 'credit', label: '외상 매출' },
          { key: 'b2b_sales', label: 'B2B 거래' },
          { key: 'b2b_partners', label: '거래처 관리' },
        ]}
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as Tab)}
      />

      {activeTab === 'credit' && <CreditTab />}
      {activeTab === 'b2b_sales' && <B2bSalesTab />}
      {activeTab === 'b2b_partners' && <B2bPartnersTab />}
    </div>
  );
}
