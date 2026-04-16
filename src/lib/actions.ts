'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { fireNotificationTrigger } from '@/lib/notification-triggers';
import { computeBomCost } from '@/lib/production-actions';

// ============ Products ============

export async function getProducts(search?: string) {
  const supabase = await createClient();
  let query = supabase.from('products').select('*, category:categories(*)').order('created_at', { ascending: false });
  
  if (search) {
    query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`);
  }
  
  const { data } = await query;
  return { data: data || [] };
}

export async function createProduct(formData: FormData) {
  const supabase = await createClient();

  const name = formData.get('name') as string;
  const nameCode = name
    .replace(/[^a-zA-Z0-9가-힣]/g, '')
    .substring(0, 4)
    .toUpperCase()
    .padEnd(4, 'X');
  const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const code = `KYO-${nameCode}-${randomCode}`;

  const rawCategoryId = formData.get('category_id') as string;
  const rawBarcode = formData.get('barcode') as string;
  const rawImageUrl = formData.get('image_url') as string;
  const rawSpec = formData.get('spec') as string;
  const rawType = formData.get('product_type') as string;
  const productType = (rawType === 'RAW' || rawType === 'SUB' || rawType === 'FINISHED') ? rawType : 'FINISHED';
  const rawCostSource = formData.get('cost_source') as string;
  let costSource: 'MANUAL' | 'BOM' = (rawCostSource === 'BOM' ? 'BOM' : 'MANUAL');
  if (productType !== 'FINISHED') costSource = 'MANUAL'; // RAW/SUB는 항상 수동

  const priceInput = parseInt(formData.get('price') as string);
  const costInput = parseInt(formData.get('cost') as string) || null;

  // RAW/SUB는 판매가 UI가 숨겨지므로 price = cost로 동기화 (schema NOT NULL 회피)
  const finalPrice = productType === 'FINISHED'
    ? (Number.isFinite(priceInput) ? priceInput : 0)
    : (costInput || 0);

  const productData = {
    name,
    code,
    category_id: (rawCategoryId && rawCategoryId !== 'null') ? rawCategoryId : null,
    product_type: productType,
    cost_source: costSource,
    unit: formData.get('unit') as string || '개',
    price: finalPrice,
    cost: costInput,
    barcode: (rawBarcode && rawBarcode !== 'null') ? rawBarcode : null,
    is_taxable: formData.get('is_taxable') !== 'false',
    image_url: rawImageUrl || null,
    spec: rawSpec ? JSON.parse(rawSpec) : {},
    description: (formData.get('description') as string) || null,
  };

  // @ts-ignore
  const { data: newProduct, error } = await supabase.from('products').insert(productData).select().single() as any;
  
  if (error) {
    return { error: error.message };
  }

  // 제품 생성 시 모든 활성 지점에 재고 레코드 자동 생성
  const { data: branches } = await supabase
    .from('branches')
    .select('id')
    .eq('is_active', true);

  if (branches && branches.length > 0) {
    const inventoryRecords = branches.map((branch: any) => ({
      product_id: newProduct.id,
      branch_id: branch.id,
      quantity: 0,
      safety_stock: 0,
    }));

    await supabase.from('inventories').insert(inventoryRecords as any);
  }
  
  revalidatePath('/products');
  revalidatePath('/inventory');
  return { success: true };
}

export async function updateProduct(id: string, formData: FormData) {
  const supabase = await createClient();
  

  const rawCategoryId = formData.get('category_id') as string;
  const rawBarcode = formData.get('barcode') as string;
  const rawImageUrl = formData.get('image_url') as string;
  const rawCode = (formData.get('code') as string)?.trim().toUpperCase();
  const rawSpec = formData.get('spec') as string;
  const rawType = formData.get('product_type') as string;
  const productType = (rawType === 'RAW' || rawType === 'SUB' || rawType === 'FINISHED') ? rawType : undefined;
  const rawCostSource = formData.get('cost_source') as string;
  const costSource: 'MANUAL' | 'BOM' | undefined =
    rawCostSource === 'BOM' ? 'BOM' : rawCostSource === 'MANUAL' ? 'MANUAL' : undefined;
  const finalCostSource = (productType === 'RAW' || productType === 'SUB') ? 'MANUAL' : costSource;

  const priceInput = parseInt(formData.get('price') as string);
  const costInput = parseInt(formData.get('cost') as string) || null;

  // RAW/SUB은 판매가 UI가 숨겨지므로 price = cost (NOT NULL 회피)
  const isMaterial = productType === 'RAW' || productType === 'SUB';
  const finalPrice = isMaterial
    ? (costInput || 0)
    : (Number.isFinite(priceInput) ? priceInput : 0);

  const productData: any = {
    name: formData.get('name') as string,
    ...(rawCode ? { code: rawCode } : {}),
    category_id: (rawCategoryId && rawCategoryId !== 'null') ? rawCategoryId : null,
    ...(productType ? { product_type: productType } : {}),
    ...(finalCostSource ? { cost_source: finalCostSource } : {}),
    unit: formData.get('unit') as string || '개',
    price: finalPrice,
    cost: costInput,
    barcode: (rawBarcode && rawBarcode !== 'null') ? rawBarcode : null,
    is_active: formData.get('is_active') === 'true',
    is_taxable: formData.get('is_taxable') !== 'false',
    image_url: rawImageUrl || null,
    ...(rawSpec ? { spec: JSON.parse(rawSpec) } : {}),
    description: (formData.get('description') as string) || null,
  };

  // @ts-ignore
  const { error } = await supabase.from('products').update(productData).eq('id', id);

  if (error) {
    return { error: error.message };
  }

  // 후처리: BOM 원가 자동 반영
  //   1) 완제품이 cost_source=BOM이면 BOM 합계로 cost 재산정
  //   2) RAW/SUB의 cost가 바뀌었으면 이를 사용하는 완제품(cost_source=BOM)의 cost 재산정
  try {
    const db = supabase as any;
    if (productType === 'FINISHED' && finalCostSource === 'BOM') {
      const newCost = await computeBomCost(id);
      await db.from('products').update({ cost: newCost }).eq('id', id);
    }
    if (isMaterial) {
      const { data: usedRows } = await db
        .from('product_bom')
        .select('product_id')
        .eq('material_id', id);
      const usedIds = [...new Set(((usedRows || []) as any[]).map((r: any) => r.product_id))];
      for (const pid of usedIds) {
        const { data: p } = await db
          .from('products')
          .select('id, cost_source, product_type')
          .eq('id', pid)
          .maybeSingle();
        if (p?.cost_source === 'BOM' && p?.product_type === 'FINISHED') {
          const newCost = await computeBomCost(pid as string);
          await db.from('products').update({ cost: newCost }).eq('id', pid);
        }
      }
    }
  } catch (err) {
    console.error('[updateProduct] BOM cost roll-up failed (ignored):', err);
  }

  revalidatePath('/products');
  revalidatePath('/production');
  return { success: true };
}

export async function deleteProduct(id: string) {
  const supabase = await createClient();
  

  const { error } = await supabase.from('products').delete().eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/products');
  return { success: true };
}

// ============ Customers ============

export async function getCustomers(search?: string, grade?: string) {
  const supabase = await createClient();
  let query = supabase.from('customers').select('*, primary_branch:branches(*)').order('created_at', { ascending: false });
  
  if (search) {
    query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
  }
  
  if (grade) {
    query = query.eq('grade', grade);
  }
  
  const { data } = await query;
  return { data: data || [] };
}

export async function createCustomer(formData: FormData) {
  const supabase = await createClient();
  

  const customerData = {
    name: formData.get('name') as string,
    phone: formData.get('phone') as string,
    email: formData.get('email') as string || null,
    address: formData.get('address') as string || null,
    grade: formData.get('grade') as string || 'NORMAL',
    primary_branch_id: formData.get('primary_branch_id') as string || null,
    health_note: formData.get('health_note') as string || null,
  };

  // @ts-ignore
  const { error } = await supabase.from('customers').insert(customerData);

  if (error) {
    return { error: error.message };
  }

  // 신규 회원가입 알림톡 자동 발송 (매핑 등록된 경우만)
  if (customerData.name && customerData.phone) {
    fireNotificationTrigger({
      eventType: 'WELCOME',
      customer: { name: customerData.name, phone: customerData.phone },
      context: { customerGrade: customerData.grade },
    }).catch(() => {});
  }

  revalidatePath('/customers');
  return { success: true };
}

export async function updateCustomer(id: string, formData: FormData) {
  const supabase = await createClient();
  

  const customerData = {
    name: formData.get('name') as string,
    phone: formData.get('phone') as string,
    email: formData.get('email') as string || null,
    address: formData.get('address') as string || null,
    grade: formData.get('grade') as string || 'NORMAL',
    primary_branch_id: formData.get('primary_branch_id') as string || null,
    health_note: formData.get('health_note') as string || null,
    is_active: formData.get('is_active') === 'true',
  };

  // @ts-ignore
  const { error } = await supabase.from('customers').update(customerData).eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/customers');
  return { success: true };
}

export async function deleteCustomer(id: string) {
  const supabase = await createClient();
  

  const { error } = await supabase.from('customers').delete().eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/customers');
  return { success: true };
}

// ============ Inventory ============

export async function getInventory(branchId?: string, search?: string) {
  const supabase = await createClient();
  let query = supabase
    .from('inventories')
    .select('*, branch:branches(*), product:products(*)')
    .order('updated_at', { ascending: false });
  
  if (branchId) {
    query = query.eq('branch_id', branchId);
  }
  
  if (search) {
    query = query.or(`product.name.ilike.%${search}%,product.code.ilike.%${search}%`);
  }
  
  const { data } = await query;
  return { data: data || [] };
}

export async function adjustInventory(formData: FormData) {
  const supabase = await createClient();

  const branchId = formData.get('branch_id') as string;
  const productId = formData.get('product_id') as string;
  const movementType = formData.get('movement_type') as string;
  const quantity = parseInt(formData.get('quantity') as string);
  const safetyStock = parseInt(formData.get('safety_stock') as string) || 0;
  const memo = formData.get('memo') as string;

  const { data: currentArr } = await supabase
    .from('inventories')
    .select('quantity, safety_stock')
    .eq('branch_id', branchId)
    .eq('product_id', productId);
  
  const current = currentArr?.[0] as any;

  if (!current) {
    await supabase.from('inventories').insert({
      branch_id: branchId,
      product_id: productId,
      quantity: Math.abs(quantity),
      safety_stock: safetyStock,
    } as any);
  } else {
    let newQuantity: number;
    if (movementType === 'IN') {
      newQuantity = (current.quantity || 0) + quantity;
    } else if (movementType === 'OUT') {
      newQuantity = (current.quantity || 0) - quantity;
    } else {
      newQuantity = quantity;
    }
    
    await supabase
      .from('inventories')
      // @ts-ignore
      .update({ 
        quantity: Math.max(0, newQuantity),
        safety_stock: safetyStock
      })
      .eq('branch_id', branchId)
      .eq('product_id', productId);
  }

  await supabase.from('inventory_movements').insert({
    branch_id: branchId,
    product_id: productId,
    movement_type: movementType,
    quantity: quantity,
    reference_type: 'MANUAL',
    memo: memo || null,
  } as any);

  revalidatePath('/inventory');
  return { success: true };
}

export async function transferInventory(formData: FormData) {
  const supabase = await createClient();
  const db = supabase as any;

  const fromBranchId = formData.get('from_branch_id') as string;
  const toBranchId = formData.get('to_branch_id') as string;
  const productId = formData.get('product_id') as string;
  const quantity = parseInt(formData.get('quantity') as string);
  const memo = formData.get('memo') as string;

  if (fromBranchId === toBranchId) {
    return { error: '동일 지점 간 이동은 할 수 없습니다.' };
  }

  if (quantity <= 0) {
    return { error: '이동 수량은 1개 이상이어야 합니다.' };
  }

  const fromInventory = await db
    .from('inventories')
    .select('quantity')
    .eq('branch_id', fromBranchId)
    .eq('product_id', productId)
    .single();

  if (!fromInventory.data || fromInventory.data.quantity < quantity) {
    return { error: '이동 수량이 출고 지점의 재고보다 많습니다.' };
  }

  const toInventory = await db
    .from('inventories')
    .select('id, quantity')
    .eq('branch_id', toBranchId)
    .eq('product_id', productId)
    .single();

  if (toInventory.data) {
    await db
      .from('inventories')
      .update({ quantity: toInventory.data.quantity + quantity })
      .eq('id', toInventory.data.id);
  } else {
    await db.from('inventories').insert({
      branch_id: toBranchId,
      product_id: productId,
      quantity: quantity,
      safety_stock: 0,
    });
  }

  await db
    .from('inventories')
    .update({ quantity: fromInventory.data.quantity - quantity })
    .eq('branch_id', fromBranchId)
    .eq('product_id', productId);

  await db.from('inventory_movements').insert({
    branch_id: fromBranchId,
    product_id: productId,
    movement_type: 'OUT',
    quantity: quantity,
    reference_type: 'TRANSFER',
    memo: `지점 이동: ${memo || '출고'}`,
  });

  await db.from('inventory_movements').insert({
    branch_id: toBranchId,
    product_id: productId,
    movement_type: 'IN',
    quantity: quantity,
    reference_type: 'TRANSFER',
    memo: `지점 이동: ${memo || '입고'}`,
  });

  revalidatePath('/inventory');
  return { success: true };
}

// ============ Categories ============

export async function getCategories() {
  const supabase = await createClient();
  const { data } = await supabase.from('categories').select('*').order('sort_order');
  return { data: data || [] };
}

export async function getCategoriesAll() {
  const supabase = await createClient();
  const { data } = await supabase.from('categories').select('*, parent:categories(name)').order('sort_order');
  return { data: data || [] };
}

export async function createCategory(formData: FormData) {
  const supabase = await createClient();
  

  const categoryData = {
    name: formData.get('name') as string,
    parent_id: formData.get('parent_id') as string || null,
    sort_order: parseInt(formData.get('sort_order') as string) || 0,
  };

  // @ts-ignore
  const { error } = await supabase.from('categories').insert(categoryData);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/products');
  revalidatePath('/system-codes');
  return { success: true };
}

export async function updateCategory(id: string, formData: FormData) {
  const supabase = await createClient();
  

  const categoryData = {
    name: formData.get('name') as string,
    parent_id: formData.get('parent_id') as string || null,
    sort_order: parseInt(formData.get('sort_order') as string) || 0,
  };

  // @ts-ignore
  const { error } = await supabase.from('categories').update(categoryData).eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/products');
  revalidatePath('/system-codes');
  return { success: true };
}

export async function deleteCategory(id: string) {
  const supabase = await createClient();
  

  const { error } = await supabase.from('categories').delete().eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/products');
  revalidatePath('/system-codes');
  return { success: true };
}

export async function getBranches() {
  const supabase = await createClient();
  const { data } = await supabase.from('branches').select('*').order('created_at');
  return { data: data || [] };
}

// ============ Branches (System Codes) ============

export async function getBranchesAll() {
  const supabase = await createClient();
  const { data } = await supabase.from('branches').select('*').order('created_at', { ascending: true });
  return { data: data || [] };
}

export async function createBranch(formData: FormData) {
  const supabase = await createClient();

  const branchData = {
    name: formData.get('name') as string,
    code: 'BR-' + Date.now().toString(36).toUpperCase(),
    channel: formData.get('channel') as string,
    address: formData.get('address') as string || null,
    phone: formData.get('phone') as string || null,
  };

  // @ts-ignore
  const { data: newBranch, error } = await supabase.from('branches').insert(branchData).select().single() as any;
  
  if (error) {
    return { error: error.message };
  }

  // 지점 생성 시 모든 제품에 재고 레코드 자동 생성
  const { data: products } = await supabase
    .from('products')
    .select('id')
    .eq('is_active', true);

  if (products && products.length > 0) {
    const inventoryRecords = products.map((product: any) => ({
      product_id: product.id,
      branch_id: newBranch.id,
      quantity: 0,
      safety_stock: 0,
    }));

    await supabase.from('inventories').insert(inventoryRecords as any);
  }
  
  revalidatePath('/branches');
  revalidatePath('/inventory');
  return { success: true };
}

export async function updateBranch(id: string, formData: FormData) {
  const supabase = await createClient();

  const branchData = {
    name: formData.get('name') as string,
    channel: formData.get('channel') as string,
    address: formData.get('address') as string || null,
    phone: formData.get('phone') as string || null,
    is_active: formData.get('is_active') === 'true',
  };

  // @ts-ignore
  const { error } = await supabase.from('branches').update(branchData).eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/branches');
  return { success: true };
}

export async function deleteBranch(id: string) {
  const supabase = await createClient();

  const { error } = await supabase.from('branches').delete().eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/branches');
  return { success: true };
}

// ============ Channels ============

export async function getChannels() {
  const supabase = await createClient();
  const { data } = await supabase.from('channels').select('*').order('sort_order');
  return { data: data || [] };
}

export async function createChannel(formData: FormData) {
  const supabase = await createClient();

  const name = formData.get('name') as string;
  const code = name.replace(/\s+/g, '_').toUpperCase();

  const channelData = {
    id: code,
    code,
    name,
    color: formData.get('color') as string || '#6366f1',
    sort_order: parseInt(formData.get('sort_order') as string) || 0,
    is_active: true,
  };

  // @ts-ignore
  const { error } = await supabase.from('channels').insert(channelData);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

export async function updateChannel(id: string, formData: FormData) {
  const supabase = await createClient();

  const channelData = {
    name: formData.get('name') as string,
    color: formData.get('color') as string || '#6366f1',
    sort_order: parseInt(formData.get('sort_order') as string) || 0,
    is_active: formData.get('is_active') === 'true',
  };

  // @ts-ignore
  const { error } = await supabase.from('channels').update(channelData).eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

export async function deleteChannel(id: string) {
  const supabase = await createClient();

  // 해당 채널을 사용하는 지점이 있는지 확인
  const { data: branches } = await supabase
    .from('branches')
    .select('id')
    .eq('channel', id);
  
  if (branches && branches.length > 0) {
    return { error: '해당 채널을 사용하는 지점이 있어 삭제할 수 없습니다.' };
  }

  const { error } = await supabase.from('channels').delete().eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

// ============ Users (Staff Management) ============

export async function getUsers() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('users')
    .select('*, branch:branches(name)')
    .order('created_at', { ascending: false });
  return { data: data || [] };
}

export async function getUsersByBranch(branchId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('users')
    .select('*, branch:branches(name)')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false });
  return { data: data || [] };
}

export async function createUser(formData: FormData) {
  const supabase = await createClient();
  
  const loginId = formData.get('login_id') as string;
  const password = formData.get('password') as string;
  const name = formData.get('name') as string;
  const phone = formData.get('phone') as string;
  const role = formData.get('role') as string;
  const branchId = formData.get('branch_id') as string;

  // SHA256으로 비밀번호 해싱
  const hashPassword = (pwd: string) => {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(pwd).digest('hex');
  };

  // Create auth user (임시: 자체 로그인人而使用)
  const authEmail = `${loginId}@kyo.local`;
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: authEmail,
    password,
    options: {
      data: { name }
    }
  });

  if (authError) {
    return { error: authError.message };
  }

  // Create user profile with login_id
  const userId = authData?.user?.id || crypto.randomUUID();
  const { error } = await supabase.from('users').insert({
    id: userId,
    login_id: loginId,
    email: authEmail,
    password_hash: hashPassword(password),
    name,
    phone: phone || null,
    role,
    branch_id: branchId || null,
    is_active: true,
  } as any);

  if (error) {
    // auth 사용자가 만들어졌으면 삭제
    if (authData?.user) {
      await supabase.auth.admin.deleteUser(authData.user.id);
    }
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

export async function updateUser(id: string, formData: FormData) {
  const supabase = await createClient();

  const userData: Record<string, any> = {
    name: formData.get('name') as string,
    phone: formData.get('phone') as string || null,
    role: formData.get('role') as string,
  };

  const branchId = formData.get('branch_id') as string;
  if (branchId) {
    userData.branch_id = branchId;
  }

  const isActive = formData.get('is_active');
  if (isActive !== undefined) {
    userData.is_active = isActive === 'true';
  }

  // @ts-ignore
  const { error } = await supabase.from('users').update(userData).eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

export async function deleteUser(id: string) {
  const supabase = await createClient();

  // Delete auth user first
  const { error: authError } = await supabase.auth.admin.deleteUser(id);
  
  if (authError) {
    return { error: authError.message };
  }
  
  // User profile will be deleted via cascade or manually
  await supabase.from('users').delete().eq('id', id);
  
  revalidatePath('/system-codes');
  return { success: true };
}

// ============ Customer Grades (System Codes) ============

export async function getCustomerGrades() {
  const supabase = await createClient();
  const { data } = await supabase.from('customer_grades').select('*').order('sort_order');
  return { data: data || [] };
}

export async function createCustomerGrade(formData: FormData) {
  const supabase = await createClient();
  

  const thresholdRaw = formData.get('upgrade_threshold') as string;
  const gradeData = {
    code: formData.get('code') as string,
    name: formData.get('name') as string,
    description: formData.get('description') as string || null,
    color: formData.get('color') as string || '#6366f1',
    sort_order: parseInt(formData.get('sort_order') as string) || 0,
    point_rate: parseFloat(formData.get('point_rate') as string) || 1.00,
    upgrade_threshold: thresholdRaw && thresholdRaw !== '' ? parseInt(thresholdRaw) : null,
  };

  // @ts-ignore
  const { error } = await supabase.from('customer_grades').insert(gradeData);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

export async function updateCustomerGrade(id: string, formData: FormData) {
  const supabase = await createClient();
  

  const thresholdRaw = formData.get('upgrade_threshold') as string;
  const gradeData = {
    code: formData.get('code') as string,
    name: formData.get('name') as string,
    description: formData.get('description') as string || null,
    color: formData.get('color') as string || '#6366f1',
    sort_order: parseInt(formData.get('sort_order') as string) || 0,
    is_active: formData.get('is_active') === 'true',
    point_rate: parseFloat(formData.get('point_rate') as string) || 1.00,
    upgrade_threshold: thresholdRaw && thresholdRaw !== '' ? parseInt(thresholdRaw) : null,
  };

  // @ts-ignore
  const { error } = await supabase.from('customer_grades').update(gradeData).eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

export async function deleteCustomerGrade(id: string) {
  const supabase = await createClient();
  

  const { error } = await supabase.from('customer_grades').delete().eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

// ============ Customer Tags ============

export async function getCustomerTags() {
  const supabase = await createClient();
  const { data } = await supabase.from('customer_tags').select('*').order('created_at');
  return { data: data || [] };
}

export async function createCustomerTag(formData: FormData) {
  const supabase = await createClient();
  

  const tagData = {
    name: formData.get('name') as string,
    description: formData.get('description') as string || null,
    color: formData.get('color') as string || '#6366f1',
  };

  // @ts-ignore
  const { error } = await supabase.from('customer_tags').insert(tagData);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

export async function updateCustomerTag(id: string, formData: FormData) {
  const supabase = await createClient();
  

  const tagData = {
    name: formData.get('name') as string,
    description: formData.get('description') as string || null,
    color: formData.get('color') as string || '#6366f1',
  };

  // @ts-ignore
  const { error } = await supabase.from('customer_tags').update(tagData).eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

export async function deleteCustomerTag(id: string) {
  const supabase = await createClient();

  const { error } = await supabase.from('customer_tags').delete().eq('id', id);

  if (error) return { error: error.message };

  revalidatePath('/system-codes');
  return { success: true };
}

// ─── 고객 등급 자동 업그레이드 ───────────────────────────────────────
// NORMAL → VIP: 누적 100만원 / VIP → VVIP: 300만원 (업그레이드 전용, 다운 없음)
export async function autoUpgradeCustomerGrades() {
  const supabase = await createClient();
  const db = supabase as any;

  const { data: customers } = await db
    .from('customers').select('id, grade').eq('is_active', true);
  if (!customers?.length) return { upgraded: 0 };

  const { data: orders } = await db
    .from('sales_orders').select('customer_id, total_amount')
    .eq('status', 'COMPLETED').not('customer_id', 'is', null);

  const ltv = new Map<string, number>();
  for (const o of (orders || [])) {
    ltv.set(o.customer_id, (ltv.get(o.customer_id) || 0) + (o.total_amount || 0));
  }

  // 등급 업그레이드 기준을 DB에서 조회
  const { data: gradeRows } = await db
    .from('customer_grades')
    .select('code, upgrade_threshold')
    .eq('is_active', true)
    .not('upgrade_threshold', 'is', null);

  const THRESHOLDS = ((gradeRows || []) as { code: string; upgrade_threshold: number }[])
    .map(g => ({ grade: g.code, min: g.upgrade_threshold }))
    .sort((a, b) => b.min - a.min); // 높은 기준부터

  const GRADE_RANK: Record<string, number> = { NORMAL: 0, VIP: 1, VVIP: 2 };

  let upgraded = 0;
  for (const c of customers) {
    const total = ltv.get(c.id) || 0;
    const target = THRESHOLDS.find(t => total >= t.min);
    if (!target) continue;
    if ((GRADE_RANK[target.grade] || 0) > (GRADE_RANK[c.grade] || 0)) {
      await db.from('customers').update({ grade: target.grade }).eq('id', c.id);
      upgraded++;
    }
  }

  revalidatePath('/customers');
  return { upgraded };
}

// ============ POS Checkout ============

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  discount?: number;
}

export interface PaymentSplit {
  method: 'cash' | 'card' | 'card_keyin' | 'kakao' | 'credit' | 'cod';
  amount: number;
  approvalNo?: string;
  cardInfo?: string;
  memo?: string;
}

export interface ShippingInfo {
  recipient_name: string;
  recipient_phone: string;
  recipient_zipcode?: string;
  recipient_address: string;        // 도로명/지번
  recipient_address_detail?: string;
  delivery_message?: string;
  sender_name?: string;
  sender_phone?: string;
  sender_zipcode?: string;
  sender_address?: string;
  sender_address_detail?: string;
}

export interface CheckoutPayload {
  branchId: string;
  branchCode: string;
  branchName: string;
  branchChannel: string;
  customerId: string | null;
  customerGrade: string | null;
  gradePointRate: number;
  cart: CartItem[];
  totalAmount: number;
  discountAmount: number;
  finalAmount: number;
  paymentMethod: string;            // 단일 결제 하위호환. splits 있으면 자동 계산.
  usePoints: boolean;
  pointsToUse: number;
  cashReceived?: number;
  userId: string | null;
  approvalNo?: string;
  cardInfo?: string;
  memo?: string;
  paymentSplits?: PaymentSplit[];   // 분할 결제. 비어있으면 단일 결제로 처리.
  shipping?: ShippingInfo | null;   // 택배 정보 (있으면 shipments 레코드 생성)
  shipFromBranchId?: string;        // 출고 지점 (택배 활성 시). 없으면 branchId 사용. 판매 지점과 다르면 재고는 출고 지점에서 차감.
}

export async function processPosCheckout(payload: CheckoutPayload) {
  const supabase = await createClient();
  const db = supabase as any;

  const {
    branchId, branchCode, branchChannel, customerId, gradePointRate,
    cart, totalAmount, discountAmount, finalAmount, paymentMethod,
    usePoints, pointsToUse, userId, approvalNo, cardInfo,
    paymentSplits, shipping, shipFromBranchId,
  } = payload;

  // 재고 차감/출고 지점: 택배 출고처가 판매 지점과 다르면 출고처에서 차감.
  const stockBranchId = (shipping && shipFromBranchId) ? shipFromBranchId : branchId;

  // 분할 결제 정규화: 비어있으면 단일 결제 하나로 간주
  const splits: PaymentSplit[] = (paymentSplits && paymentSplits.length > 0)
    ? paymentSplits.filter(s => s.amount > 0)
    : [{ method: paymentMethod as any, amount: finalAmount, approvalNo, cardInfo }];

  const paidTotal = splits.reduce((s, p) => s + (p.amount || 0), 0);
  const remaining = Math.max(0, finalAmount - paidTotal);
  // 잔액이 있으면 외상 처리로 간주 (splits 합이 finalAmount 미만)
  const hasCredit = remaining > 0 || splits.some(s => s.method === 'credit');
  const topMethod: string = splits.length === 1
    ? splits[0].method
    : 'mixed';
  const firstCard = splits.find(s => s.method === 'card' || s.method === 'card_keyin');

  // ① 재고 사전 확인 (출고 지점 기준)
  for (const item of cart) {
    const { data: inv } = await supabase
      .from('inventories').select('id, quantity')
      .eq('branch_id', stockBranchId).eq('product_id', item.productId).single();
    const qty = (inv as any)?.quantity ?? 0;
    if (!inv || qty < item.quantity) {
      const where = stockBranchId === branchId ? '' : ' (출고 지점)';
      return { error: `"${item.name}" 재고 부족${where} (현재: ${qty}개, 요청: ${item.quantity}개)` };
    }
  }

  // ② 판매 전표 생성
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  const orderNumber = `SA-${branchCode}-${today}-${randomSuffix}`;

  const pointsEarned = customerId
    ? Math.floor(finalAmount * (gradePointRate || 1.0) / 100)
    : 0;

  const { data: saleOrder, error: saleError } = await db.from('sales_orders').insert({
    order_number: orderNumber,
    channel: branchChannel || 'STORE',
    branch_id: branchId,
    customer_id: customerId || null,
    ordered_by: userId || null,
    total_amount: totalAmount,
    discount_amount: discountAmount,
    status: 'COMPLETED',
    payment_method: topMethod,
    points_earned: pointsEarned,
    points_used: usePoints ? pointsToUse : 0,
    ordered_at: new Date().toISOString(),
    approval_no: approvalNo || firstCard?.approvalNo || null,
    card_info: cardInfo || firstCard?.cardInfo || null,
    memo: payload.memo || null,
    customer_grade_at_order: customerId ? (payload as any).customerGrade || null : null,
    point_rate_applied: customerId ? (gradePointRate || 1.0) : null,
    credit_settled: hasCredit ? false : null,
  }).select().single();

  if (saleError) return { error: saleError.message };
  const saleOrderId = (saleOrder as any).id;

  // ②-a 분할 결제 기록
  if (splits.length > 0) {
    const paymentRows = splits.map(s => ({
      sales_order_id: saleOrderId,
      payment_method: s.method,
      amount: s.amount,
      approval_no: s.approvalNo || null,
      card_info: s.cardInfo || null,
      memo: s.memo || null,
      created_by: userId || null,
    }));
    const { error: payErr } = await db.from('sales_order_payments').insert(paymentRows);
    if (payErr) console.error('[processPosCheckout] sales_order_payments insert failed:', payErr);
  }

  // ②-b 택배 정보 있으면 shipments 레코드 생성
  if (shipping && shipping.recipient_name && shipping.recipient_phone && shipping.recipient_address) {
    // sender_* 는 NOT NULL 이므로 '' 로라도 채움 (없으면 구매자 정보 대체)
    const senderName = shipping.sender_name || '';
    const senderPhone = shipping.sender_phone || '';
    const payloadBase: any = {
      source: 'STORE',
      sales_order_id: saleOrderId,
      branch_id: stockBranchId, // 출고 지점
      sender_name: senderName,
      sender_phone: senderPhone,
      recipient_name: shipping.recipient_name,
      recipient_phone: shipping.recipient_phone,
      recipient_zipcode: shipping.recipient_zipcode || null,
      recipient_address: shipping.recipient_address,
      recipient_address_detail: shipping.recipient_address_detail || null,
      delivery_message: shipping.delivery_message || null,
      status: 'PENDING',
    };
    const payloadFull = {
      ...payloadBase,
      sender_zipcode: shipping.sender_zipcode || null,
      sender_address: shipping.sender_address || null,
      sender_address_detail: shipping.sender_address_detail || null,
    };

    let { error: shipErr } = await db.from('shipments').insert(payloadFull);
    // 마이그레이션 046 미적용(sender_* 컬럼 부재)이면 기본 payload로 재시도
    if (shipErr) {
      const msg = String(shipErr.message || '').toLowerCase();
      const code = String((shipErr as any).code || '');
      const isMissingCol = code === '42703' || (msg.includes('column') && msg.includes('does not exist'));
      if (isMissingCol) {
        console.warn('[processPosCheckout] shipments sender 컬럼 없음 — 046 미적용. base payload로 재시도.');
        const retry = await db.from('shipments').insert(payloadBase);
        shipErr = retry.error;
      }
    }
    if (shipErr) console.error('[processPosCheckout] shipments insert failed:', shipErr);
  }

  // ③ 판매 항목 저장
  for (const item of cart) {
    await db.from('sales_order_items').insert({
      sales_order_id: saleOrderId,
      product_id: item.productId,
      quantity: item.quantity,
      unit_price: item.price,
      discount_amount: item.discount || 0,
      total_price: item.price * item.quantity - (item.discount || 0),
    });
  }

  // ④ 재고 차감 + 이동 기록 (출고 지점 기준)
  const stockUpdates: Record<string, number> = {};
  let movementMemo: string | null = null;
  if (stockBranchId !== branchId) {
    const { data: bns } = await supabase
      .from('branches').select('id, name').in('id', [branchId, stockBranchId]);
    const nameOf = (id: string) => (bns as any[] | null)?.find(b => b.id === id)?.name || id;
    movementMemo = `판매: ${nameOf(branchId)}, 출고: ${nameOf(stockBranchId)}`;
  }
  for (const item of cart) {
    const { data: inv } = await supabase
      .from('inventories').select('id, quantity')
      .eq('branch_id', stockBranchId).eq('product_id', item.productId).single();
    const inv_ = inv as any;
    await db.from('inventories').update({ quantity: inv_.quantity - item.quantity }).eq('id', inv_.id);
    await db.from('inventory_movements').insert({
      branch_id: stockBranchId,
      product_id: item.productId,
      movement_type: 'OUT',
      quantity: item.quantity,
      reference_id: saleOrderId,
      reference_type: 'POS_SALE',
      memo: movementMemo,
    });
    stockUpdates[item.productId] = inv_.quantity - item.quantity;
  }

  // ⑤ 포인트 처리
  if (customerId) {
    const { data: lastHist } = await db.from('point_history').select('balance')
      .eq('customer_id', customerId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const currentPoints = lastHist?.balance || 0;

    if (usePoints && pointsToUse > 0) {
      const afterUse = currentPoints - pointsToUse;
      await db.from('point_history').insert({
        customer_id: customerId, sales_order_id: saleOrderId,
        type: 'use', points: -pointsToUse, balance: afterUse,
        description: `포인트 사용 (${orderNumber})`,
      });
      await db.from('point_history').insert({
        customer_id: customerId, sales_order_id: saleOrderId,
        type: 'earn', points: pointsEarned, balance: afterUse + pointsEarned,
        description: `구매 적립 (${orderNumber})`,
      });
    } else {
      await db.from('point_history').insert({
        customer_id: customerId, sales_order_id: saleOrderId,
        type: 'earn', points: pointsEarned, balance: currentPoints + pointsEarned,
        description: `구매 적립 (${orderNumber})`,
      });
    }
  }

  // ⑥ 주문 완료 알림톡 자동 발송 (등록 고객 + 매핑 존재 시)
  if (customerId) {
    const { data: cust } = await (db as any)
      .from('customers')
      .select('name, phone, grade')
      .eq('id', customerId)
      .maybeSingle();
    const { data: br } = await (db as any)
      .from('branches').select('name').eq('id', branchId).maybeSingle();

    if (cust?.name && cust?.phone) {
      fireNotificationTrigger({
        eventType: 'ORDER_COMPLETE',
        customer: { id: customerId, name: cust.name, phone: cust.phone },
        context: {
          orderNo: orderNumber,
          amount: totalAmount - discountAmount,
          branchName: br?.name || '',
          customerGrade: cust.grade || 'NORMAL',
        },
      }).catch(() => {});
    }
  }

  return { orderNumber, pointsEarned, stockUpdates };
}

// ============ Product Files ============

export async function addProductFile(
  productId: string,
  fileUrl: string,
  fileName: string,
  fileType: 'image' | 'document'
) {
  const supabase = await createClient();

  const { error } = await supabase.from('product_files').insert({
    product_id: productId,
    file_url: fileUrl,
    file_name: fileName,
    file_type: fileType,
  } as any);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/products');
  return { success: true };
}

export async function deleteProductFile(fileId: string) {
  const supabase = await createClient();

  const { error } = await supabase.from('product_files').delete().eq('id', fileId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/products');
  return { success: true };
}
