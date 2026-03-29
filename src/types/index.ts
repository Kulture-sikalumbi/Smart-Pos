// ============================================
// ERP System Type Definitions
// ============================================

// Department Types
export type DepartmentId = 
  | 'meat' 
  | 'veg_fruit' 
  | 'bakery' 
  | 'condiments' 
  | 'dairy_dips' 
  | 'dry_goods' 
  | 'hot_beverages' 
  | 'packaging' 
  | 'sauces' 
  | 'spices' 
  | 'cold_beverages'
  | 'groceries';

export interface Department {
  id: DepartmentId;
  name: string;
  code: string;
}

// Unit Types
export type UnitType = 'KG' | 'LTRS' | 'EACH' | 'PACK';

// Stock Item
export interface StockItem {
  id: string;
  code: string;
  name: string;
  departmentId: DepartmentId;
  unitType: UnitType;
  /** For unitType=PACK, how many EACH are in 1 pack. Stored as `stock_items.items_per_pack` when available. */
  itemsPerPack?: number;
  lowestCost: number;
  highestCost: number;
  currentCost: number;
  currentStock: number;
  reorderLevel?: number;
  supplierId?: string;
}

// Stock Issue (Internal Transfer)
export interface StockIssue {
  id: string;
  date: string;
  issueNo?: number;
  stockItemId: string;
  issueType: 'Wastage' | 'Expired' | 'Staff Meal' | 'Theft' | 'Damage';
  qtyIssued: number; // stored in base unit
  unitCostAtTime: number;
  totalValueLost: number;
  notes?: string | null;
  createdBy: string | null;
  createdAt?: string;
}

// Stock Movement
export interface StockMovement {
  id: string;
  timestamp: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  type: 'purchase' | 'issue' | 'sale' | 'batch' | 'adjustment';
  qtyBefore: number;
  qtyChange: number;
  qtyAfter: number;
  value: number;
  reference?: string;
}

// Stock Take / Variance
export interface StockVariance {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  departmentId: DepartmentId;
  unitType: UnitType;
  lowestCost: number;
  highestCost: number;
  currentCost: number;
  systemQty: number;
  physicalQty: number;
  varianceQty: number;
  varianceValue: number;
  countDate: string;
  timesHadVariance: number;
}

export interface StockTakeSession {
  id: string;
  /** Stock take date as YYYY-MM-DD (local). */
  date: string;
  departmentId: DepartmentId | 'all';
  createdAt: string;
  createdBy: string;
  variances: StockVariance[];
}

export type ExpenseCategory =
  | 'rent'
  | 'salaries'
  | 'utilities'
  | 'fuel'
  | 'repairs'
  | 'marketing'
  | 'other';

export interface Expense {
  id: string;
  /** Expense date as YYYY-MM-DD (local). */
  date: string;
  category: ExpenseCategory;
  amount: number;
  description?: string;
  createdAt: string;
}

// Recipe (Parent-Child relationship)
export interface RecipeIngredient {
  id: string;
  ingredientId: string;
  ingredientCode: string;
  ingredientName: string;
  requiredQty: number;
  unitType: UnitType;
  unitCost: number;
}

export interface Recipe {
  id: string;
  parentItemId: string;
  parentItemCode: string;
  parentItemName: string;
  /** Department to assign finished goods stock item to when producing batches. */
  finishedGoodDepartmentId?: DepartmentId;
  outputQty: number;
  outputUnitType: UnitType;
  ingredients: RecipeIngredient[];
  totalCost: number;
  unitCost: number;
}

// Batch Production
export interface BatchProduction {
  id: string;
  recipeId: string;
  recipeName: string;
  batchDate: string;
  theoreticalOutput: number;
  actualOutput: number;
  yieldVariance: number;
  yieldVariancePercent: number;
  ingredientsUsed: RecipeIngredient[];
  totalCost: number;
  unitCost: number;
  producedBy: string;
}

// GRV (Goods Received Voucher) / Purchase
export interface GRVItem {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

export interface GRV {
  id: string;
  grvNo: string;
  date: string;
  supplierId: string;
  supplierName: string;
  items: GRVItem[];
  subtotal: number;
  tax: number;
  total: number;
  paymentType: 'cash' | 'account' | 'cheque';
  status: 'pending' | 'confirmed' | 'cancelled';
  receivedBy: string;
}

// Supplier
export interface Supplier {
  id: string;
  code: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  accountBalance: number;
}

// Staff
export type StaffRole = 'owner' | 'manager' | 'waitron' | 'bar_staff' | 'kitchen_staff';

export interface Staff {
  id: string;
  name: string;
  role: StaffRole;
  commissionPercent: number;
  hoursWorked: number;
  totalSales: number;
  isActive: boolean;
}

// Cash Up / Reconciliation
export interface CashUp {
  id: string;
  date: string;
  drnFrom: number;
  drnTo: number;
  staffId: string;
  staffName: string;
  totalSales: number;
  cashPayments: number;
  cardPayments: number;
  chequePayments: number;
  nonBankPayments: number;
  accountPayments: number;
  payouts: number;
  tips: number;
  expectedCash: number;
  actualCash: number;
  shortageOverage: number;
}

// Menu Item (for sales tracking)
export interface MenuItem {
  id: string;
  code: string;
  name: string;
  departmentId: string;
  departmentName: string;
  costPerItem: number;
  sellPriceExcl: number;
  sellPriceIncl: number;
  targetGP: number;
  isBatchItem: boolean;
  recipeId?: string;
}

// Sales Transaction
export interface SaleItem {
  id: string;
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  unitPrice: number;
  cost: number;
  total: number;
  profit: number;
  gpPercent: number;
}

export interface Sale {
  id: string;
  invoiceNo: number;
  date: string;
  tableNo?: number;
  staffId: string;
  staffName: string;
  items: SaleItem[];
  subtotal: number;
  tax: number;
  total: number;
  paymentType: 'cash' | 'card' | 'cheque' | 'account' | 'non_bank';
  totalCost: number;
  grossProfit: number;
  gpPercent: number;
}

// Management Overview Report
export interface ManagementOverview {
  reportDate: string;
  drnRange: { from: number; to: number };
  
