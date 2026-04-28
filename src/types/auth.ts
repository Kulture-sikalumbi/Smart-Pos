// ============================================
// Authentication & Authorization Types
// ============================================

export type UserRole = 'owner' | 'manager' | 'front_supervisor' | 'cashier' | 'waitron' | 'kitchen_staff' | 'bar_staff';
export type AssignableStaffRole = 'front_supervisor' | 'cashier' | 'kitchen_staff';
export const ASSIGNABLE_STAFF_ROLES: AssignableStaffRole[] = ['front_supervisor', 'cashier', 'kitchen_staff'];

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  pin?: string; // For quick POS login
  isActive: boolean;
  createdAt: string;
}

// Role-based permissions
export interface RolePermissions {
  // Dashboard & Reports
  viewDashboard: boolean;
  viewReports: boolean;
  viewManagementOverview: boolean;
  
  // Inventory
  viewInventory: boolean;
  manageInventory: boolean;
  performStockTake: boolean;
  createStockIssues: boolean;
  
  // Manufacturing
  viewRecipes: boolean;
  manageRecipes: boolean;
  recordBatchProduction: boolean;
  
  // Purchases
  viewPurchases: boolean;
  createGRV: boolean;
  confirmGRV: boolean;
  
  // Staff
  viewStaff: boolean;
  manageStaff: boolean;
  
  // POS
  accessPOS: boolean;
  createOrders: boolean;
  processPayments: boolean;
  applyDiscounts: boolean;
  voidItems: boolean;
  transferTables: boolean;
  
  // Cash Up
  viewOwnCashUp: boolean;
  viewAllCashUps: boolean;
  performCashUp: boolean;
  
  // Settings
  viewSettings: boolean;
  manageSettings: boolean;
}

