import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { miniMaxClient, MiniMaxMessage } from '@/lib/ai/client';
import { SYSTEM_PROMPT, DB_SCHEMA, BUSINESS_RULES, QUERY_EXAMPLES } from '@/lib/ai/schema';

interface AgentRequest {
  message: string;
  context?: {
    userId?: string;
    userRole?: string;
    branchId?: string;
  };
}

function log(msg: string, data?: any) {
  console.log(`[Agent] ${msg}`, data || '');
}

function isValidSelectQuery(sql: string): boolean {
  const normalized = sql.trim().toUpperCase();
  if (!normalized.startsWith('SELECT')) return false;
  const dangerous = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'GRANT', 'REVOKE', ';--', 'EXEC', 'EXECUTE'];
  for (const keyword of dangerous) {
    if (normalized.includes(keyword)) return false;
  }
  return true;
}

function extractSqlFromResponse(response: string): string | null {
  try {
    const parsed = JSON.parse(response.replace(/```json\n?/g, '').replace(/\n?```/g, '').trim());
    return parsed.sql || parsed.query || parsed.query_sql || null;
  } catch (e) {
    const sqlMatch = response.match(/(?:sql|query)["']?\s*[:=]\s*["']?([^"'`;]+)/i);
    if (sqlMatch) return sqlMatch[1].trim();
    
    const selectMatch = response.match(/(SELECT\s+[^;]+)/i);
    if (selectMatch) return selectMatch[1].trim();
    
    return null;
  }
}

function parseQueryIntent(sql: string): { table: string; filters: Record<string, any>; fields: string[] } {
  const normalized = sql.toLowerCase();
  const tableMatch = sql.match(/FROM\s+(\w+)/i);
  const table = tableMatch ? tableMatch[1].toLowerCase() : '';
  
  const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
  const fields = selectMatch ? selectMatch[1].split(',').map((f: string) => f.trim()) : ['*'];
  
  const filters: Record<string, any> = {};
  
  if (normalized.includes('where')) {
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+(?:ORDER|GROUP|LIMIT|HAVING)|$)/i);
    if (whereMatch) {
      const whereClause = whereMatch[1].trim();
      
      const likeMatch = whereClause.match(/(\w+)\s+(?:LIKE|ILIKE)\s+['"]%?(.+?)%?['"]/i);
      if (likeMatch) {
        filters[likeMatch[1]] = { op: 'like', value: likeMatch[2] };
      }
      
      const eqMatch = whereClause.match(/(\w+)\s*=\s*['"]([^'"]+)['"]/i);
      if (eqMatch) {
        filters[eqMatch[1]] = { op: 'eq', value: eqMatch[2] };
      }
    }
  }
  
  return { table, filters, fields };
}

async function executeSmartQuery(supabase: any, sql: string): Promise<{ data: any; error: any }> {
  const { table, filters, fields } = parseQueryIntent(sql);
  
  log('Parsed query intent:', { table, filters, fields });
  
  const allowedTables = ['branches', 'products', 'inventories', 'inventory_movements', 'customers', 'customer_grades', 'point_history', 'sales_orders', 'sales_order_items', 'users', 'categories', 'notifications', 'cafe24_sync_logs'];
  
  if (!allowedTables.includes(table)) {
    return { data: null, error: { message: `테이블 '${table}'은(는) 조회할 수 없습니다.` } };
  }
  
  try {
    let query = (supabase as any).from(table).select(fields.join(','));
    
    for (const [field, cond] of Object.entries(filters)) {
      const condition = cond as { op: string; value: string };
      if (condition.op === 'like') {
        query = query.like(field, `%${condition.value}%`);
      } else if (condition.op === 'eq') {
        query = query.eq(field, condition.value);
      }
    }
    
    const orderMatch = sql.match(/ORDER BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
    if (orderMatch) {
      query = query.order(orderMatch[1], { ascending: orderMatch[2]?.toUpperCase() !== 'DESC' });
    }
    
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      query = query.limit(parseInt(limitMatch[1]));
    } else {
      query = query.limit(20);
    }
    
    if (table === 'customers') {
      query = query.select('*, customer_grades(name, point_rate), branches(name)');
    } else if (table === 'inventories') {
      query = query.select('*, products(name, code), branches(name)');
    } else if (table === 'point_history') {
      query = query.select('*, customers(name, phone)');
    }
    
    const { data, error } = await query;
    return { data, error };
  } catch (e: any) {
    return { data: null, error: { message: e.message } };
  }
}

export async function POST(req: NextRequest) {
  try {
    log('Request received');

    const body: AgentRequest = await req.json();
    const { message, context } = body;

    if (!message) {
      return NextResponse.json({ error: '메시지가 필요합니다.' }, { status: 400 });
    }

    log('Message received', message);

    const fullPrompt = `${SYSTEM_PROMPT}

${DB_SCHEMA}

${QUERY_EXAMPLES}

${BUSINESS_RULES}

== 현재 사용자 ==
${context?.userId ? `사용자 ID: ${context.userId}` : ''}
${context?.userRole ? `역할: ${context.userRole}` : ''}
${context?.branchId ? `지점 ID: ${context.branchId}` : ''}

== 사용자 질문 ==
${message}

주의: 반드시 SELECT 쿼리만 생성하세요. 절대 INSERT, UPDATE, DELETE 등을 하지 마세요.`;

    const messages: MiniMaxMessage[] = [
      { role: 'system', content: fullPrompt },
      { role: 'user', content: message },
    ];

    log('Calling MiniMax API for SQL generation...');
    const response = await miniMaxClient.chat(messages);
    log('MiniMax response received', response.substring(0, 500));

    const sqlQuery = extractSqlFromResponse(response);
    
    if (!sqlQuery) {
      log('Could not extract SQL from response');
      return NextResponse.json({
        type: 'error',
        message: '질문을 이해하지 못했습니다. 다시 시도해주세요.',
      });
    }

    if (!isValidSelectQuery(sqlQuery)) {
      log('Invalid query detected', sqlQuery);
      return NextResponse.json({
        type: 'error',
        message: '보안 정책에 위배되는 쿼리는 실행할 수 없습니다.',
      });
    }

    log('Executing SQL:', sqlQuery);
    const supabase = await createClient();
    const { data, error } = await executeSmartQuery(supabase, sqlQuery);

    if (error) {
      return NextResponse.json({
        type: 'error',
        message: `쿼리 실행 실패: ${error.message}`,
      });
    }

    log('Query result count:', Array.isArray(data) ? data.length : 'not array');

    const naturalResponse = formatNaturalResponse(message, data);

    return NextResponse.json({
      type: 'success',
      message: naturalResponse,
    });

  } catch (error: any) {
    log('Error caught', error.message);
    log('Error stack', error.stack);
    return NextResponse.json({
      type: 'error',
      message: error.message || '에러가 발생했습니다.',
    }, { status: 500 });
  }
}

function formatNaturalResponse(question: string, data: any): string {
  if (!data) return '데이터가 없습니다.';
  if (Array.isArray(data) && data.length === 0) return '조회 결과가 없습니다.';
  
  const q = question.toLowerCase();

  if (Array.isArray(data)) {
    if (data.length === 0) return '결과가 없습니다.';
    if (data.length === 1) {
      return formatSingleRecord(data[0], q);
    }
    return formatMultipleRecords(data, q);
  }
  
  return formatSingleRecord(data, q);
}

function formatSingleRecord(record: any, question: string): string {
  if (!record) return '데이터가 없습니다.';
  
  const keys = Object.keys(record);
  
  if (keys.includes('name') && keys.includes('phone')) {
    let msg = '';
    if (record.name) msg += `${record.name}`;
    if (record.phone) msg += ` (전화번호: ${record.phone})`;
    if (record.grade) {
      const gradeName = record.grade_name || record.grade;
      msg += `, 등급: ${gradeName}`;
    }
    if (record.point_rate) msg += `, 적립률: ${record.point_rate}%`;
    if (record.balance !== undefined && record.balance !== null) {
      msg += `, 적립포인트: ${Number(record.balance).toLocaleString()}P`;
    }
    if (record.quantity !== undefined && record.quantity !== null) {
      msg += `, 재고: ${record.quantity}개`;
    }
    if (record.price !== undefined && record.price !== null) {
      msg += `, 가격: ${Number(record.price).toLocaleString()}원`;
    }
    if (record.total_amount !== undefined && record.total_amount !== null) {
      msg += `, 금액: ${Number(record.total_amount).toLocaleString()}원`;
    }
    if (record.status) msg += `, 상태: ${record.status}`;
    if (record.payment_method) msg += `, 결제: ${record.payment_method}`;
    if (record.created_at) {
      const date = new Date(record.created_at);
      msg += `, 등록일: ${date.toLocaleDateString('ko-KR')}`;
    }
    return msg || JSON.stringify(record);
  }
  
  if (keys.includes('quantity') && (keys.includes('product_name') || keys.includes('name'))) {
    const name = record.product_name || record.name || '제품';
    return `${name}: 재고 ${record.quantity}개${record.safety_stock ? ` (안전재고: ${record.safety_stock})` : ''}`;
  }
  
  if (keys.includes('total_amount') || keys.includes('order_number')) {
    let msg = `주문번호: ${record.order_number}`;
    if (record.total_amount) msg += `, 금액: ${Number(record.total_amount).toLocaleString()}원`;
    if (record.status) msg += `, 상태: ${record.status}`;
    if (record.payment_method) msg += `, 결제: ${record.payment_method}`;
    return msg;
  }
  
  if (keys.includes('code') && keys.includes('point_rate')) {
    return `${record.name || record.code} 등급: 적립률 ${record.point_rate}%`;
  }
  
  const importantFields = ['name', 'phone', 'grade', 'point_rate', 'balance', 'quantity', 'price', 'status', 'code'];
  const displayFields = keys.filter(k => importantFields.includes(k) && record[k] !== null && record[k] !== undefined);
  
  if (displayFields.length > 0) {
    return displayFields.map(k => {
      let val = record[k];
      if (k === 'point_rate') val = `${val}%`;
      if (k === 'price' || k === 'total_amount') val = `${Number(val).toLocaleString()}원`;
      if (k === 'balance') val = `${Number(val).toLocaleString()}P`;
      return `${k}: ${val}`;
    }).join(', ');
  }
  
  return JSON.stringify(record);
}

function formatMultipleRecords(records: any[], question: string): string {
  const q = question.toLowerCase();
  
  const isCustomerList = records[0] && 'name' in records[0] && 'phone' in records[0];
  if (isCustomerList) {
    const list = records.slice(0, 10).map((c: any, i: number) => {
      let line = `${i + 1}. ${c.name} (${c.phone || '전화번호 없음'})`;
      if (c.grade) line += ` - ${c.grade}`;
      if (c.balance !== undefined && c.balance !== null) line += ` - ${Number(c.balance).toLocaleString()}P`;
      return line;
    }).join('\n');
    const suffix = records.length > 10 ? `\n...이 외 ${records.length - 10}명` : '';
    return `${records.length}명의 고객이 조회되었습니다:\n${list}${suffix}`;
  }
  
  const isProductList = records[0] && 'name' in records[0] && 'price' in records[0];
  if (isProductList) {
    const list = records.slice(0, 10).map((p: any, i: number) => {
      return `${i + 1}. ${p.name} - ${Number(p.price || 0).toLocaleString()}원`;
    }).join('\n');
    const suffix = records.length > 10 ? `\n...이 외 ${records.length - 10}개` : '';
    return `${records.length}개 제품이 조회되었습니다:\n${list}${suffix}`;
  }
  
  const isInventoryList = records[0] && 'quantity' in records[0];
  if (isInventoryList) {
    const list = records.slice(0, 5).map((inv: any, i: number) => {
      const name = inv.product_name || inv.products?.name || inv.name || '알 수 없는 제품';
      return `${i + 1}. ${name}: ${inv.quantity}개${inv.safety_stock ? ` (안전재고 ${inv.safety_stock})` : ''}`;
    }).join('\n');
    const suffix = records.length > 5 ? `\n...이 외 ${records.length - 5}개` : '';
    return `${records.length}개 재고가 조회되었습니다:\n${list}${suffix}`;
  }
  
  const isGradeList = records[0] && 'point_rate' in records[0];
  if (isGradeList) {
    return records.map(g => `${g.name || g.code}: 적립률 ${g.point_rate}%`).join('\n');
  }
  
  const isPointHistory = records[0] && 'balance' in records[0];
  if (isPointHistory) {
    const latest = records[0];
    const customerName = latest.customers?.name || latest.name || '고객';
    return `${customerName}의 현재 적립포인트: ${Number(latest.balance).toLocaleString()}P`;
  }
  
  const isBranchList = records[0] && 'code' in records[0] && !records[0].price;
  if (isBranchList) {
    const list = records.map((b: any, i: number) => `${i + 1}. ${b.name} (${b.code}) - ${b.channel || ''}`).join('\n');
    return `${records.length}개의 지점이 조회되었습니다:\n${list}`;
  }
  
  return `${records.length}개 결과가 조회되었습니다.`;
}

export async function GET(req: NextRequest) {
  return NextResponse.json({
    status: 'ok',
    message: 'AI Agent API is running',
  });
}
