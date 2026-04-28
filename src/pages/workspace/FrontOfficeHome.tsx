import { Boxes, Grid3X3, Package, Receipt, UtensilsCrossed } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import type { UserRole } from '@/types/auth';

const tools = [
  { label: 'POS Terminal', icon: Receipt, path: '/app/pos/terminal', permission: 'accessPOS' as const, roles: ['owner', 'manager', 'front_supervisor', 'cashier'] as UserRole[] },
  { label: 'Front Office Stock', icon: Package, path: '/app/inventory/front-office-stock', permission: 'viewInventory' as const, roles: ['owner', 'manager', 'front_supervisor', 'kitchen_staff'] as UserRole[] },
  { label: 'Batch Production', icon: Boxes, path: '/app/manufacturing/production', permission: 'recordBatchProduction' as const, roles: ['owner', 'manager', 'front_supervisor', 'kitchen_staff'] as UserRole[] },
  { label: 'Front Stock Take', icon: Package, path: '/app/inventory/front-stock-take', permission: 'viewInventory' as const, roles: ['owner', 'manager', 'front_supervisor'] as UserRole[] },
  { label: 'Kitchen Display', icon: UtensilsCrossed, path: '/app/pos/kitchen', permission: 'accessPOS' as const, roles: ['owner', 'manager', 'front_supervisor', 'kitchen_staff'] as UserRole[] },
  { label: 'Tables', icon: Grid3X3, path: '/app/pos/tables', permission: 'accessPOS' as const, roles: ['owner', 'manager', 'front_supervisor', 'cashier'] as UserRole[] },
  { label: 'Daily Receipts', icon: Receipt, path: '/app/receipt-demo', permission: 'viewReports' as const, roles: ['owner', 'manager', 'front_supervisor', 'cashier'] as UserRole[] },
];

export default function FrontOfficeHome() {
  const navigate = useNavigate();
  const { hasPermission, user } = useAuth();
  const role = (user?.role ?? 'cashier') as UserRole;
  const visibleTools = tools.filter((tool) => hasPermission(tool.permission) && tool.roles.includes(role));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Front Office Workspace</h1>
        <p className="text-sm text-muted-foreground">Select a station to start serving.</p>
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

