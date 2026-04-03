import type { MiniMaxTool } from './client';

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const AGENT_TOOLS: MiniMaxTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_inventory',
      description: '지점별 재고 현황을 조회합니다. 특정 지점명이나 제품명으로 필터링할 수 있습니다.',
      parameters: {
        type: 'object',
        properties: {
          branch_name: {
            type: 'string',
            description: '지점명 (예: 강남점, 한약국, 백화점). 생략하면 전체 지점 조회.',
          },
          product_name: {
            type: 'string',
            description: '제품명 또는 키워드. 생략하면 해당 지점 모든 재고 조회.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_customer',
      description: '고객 정보를 조회합니다. 이름 또는 전화번호로 검색합니다. 포인트 잔액도 함께 반환됩니다.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '고객 이름 (부분 일치)',
          },
          phone: {
            type: 'string',
            description: '전화번호 (010-0000-0000 형식)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_customer_grades',
      description: '고객 등급별 적립률 정보를 조회합니다.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_orders',
      description: '판매 주문(매출) 내역을 조회합니다.',
      parameters: {
        type: 'object',
        properties: {
          branch_name: {
            type: 'string',
            description: '지점명으로 필터링',
          },
          date_from: {
            type: 'string',
            description: '조회 시작일 (YYYY-MM-DD)',
          },
          date_to: {
            type: 'string',
            description: '조회 종료일 (YYYY-MM-DD)',
          },
          limit: {
            type: 'number',
            description: '최대 조회 건수 (기본 20)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_products',
      description: '제품 목록을 조회합니다.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '제품명 키워드',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'transfer_inventory',
      description: '지점 간 재고를 이동합니다. 반드시 사용자 확인 후 실행됩니다.',
      parameters: {
        type: 'object',
        properties: {
          from_branch_name: {
            type: 'string',
            description: '출발 지점명',
          },
          to_branch_name: {
            type: 'string',
            description: '도착 지점명',
          },
          product_name: {
            type: 'string',
            description: '이동할 제품명',
          },
          quantity: {
            type: 'number',
            description: '이동할 수량',
          },
        },
        required: ['from_branch_name', 'to_branch_name', 'product_name', 'quantity'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'adjust_points',
      description: '고객 포인트를 수동으로 조정합니다. 반드시 사용자 확인 후 실행됩니다.',
      parameters: {
        type: 'object',
        properties: {
          customer_name: {
            type: 'string',
            description: '고객 이름',
          },
          phone: {
            type: 'string',
            description: '고객 전화번호',
          },
          points: {
            type: 'number',
            description: '조정할 포인트 (양수=적립, 음수=차감)',
          },
          reason: {
            type: 'string',
            description: '조정 사유',
          },
        },
        required: ['points', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_customer_grade',
      description: '고객 등급을 변경합니다. 반드시 사용자 확인 후 실행됩니다.',
      parameters: {
        type: 'object',
        properties: {
          customer_name: {
            type: 'string',
            description: '고객 이름',
          },
          phone: {
            type: 'string',
            description: '고객 전화번호',
          },
          new_grade: {
            type: 'string',
            enum: ['NORMAL', 'VIP', 'VVIP'],
            description: '변경할 등급',
          },
        },
        required: ['new_grade'],
      },
    },
  },
];

export const WRITE_TOOLS = new Set(['transfer_inventory', 'adjust_points', 'update_customer_grade']);

// ─── Tool Executors ──────────────────────────────────────────────────────────

export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  supabase: any
): Promise<string> {
  try {
    switch (toolName) {
      case 'get_inventory':
        return await execGetInventory(supabase, args);
      case 'get_customer':
        return await execGetCustomer(supabase, args);
      case 'get_customer_grades':
        return await execGetCustomerGrades(supabase);
      case 'get_orders':
        return await execGetOrders(supabase, args);
      case 'get_products':
        return await execGetProducts(supabase, args);
      case 'transfer_inventory':
        return await execTransferInventory(supabase, args as any);
      case 'adjust_points':
        return await execAdjustPoints(supabase, args as any);
      case 'update_customer_grade':
        return await execUpdateCustomerGrade(supabase, args as any);
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (e: any) {
    return JSON.stringify({ error: e.message });
  }
}

async function findBranchId(supabase: any, name: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supabase
    .from('branches')
    .select('id, name')
    .ilike('name', `%${name}%`)
    .eq('is_active', true)
    .limit(1)
    .single();
  return data || null;
}

async function findProductId(supabase: any, name: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supabase
    .from('products')
    .select('id, name')
    .ilike('name', `%${name}%`)
    .eq('is_active', true)
    .limit(1)
    .single();
  return data || null;
}

async function findCustomer(supabase: any, args: { customer_name?: string; phone?: string; name?: string }) {
  const name = args.customer_name || args.name;
  let q = supabase.from('customers').select('id, name, phone, grade, email').eq('is_active', true);
  if (args.phone) q = q.eq('phone', args.phone);
  else if (name) q = q.ilike('name', `%${name}%`);
  q = q.limit(1).single();
  const { data } = await q;
  return data || null;
}

async function getCustomerPoints(supabase: any, customerId: string): Promise<number> {
  const { data } = await supabase
    .from('point_history')
    .select('balance')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return data?.balance ?? 0;
}

async function execGetInventory(supabase: any, args: { branch_name?: string; product_name?: string }): Promise<string> {
  let branchId: string | null = null;
  let productId: string | null = null;

  if (args.branch_name) {
    const branch = await findBranchId(supabase, args.branch_name);
    if (!branch) return JSON.stringify({ error: `지점 "${args.branch_name}"을(를) 찾을 수 없습니다.` });
    branchId = branch.id;
  }

  if (args.product_name) {
    const product = await findProductId(supabase, args.product_name);
    if (!product) return JSON.stringify({ error: `제품 "${args.product_name}"을(를) 찾을 수 없습니다.` });
    productId = product.id;
  }

  let q = supabase
    .from('inventories')
    .select('quantity, safety_stock, products(name, code), branches(name)');

  if (branchId) q = q.eq('branch_id', branchId);
  if (productId) q = q.eq('product_id', productId);
  q = q.gt('quantity', 0).limit(30);

  const { data, error } = await q;
  if (error) return JSON.stringify({ error: error.message });

  const result = (data || []).map((inv: any) => ({
    지점: inv.branches?.name,
    제품: inv.products?.name,
    수량: inv.quantity,
    안전재고: inv.safety_stock,
    상태: inv.quantity <= (inv.safety_stock || 0) ? '⚠️ 부족' : '정상',
  }));

  if (result.length === 0) return JSON.stringify({ 결과: '재고 없음' });
  return JSON.stringify(result);
}

async function execGetCustomer(supabase: any, args: { name?: string; phone?: string }): Promise<string> {
  let q = supabase.from('customers').select('*').eq('is_active', true);
  if (args.phone) q = q.eq('phone', args.phone);
  else if (args.name) q = q.ilike('name', `%${args.name}%`);
  q = q.limit(5);

  const { data, error } = await q;
  if (error) return JSON.stringify({ error: error.message });
  if (!data || data.length === 0) return JSON.stringify({ 결과: '고객을 찾을 수 없습니다.' });

  const results = await Promise.all(
    data.map(async (c: any) => {
      const points = await getCustomerPoints(supabase, c.id);
      return {
        이름: c.name,
        전화번호: c.phone,
        이메일: c.email || '-',
        등급: c.grade,
        포인트잔액: points,
        활성: c.is_active,
        등록일: c.created_at?.slice(0, 10),
      };
    })
  );

  return JSON.stringify(results);
}

async function execGetCustomerGrades(supabase: any): Promise<string> {
  const { data, error } = await supabase
    .from('customer_grades')
    .select('code, name, point_rate')
    .eq('is_active', true)
    .order('sort_order');

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify(data || []);
}

async function execGetOrders(supabase: any, args: { branch_name?: string; date_from?: string; date_to?: string; limit?: number }): Promise<string> {
  let branchId: string | null = null;
  if (args.branch_name) {
    const branch = await findBranchId(supabase, args.branch_name);
    if (!branch) return JSON.stringify({ error: `지점 "${args.branch_name}"을(를) 찾을 수 없습니다.` });
    branchId = branch.id;
  }

  let q = supabase
    .from('sales_orders')
    .select('order_number, total_amount, payment_method, status, ordered_at, channel, customers(name)')
    .order('ordered_at', { ascending: false });

  if (branchId) q = q.eq('branch_id', branchId);
  if (args.date_from) q = q.gte('ordered_at', args.date_from);
  if (args.date_to) q = q.lte('ordered_at', args.date_to + 'T23:59:59');
  q = q.limit(args.limit || 20);

  const { data, error } = await q;
  if (error) return JSON.stringify({ error: error.message });
  if (!data || data.length === 0) return JSON.stringify({ 결과: '주문 내역 없음' });

  const total = data.reduce((sum: number, o: any) => sum + (o.total_amount || 0), 0);
  const result = {
    조회건수: data.length,
    총매출: total,
    주문목록: data.map((o: any) => ({
      주문번호: o.order_number,
      고객: o.customers?.name || '비회원',
      금액: o.total_amount,
      결제: o.payment_method,
      상태: o.status,
      일시: o.ordered_at?.slice(0, 16),
    })),
  };

  return JSON.stringify(result);
}

async function execGetProducts(supabase: any, args: { name?: string }): Promise<string> {
  let q = supabase
    .from('products')
    .select('name, code, price, unit')
    .eq('is_active', true)
    .order('name');

  if (args.name) q = q.ilike('name', `%${args.name}%`);
  q = q.limit(30);

  const { data, error } = await q;
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify(data || []);
}

async function execTransferInventory(supabase: any, args: {
  from_branch_name: string;
  to_branch_name: string;
  product_name: string;
  quantity: number;
}): Promise<string> {
  const fromBranch = await findBranchId(supabase, args.from_branch_name);
  if (!fromBranch) return JSON.stringify({ error: `출발 지점 "${args.from_branch_name}" 없음` });

  const toBranch = await findBranchId(supabase, args.to_branch_name);
  if (!toBranch) return JSON.stringify({ error: `도착 지점 "${args.to_branch_name}" 없음` });

  const product = await findProductId(supabase, args.product_name);
  if (!product) return JSON.stringify({ error: `제품 "${args.product_name}" 없음` });

  // Check source stock
  const { data: srcInv } = await supabase
    .from('inventories')
    .select('id, quantity')
    .eq('branch_id', fromBranch.id)
    .eq('product_id', product.id)
    .single();

  if (!srcInv || srcInv.quantity < args.quantity) {
    return JSON.stringify({
      error: `${fromBranch.name}의 ${product.name} 재고 부족. 현재: ${srcInv?.quantity ?? 0}개, 요청: ${args.quantity}개`,
    });
  }

  // Decrement source
  await supabase
    .from('inventories')
    .update({ quantity: srcInv.quantity - args.quantity })
    .eq('id', srcInv.id);

  // Increment destination (upsert)
  const { data: dstInv } = await supabase
    .from('inventories')
    .select('id, quantity')
    .eq('branch_id', toBranch.id)
    .eq('product_id', product.id)
    .single();

  if (dstInv) {
    await supabase
      .from('inventories')
      .update({ quantity: dstInv.quantity + args.quantity })
      .eq('id', dstInv.id);
  } else {
    await supabase
      .from('inventories')
      .insert({ branch_id: toBranch.id, product_id: product.id, quantity: args.quantity });
  }

  // Movement records
  const now = new Date().toISOString();
  await supabase.from('inventory_movements').insert([
    {
      branch_id: fromBranch.id,
      product_id: product.id,
      movement_type: 'TRANSFER',
      quantity: -args.quantity,
      memo: `이동출고 → ${toBranch.name} (AI 에이전트)`,
      created_at: now,
    },
    {
      branch_id: toBranch.id,
      product_id: product.id,
      movement_type: 'TRANSFER',
      quantity: args.quantity,
      memo: `이동입고 ← ${fromBranch.name} (AI 에이전트)`,
      created_at: now,
    },
  ]);

  return JSON.stringify({
    성공: true,
    메시지: `${product.name} ${args.quantity}개를 ${fromBranch.name}에서 ${toBranch.name}으로 이동했습니다.`,
    출발지잔여재고: srcInv.quantity - args.quantity,
  });
}

async function execAdjustPoints(supabase: any, args: {
  customer_name?: string;
  phone?: string;
  points: number;
  reason: string;
}): Promise<string> {
  const customer = await findCustomer(supabase, args);
  if (!customer) return JSON.stringify({ error: '고객을 찾을 수 없습니다.' });

  const currentBalance = await getCustomerPoints(supabase, customer.id);
  const newBalance = currentBalance + args.points;

  if (newBalance < 0) {
    return JSON.stringify({ error: `포인트 부족. 현재: ${currentBalance}P, 차감: ${Math.abs(args.points)}P` });
  }

  await supabase.from('point_history').insert({
    customer_id: customer.id,
    type: args.points > 0 ? 'adjust' : 'adjust',
    points: args.points,
    balance: newBalance,
    description: args.reason + ' (AI 에이전트)',
  });

  return JSON.stringify({
    성공: true,
    고객: customer.name,
    조정전: currentBalance,
    조정후: newBalance,
    메시지: `${customer.name} 고객 포인트 ${args.points > 0 ? '+' : ''}${args.points}P 조정 완료`,
  });
}

async function execUpdateCustomerGrade(supabase: any, args: {
  customer_name?: string;
  phone?: string;
  new_grade: string;
}): Promise<string> {
  const customer = await findCustomer(supabase, args);
  if (!customer) return JSON.stringify({ error: '고객을 찾을 수 없습니다.' });

  const gradeNames: Record<string, string> = { NORMAL: '일반', VIP: 'VIP', VVIP: 'VVIP' };
  const prevGrade = customer.grade;

  await supabase
    .from('customers')
    .update({ grade: args.new_grade })
    .eq('id', customer.id);

  return JSON.stringify({
    성공: true,
    고객: customer.name,
    이전등급: gradeNames[prevGrade] || prevGrade,
    변경등급: gradeNames[args.new_grade] || args.new_grade,
    메시지: `${customer.name} 고객 등급을 ${gradeNames[prevGrade] || prevGrade}에서 ${gradeNames[args.new_grade] || args.new_grade}로 변경했습니다.`,
  });
}
