'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

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
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const productData = {
    name: formData.get('name') as string,
    code: formData.get('code') as string,
    category_id: formData.get('category_id') as string || null,
    unit: formData.get('unit') as string || '개',
    price: parseInt(formData.get('price') as string),
    cost: parseInt(formData.get('cost') as string) || null,
    barcode: formData.get('barcode') as string || null,
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
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const productData = {
    name: formData.get('name') as string,
    code: formData.get('code') as string,
    category_id: formData.get('category_id') as string || null,
    unit: formData.get('unit') as string || '개',
    price: parseInt(formData.get('price') as string),
    cost: parseInt(formData.get('cost') as string) || null,
    barcode: formData.get('barcode') as string || null,
    is_active: formData.get('is_active') === 'true',
  };

  // @ts-ignore
  const { error } = await supabase.from('products').update(productData).eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/products');
  return { success: true };
}

export async function deleteProduct(id: string) {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

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
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

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
  
  revalidatePath('/customers');
  return { success: true };
}

export async function updateCustomer(id: string, formData: FormData) {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

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
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

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
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const branchId = formData.get('branch_id') as string;
  const productId = formData.get('product_id') as string;
  const movementType = formData.get('movement_type') as string;
  const quantity = parseInt(formData.get('quantity') as string);
  const memo = formData.get('memo') as string;

  const { data: currentArr } = await supabase
    .from('inventories')
    .select('quantity')
    .eq('branch_id', branchId)
    .eq('product_id', productId);
  
  const current = currentArr?.[0] as any;

  if (!current) {
    await supabase.from('inventories').insert({
      branch_id: branchId,
      product_id: productId,
      quantity: Math.abs(quantity),
      safety_stock: 0,
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
      .update({ quantity: Math.max(0, newQuantity) })
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
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

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
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

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
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

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
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const branchData = {
    name: formData.get('name') as string,
    code: formData.get('code') as string,
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
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const branchData = {
    name: formData.get('name') as string,
    code: formData.get('code') as string,
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
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { error } = await supabase.from('branches').delete().eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/branches');
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
  
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) redirect('/login');

  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const name = formData.get('name') as string;
  const phone = formData.get('phone') as string;
  const role = formData.get('role') as string;
  const branchId = formData.get('branch_id') as string;

  // Create auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) {
    return { error: authError.message };
  }

  if (!authData.user) {
    return { error: '사용자 생성 실패' };
  }

  // Create user profile
  const { error } = await supabase.from('users').insert({
    id: authData.user.id,
    email,
    password_hash: 'managed_by_auth',
    name,
    phone: phone || null,
    role,
    branch_id: branchId || null,
  } as any);

  if (error) {
    // Cleanup auth user if profile creation fails
    await supabase.auth.admin.deleteUser(authData.user.id);
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}

export async function updateUser(id: string, formData: FormData) {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

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
  
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) redirect('/login');

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
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const gradeData = {
    code: formData.get('code') as string,
    name: formData.get('name') as string,
    description: formData.get('description') as string || null,
    color: formData.get('color') as string || '#6366f1',
    sort_order: parseInt(formData.get('sort_order') as string) || 0,
    point_rate: parseFloat(formData.get('point_rate') as string) || 1.00,
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
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const gradeData = {
    code: formData.get('code') as string,
    name: formData.get('name') as string,
    description: formData.get('description') as string || null,
    color: formData.get('color') as string || '#6366f1',
    sort_order: parseInt(formData.get('sort_order') as string) || 0,
    is_active: formData.get('is_active') === 'true',
    point_rate: parseFloat(formData.get('point_rate') as string) || 1.00,
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
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

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
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

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
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

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
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { error } = await supabase.from('customer_tags').delete().eq('id', id);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/system-codes');
  return { success: true };
}
