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
  const { error } = await supabase.from('products').insert(productData);
  
  if (error) {
    return { error: error.message };
  }
  
  revalidatePath('/products');
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

export async function getBranches() {
  const supabase = await createClient();
  const { data } = await supabase.from('branches').select('*').order('created_at');
  return { data: data || [] };
}
