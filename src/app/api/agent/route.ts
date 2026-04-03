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
  log('Extracting SQL from response:', response.substring(0, 300));
  
  try {
    const cleaned = response.replace(/```json\n?/g, '').replace(/\n?```/g, '').trim();
    log('Cleaned response:', cleaned.substring(0, 200));
    
    const parsed = JSON.parse(cleaned);
    log('Parsed JSON:', parsed);
    return parsed.sql || parsed.query || parsed.query_sql || parsed.SQL || null;
  } catch (e) {
    log('JSON parse failed, trying regex extraction');
    
    const patterns = [
      /(?:sql|query)["']?\s*[:=]\s*["']?([^"'`;]+)/i,
      /SELECT\s+[^;]+/i,
      /"sql"\s*:\s*"([^"]+)"/i,
      /'sql'\s*:\s*'([^']+)'/i,
    ];
    
    for (const pattern of patterns) {
      const match = response.match(pattern);
      if (match) {
        const sql = match[1] || match[0];
        if (sql.toUpperCase().includes('SELECT')) {
          log('Found SQL via regex:', sql.substring(0, 100));
          return sql.trim();
        }
      }
    }
    
    return null;
  }
}

function parseQueryIntent(sql: string): { table: string; alias: string; filters: Record<string, any>; fields: string[]; joins: any[] } {
  const normalized = sql.toLowerCase();
  
  const fromMatch = sql.match(/FROM\s+(\w+)(?:\s+(\w+))?/i);
  const table = fromMatch ? fromMatch[1].toLowerCase() : '';
  const alias = fromMatch && fromMatch[2] ? fromMatch[2].toLowerCase() : '';
  
  const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
  const fields = selectMatch ? selectMatch[1].split(',').map((f: string) => f.trim()) : ['*'];
  
  const filters: Record<string, any> = {};
  const joins: any[] = [];
  
  const joinMatches = sql.matchAll(/JOIN\s+(\w+)(?:\s+(\w+))?\s+ON\s+[\w.]+\s*=\s*[\w.]+/gi);
  for (const match of joinMatches) {
    joins.push({ table: match[1].toLowerCase(), alias: match[2] || '' });
  }
  
  if (normalized.includes('where')) {
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+(?:ORDER|GROUP|LIMIT|HAVING|JOIN)|$)/i);
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
      
      const gtMatch = whereClause.match(/(\w+)\s*>\s*(\d+)/i);
      if (gtMatch) {
        filters[gtMatch[1]] = { op: 'gt', value: parseInt(gtMatch[2]) };
      }
      
      const neMatch = whereClause.match(/(\w+)\s*<>?\s*['"]?(\w+)['"]?/gi);
      if (neMatch) {
        for (const n of neMatch) {
          const parts = n.split(/\s*<>?\s*/);
          if (parts[0] && parts[1]) {
            filters[parts[0]] = { op: 'ne', value: parts[1].replace(/['"]/g, '') };
          }
        }
      }
    }
  }
  
  return { table, alias, filters, fields, joins };
}

function buildQueryFromKeywords(message: string): string | null {
  const msg = message.toLowerCase();
  
  const koreanNamePattern = /([가-힣]{2,4})(?:동|님|씨|氏)/;
  const nameMatch = message.match(koreanNamePattern);
  
  if (nameMatch && (msg.includes('고객') || msg.includes('정보') || msg.includes('조회'))) {
    const name = nameMatch[1];
    return `SELECT * FROM customers WHERE name LIKE '%${name}%' LIMIT 5`;
  }
  
  if (msg.includes('고객')) {
    if (msg.includes('리스트') || msg.includes('목록') || msg.includes('전체')) {
      return 'SELECT * FROM customers WHERE is_active = true ORDER BY created_at DESC LIMIT 20';
    }
    if (nameMatch) {
      const name = nameMatch[1];
      return `SELECT * FROM customers WHERE name LIKE '%${name}%' LIMIT 5`;
    }
    return 'SELECT * FROM customers WHERE is_active = true ORDER BY created_at DESC LIMIT 20';
  }
  
  if (msg.includes('적립률') || msg.includes('적립율')) {
    return 'SELECT * FROM customer_grades ORDER BY sort_order';
  }
  
  if (msg.includes('포인트') || msg.includes('적립금')) {
    if (nameMatch) {
      const name = nameMatch[1];
      return `SELECT * FROM customers WHERE name LIKE '%${name}%' LIMIT 5`;
    }
    return null;
  }
  
  if (msg.includes('제품') || msg.includes('상품')) {
    const productMatch = message.match(/([가-힣\w]+)(?:제품|상품)/);
    if (productMatch) {
      return `SELECT * FROM products WHERE name LIKE '%${productMatch[1]}%' AND is_active = true LIMIT 20`;
    }
    return 'SELECT * FROM products WHERE is_active = true ORDER BY name LIMIT 20';
  }
  
  if (msg.includes('지점') && !msg.includes('고객')) {
    return 'SELECT * FROM branches WHERE is_active = true ORDER BY name';
  }
  
  if (msg.includes('재고')) {
    return 'SELECT * FROM inventories WHERE quantity > 0 LIMIT 20';
  }
  
  if (msg.includes('매출') || msg.includes('주문') || msg.includes('판매')) {
    return "SELECT * FROM sales_orders WHERE status = 'COMPLETED' ORDER BY ordered_at DESC LIMIT 20";
  }
  
  return null;
}

async function executeSmartQuery(supabase: any, sql: string): Promise<{ data: any; error: any }> {
  const { table, alias, filters, fields, joins } = parseQueryIntent(sql);
  
  log('Parsed query intent:', { table, alias, filters, fields, joins });
  
  const allowedTables = ['branches', 'products', 'inventories', 'inventory_movements', 'customers', 'customer_grades', 'point_history', 'sales_orders', 'sales_order_items', 'users', 'categories', 'notifications', 'cafe24_sync_logs'];
  
  if (!allowedTables.includes(table)) {
    return { data: null, error: { message: `테이블 '${table}'은(는) 조회할 수 없습니다.` } };
  }
  
  try {
    let query: any;
    
    if (table === 'inventories') {
      query = supabase
        .from('inventories')
        .select('*, products(name, code, barcode), branches(name)')
        .gt('quantity', 0);
    } else if (table === 'point_history') {
      query = supabase
        .from('point_history')
        .select('*, customers(name, phone)')
        .order('created_at', { ascending: false });
    } else {
      query = (supabase as any).from(table).select('*');
    }
    
    for (const [fld, cond] of Object.entries(filters)) {
      const condition = cond as { op: string; value: any };
      let fieldName = fld;
      if (alias && fld.startsWith(alias + '.')) {
        fieldName = fld.replace(alias + '.', '');
      }
      if (condition.op === 'like') {
        query = query.like(fieldName, `%${condition.value}%`);
      } else if (condition.op === 'eq') {
        query = query.eq(fieldName, condition.value);
      } else if (condition.op === 'gt') {
        query = query.gt(fieldName, condition.value);
      } else if (condition.op === 'ne') {
        query = query.neq(fieldName, condition.value);
      }
    }
    
    const orderMatch = sql.match(/ORDER BY\s+(?:\w+\.)?(\w+)(?:\s+(ASC|DESC))?/i);
    if (orderMatch) {
      query = query.order(orderMatch[1], { ascending: orderMatch[2]?.toUpperCase() !== 'DESC' });
    }
    
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      query = query.limit(parseInt(limitMatch[1]));
    } else {
      query = query.limit(20);
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

    log('Calling MiniMax API...');
    const response = await miniMaxClient.chat(messages);
    log('MiniMax response received');

    const keywordSql = buildQueryFromKeywords(message);
    
    if (keywordSql) {
      log('Using keyword-based query:', keywordSql);
      const supabase = await createClient();
      const { data, error } = await executeSmartQuery(supabase, keywordSql);
      if (error) {
        return NextResponse.json({ type: 'error', message: `쿼리 실행 실패: ${error.message}` });
      }
      return NextResponse.json({ type: 'success', message: formatNaturalResponse(message, data) });
    }

    const sqlQuery = extractSqlFromResponse(response);
    
    if (!sqlQuery) {
      return NextResponse.json({
        type: 'error',
        message: '질문을 이해하지 못했습니다. 다른 방식으로 다시 시도해주세요.',
      });
    }

    if (!isValidSelectQuery(sqlQuery)) {
      return NextResponse.json({
        type: 'error',
        message: '보안 정책에 위배되는 쿼리는 실행할 수 없습니다.',
      });
    }

    log('Executing AI SQL:', sqlQuery);
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
  
  if (keys.includes('name') && keys.includes('phone') && keys.includes('grade')) {
    let msg = '';
    if (record.name) msg += `${record.name}`;
    if (record.phone) msg += ` (전화번호: ${record.phone})`;
    if (record.grade) {
      const gradeNames: Record<string, string> = { NORMAL: '일반', VIP: 'VIP', VVIP: 'VVIP' };
      msg += `, 등급: ${gradeNames[record.grade] || record.grade}`;
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
    if (record.source) msg += `, 출처: ${record.source}`;
    if (record.channel) {
      const channelNames: Record<string, string> = { STORE: '한약국', DEPT_STORE: '백화점', ONLINE: '자사몰', EVENT: '이벤트' };
      msg += `, 채널: ${channelNames[record.channel] || record.channel}`;
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
  const koreanNamePattern = /([가-힣]{2,4})(?:동|님|씨|氏)/;
  const questionNameMatch = question.match(koreanNamePattern);
  
  const isCustomerList = records[0] && 'name' in records[0] && 'phone' in records[0];
  if (isCustomerList) {
    if (records.length === 1) {
      const c = records[0];
      const gradeNames: Record<string, string> = { NORMAL: '일반', VIP: 'VIP', VVIP: 'VVIP' };
      let msg = `${c.name} 고객 정보:\n`;
      msg += `• 전화번호: ${c.phone || '없음'}\n`;
      msg += `• 등급: ${gradeNames[c.grade] || c.grade || '일반'}\n`;
      if (c.balance !== undefined && c.balance !== null) {
        msg += `• 적립포인트: ${Number(c.balance).toLocaleString()}P\n`;
      }
      if (c.source) msg += `• 등록출처: ${c.source}\n`;
      if (c.created_at) {
        const date = new Date(c.created_at);
        msg += `• 등록일: ${date.toLocaleDateString('ko-KR')}\n`;
      }
      return msg.trim();
    }
    
    if (questionNameMatch) {
      const name = questionNameMatch[1];
      const filtered = records.filter((c: any) => c.name && c.name.includes(name));
      if (filtered.length === 1) {
        const c = filtered[0];
        const gradeNames: Record<string, string> = { NORMAL: '일반', VIP: 'VIP', VVIP: 'VVIP' };
        let msg = `${c.name} 고객 정보:\n`;
        msg += `• 전화번호: ${c.phone || '없음'}\n`;
        msg += `• 등급: ${gradeNames[c.grade] || c.grade || '일반'}\n`;
        if (c.balance !== undefined && c.balance !== null) {
          msg += `• 적립포인트: ${Number(c.balance).toLocaleString()}P\n`;
        }
        return msg.trim();
      }
    }
    
    const gradeNames: Record<string, string> = { NORMAL: '일반', VIP: 'VIP', VVIP: 'VVIP' };
    const list = records.slice(0, 10).map((c: any, i: number) => {
      let line = `${i + 1}. ${c.name} (${c.phone || '전화번호 없음'})`;
      if (c.grade) line += ` - ${gradeNames[c.grade] || c.grade}`;
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
    const list = records.slice(0, 10).map((inv: any, i: number) => {
      const productName = inv.product_name || inv.products?.name || inv.name || 
                   (inv.products ? '제품' : '알 수 없는 제품');
      const branchName = inv.branch_name || inv.branches?.name || '';
      let line = `${i + 1}. ${productName}: ${inv.quantity}개`;
      if (branchName) line += ` [${branchName}]`;
      if (inv.safety_stock) line += ` (안전재고 ${inv.safety_stock})`;
      return line;
    }).join('\n');
    const suffix = records.length > 10 ? `\n...이 외 ${records.length - 10}개` : '';
    return `${records.length}개 재고가 조회되었습니다:\n${list}${suffix}`;
  }
  
  const isGradeList = records[0] && 'point_rate' in records[0];
  if (isGradeList) {
    const gradeNames: Record<string, string> = { NORMAL: '일반', VIP: 'VIP', VVIP: 'VVIP' };
    return records.map(g => `${gradeNames[g.code] || g.name || g.code}: 적립률 ${g.point_rate}%`).join('\n');
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
