import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { miniMaxClient, MiniMaxMessage } from '@/lib/ai/client';
import { SYSTEM_PROMPT, DB_SCHEMA, BUSINESS_RULES } from '@/lib/ai/schema';

interface AgentRequest {
  message: string;
  context?: {
    userId?: string;
    userRole?: string;
    branchId?: string;
  };
}

interface IntentResult {
  operation: string;
  table: string;
  data: Record<string, any>;
  requiresConfirmation: boolean;
  confirmationMessage: string;
}

function getCookie(name: string): string | null {
  const cookies = document.cookie.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    acc[key] = decodeURIComponent(value || '');
    return acc;
  }, {} as Record<string, string>);
  return cookies[name] || null;
}

export async function POST(req: NextRequest) {
  try {
    const body: AgentRequest = await req.json();
    const { message, context } = body;

    if (!message) {
      return NextResponse.json({ error: '메시지가 필요합니다.' }, { status: 400 });
    }

    const supabase = await createClient();

    const fullPrompt = `
${SYSTEM_PROMPT}

${DB_SCHEMA}

${BUSINESS_RULES}

== 현재 사용자 context ==
${context?.userId ? `사용자 ID: ${context.userId}` : ''}
${context?.userRole ? `역할: ${context.userRole}` : ''}
${context?.branchId ? `지점 ID: ${context.branchId}` : ''}

== 사용자 명령 ==
${message}

위 명령을 해석하여 JSON 형식으로만 응답하세요. operation 가능한 값:
- inventory_transfer (재고 이동)
- inventory_adjust (재고 조정)
- inventory_in (재고 입고)
- inventory_out (재고 출고)
- point_earn (포인트 적립)
- point_use (포인트 사용)
- point_query (포인트 조회)
- customer_query (고객 조회)
- customer_create (고객 등록)
- order_query (주문 조회)
- product_query (제품 조회)
- info (일반 정보 조회)

응답은 JSON 하나만, 설명 추가 금지.
`;

    const messages: MiniMaxMessage[] = [
      { role: 'system', content: fullPrompt },
      { role: 'user', content: message },
    ];

    console.log('Calling MiniMax...');
    const response = await miniMaxClient.chat(messages);
    console.log('MiniMax raw response:', response.substring(0, 500));

    let intent: IntentResult;
    try {
      const cleaned = response.replace(/```json\n?/g, '').replace(/\n?```/g, '').trim();
      console.log('Cleaned response:', cleaned.substring(0, 200));
      intent = JSON.parse(cleaned);
    } catch (e: any) {
      console.error('JSON parse error:', e.message);
      return NextResponse.json({
        type: 'error',
        message: '명령을 이해하지 못했습니다. 다시 입력해주세요.',
        raw: response,
      });
    }

    const { operation, table, data, requiresConfirmation, confirmationMessage } = intent;

    if (requiresConfirmation) {
      return NextResponse.json({
        type: 'confirm',
        message: confirmationMessage || '이 작업을 실행할까요?',
        operation,
        data,
      });
    }

    const result = await executeOperation(supabase, operation, data);

    return NextResponse.json({
      type: 'success',
      message: result.message,
      data: result.data,
    });
  } catch (error: any) {
    console.error('Agent error:', error);
    console.error('Error stack:', error.stack);
    return NextResponse.json({
      type: 'error',
      message: error.message || '에러가 발생했습니다.',
      error: error.toString(),
    }, { status: 500 });
  }
}

