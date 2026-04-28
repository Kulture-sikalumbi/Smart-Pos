// ============================================
// POS System Type Definitions
// ============================================

export type TableStatus = 'available' | 'occupied' | 'reserved' | 'dirty';
export type OrderStatus = 'open' | 'sent' | 'in_progress' | 'ready' | 'served' | 'paid' | 'voided';
export type OrderType = 'eat_in' | 'take_out' | 'delivery';
export type PaymentMethod = 'cash' | 'card' | 'cheque' | 'account' | 'non_bank';
export type OrderSource = 'pos' | 'tablet' | 'self_order' | 'qr';

export interface Table {
  id: string;
  number: number;
  name?: string;
  seats: number;
  status: TableStatus;
  currentOrderId?: string;
  section?: string;
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  menuItemCode: string;
  menuItemName: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  discountPercent?: number;
  total: number;
  notes?: string;
  modifiers?: string[];
  isVoided: boolean;
  voidReason?: string;
  sentToKitchen: boolean;
  preparedAt?: string;
}

export interface Order {
  id: string;
  orderNo: number;
  source?: OrderSource;
  /** Server-side cashier shift id (X/Z reporting). */
  shiftId?: string;
  tillId?: string;
  tillCode?: string;
  tillName?: string;
  tableId?: string;
  tableNo?: number;
  orderType: OrderType;
  status: OrderStatus;
  staffId: string;
  staffName: string;
  items: OrderItem[];
  subtotal: number;
  discountAmount: number;
  discountPercent: number;
  discountReason?: string;
  tax: number;
  total: number;
  totalCost: number;
  grossProfit: number;
  gpPercent: number;
  createdAt: string;
  sentAt?: string;
  paidAt?: string;
  paymentMethod?: PaymentMethod;
  splitPayments?: PaymentSplit[];
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
}

export interface PaymentSplit {
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

// Kitchen Display
export interface KitchenOrder {
  id: string;
  orderNo: number;
  tableNo?: number;
  orderType: OrderType;
  items: KitchenOrderItem[];
  createdAt: string;
  status: 'pending' | 'in_progress' | 'ready';
  priority: 'normal' | 'rush';
}

export interface KitchenOrderItem {
  id: string;
  name: string;
  quantity: number;
  notes?: string;
  modifiers?: string[];
  status: 'pending' | 'preparing' | 'ready';
}

// Shift & Cash Up
export interface Shift {
  id: string;
  staffId: string;
  staffName: string;
  startTime: string;
  endTime?: string;
  startingCash: number;
  isActive: boolean;
  drnFrom?: number;
  drnTo?: number;
}

export interface CashUpSession {
  id: string;
  shiftId: string;
  staffId: string;
  staffName: string;
  date: string;
  drnFrom: number;
  drnTo: number;
  
  // Sales breakdown
  totalSales: number;
  cashSales: number;
  cardSales: number;
  chequeSales: number;
  accountSales: number;
  nonBankSales: number;
  
  // Cash drawer
  openingCash: number;
  cashReceived: number;
  payouts: number;
  tips: number;
  
  // Calculation
  expectedCash: number; // openingCash + cashReceived - payouts
  actualCash: number;
  shortageOverage: number; // actualCash - expectedCash
  
  // Bankable
  bankableCash: number; // actualCash - tips (tips stay with staff)
  
  status: 'open' | 'submitted' | 'approved';
  approvedBy?: string;
  notes?: string;
}

export interface Payout {
  id: string;
  shiftId: string;
  amount: number;
  reason: string;
  approvedBy: string;
  createdAt: string;
}

// Menu Categories for POS
export interface POSCategory {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  sortOrder: number;
}

export interface POSMenuItem {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  price: number;
  cost: number;
  image?: string;
  isAvailable: boolean;
  modifierGroups?: string[];
  /** If true, selling this item will attempt recipe-based inventory deduction. */
  trackInventory?: boolean;
  /** Optional direct stock link for sale deduction from front_stock(SALE). */
  physicalStockItemId?: string;
}

// Table Section
export interface TableSection {
  id: string;
  name: string;
  tables: Table[];
}