  // Payment breakdown
  cashTotal: number;
  chequeTotal: number;
  cardTotal: number;
  accountTotal: number;
  nonBankTotal: number;
  totalPaytypes: number;
  
  // Turnover
  turnoverIncl: number;
  tax: number;
  turnoverExcl: number;
  
  // Stock values
  openingStock: number;
  purchases: number;
  stockTransIn: number;
  stockTransOut: number;
  closingStock: number;
  costOfSales: number;
  costOfSalesPercent: number;
  
  // Profit
  grossProfit: number;
  grossProfitPercent: number;
  expenses: number;
  netProfit: number;
  
  // Customer activity
  invoiceCount: number;
  customerCount: number;
  tableCount: number;
  avgPerInvoice: number;
  tablesPerHour: number;
  minsPerTable: number;
  hoursPerDay: number;
  
  // Variances
  stockVarianceValue: number;
  wastageValue: number;
  
  // Session breakdown
  sessions: {
    morning: { recorded: number; percent: number };
    afternoon: { recorded: number; percent: number };
    evening: { recorded: number; percent: number };
  };
  
  // Order types
  orderTypes: {
    eatIn: { value: number; percent: number };
    takeOut: { value: number; percent: number };
    delivery: { value: number; percent: number };
  };
}

// Sales Mix Report Item
export interface SalesMixItem {
  itemNo: number;
  itemName: string;
  quantity: number;
  costPerItem: number;
  sellExcl: number;
  sellIncl: number;
  gpBeforeDiscount: number;
  gpAfterDiscount: number;
  totalCost: number;
  totalSales: number;
  totalProfit: number;
  percentOfTurnover: number;
}

// Filter/Report Options
export interface DateRangeFilter {
  startDate: string;
  endDate: string;
}

export interface ReportFilters extends DateRangeFilter {
  departmentId?: DepartmentId;
  staffId?: string;
  drnFrom?: number;
  drnTo?: number;
}

// Daily Sales Report
export interface DailySalesReport {
  date: string; // ISO date string
  totals: {
    netSales: number;
    grossSales: number;
    cogs: number;
    profit: number;
    laborCost: number;
  };
  topSellingItems: {
    name: string;
    quantity: number;
    totalSales: number;
  }[];
  stockVariances: {
    item: string;
    theoretical: number;
    actual: number;
    uom: string;
    cost: number;
  }[];
  voids: {
    reason: string;
    count: number;
    value: number;
  }[];
}

// Tax Engine Types
export interface TaxRule {
  countryCode: 'ZM' | 'ZA' | 'US'; // Zambia, South Africa, USA
  taxName: string; // e.g., 'VAT', 'Tourism Levy', 'Sales Tax'
  rate: number; // As a decimal, e.g., 0.16 for 16%
  applyOrder: number; // Determines calculation sequence
  isCompound: boolean; // If true, calculated on subtotal + previous taxes
}

export interface TaxCalculationResult {
  subtotal: number;
  taxBreakdown: { name: string; amount: number }[];
  total: number;
}

// System Audit Log Types
export type SensitiveActionType =
  | 'void'
  | 'discount'
  | 'price_change'
  | 'cash_drawer_open'
  | 'manager_override'
  | 'order_open'
  | 'order_close'
  | 'security_alert'
  | 'order_paid'
  | 'order_sent'
  | 'order_ready'
  | 'order_served'
  | 'grv_create'
  | 'grv_update'
  | 'grv_confirm'
  | 'grv_cancel'
  | 'grv_delete'
  | 'batch_production_record'
  | 'batch_production_delete'
  | 'stock_take_record'
  | 'stock_take_delete'
  | 'expense_add'
  | 'expense_update'
  | 'expense_delete'
  | 'zra_export';

export interface GeoLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface SystemAuditLogEntry {
  id: string;
  timestamp: string; // ISO 8601 format
  userId: string;
  userName: string;
  actionType: SensitiveActionType;
  previousValue?: string | number;
  newValue?: string | number;
  reference?: string; // e.g., invoice number or item ID
  geoLocation?: GeoLocation;
  notes?: string;
}

// Global Receipt / Settings Types
export type CountryCode = 'ZM' | 'ZA' | 'US' | (string & {});
export type CurrencyCode = 'ZMW' | 'ZAR' | 'USD' | (string & {});

export interface ReceiptSettings {
  countryCode: CountryCode;
  currencyCode: CurrencyCode;
  legalFooter: string;

  /** For non-Zambia countries, where should the QR take the customer? */
  googleReviewUrl?: string;
  digitalReceiptBaseUrl?: string; // e.g. https://yourdomain.com/r/
}

export interface ReceiptTaxLine {
  name: string;
  amount: number;
}

export interface ReceiptData {
  receiptId: string;
  issuedAt: string; // ISO
  countryCode: CountryCode;
  currencyCode: CurrencyCode;
  subtotal: number;
  taxes: ReceiptTaxLine[];
  total: number;
  usdEquivalent?: number;
  legalFooter?: string;

  /** Optional: use for Zambia smart QR */
  zraVerificationUrl?: string;
  /** Optional: use for non-Zambia smart QR */
  qrUrl?: string;
}
