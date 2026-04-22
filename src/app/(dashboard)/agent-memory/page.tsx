'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { fmtDateKST } from '@/lib/date';

interface Memory {
  id: string;
  memory_type: 'alias' | 'pattern' | 'error' | 'insight';
  category: string;
  content: string;
  source_query: string | null;
  usage_count: number;
  last_used_at: string;
  created_at: string;
  is_active: boolean;
}

const TYPE_BADGE: Record<string, string> = {
  alias:   'bg-blue-100 text-blue-700',
  pattern: 'bg-purple-100 text-purple-700',
  error:   'bg-red-100 text-red-700',
  insight: 'bg-green-100 text-green-700',
};
const TYPE_LABEL: Record<string, string> = {
  alias: '별칭', pattern: '패턴', error: '오류', insight: '통찰',
};
const CAT_LABEL: Record<string, string> = {
  customer: '고객', branch: '지점', inventory: '재고',
  order: '주문', production: '생산', general: '일반',
};

export default function AgentMemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<{ type: string; category: string; active: string }>({
    type: '', category: '', active: 'true',
  });
  const [stats, setStats] = useState({ total: 0, active: 0, byType: {} as Record<string, number> });

  const fetchMemories = async () => {
    setLoading(true);
    const sb = createClient() as any;
    let q = sb.from('agent_memories').select('*').order('usage_count', { ascending: false });
    if (filter.type) q = q.eq('memory_type', filter.type);
    if (filter.category) q = q.eq('category', filter.category);
    if (filter.active !== '') q = q.eq('is_active', filter.active === 'true');
    const { data } = await q;
    const rows: Memory[] = data || [];
    setMemories(rows);

    const all = (await sb.from('agent_memories').select('memory_type, is_active')).data || [];
    const byType: Record<string, number> = {};
    let active = 0;
    for (const r of all) {
      byType[r.memory_type] = (byType[r.memory_type] || 0) + 1;
      if (r.is_active) active++;
    }
    setStats({ total: all.length, active, byType });
    setLoading(false);
  };

  useEffect(() => { fetchMemories(); }, [filter]);

  const toggleActive = async (id: string, current: boolean) => {
    const sb = createClient() as any;
    await sb.from('agent_memories').update({ is_active: !current }).eq('id', id);
    fetchMemories();
  };

  const deleteMemory = async (id: string) => {
    if (!confirm('이 기억을 삭제하시겠습니까?')) return;
    const sb = createClient() as any;
    await sb.from('agent_memories').delete().eq('id', id);
    fetchMemories();
  };

  const clearInactive = async () => {
    if (!confirm('비활성 메모리를 전체 삭제합니다.')) return;
    const sb = createClient() as any;
    await sb.from('agent_memories').delete().eq('is_active', false);
    fetchMemories();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">AI 에이전트 학습 메모리</h1>
          <p className="text-sm text-slate-500 mt-0.5">에이전트가 업무를 처리하며 자동으로 축적한 지식입니다. 비활성화하면 프롬프트에 주입되지 않습니다.</p>
        </div>
        <button onClick={clearInactive} className="btn-secondary text-sm py-1.5 px-3 text-red-600 shrink-0">
          비활성 전체 삭제
        </button>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3 sm:gap-4">
        <div className="card text-center py-3">
          <p className="text-xs text-slate-500">전체</p>
          <p className="text-2xl font-bold text-slate-800">{stats.total}</p>
        </div>
        <div className="card text-center py-3">
          <p className="text-xs text-slate-500">활성</p>
          <p className="text-2xl font-bold text-green-600">{stats.active}</p>
        </div>
        {(['alias', 'pattern', 'error', 'insight'] as const).map(t => (
          <div key={t} className="card text-center py-3">
            <p className={`text-xs font-medium px-1.5 py-0.5 rounded inline-block ${TYPE_BADGE[t]}`}>{TYPE_LABEL[t]}</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{stats.byType[t] || 0}</p>
          </div>
        ))}
      </div>

      {/* 필터 */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <select value={filter.type} onChange={e => setFilter(f => ({ ...f, type: e.target.value }))} className="input w-32 text-sm">
          <option value="">전체 유형</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filter.category} onChange={e => setFilter(f => ({ ...f, category: e.target.value }))} className="input w-32 text-sm">
          <option value="">전체 카테고리</option>
          {Object.entries(CAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filter.active} onChange={e => setFilter(f => ({ ...f, active: e.target.value }))} className="input w-32 text-sm">
          <option value="">전체 상태</option>
          <option value="true">활성만</option>
          <option value="false">비활성만</option>
        </select>
        <span className="text-sm text-slate-400 self-center">{memories.length}건</span>
      </div>

      {/* 메모리 테이블 */}
      <div className="card overflow-x-auto">
        <table className="table text-sm">
          <thead>
            <tr>
              <th className="w-20">유형</th>
              <th className="w-20">카테고리</th>
              <th>내용</th>
              <th className="w-16 text-right">사용횟수</th>
              <th className="w-28 text-right">마지막 사용</th>
              <th className="w-20 text-center">상태</th>
              <th className="w-20">관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-8 text-slate-400">로딩 중...</td></tr>
            ) : memories.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-slate-400">
                아직 학습된 메모리가 없습니다.<br/>
                <span className="text-xs">에이전트가 업무를 처리하면 자동으로 쌓입니다.</span>
              </td></tr>
            ) : memories.map(m => (
              <tr key={m.id} className={!m.is_active ? 'opacity-40' : ''}>
                <td>
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${TYPE_BADGE[m.memory_type]}`}>
                    {TYPE_LABEL[m.memory_type]}
                  </span>
                </td>
                <td className="text-slate-500 text-xs">{CAT_LABEL[m.category] || m.category}</td>
                <td>
                  <p className="text-sm">{m.content}</p>
                  {m.source_query && (
                    <p className="text-xs text-slate-400 mt-0.5">원본: {m.source_query.slice(0, 60)}</p>
                  )}
                </td>
                <td className="text-right font-semibold text-blue-600">{m.usage_count}</td>
                <td className="text-right text-xs text-slate-400">
                  {fmtDateKST(m.last_used_at)}
                </td>
                <td className="text-center">
                  <button
                    onClick={() => toggleActive(m.id, m.is_active)}
                    className={`text-xs px-2 py-0.5 rounded ${m.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}
                  >
                    {m.is_active ? '활성' : '비활성'}
                  </button>
                </td>
                <td>
                  <button onClick={() => deleteMemory(m.id)} className="text-xs text-red-500 hover:underline">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
