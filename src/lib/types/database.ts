export type Channel = 'STORE' | 'DEPT_STORE' | 'ONLINE' | 'EVENT';
export type UserRole = 'SUPER_ADMIN' | 'HQ_OPERATOR' | 'PHARMACY_STAFF' | 'BRANCH_STAFF' | 'EXECUTIVE';
export type CustomerGrade = 'NORMAL' | 'VIP' | 'VVIP';
export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED';
export type PaymentMethod = 'cash' | 'card' | 'kakao';
export type MovementType = 'IN' | 'OUT' | 'ADJUST' | 'PRODUCTION';
export type PointType = 'earn' | 'use' | 'expire' | 'adjust';
export type ProductionStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type SeasonType = 'NEW_YEAR' | 'LUNAR_NEW_YEAR' | 'CHUSEOK' | 'EVENT' | 'ETC';
export type NotificationStatus = 'pending' | 'sent' | 'failed';
export type SyncStatus = 'pending' | 'success' | 'failed';

export interface Branch {
  id: string;
  name: string;
  code: string;
  channel: Channel;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  email: string;
  password_hash?: string;
  name: string;
  phone: string | null;
  role: UserRole;
  branch_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  branch?: Branch;
}

export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  code: string;
  category_id: string | null;
  unit: string;
  price: number;
  cost: number | null;
  barcode: string | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  category?: Category;
}

export interface ProductBOM {
  id: string;
  product_id: string;
  material_id: string;
  quantity: number;
  created_at: string;
  product?: Product;
  material?: Product;
}

export interface Inventory {
  id: string;
  branch_id: string;
  product_id: string;
  quantity: number;
  safety_stock: number;
  last_synced_at: string | null;
  updated_at: string;
  branch?: Branch;
  product?: Product;
}

export interface InventoryMovement {
  id: string;
  branch_id: string;
  product_id: string;
  movement_type: MovementType;
  quantity: number;
  reference_id: string | null;
  reference_type: string | null;
  memo: string | null;
  created_at: string;
  branch?: Branch;
  product?: Product;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  grade: CustomerGrade;
  primary_branch_id: string | null;
  cafe24_member_id: string | null;
  health_note: string | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  primary_branch?: Branch;
  tags?: CustomerTag[];
}

export interface CustomerConsultation {
  id: string;
  customer_id: string;
  consultation_type: string | null;
  content: Record<string, unknown>;
  consulted_by: string | null;
  created_at: string;
  consulted_by_user?: User;
}

export interface CustomerTag {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  created_at: string;
}

export interface CustomerTagMap {
  id: string;
  customer_id: string;
  tag_id: string;
  created_at: string;
}

export interface SalesOrder {
  id: string;
  order_number: string;
  channel: Channel;
  branch_id: string;
  customer_id: string | null;
  ordered_by: string;
  total_amount: number;
  discount_amount: number;
  status: OrderStatus;
  payment_method: PaymentMethod | null;
  points_used: number;
  points_earned: number;
  cash_received: number | null;
  change_amount: number | null;
  cafe24_order_id: string | null;
  memo: string | null;
  ordered_at: string;
  created_at: string;
  branch?: Branch;
  customer?: Customer;
  user?: User;
  items?: SalesOrderItem[];
}

export interface SalesOrderItem {
  id: string;
  sales_order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  total_price: number;
  created_at: string;
  product?: Product;
}

export interface PointHistory {
  id: string;
  customer_id: string;
  sales_order_id: string | null;
  type: PointType;
  points: number;
  balance: number;
  description: string | null;
  created_at: string;
  customer?: Customer;
  sales_order?: SalesOrder;
}

export interface ProductionOrder {
  id: string;
  order_number: string;
  product_id: string;
  quantity: number;
  status: ProductionStatus;
  produced_by: string | null;
  produced_at: string | null;
  memo: string | null;
  created_at: string;
  product?: Product;
  user?: User;
}

export interface Season {
  id: string;
  name: string;
  season_type: SeasonType | null;
  start_date: string;
  end_date: string;
  target_amount: number | null;
  is_active: boolean;
  created_at: string;
}

export interface Notification {
  id: string;
  customer_id: string | null;
  notification_type: string;
  template_code: string | null;
  phone: string;
  message: string;
  status: NotificationStatus;
  sent_at: string | null;
  created_at: string;
  customer?: Customer;
}

export interface Cafe24SyncLog {
  id: string;
  sync_type: string;
  cafe24_order_id: string | null;
  data: Record<string, unknown> | null;
  status: SyncStatus;
  error_message: string | null;
  processed_at: string | null;
  created_at: string;
}

export type Database = {
  public: {
    Tables: {
      branches: { Row: Branch; Insert: Omit<Branch, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Branch> };
      users: { Row: User; Insert: Omit<User, 'id' | 'created_at' | 'updated_at'>; Update: Partial<User> };
      categories: { Row: Category; Insert: Omit<Category, 'id' | 'created_at'>; Update: Partial<Category> };
      products: { Row: Product; Insert: Omit<Product, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Product> };
      product_bom: { Row: ProductBOM; Insert: Omit<ProductBOM, 'id' | 'created_at'>; Update: Partial<ProductBOM> };
      inventories: { Row: Inventory; Insert: Omit<Inventory, 'id' | 'updated_at'>; Update: Partial<Inventory> };
      inventory_movements: { Row: InventoryMovement; Insert: Omit<InventoryMovement, 'id' | 'created_at'>; Update: Partial<InventoryMovement> };
      customers: { Row: Customer; Insert: Omit<Customer, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Customer> };
      customer_consultations: { Row: CustomerConsultation; Insert: Omit<CustomerConsultation, 'id' | 'created_at'>; Update: Partial<CustomerConsultation> };
      customer_tags: { Row: CustomerTag; Insert: Omit<CustomerTag, 'id' | 'created_at'>; Update: Partial<CustomerTag> };
      customer_tag_map: { Row: CustomerTagMap; Insert: Omit<CustomerTagMap, 'id' | 'created_at'>; Update: Partial<CustomerTagMap> };
      sales_orders: { Row: SalesOrder; Insert: Omit<SalesOrder, 'id' | 'created_at'>; Update: Partial<SalesOrder> };
      sales_order_items: { Row: SalesOrderItem; Insert: Omit<SalesOrderItem, 'id' | 'created_at'>; Update: Partial<SalesOrderItem> };
      point_history: { Row: PointHistory; Insert: Omit<PointHistory, 'id' | 'created_at'>; Update: Partial<PointHistory> };
      production_orders: { Row: ProductionOrder; Insert: Omit<ProductionOrder, 'id' | 'created_at'>; Update: Partial<ProductionOrder> };
      seasons: { Row: Season; Insert: Omit<Season, 'id' | 'created_at'>; Update: Partial<Season> };
      notifications: { Row: Notification; Insert: Omit<Notification, 'id' | 'created_at'>; Update: Partial<Notification> };
      cafe24_sync_logs: { Row: Cafe24SyncLog; Insert: Omit<Cafe24SyncLog, 'id' | 'created_at'>; Update: Partial<Cafe24SyncLog> };
    };
  };
};
