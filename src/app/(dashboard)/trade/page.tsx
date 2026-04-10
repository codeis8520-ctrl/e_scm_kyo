'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';

const CreditTab = dynamic(() => import('./CreditTab'), { ssr: false, loading: () => <div className="py-8 text-center text-slate-400">로딩 중...</div> });
const B2bSalesTab = dynamic(() => import('./B2bSalesTab'), { ssr: false, loading: () => <div className="py-8 text-center text-slate-400">로딩 중...</div> });
const B2bPartnersTab = dynamic(() => import('./B2bPartnersTab'), { ssr: false, loading: () => <div className="py-8 text-center text-slate-400">로딩 중...</div> });

type Tab = 'credit' | 'b2b_sales' | 'b2b_partners';

export default function TradePage() {
  const [activeTab, setActiveTab] = useState<Tab>('credit');

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-slate-200">
        {([
          { key: 'credit' as Tab, label: '외상 매출' },
          { key: 'b2b_sales' as Tab, label: 'B2B 거래' },
          { key: 'b2b_partners' as Tab, label: '거래처 관리' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'credit' && <CreditTab />}
      {activeTab === 'b2b_sales' && <B2bSalesTab />}
      {activeTab === 'b2b_partners' && <B2bPartnersTab />}
    </div>
  );
}
