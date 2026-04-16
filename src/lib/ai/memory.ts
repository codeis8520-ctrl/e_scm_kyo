/**
 * AI 에이전트 메모리 시스템
 *
 * 에이전트가 업무를 처리하면서 얻은 지식을 DB에 저장하고,
 * 다음 대화 시작 시 시스템 프롬프트에 자동 주입합니다.
 *
 * memory_type:
 *   alias   — 이름 ↔ ID/상세 매핑 (고객명, 지점명 등)
 *   pattern — 반복되는 업무 흐름 패턴
 *   error   — 특정 상황에서 발생한 오류 패턴
 *   insight — 데이터에서 도출된 업무 통찰
 */

// ─── 메모리 로딩 (시스템 프롬프트 주입용) ─────────────────────────────────────

export async function loadMemories(db: any): Promise<{ text: string; ids: string[] }> {
  const { data } = await db
    .from('agent_memories')
    .select('id, memory_type, category, content')
    .eq('is_active', true)
    .order('usage_count', { ascending: false })
    .limit(20);

  if (!data?.length) return { text: '', ids: [] };

  const sections: Record<string, string[]> = {};
  const ids: string[] = [];
  for (const m of data) {
    const key = m.category;
    if (!sections[key]) sections[key] = [];
    sections[key].push(`[${m.memory_type}] ${m.content}`);
    ids.push(m.id);
  }

  const lines = ['== 축적된 업무 지식 (과거 경험) =='];
  for (const [cat, entries] of Object.entries(sections)) {
    lines.push(`# ${CATEGORY_LABELS[cat] || cat}`);
    lines.push(...entries);
  }

  return { text: lines.join('\n'), ids };
}

