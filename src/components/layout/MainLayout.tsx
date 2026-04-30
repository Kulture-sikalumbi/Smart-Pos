import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import React, { Suspense } from 'react';
import { AppSidebar } from './AppSidebar';
import { SidebarProvider, SidebarTrigger, SidebarInset } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';
import { Grid3X3 } from 'lucide-react';
import LowStockAlerts from '@/components/common/LowStockAlerts';
import SyncStatusIndicator from '@/components/layout/SyncStatusIndicator';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { ROLE_NAMES } from '@/types/auth';
import { useBranding } from '@/contexts/BrandingContext';
import { useOfflineOrderSync } from '@/hooks/useOfflineOrderSync';
import { CurrencyPicker } from '@/components/common/CurrencyPicker';

export function MainLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, switchUser, operatorUsers, hasPermission } = useAuth();
  const { settings } = useBranding();

  useOfflineOrderSync();

  const isPosTerminal = location.pathname === '/app/pos' || location.pathname.startsWith('/app/pos/terminal');
  const isSelfOrder = location.pathname.startsWith('/app/self-order/');
  const isKitchenDisplay = location.pathname === '/app/pos/kitchen';

  if (isPosTerminal || isSelfOrder || isKitchenDisplay) {
    const canUseTables = hasPermission('transferTables');

    return (
      <div className="min-h-screen w-full bg-background bg-[radial-gradient(85%_55%_at_50%_-8%,hsl(var(--primary)/0.28),transparent_62%),radial-gradient(45%_40%_at_88%_12%,hsl(var(--primary)/0.18),transparent_70%)] relative">
        {!isSelfOrder && isPosTerminal && canUseTables && (
          <div className="absolute bottom-4 right-4 z-50">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full border-primary/30 bg-background/90 backdrop-blur-xl shadow-lg"
              onClick={() => navigate('/app/pos/tables')}
            >
              <Grid3X3 className="h-4 w-4 mr-1" />
              Tables
            </Button>
          </div>
        )}
        <div className="absolute top-3 right-3 z-50">
          <SyncStatusIndicator />
        </div>
        <Outlet />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex h-screen overflow-hidden w-full bg-background bg-[radial-gradient(82%_52%_at_52%_-6%,hsl(var(--primary)/0.26),transparent_60%),radial-gradient(40%_36%_at_86%_16%,hsl(var(--primary)/0.16),transparent_72%)]">
        {/* Sidebar: fixed, high z-index, visible on desktop by default */}
        <div className="z-40 relative lg:static">
          <AppSidebar />
        </div>
        {/* Main content area inset by sidebar */}
        <SidebarInset className="relative flex-1 flex flex-col min-w-0 !bg-transparent overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(88%_62%_at_50%_-12%,hsl(var(--primary)/0.34),transparent_62%),radial-gradient(46%_40%_at_92%_14%,hsl(var(--primary)/0.20),transparent_72%)]"
          />
          {/* Header */}
          <header className="h-14 border-b border-primary/30 bg-gradient-to-r from-primary/22 via-primary/12 to-transparent backdrop-blur-xl flex items-center justify-between px-4 sticky top-0 z-30">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="lg:hidden" />
              <h1 className="text-lg font-semibold text-foreground hidden sm:block">
                {settings.appName}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <SyncStatusIndicator />
              <CurrencyPicker className="hidden sm:block" disabled={!hasPermission('manageSettings')} />
              <LowStockAlerts />
              {/* User Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2 hover:bg-primary/12">
                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
                      {(user?.name ?? '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="hidden sm:block text-left">
                      <span className="text-sm font-medium">{user?.name}</span>
                      <Badge variant="outline" className="ml-2 text-xs border-primary/50 text-primary/80">
                        {user ? ROLE_NAMES[user.role] : ''}
                      </Badge>
                    </div>
                    <ChevronDown className="h-4 w-4 hidden sm:block" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <div>
                      <p className="font-medium">{user?.name}</p>
                      <p className="text-xs text-muted-foreground">{user ? ROLE_NAMES[user.role] : ''}</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Switch User
                  </DropdownMenuLabel>
                    {operatorUsers.map((u) => (
                    <DropdownMenuItem
                      key={u.id}
                      onClick={() => switchUser(u.id)}
                      className={user?.id === u.id ? 'bg-accent' : ''}
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
                          {(u.name ?? '?').charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm">{u.name ?? ''}</p>
                          <p className="text-xs text-muted-foreground">{ROLE_NAMES[u.role]}</p>
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} className="text-destructive">
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          {/* Main Content */}
          <div className="relative z-10 flex-1 min-h-0 p-4 md:p-6 overflow-auto bg-transparent">
            <Suspense fallback={<div className="flex flex-1 items-center justify-center min-h-[40vh]"><div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-primary/60 border-opacity-30" /></div>}>
              <Outlet />
            </Suspense>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
