export type RfmSegment =
  | 'champions'
  | 'loyal'
  | 'potential_loyal'
  | 'at_risk'
  | 'cant_lose'
  | 'new'
  | 'lost';

export const SEGMENT_META: Record<RfmSegment, { label: string; color: string; bg: string; desc: string }> = {
  champions:       { label: '최우수',      color: 'text-purple-700',  bg: 'bg-purple-100',  desc: '최근 구매, 자주, 많이 구매하는 핵심 고객' },
  loyal:           { label: '충성',        color: 'text-blue-700',    bg: 'bg-blue-100',    desc: '꾸준히 구매하는 단골 고객' },
  potential_loyal: { label: '잠재 충성',   color: 'text-cyan-700',    bg: 'bg-cyan-100',    desc: '최근 활동적이고 충성도 향상 가능성 있음' },
  new:             { label: '신규',        color: 'text-green-700',   bg: 'bg-green-100',   desc: '최근 방문했으나 아직 재구매 이력 적음' },
  at_risk:         { label: '이탈 위험',   color: 'text-amber-700',   bg: 'bg-amber-100',   desc: '구매 간격이 늘어나고 있는 이탈 가능 고객' },
  cant_lose:       { label: '유지 필수',   color: 'text-orange-700',  bg: 'bg-orange-100',  desc: '이전 우수 고객이나 최근 방문 없음' },
  lost:            { label: '이탈',        color: 'text-slate-500',   bg: 'bg-slate-100',   desc: '오래 전 방문 후 재방문 없는 고객' },
};