// Default permissions by role
export const ROLE_PERMISSIONS: Record<UserRole, RolePermissions> = {
  owner: {
    viewDashboard: true,
    viewReports: true,
    viewManagementOverview: true,
    viewInventory: true,
    manageInventory: true,
    performStockTake: true,
    createStockIssues: true,
    viewRecipes: true,
    manageRecipes: true,
    recordBatchProduction: true,
    viewPurchases: true,
    createGRV: true,
    confirmGRV: true,
    viewStaff: true,
    manageStaff: true,
    accessPOS: true,
    createOrders: true,
    processPayments: true,
    applyDiscounts: true,
    voidItems: true,
    transferTables: true,
    viewOwnCashUp: true,
    viewAllCashUps: true,
    performCashUp: true,
    viewSettings: true,
    manageSettings: true,
  },
  manager: {
    viewDashboard: true,
    viewReports: true,
    viewManagementOverview: true,
    viewInventory: true,
    manageInventory: true,
    performStockTake: true,
    createStockIssues: true,
    viewRecipes: true,
    manageRecipes: true,
    recordBatchProduction: true,
    viewPurchases: true,
    createGRV: true,
    confirmGRV: true,
    viewStaff: false,
    manageStaff: false,
    accessPOS: true,
    createOrders: true,
    processPayments: true,
    applyDiscounts: true,
    voidItems: true,
    transferTables: true,
    viewOwnCashUp: true,
    viewAllCashUps: true,
    performCashUp: true,
    viewSettings: true,
    manageSettings: false,
  },
  front_supervisor: {
    viewDashboard: false,
    viewReports: true,
    viewManagementOverview: false,
    viewInventory: true,
    manageInventory: true,
    performStockTake: false,
    createStockIssues: true,
    viewRecipes: true,
    manageRecipes: false,
    recordBatchProduction: true,
    viewPurchases: false,
    createGRV: false,
    confirmGRV: false,
    viewStaff: false,
    manageStaff: false,
    accessPOS: true,
    createOrders: true,
    processPayments: true,
    applyDiscounts: true,
    voidItems: true,
    transferTables: true,
    viewOwnCashUp: true,
    viewAllCashUps: true,
    performCashUp: true,
    viewSettings: false,
    manageSettings: false,
  },
  cashier: {
    viewDashboard: false,
    viewReports: true,
    viewManagementOverview: false,
    viewInventory: false,
    manageInventory: false,
    performStockTake: false,
    createStockIssues: false,
    viewRecipes: false,
    manageRecipes: false,
    recordBatchProduction: false,
    viewPurchases: false,
    createGRV: false,
    confirmGRV: false,
    viewStaff: false,
    manageStaff: false,
    accessPOS: true,
    createOrders: true,
    processPayments: true,
    applyDiscounts: false,
    voidItems: false,
    transferTables: true,
    viewOwnCashUp: true,
    viewAllCashUps: false,
    performCashUp: true,
    viewSettings: false,
    manageSettings: false,
  },
  waitron: {
    viewDashboard: false,
    viewReports: false,
    viewManagementOverview: false,
    viewInventory: false,
    manageInventory: false,
    performStockTake: false,
    createStockIssues: false,
    viewRecipes: false,
    manageRecipes: false,
    recordBatchProduction: false,
    viewPurchases: false,
    createGRV: false,
    confirmGRV: false,
    viewStaff: false,
    manageStaff: false,
    accessPOS: true,
    createOrders: true,
    processPayments: true,
    applyDiscounts: false,
    voidItems: false,
    transferTables: true,
    viewOwnCashUp: true,
    viewAllCashUps: false,
    performCashUp: true,
    viewSettings: false,
    manageSettings: false,
  },
  kitchen_staff: {
    viewDashboard: false,
    viewReports: false,
    viewManagementOverview: false,
    viewInventory: true,
    manageInventory: false,
    performStockTake: false,
    createStockIssues: false,
    viewRecipes: true,
    manageRecipes: false,
    recordBatchProduction: true,
    viewPurchases: false,
    createGRV: false,
    confirmGRV: false,
    viewStaff: false,
    manageStaff: false,
    accessPOS: false,
    createOrders: false,
    processPayments: false,
    applyDiscounts: false,
    voidItems: false,
    transferTables: false,
    viewOwnCashUp: false,
    viewAllCashUps: false,
    performCashUp: false,
    viewSettings: false,
    manageSettings: false,
  },
  bar_staff: {
    viewDashboard: false,
    viewReports: false,
    viewManagementOverview: false,
    viewInventory: true,
    manageInventory: false,
    performStockTake: false,
    createStockIssues: true,
    viewRecipes: false,
    manageRecipes: false,
    recordBatchProduction: false,
    viewPurchases: false,
    createGRV: false,
    confirmGRV: false,
    viewStaff: false,
    manageStaff: false,
    accessPOS: true,
    createOrders: true,
    processPayments: true,
    applyDiscounts: false,
    voidItems: false,
    transferTables: false,
    viewOwnCashUp: true,
    viewAllCashUps: false,
    performCashUp: true,
    viewSettings: false,
    manageSettings: false,
  },
};

// Role display names
export const ROLE_NAMES: Record<UserRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  front_supervisor: 'Front Office Supervisor',
  cashier: 'Cashier',
  waitron: 'Waitron',
  kitchen_staff: 'Kitchen Staff',
  bar_staff: 'Bar Staff',
};

export function isAssignableStaffRole(role: unknown): role is AssignableStaffRole {
  return role === 'front_supervisor' || role === 'cashier' || role === 'kitchen_staff';
}

export const ROLE_ACCESS_HELPERS: Record<UserRole, string[]> = {
  owner: [
    'Full Back Office + Front Office control',
    'Can manage staff, settings, tax, and reports',
    'Can approve stock, production, and sales operations',
  ],
  manager: [
    'King of the Front: full Front Office supervision',
    'Can manage front stock, production, receipts, and stock bridge views',
    'Cannot access admin-only staff management controls',
  ],
  front_supervisor: [
    'Full Front Office supervision without admin back-office powers',
    'Can access POS, front stock controls, stock transfers, and batch operations',
    'Can audit receipts and use stock issues bridge, but cannot manage staff/tax',
  ],
  cashier: [
    'POS Terminal and Tables access',
    'Can process sales and view basic receipts',
    'No stock management or production tools',
  ],
  waitron: [
    'Order taking and table operations',
    'Limited POS actions with no inventory controls',
    'No production or admin pages',
  ],
  kitchen_staff: [
    'Kitchen Display and Batch Production access',
    'Read-only front stock visibility for ingredient awareness',
    'No sales, payments, or cash-related pages',
  ],
  bar_staff: [
    'Counter sales workflow access',
    'Limited operations focused on service execution',
    'No admin and limited inventory controls',
  ],
};
