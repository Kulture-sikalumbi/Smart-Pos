import { ArrowRightLeft, BarChart3, Boxes, ChefHat, Grid3X3, Package, Receipt, UtensilsCrossed } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import type { RolePermissions, UserRole } from '@/types/auth';
import type { ComponentType } from 'react';

const tools: Array<{
  label: string;
  icon: ComponentType<{ className?: string }>;
  path: string;
  permission: keyof RolePermissions;
  roles?: UserRole[];
}> = [
  { label: 'POS Terminal', icon: Receipt, path: '/app/pos/terminal', permission: 'accessPOS', roles: ['owner', 'manager', 'front_supervisor', 'cashier'] },
  { label: 'POS Menu Manager', icon: ChefHat, path: '/app/pos/menu', permission: 'accessPOS', roles: ['owner', 'manager', 'front_supervisor', 'cashier'] },
  { label: 'Front Office Stock', icon: Package, path: '/app/inventory/front-office-stock', permission: 'viewInventory', roles: ['owner', 'manager', 'front_supervisor', 'kitchen_staff'] },
  { label: 'Stock Transfers', icon: ArrowRightLeft, path: '/app/inventory/transfer-qr', permission: 'viewInventory', roles: ['owner', 'manager', 'front_supervisor'] },
  { label: 'Front Stock Take', icon: Package, path: '/app/inventory/front-stock-take', permission: 'viewInventory', roles: ['owner', 'manager', 'front_supervisor'] },
  { label: 'Batch Production', icon: Boxes, path: '/app/manufacturing/production', permission: 'recordBatchProduction' },
  { label: 'Batch History', icon: BarChart3, path: '/app/manufacturing/history', permission: 'recordBatchProduction', roles: ['owner', 'manager', 'front_supervisor'] },
  { label: 'Kitchen Display', icon: UtensilsCrossed, path: '/app/pos/kitchen', permission: 'accessPOS', roles: ['owner', 'manager', 'front_supervisor', 'kitchen_staff'] },
  { label: 'Tables', icon: Grid3X3, path: '/app/pos/tables', permission: 'accessPOS', roles: ['owner', 'manager', 'front_supervisor', 'cashier'] },
  { label: 'Stock Issues (Bridge)', icon: ArrowRightLeft, path: '/app/inventory/stock-issues', permission: 'createStockIssues', roles: ['owner', 'manager', 'front_supervisor'] },
  { label: 'Daily Receipts', icon: Receipt, path: '/app/receipt-demo', permission: 'viewReports', roles: ['owner', 'manager', 'front_supervisor', 'cashier'] },
];

export default function FrontOfficeHome() {
  const navigate = useNavigate();
  const { hasPermission, user } = useAuth();
  const role = (user?.role ?? 'cashier') as UserRole;
  const visibleTools = tools.filter((tool) => hasPermission(tool.permission) && (!tool.roles || tool.roles.includes(role)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Front Office Workspace</h1>
        <p className="text-sm text-muted-foreground">All front-office tools are shown here based on your role permissions.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleTools.map((tool) => (
          <Card
            key={tool.path}
            className="cursor-pointer border-emerald-500/20 hover:border-emerald-400/60 transition-colors"
            onClick={() => navigate(tool.path)}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-base">
                <tool.icon className="h-5 w-5 text-emerald-400" />
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

