'use client';

import React from 'react';

export interface PageTab {
  key: string;
  label: string;
}

interface PageTabsProps {
  tabs: PageTab[];
  activeKey: string;
  onChange: (key: string) => void;
  actions?: React.ReactNode;
}

export default function PageTabs({ tabs, activeKey, onChange, actions }: PageTabsProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-200">
      <nav role="tablist" className="flex flex-wrap gap-1">
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeKey === t.key}
            onClick={() => onChange(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeKey === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {actions && <div className="flex flex-wrap items-center gap-3 pb-2">{actions}</div>}
    </div>
  );
}
