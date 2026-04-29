import React, { useMemo, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { useAuth } from '@/contexts/AuthContext';
import { useBranding } from '@/contexts/BrandingContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { cn } from '@/lib/utils';
import { NavLink } from '@/components/NavLink';
import {
  ArrowRightLeft,
  BarChart3,
  Boxes,
  ChefHat,
  ClipboardCheck,
  Factory,
  Grid3X3,
  LayoutDashboard,
  MonitorSmartphone,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { UserRole } from '@/types/auth';
import { isAdminLikeRole } from '@/types/auth';

type NavItemType = {
  id: string;
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  permission: keyof import('@/types/auth').RolePermissions;
  roles?: UserRole[];
};

const backOfficeItems: NavItemType[] = [
  { id: 'back-home', title: 'Workspace Home', url: '/app/back-office', icon: LayoutDashboard, permission: 'viewDashboard' },
  { id: 'back-dashboard', title: 'Dashboard', url: '/app/dashboard', icon: LayoutDashboard, permission: 'viewDashboard' },
  { id: 'back-stock-items', title: 'Stock Items', url: '/app/inventory/items', icon: Package, permission: 'viewInventory' },
  { id: 'back-purchases', title: 'Purchases (GRV)', url: '/app/purchases', icon: ShoppingCart, permission: 'viewPurchases' },
  { id: 'back-stock-issues', title: 'Stock Issues', url: '/app/inventory/stock-issues', icon: ArrowRightLeft, permission: 'createStockIssues' },
  { id: 'back-stock-take', title: 'Stock Take', url: '/app/inventory/stock-take', icon: ClipboardCheck, permission: 'performStockTake' },
  { id: 'back-staff', title: 'Staff', url: '/app/staff', icon: Users, permission: 'viewStaff' },
  { id: 'back-reports', title: 'Reports', url: '/app/reports', icon: BarChart3, permission: 'viewReports' },
  { id: 'back-shift-reports', title: 'Shift X/Z Reports', url: '/app/reports/shifts', icon: Receipt, permission: 'viewReports' },
  { id: 'back-tills', title: 'Tills', url: '/app/settings/tills', icon: Receipt, permission: 'manageSettings' },
  { id: 'back-pos-menu', title: 'POS Menu Manager', url: '/app/pos/menu', icon: ChefHat, permission: 'accessPOS', roles: ['owner', 'manager', 'front_supervisor'] },
];

const frontOfficeItems: NavItemType[] = [
  { id: 'front-home', title: 'Workspace Home', url: '/app/front-office', icon: ChefHat, permission: 'accessPOS' },
  { id: 'front-pos', title: 'POS Terminal', url: '/app/pos/terminal', icon: MonitorSmartphone, permission: 'accessPOS', roles: ['owner', 'manager', 'front_supervisor', 'cashier'] },
  { id: 'front-pos-menu', title: 'POS Menu Manager', url: '/app/pos/menu', icon: ChefHat, permission: 'accessPOS', roles: ['owner', 'manager', 'front_supervisor', 'cashier'] },
  { id: 'front-stock', title: 'Front Office Stock', url: '/app/inventory/front-office-stock', icon: Package, permission: 'viewInventory', roles: ['owner', 'manager', 'front_supervisor', 'kitchen_staff'] },
  { id: 'front-transfers', title: 'Stock Transfers', url: '/app/inventory/transfer-qr', icon: ArrowRightLeft, permission: 'viewInventory', roles: ['owner', 'manager', 'front_supervisor'] },
  { id: 'front-stock-take', title: 'Front Stock Take', url: '/app/inventory/front-stock-take', icon: ClipboardCheck, permission: 'viewInventory', roles: ['owner', 'manager', 'front_supervisor'] },
  { id: 'front-batch-production', title: 'Batch Production', url: '/app/manufacturing/production', icon: Boxes, permission: 'recordBatchProduction' },
  { id: 'front-batch-history', title: 'Batch History', url: '/app/manufacturing/history', icon: BarChart3, permission: 'recordBatchProduction', roles: ['owner', 'manager', 'front_supervisor'] },
  { id: 'front-kitchen', title: 'Kitchen Display', url: '/app/pos/kitchen', icon: UtensilsCrossed, permission: 'accessPOS', roles: ['owner', 'manager', 'front_supervisor', 'kitchen_staff'] },
  { id: 'front-tables', title: 'Tables', url: '/app/pos/tables', icon: Grid3X3, permission: 'accessPOS', roles: ['owner', 'manager', 'front_supervisor', 'cashier'] },
  { id: 'front-stock-issues', title: 'Stock Issues (Bridge)', url: '/app/inventory/stock-issues', icon: ArrowRightLeft, permission: 'createStockIssues', roles: ['owner', 'manager', 'front_supervisor'] },
  { id: 'front-receipts', title: 'Daily Receipts', url: '/app/receipt-demo', icon: Receipt, permission: 'viewReports', roles: ['owner', 'manager', 'front_supervisor', 'cashier'] },
];

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const { hasPermission, user, brand } = useAuth();
  const { settings } = useBranding();
  const { workspace, setWorkspace, canUseBackOffice, canUseFrontOffice } = useWorkspace();
  const [showCreateBrandDialog, setShowCreateBrandDialog] = useState(false);

  const authBrandId = String((user as any)?.brand_id ?? (brand as any)?.id ?? '');
  const hasBrand = Boolean(authBrandId);
  const role = String((user as any)?.role ?? '').toLowerCase();
  const isSuperAdmin = Boolean((user as any)?.is_super_admin);
  const isAdminLike = isSuperAdmin || isAdminLikeRole(role);
  const canSwitchMode = isAdminLike;
  const showPrivilegedFooterLinks = isAdminLike;

  const isActive = (path: string) => {
    if (path === '/app') return location.pathname === '/app' || location.pathname === '/app/';
    return location.pathname.startsWith(path);
  };

  const activeRole = (user?.role ?? 'cashier') as UserRole;
  const visibleItems = useMemo(() => {
    const source = workspace === 'back' ? backOfficeItems : frontOfficeItems;
    return source.filter((item) => hasPermission(item.permission) && (!item.roles || item.roles.includes(activeRole)));
  }, [workspace, hasPermission, activeRole]);

  const NavItem = ({ item }: { item: NavItemType }) => {
    const disabled = !hasBrand;
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={isActive(item.url) && !disabled}>
          <NavLink
            to={disabled ? '#' : item.url}
            aria-disabled={disabled}
            tabIndex={disabled ? -1 : undefined}
            onClick={(e) => {
              if (disabled) {
                e.preventDefault();
                setShowCreateBrandDialog(true);
                return;
              }
              if (
                item.url.startsWith('/app/pos') ||
                item.url.startsWith('/app/manufacturing') ||
                item.url.startsWith('/app/inventory/front-office-stock') ||
                item.url.startsWith('/app/inventory/transfer-qr')
              ) {
                setWorkspace('front');
              }
              if (item.url.startsWith('/app/dashboard') || item.url.startsWith('/app/purchases') || item.url.startsWith('/app/staff') || item.url.startsWith('/app/reports') || item.url.startsWith('/app/inventory/stock')) {
                setWorkspace('back');
              }
            }}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-md transition-colors',
              isActive(item.url) && !disabled
                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
              disabled && 'cursor-not-allowed opacity-50'
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{item.title}</span>}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  const workspaceAccentClass =
    workspace === 'back'
      ? 'border-r-2 border-r-blue-500/60 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.15)]'
      : 'border-r-2 border-r-emerald-400/70 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.18)]';

  return (
    <Sidebar className={cn('border-r border-sidebar-border', workspaceAccentClass)}>
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          {settings.logoDataUrl ? (
            <img src={settings.logoDataUrl} alt={settings.appName} className="h-8 w-8 rounded-lg object-cover border border-sidebar-border bg-sidebar-primary" />
          ) : (
            <div className="h-8 w-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <Factory className="h-5 w-5 text-sidebar-primary-foreground" />
            </div>
          )}
          {!collapsed && (
            <div>
              <h2 className="font-bold text-sidebar-foreground">{settings.appName}</h2>
              <p className="text-xs text-sidebar-foreground/60">{workspace === 'back' ? 'Back Office Mode' : 'Front Office Mode'}</p>
            </div>
          )}
        </div>

        {!collapsed && canSwitchMode && (
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              variant={workspace === 'back' ? 'default' : 'outline'}
              disabled={!canUseBackOffice || !canSwitchMode}
              onClick={() => {
                setWorkspace('back');
                navigate('/app/back-office');
              }}
            >
              Back Office
            </Button>
            <Button
              size="sm"
              variant={workspace === 'front' ? 'default' : 'outline'}
              disabled={!canUseFrontOffice}
              onClick={() => {
                setWorkspace('front');
                navigate('/app/front-office');
              }}
            >
              Front Office
            </Button>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className="py-4">
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel className="text-sidebar-foreground/50 px-3">{workspace === 'back' ? 'Back Office' : 'Front Office'}</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => (
                <NavItem key={item.id} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {showPrivilegedFooterLinks ? (
        <SidebarFooter className="p-4 border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={isActive('/hub')}>
                <NavLink to="/hub" className="flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sidebar-foreground hover:bg-sidebar-accent/50">
                  <ChefHat className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>Command Center</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={isActive('/app/settings')}>
                <NavLink
                  to={hasBrand ? '/app/settings' : '#'}
                  onClick={(e) => {
                    if (!hasBrand) {
                      e.preventDefault();
                      navigate('/app/company-settings');
                    }
                  }}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-md transition-colors',
                    isActive('/app/settings') ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
                    !hasBrand && 'opacity-60'
                  )}
                >
                  <Settings className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>Settings</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      ) : null}

      <AlertDialog open={showCreateBrandDialog} onOpenChange={setShowCreateBrandDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create a brand first</AlertDialogTitle>
            <AlertDialogDescription>
              You need to create a brand before accessing workspace pages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel onClick={() => setShowCreateBrandDialog(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => navigate('/app/company-settings')}>Create Brand</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </Sidebar>
  );
}

