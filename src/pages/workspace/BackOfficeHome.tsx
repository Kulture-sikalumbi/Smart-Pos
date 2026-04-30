import { ArrowRightLeft, BarChart3, ChefHat, ClipboardCheck, LayoutDashboard, Package, Receipt, Settings, ShoppingCart, ShieldCheck, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import type { UserRole } from '@/types/auth';
import type { RolePermissions } from '@/types/auth';
import type { ComponentType } from 'react';

const tools: Array<{
  label: string;
  icon: ComponentType<{ className?: string }>;
  path: string;
  permission: keyof RolePermissions;
  roles?: UserRole[];
}> = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/app/dashboard', permission: 'viewDashboard' },
  { label: 'Stock Items', icon: Package, path: '/app/inventory/items', permission: 'viewInventory' },
  { label: 'Purchases (GRV)', icon: ShoppingCart, path: '/app/purchases', permission: 'viewPurchases' },
  { label: 'Stock Issues', icon: ArrowRightLeft, path: '/app/inventory/stock-issues', permission: 'createStockIssues' },
  { label: 'Stock Take', icon: ClipboardCheck, path: '/app/inventory/stock-take', permission: 'performStockTake' },
  { label: 'Recipes', icon: ChefHat, path: '/app/manufacturing/recipes', permission: 'recordBatchProduction' },
  { label: 'Batch History', icon: BarChart3, path: '/app/manufacturing/history', permission: 'recordBatchProduction' },
  { label: 'Audit Trail', icon: ShieldCheck, path: '/app/audit-dashboard', permission: 'viewReports', roles: ['owner', 'manager', 'front_supervisor'] },
  { label: 'Staff', icon: Users, path: '/app/staff', permission: 'viewStaff' },
  { label: 'Reports', icon: BarChart3, path: '/app/reports', permission: 'viewReports' },
  { label: 'Shift X/Z Reports', icon: Receipt, path: '/app/reports/shifts', permission: 'viewReports' },
  { label: 'Till Management', icon: Receipt, path: '/app/settings/tills', permission: 'manageSettings' },
  { label: 'POS Menu Manager', icon: ChefHat, path: '/app/pos/menu', permission: 'accessPOS', roles: ['owner', 'manager', 'front_supervisor'] },
  { label: 'Settings', icon: Settings, path: '/app/settings', permission: 'manageSettings' },
];

export default function BackOfficeHome() {
  const navigate = useNavigate();
  const { hasPermission, user } = useAuth();
  const role = (user?.role ?? 'cashier') as UserRole;
  const visibleTools = tools.filter((tool) => hasPermission(tool.permission) && (!tool.roles || tool.roles.includes(role)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Back Office Workspace</h1>
        <p className="text-sm text-muted-foreground">All back-office tools are available here based on your role permissions.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleTools.map((tool) => (
          <Card
            key={tool.path}
            className="cursor-pointer border-blue-500/20 hover:border-blue-400/60 transition-colors"
            onClick={() => navigate(tool.path)}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-base">
                <tool.icon className="h-5 w-5 text-blue-400" />
                {tool.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Open {tool.label}</CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