async function executeOperation(supabase: any, operation: string, data: Record<string, any>) {
  switch (operation) {
    case 'inventory_transfer': {
      const { fromBranchId, toBranchId, productId, quantity, memo } = data;

      const fromInventory = await supabase
        .from('inventories')
        .select('id, quantity')
        .eq('branch_id', fromBranchId)
        .eq('product_id', productId)
        .single();

      if (!fromInventory.data || fromInventory.data.quantity < quantity) {
        throw new Error(`원래 지점 재고가 부족합니다. (현재: ${fromInventory.data?.quantity || 0})`);
      }

      await supabase.from('inventory_movements').insert({
        branch_id: fromBranchId,
        product_id: productId,
        movement_type: 'OUT',
        quantity: -quantity,
        memo: memo || `재고 이동: ${quantity}개`,
      });

      await supabase.from('inventories').update({
        quantity: fromInventory.data.quantity - quantity,
      }).eq('id', fromInventory.data.id);

      let toInventory = await supabase
        .from('inventories')
        .select('id, quantity')
        .eq('branch_id', toBranchId)
        .eq('product_id', productId)
        .single();

      if (toInventory.data) {
        await supabase.from('inventories').update({
          quantity: toInventory.data.quantity + quantity,
        }).eq('id', toInventory.data.id);
      } else {
        await supabase.from('inventories').insert({
          branch_id: toBranchId,
          product_id: productId,
          quantity: quantity,
        });
      }

      await supabase.from('inventory_movements').insert({
        branch_id: toBranchId,
        product_id: productId,
        movement_type: 'IN',
        quantity: quantity,
        memo: memo || `재고 이동: ${quantity}개`,
      });

      return {
        message: `재고 이동 완료: ${quantity}개 이동`,
        data: { fromBranchId, toBranchId, productId, quantity },
      };
    }

    case 'inventory_adjust': {
      const { branchId, productId, quantity, newQuantity, memo, reason } = data;

      let inventory = await supabase
        .from('inventories')
        .select('id, quantity')
        .eq('branch_id', branchId)
        .eq('product_id', productId)
        .single();

      if (!inventory.data) {
        await supabase.from('inventories').insert({
          branch_id: branchId,
          product_id: productId,
          quantity: newQuantity,
        });
        inventory = await supabase
          .from('inventories')
          .select('id, quantity')
          .eq('branch_id', branchId)
          .eq('product_id', productId)
          .single();
      } else {
        await supabase.from('inventories').update({
          quantity: newQuantity,
        }).eq('id', inventory.data.id);
      }

      await supabase.from('inventory_movements').insert({
        branch_id: branchId,
        product_id: productId,
        movement_type: 'ADJUST',
        quantity: newQuantity - (inventory.data?.quantity || 0),
        memo: memo || `재고 조정: ${reason || '직접 조정'}`,
      });

      return {
        message: `재고 조정 완료: ${inventory.data?.quantity || 0} -> ${newQuantity}`,
        data: { branchId, productId, oldQuantity: inventory.data?.quantity, newQuantity },
      };
    }

    case 'point_earn': {
      const { customerId, points, salesOrderId, description } = data;

      const lastHistory = await supabase
        .from('point_history')
        .select('balance')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const currentBalance = lastHistory?.data?.balance || 0;
      const newBalance = currentBalance + points;

      await supabase.from('point_history').insert({
        customer_id: customerId,
        sales_order_id: salesOrderId || null,
        type: 'earn',
        points: points,
        balance: newBalance,
        description: description || `포인트 적립: ${points}P`,
      });

      return {
        message: `포인트 적립 완료: ${points}P (현재 잔액: ${newBalance}P)`,
        data: { customerId, points, newBalance },
      };
    }

    case 'point_use': {
      const { customerId, points, salesOrderId, description } = data;

      const lastHistory = await supabase
        .from('point_history')
        .select('balance')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const currentBalance = lastHistory?.data?.balance || 0;

      if (currentBalance < points) {
        throw new Error(`포인트가 부족합니다. (보유: ${currentBalance}P, 사용 요청: ${points}P)`);
      }

      const newBalance = currentBalance - points;

      await supabase.from('point_history').insert({
        customer_id: customerId,
        sales_order_id: salesOrderId || null,
        type: 'use',
        points: -points,
        balance: newBalance,
        description: description || `포인트 사용: ${points}P`,
      });

      return {
        message: `포인트 사용 완료: ${points}P 차감 (현재 잔액: ${newBalance}P)`,
        data: { customerId, points, newBalance },
      };
    }

    case 'customer_create': {
      const { name, phone, email, grade, primaryBranchId, source } = data;

      const { data: customer, error } = await supabase
        .from('customers')
        .insert({
          name,
          phone,
          email: email || null,
          grade: grade || 'NORMAL',
          primary_branch_id: primaryBranchId || null,
          source: source || 'DIRECT',
        })
        .select()
        .single();

      if (error) throw new Error(`고객 등록 실패: ${error.message}`);

      return {
        message: `고객 등록 완료: ${name} (${phone})`,
        data: customer,
      };
    }

    case 'product_query': {
      const { search, limit } = data;
      let query = supabase.from('products').select('*').eq('is_active', true);

      if (search) {
        query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%,barcode.ilike.%${search}%`);
      }

      const { data: products, error } = await query.limit(limit || 20).order('name');

      if (error) throw new Error(`제품 조회 실패: ${error.message}`);

      return {
        message: `${products?.length || 0}개 제품 조회됨`,
        data: products,
      };
    }

    case 'customer_query': {
      const { search } = data;
      let query = supabase.from('customers').select('*, primary_branch:branches(name)').eq('is_active', true);

      if (search) {
        query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
      }

      const { data: customers, error } = await query.limit(20).order('created_at', { ascending: false });

      if (error) throw new Error(`고객 조회 실패: ${error.message}`);

      return {
        message: `${customers?.length || 0}명 고객 조회됨`,
        data: customers,
      };
    }

    default:
      return {
        message: `알 수 없는 작업입니다: ${operation}`,
        data: {},
      };
  }
}

export async function GET(req: NextRequest) {
  return NextResponse.json({
    status: 'ok',
    message: 'AI Agent API is running',
    available_operations: [
      'inventory_transfer',
      'inventory_adjust',
      'inventory_in',
      'inventory_out',
      'point_earn',
      'point_use',
      'point_query',
      'customer_query',
      'customer_create',
      'order_query',
      'product_query',
    ],
  });
}
