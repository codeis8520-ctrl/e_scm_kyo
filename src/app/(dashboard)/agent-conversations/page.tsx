'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Conversation {
  id: string;
  session_id: string | null;
  user_id: string;
  user_role: string | null;
  branch_id: string | null;
  user_message: string;
  assistant_response: string | null;
  tools_used: string[] | null;
  success: boolean;
  error_note: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cached_tokens: number | null;
  model: string | null;
  rounds: number | null;
  created_at: string;
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  return document.cookie.split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    acc[k] = decodeURIComponent(v || '');
    return acc;
  }, {} as Record<string, string>)[name] || null;
}

function fmtDateTime(s: string): string {
  if (!s) return '';
  const d = new Date(s);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayStr(): string { return fmtDate(new Date()); }
function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n); return fmtDate(d);
}
function daysBetween(iso: string): number {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n) + '…' : clean;
}

const PAGE_SIZE = 30;
type DatePreset = '7d' | '30d' | '90d' | 'all' | 'custom';

export default function AgentConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'success' | 'error'>('all');
  const [search, setSearch] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);

  // 날짜 · 도구 필터 (Phase 2)
  const [datePreset, setDatePreset] = useState<DatePreset>('30d');
  const [startDate, setStartDate] = useState(daysAgo(29));
  const [endDate, setEndDate] = useState(todayStr());
  const [toolFilter, setToolFilter] = useState<string>('');

  const userId = getCookie('user_id');
  const userRole = getCookie('user_role');
  const userName = getCookie('user_name') || '';
  // 전체 조회는 본부대표(SUPER_ADMIN)만. 그 외(HQ_OPERATOR 포함)는 본인 대화만.
  const isSuperAdmin = userRole === 'SUPER_ADMIN';
  const [scope, setScope] = useState<'mine' | 'all'>('mine');

  // 저장량 통계
  const [stats, setStats] = useState<{
    myTotal: number;
    myOldestAt: string | null;
    allTotal: number | null;
  }>({ myTotal: 0, myOldestAt: null, allTotal: null });

  const applyDatePreset = (p: DatePreset) => {
    setDatePreset(p);
    if (p === '7d') { setStartDate(daysAgo(6)); setEndDate(todayStr()); }
    else if (p === '30d') { setStartDate(daysAgo(29)); setEndDate(todayStr()); }
    else if (p === '90d') { setStartDate(daysAgo(89)); setEndDate(todayStr()); }
    else if (p === 'all') { setStartDate('2020-01-01'); setEndDate(todayStr()); }
  };

  // 저장 통계 로드 (필터와 무관, 전역)
  const fetchStats = useCallback(async () => {
    if (!userId) return;
    const sb = createClient() as any;
    // 본인 총 건수 + 가장 오래된 날짜
    const { count: myCount } = await sb.from('agent_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    const { data: oldest } = await sb.from('agent_conversations')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1);
    let allTotal: number | null = null;
    if (isSuperAdmin) {
      const { count } = await sb.from('agent_conversations')
        .select('id', { count: 'exact', head: true });
      allTotal = count ?? 0;
    }
    setStats({
      myTotal: myCount || 0,
      myOldestAt: oldest?.[0]?.created_at || null,
      allTotal,
    });
  }, [userId, isSuperAdmin]);

  const fetchData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const sb = createClient() as any;
    let q = sb.from('agent_conversations')
      .select('id, session_id, user_id, user_role, branch_id, user_message, assistant_response, tools_used, success, error_note, prompt_tokens, completion_tokens, total_tokens, cached_tokens, model, rounds, created_at')
      .gte('created_at', `${startDate}T00:00:00`)
      .lte('created_at', `${endDate}T23:59:59`)
      .order('created_at', { ascending: false })
      .limit(limit + 1);

    if (!(isSuperAdmin && scope === 'all')) {
      q = q.eq('user_id', userId);
    }
    if (filter === 'success') q = q.eq('success', true);
    else if (filter === 'error') q = q.eq('success', false);
    if (toolFilter) {
      // JSONB 배열에서 특정 도구 포함 여부 — Supabase .contains
      q = q.contains('tools_used', [toolFilter]);
    }

    const { data, error } = await q;
    if (error) {
      console.error('[agent-conversations] load error:', error);
      setConversations([]);
      setHasMore(false);
    } else {
      const rows = (data as Conversation[]) || [];
      setHasMore(rows.length > limit);
      setConversations(rows.slice(0, limit));
    }
    setLoading(false);
  }, [userId, isSuperAdmin, scope, filter, limit, startDate, endDate, toolFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // 표시된 대화에서 도구명 목록 추출 (필터 옵션용)
  const availableTools = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      for (const t of (c.tools_used || [])) set.add(String(t));
    }
    return Array.from(set).sort();
  }, [conversations]);

  const filtered = useMemo(() => conversations.filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (c.user_message || '').toLowerCase().includes(q)
      || (c.assistant_response || '').toLowerCase().includes(q)
      || (c.tools_used || []).some(t => String(t).toLowerCase().includes(q));
  }), [conversations, search]);

  const handleDelete = async (id: string) => {
    if (!confirm('이 대화 기록을 삭제할까요?')) return;
    setDeletingId(id);
    try {
      const sb = createClient() as any;
      const { error } = await sb.from('agent_conversations').delete().eq('id', id);
      if (error) {
        alert('삭제 실패: ' + error.message);
        return;
      }
      setConversations(prev => prev.filter(c => c.id !== id));
      if (expandedId === id) setExpandedId(null);
      fetchStats();
    } finally {
      setDeletingId(null);
    }
  };

  const handleCsv = () => {
    if (filtered.length === 0) return;
    const header = [
      '일시', '성공', '모델', '라운드', '총 토큰', '프롬프트 토큰', '응답 토큰', '캐시 토큰',
      '사용자 ID', '역할', '지점 ID', '세션 ID',
      '질문', '응답', '사용 도구', '오류',
    ];
    const rows = filtered.map(c => [
      fmtDateTime(c.created_at),
      c.success ? 'OK' : 'FAIL',
      c.model || '',
      c.rounds ?? '',
      c.total_tokens ?? '',
      c.prompt_tokens ?? '',
      c.completion_tokens ?? '',
      c.cached_tokens ?? '',
      c.user_id,
      c.user_role || '',
      c.branch_id || '',
      c.session_id || '',
      (c.user_message || '').replace(/\n/g, ' '),
      (c.assistant_response || '').replace(/\n/g, ' '),
      (c.tools_used || []).join('|'),
      (c.error_note || '').replace(/\n/g, ' '),
    ]);
    const csv = [header, ...rows].map(r => r.map(cell => {
      const s = String(cell ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AI대화기록_${startDate}_${endDate}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const totalTokens = filtered.reduce((s, c) => s + (c.total_tokens || 0), 0);
  const successCount = filtered.filter(c => c.success).length;
  const errorCount = filtered.length - successCount;
  const oldestDays = stats.myOldestAt ? daysBetween(stats.myOldestAt) : null;

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">AI 대화 기록</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isSuperAdmin && scope === 'all' ? '전체 사용자' : `${userName || '본인'}`}의 에이전트 대화.
            {isSuperAdmin ? ' (본부대표는 전체 대화 조회 가능)' : ' (본인 대화만 표시)'}
          </p>
        </div>
      </div>

      {/* 저장량 안내 배너 */}
      <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-indigo-500">💾</span>
            <span className="text-slate-600">내 저장된 대화</span>
            <span className="font-bold text-indigo-700">{stats.myTotal.toLocaleString()}건</span>
          </div>
          {stats.myOldestAt && oldestDays !== null && (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">가장 오래된 대화:</span>
              <span className="font-mono text-slate-700">{stats.myOldestAt.slice(0, 10)}</span>
              <span className="text-slate-400 text-xs">({oldestDays}일 전)</span>
            </div>
          )}
          {isSuperAdmin && stats.allTotal !== null && (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">전체 시스템:</span>
              <span className="font-bold text-indigo-700">{stats.allTotal.toLocaleString()}건</span>
            </div>
          )}
          <span className="ml-auto text-[11px] text-slate-500">
            ※ 현재 자동 삭제 정책 없음 — 직접 삭제로 관리
          </span>
        </div>
      </div>

      {/* 요약 카드 (현재 필터 범위) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="조회된 대화" value={`${filtered.length}건`} />
        <SummaryCard label="성공" value={`${successCount}건`} accent="green" />
        <SummaryCard label="실패" value={`${errorCount}건`} accent="red" />
        <SummaryCard label="이번 구간 토큰" value={totalTokens.toLocaleString()} accent="blue" />
      </div>

      {/* 필터 바 */}
      <div className="card space-y-3">
        {/* 기간 */}
        <div className="flex flex-wrap items-center gap-2">
          {([
            ['7d', '최근 7일'],
            ['30d', '최근 30일'],
            ['90d', '최근 90일'],
            ['all', '전체'],
            ['custom', '사용자 지정'],
          ] as [DatePreset, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => applyDatePreset(k)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                datePreset === k ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >{label}</button>
          ))}
          <div className="flex items-center gap-1.5 ml-2">
            <input type="date" value={startDate}
              onChange={e => { setStartDate(e.target.value); setDatePreset('custom'); }}
              className="input text-sm py-1 w-36" />
            <span className="text-slate-400">~</span>
            <input type="date" value={endDate}
              onChange={e => { setEndDate(e.target.value); setDatePreset('custom'); }}
              className="input text-sm py-1 w-36" />
          </div>
          <button onClick={() => { fetchData(); fetchStats(); }} className="btn-secondary text-sm py-1.5 ml-auto">새로고침</button>
          <button onClick={handleCsv} disabled={filtered.length === 0}
            className="btn-secondary text-sm py-1.5 disabled:opacity-40">CSV 내보내기</button>
        </div>

        {/* 상세 필터 */}
        <div className="flex flex-wrap gap-2">
          {isSuperAdmin && (
            <div className="flex rounded-md overflow-hidden border border-slate-200">
              <button
                onClick={() => { setScope('mine'); setLimit(PAGE_SIZE); }}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${scope === 'mine' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >내 대화</button>
              <button
                onClick={() => { setScope('all'); setLimit(PAGE_SIZE); }}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${scope === 'all' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >전체 대화</button>
            </div>
          )}
          <div className="flex rounded-md overflow-hidden border border-slate-200">
            {([
              ['all', '전체'],
              ['success', '성공'],
              ['error', '실패'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => { setFilter(k); setLimit(PAGE_SIZE); }}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  filter === k ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >{label}</button>
            ))}
          </div>
          <select
            value={toolFilter}
            onChange={e => { setToolFilter(e.target.value); setLimit(PAGE_SIZE); }}
            className="input text-sm py-1 w-44"
            title="사용된 도구 필터"
          >
            <option value="">전체 도구</option>
            {availableTools.map(t => <option key={t} value={t}>🔧 {t}</option>)}
          </select>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="질문·응답·도구명 키워드"
            className="input text-sm py-1 flex-1 min-w-[200px]"
          />
        </div>
      </div>

      {/* 목록 */}
      <div className="space-y-2">
        {loading ? (
          <p className="text-center text-slate-400 py-10">불러오는 중...</p>
        ) : filtered.length === 0 ? (
          <div className="card text-center text-slate-400 py-12">
            <p className="text-3xl mb-2">💬</p>
            <p>{search.trim() || toolFilter ? '조건에 맞는 결과가 없습니다.' : '이 기간에 대화 내역이 없습니다.'}</p>
            <p className="text-xs text-slate-300 mt-1">기간을 넓혀 보세요.</p>
          </div>
        ) : filtered.map(c => (
          <ConversationRow
            key={c.id}
            conv={c}
            expanded={expandedId === c.id}
            onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
            onDelete={() => handleDelete(c.id)}
            deleting={deletingId === c.id}
            showUserMeta={isSuperAdmin && scope === 'all'}
            isMine={c.user_id === userId}
          />
        ))}
      </div>

      {/* 더 보기 */}
      {!loading && hasMore && (
        <div className="text-center py-2">
          <button
            onClick={() => setLimit(prev => prev + PAGE_SIZE)}
            className="btn-secondary text-sm"
          >
            더 보기 ({PAGE_SIZE}건 추가)
          </button>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, accent }: {
  label: string; value: string; accent?: 'blue' | 'green' | 'red';
}) {
  const color = accent === 'blue' ? 'text-blue-700'
    : accent === 'green' ? 'text-green-700'
    : accent === 'red' ? 'text-red-600'
    : 'text-slate-800';
  return (
    <div className="card py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-bold ${color} mt-0.5`}>{value}</p>
    </div>
  );
}

function ConversationRow({ conv, expanded, onToggle, onDelete, deleting, showUserMeta, isMine }: {
  conv: Conversation;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleting: boolean;
  showUserMeta: boolean;
  isMine: boolean;
}) {
  const tools = conv.tools_used || [];
  return (
    <div className={`card p-0 overflow-hidden transition-shadow ${expanded ? 'shadow-md ring-1 ring-blue-100' : ''}`}>
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-start gap-3"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1 flex-wrap">
            <span>{fmtDateTime(conv.created_at)}</span>
            {conv.success ? (
              <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 text-[10px]">성공</span>
            ) : (
              <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[10px]">실패</span>
            )}
            {conv.model && <span className="font-mono text-[10px]">{conv.model}</span>}
            {conv.rounds && conv.rounds > 1 && (
              <span className="text-[10px]">· {conv.rounds}R</span>
            )}
            {conv.total_tokens != null && (
              <span className="text-[10px]">· {conv.total_tokens.toLocaleString()} tokens</span>
            )}
            {showUserMeta && (
              <span className="ml-auto text-[10px] font-mono text-slate-400">
                {conv.user_role || '?'} · {String(conv.user_id).slice(0, 8)}
                {!isMine && <span className="ml-1 text-amber-500">(타인)</span>}
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-slate-800 truncate">
            <span className="text-blue-600 mr-1.5">Q.</span>{truncate(conv.user_message, 140)}
          </p>
          {!expanded && conv.assistant_response && (
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              <span className="text-slate-400 mr-1.5">A.</span>{truncate(conv.assistant_response, 160)}
            </p>
          )}
          {tools.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {tools.slice(0, 6).map((t, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono">
                  🔧 {t}
                </span>
              ))}
              {tools.length > 6 && (
                <span className="text-[10px] text-slate-400">+{tools.length - 6}</span>
              )}
            </div>
          )}
        </div>
        <span className="text-slate-400 text-xs whitespace-nowrap">{expanded ? '▲ 접기' : '▼ 펼치기'}</span>
      </button>
      {expanded && (
        <div className="border-t border-slate-100 p-4 space-y-3 bg-slate-50/40">
          {/* 질문 */}
          <div>
            <p className="text-[11px] font-semibold text-blue-700 uppercase mb-1">질문</p>
            <pre className="text-sm text-slate-700 whitespace-pre-wrap break-words bg-white border border-slate-200 rounded p-3 font-sans">{conv.user_message}</pre>
          </div>
          {/* 응답 */}
          {conv.assistant_response && (
            <div>
              <p className="text-[11px] font-semibold text-slate-600 uppercase mb-1">응답</p>
              <pre className="text-sm text-slate-700 whitespace-pre-wrap break-words bg-white border border-slate-200 rounded p-3 font-sans">{conv.assistant_response}</pre>
            </div>
          )}
          {conv.error_note && (
            <div>
              <p className="text-[11px] font-semibold text-red-600 uppercase mb-1">오류</p>
              <pre className="text-sm text-red-700 whitespace-pre-wrap break-words bg-red-50 border border-red-200 rounded p-3 font-mono">{conv.error_note}</pre>
            </div>
          )}
          {/* 메타 */}
          <div className="flex flex-wrap gap-4 text-xs text-slate-500 pt-2 border-t border-slate-200">
            {conv.session_id && (
              <div><span className="text-slate-400 mr-1">세션</span><span className="font-mono">{String(conv.session_id).slice(0, 8)}</span></div>
            )}
            {conv.prompt_tokens != null && (
              <div><span className="text-slate-400 mr-1">프롬프트</span>{conv.prompt_tokens.toLocaleString()}</div>
            )}
            {conv.completion_tokens != null && (
              <div><span className="text-slate-400 mr-1">응답</span>{conv.completion_tokens.toLocaleString()}</div>
            )}
            {conv.cached_tokens != null && conv.cached_tokens > 0 && (
              <div><span className="text-slate-400 mr-1">캐시</span>{conv.cached_tokens.toLocaleString()}</div>
            )}
            <button
              onClick={onDelete}
              disabled={deleting}
              className="ml-auto text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
            >
              {deleting ? '삭제 중...' : '🗑 이 대화 삭제'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