// 로드된 메모리 ID에 대해 usage_count를 +1 (참조 기록).
// 호출 측에서 fire-and-forget으로 사용.
export async function bumpMemoryUsage(db: any, ids: string[]) {
  if (!ids?.length) return;
  // Supabase JS는 expression update를 지원하지 않아, 1건씩 raw SQL 없이 처리.
  // RPC가 없으므로 간단히 조회 후 업데이트. (최대 20건이라 비용 미미)
  const { data } = await db
    .from('agent_memories')
    .select('id, usage_count')
    .in('id', ids);
  if (!data?.length) return;
  const now = new Date().toISOString();
  await Promise.all(
    data.map((m: any) =>
      db.from('agent_memories')
        .update({ usage_count: (m.usage_count || 0) + 1, last_used_at: now })
        .eq('id', m.id),
    ),
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  customer:   '고객',
  branch:     '지점',
  inventory:  '재고',
  order:      '주문/매출',
  production: '생산',
  general:    '일반',
};

// ─── 메모리 저장 (upsert) ──────────────────────────────────────────────────────

async function upsertMemory(
  db: any,
  opts: {
    memory_type: 'alias' | 'pattern' | 'error' | 'insight';
    category: string;
    source_key: string;
    content: string;
    source_query?: string;
  }
) {
  // 이미 같은 source_key가 있으면 content 업데이트 + usage_count 증가
  const { data: existing } = await db
    .from('agent_memories')
    .select('id, usage_count')
    .eq('source_key', opts.source_key)
    .single();

  if (existing) {
    const { error: updErr } = await db
      .from('agent_memories')
      .update({
        content: opts.content,
        usage_count: existing.usage_count + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (updErr) console.error('[Memory] update 실패:', updErr.message, opts.source_key);
  } else {
    const { error: insErr } = await db.from('agent_memories').insert({
      memory_type: opts.memory_type,
      category: opts.category,
      source_key: opts.source_key,
      content: opts.content,
      source_query: opts.source_query || null,
    });
    if (insErr) console.error('[Memory] insert 실패:', insErr.message, opts.source_key);
  }
}

// ─── 도구 실행 결과에서 메모리 자동 추출 ──────────────────────────────────────

export async function extractMemory(
  db: any,
  toolName: string,
  args: Record<string, any>,
  resultJson: string
) {
  let parsed: any = {};
  try { parsed = JSON.parse(resultJson); } catch { return; }

  // 오류 패턴 기억
  if (parsed.error || parsed.오류) {
    const errMsg = parsed.error || parsed.오류;
    await upsertMemory(db, {
      memory_type: 'error',
      category: getCategoryForTool(toolName),
      source_key: `error:${toolName}:${normalizeKey(errMsg)}`,
      content: `${toolName} 실행 시 "${summarizeArgs(args)}" → 오류: ${errMsg}`,
      source_query: JSON.stringify(args),
    });
    return;
  }

  switch (toolName) {

    // 고객 검색 결과 → alias 기억
    case 'get_customer': {
      const customers = parsed.고객 || parsed.customers || [];
      // 검색된 고객 각각 alias 저장 (최대 5명)
      for (const c of customers.slice(0, 5)) {
        await upsertMemory(db, {
          memory_type: 'alias',
          category: 'customer',
          source_key: `alias:customer:${normalizeKey(c.name)}`,
          content: `고객 "${c.name}" → 전화:${c.phone}, 등급:${c.grade}${c.primary_branch ? ', 지점:' + c.primary_branch : ''}`,
          source_query: args.name || args.phone,
        });
      }
      break;
    }

    // 지점 조회 → alias 기억
    case 'get_branches': {
      const branches = parsed.지점 || parsed.branches || [];
      for (const b of branches) {
        await upsertMemory(db, {
          memory_type: 'alias',
          category: 'branch',
          source_key: `alias:branch:${normalizeKey(b.name)}`,
          content: `지점 "${b.name}" (채널:${b.channel || '-'}, 운영:${b.is_active ? '활성' : '비활성'})`,
          source_query: args.name,
        });
      }
      break;
    }

    // 재고 조회 → 부족 품목 통찰
    case 'get_low_stock': {
      const items = parsed.부족품목 || parsed.items || [];
      if (items.length > 0) {
        const top = items.slice(0, 5).map((i: any) => i.제품명 || i.name).join(', ');
        await upsertMemory(db, {
          memory_type: 'insight',
          category: 'inventory',
          source_key: `insight:low_stock:${args.branch_name || 'all'}`,
          content: `재고 부족 상시 품목 (${args.branch_name || '전체'}): ${top}`,
          source_query: args.branch_name,
        });
      }
      break;
    }

    // 매출 요약 → 통찰
    case 'get_sales_summary': {
      const total = parsed.총매출 || parsed.total;
      if (total) {
        await upsertMemory(db, {
          memory_type: 'insight',
          category: 'order',
          source_key: `insight:sales:${args.period || 'custom'}:${args.branch_name || 'all'}`,
          content: `${args.period || '조회'} 기간 매출 (${args.branch_name || '전체'}): ${Number(total).toLocaleString()}원`,
          source_query: JSON.stringify(args),
        });
      }
      break;
    }

    // 상위 판매 제품 → 통찰
    case 'get_top_products': {
      const products = parsed.상위제품 || parsed.products || [];
      if (products.length > 0) {
        const top = products.slice(0, 3).map((p: any) => p.제품명 || p.name).join(', ');
        await upsertMemory(db, {
          memory_type: 'insight',
          category: 'order',
          source_key: `insight:top_products:${args.branch_name || 'all'}`,
          content: `인기 제품 Top3 (${args.branch_name || '전체'}): ${top}`,
          source_query: JSON.stringify(args),
        });
      }
      break;
    }

    // 발주서 생성 완료 → 흐름 패턴
    case 'create_purchase_order':
    case 'create_and_confirm_purchase_order': {
      if (parsed.발주번호) {
        await upsertMemory(db, {
          memory_type: 'pattern',
          category: 'general',
          source_key: `pattern:purchase_flow`,
          content: `발주 흐름: create_purchase_order → confirm_purchase_order → receive_purchase_order 순서로 처리`,
          source_query: toolName,
        });
      }
      break;
    }

    // 생산 완료 → 흐름 패턴 (OEM 위탁 모델)
    case 'complete_production_order': {
      if (!parsed.error) {
        await upsertMemory(db, {
          memory_type: 'pattern',
          category: 'production',
          source_key: `pattern:production_flow`,
          content: `생산 흐름(OEM 위탁): create_production_order(공장·입고지점 지정) → start_production_order → complete_production_order. 완료 시 완제품만 입고 지점에 증가. 원/부자재 차감 없음(OEM 자체 조달). BOM은 원가 산정 참고용.`,
          source_query: toolName,
        });
      }
      break;
    }

    // 포인트 조정 → 패턴
    case 'adjust_points': {
      if (!parsed.error) {
        await upsertMemory(db, {
          memory_type: 'pattern',
          category: 'customer',
          source_key: `pattern:points_flow`,
          content: `포인트 조정 전 반드시 get_customer로 고객 확인 후 고객명/전화번호 사용`,
          source_query: toolName,
        });
      }
      break;
    }
  }
}

// ─── 쓰기 작업 완료 후 메모리 저장 ───────────────────────────────────────────

export async function extractMemoryFromWrite(
  db: any,
  toolName: string,
  args: Record<string, any>,
  result: any
) {
  if (result?.error) {
    await upsertMemory(db, {
      memory_type: 'error',
      category: getCategoryForTool(toolName),
      source_key: `error:write:${toolName}:${normalizeKey(result.error)}`,
      content: `${toolName} 쓰기 오류: "${summarizeArgs(args)}" → ${result.error}`,
      source_query: JSON.stringify(args),
    });
    return;
  }

  // 고객 등록 성공
  if (toolName === 'create_customer' && result?.성공) {
    await upsertMemory(db, {
      memory_type: 'alias',
      category: 'customer',
      source_key: `alias:customer:${normalizeKey(args.name)}`,
      content: `고객 "${args.name}" → 전화:${args.phone}, 등급:${args.grade || 'NORMAL'}`,
      source_query: args.name,
    });
  }
}

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

function normalizeKey(str: string): string {
  return String(str || '').toLowerCase().replace(/\s+/g, '_').slice(0, 60);
}

function summarizeArgs(args: Record<string, any>): string {
  return Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}:${String(v).slice(0, 20)}`)
    .join(', ');
}

function getCategoryForTool(toolName: string): string {
  if (toolName.includes('customer') || toolName.includes('point') || toolName.includes('grade')) return 'customer';
  if (toolName.includes('inventory') || toolName.includes('stock')) return 'inventory';
  if (toolName.includes('purchase') || toolName.includes('supplier') || toolName.includes('order') || toolName.includes('sales')) return 'order';
  if (toolName.includes('production')) return 'production';
  if (toolName.includes('branch')) return 'branch';
  return 'general';
}
