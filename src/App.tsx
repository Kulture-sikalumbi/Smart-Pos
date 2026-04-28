import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Routes, Route, Navigate } from "react-router-dom";
import { BrandingProvider } from "./contexts/BrandingContext";
import { CurrencyProvider } from "./contexts/CurrencyContext";
import { MainLayout } from "./components/layout/MainLayout";
import { RoleGateway } from "./components/common/RoleGateway";
import { BrandActivationGuard } from "./components/common/BrandActivationGuard";
import { useAuth } from '@/contexts/AuthContext';
import { ProtectedRoute } from './components/common/ProtectedRoute';
import React, { Suspense, useEffect, useState, useRef } from "react";
import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { InstallPrompt } from "@/components/common/InstallPrompt";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useNavigate } from 'react-router-dom';

import Dashboard from "./pages/Dashboard";
import StockItems from "./pages/inventory/StockItems";
import StockIssues from "./pages/inventory/StockIssues";
import StockTake from "./pages/inventory/StockTake";
import FrontOfficeStock from "./pages/inventory/FrontOfficeStock";
import FrontStockTake from "./pages/inventory/FrontStockTake";
import Recipes from "./pages/manufacturing/Recipes";
import BatchProduction from "./pages/manufacturing/BatchProduction";
import { BatchProductionManager } from "./pages/manufacturing/BatchProductionManager";
import Purchases from "./pages/Purchases";
import Staff from "./pages/Staff";
import Reports from "./pages/Reports";
import ShiftReports from "./pages/ShiftReports";
import IntelligenceWorkspace from "./pages/IntelligenceWorkspace";
import Settings from "./pages/Settings";
import TillManagement from "./pages/TillManagement";
import NotFound from "./pages/NotFound";
import TaxEngineDemo from './pages/TaxEngineDemo';
import AuditDashboard from './pages/AuditDashboard';
import SecurityDemo from './pages/security/SecurityDemo';
import ProfitProtectionDemo from './pages/variance/ProfitProtectionDemo';
import ZRAInvoiceDemo from './pages/pos/ZRAInvoiceDemo';
import ReportSharerDemo from './components/common/ReportSharerDemo';
import GlobalReceiptDemo from './pages/pos/GlobalReceiptDemo';
import SelfOrder from './pages/pos/SelfOrder';
import TableQrCodes from './pages/pos/TableQrCodes';
import TabletLockMode from './pages/pos/TabletLockMode';
import Hub from './pages/Hub';
import BackOfficeHome from './pages/workspace/BackOfficeHome';
import FrontOfficeHome from './pages/workspace/FrontOfficeHome';
import ZRATaxSeason from './pages/ZRATaxSeason';
import CompanySettings from './pages/CompanySettings';
import Landing from './pages/Landing';
// AuthPage removed: using in-place overlay form instead
import AuthCallback from './pages/AuthCallback';
import AdvancedGAAP from "./pages/inventory/AdvancedGAAP";

const queryClient = new QueryClient();

type AppErrorBoundaryState = {
  hasError: boolean;
  message?: string;
};

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, AppErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Unexpected application error',
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('AppErrorBoundary caught an error', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The page hit an unexpected error. Reload to recover.
          </p>
          {this.state.message ? (
            <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
          ) : null}
          <div className="mt-4 flex gap-2">
            <Button onClick={() => window.location.reload()}>Reload</Button>
            <Button variant="outline" onClick={() => this.setState({ hasError: false, message: undefined })}>
              Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

const TransferQR = React.lazy(() => import("./pages/inventory/TransferQR"));
const POSTerminal = React.lazy(() => import("./pages/pos/POSTerminal"));
const TableManagement = React.lazy(() => import("./pages/pos/TableManagement"));
const CashUp = React.lazy(() => import("./pages/pos/CashUp"));
const KitchenDisplay = React.lazy(() => import("./pages/pos/KitchenDisplay"));
const MenuManager = React.lazy(() => import("./pages/pos/MenuManager"));

// Professional Skeleton Spinner
function AppShellLoader() {
  return (
    <div className="flex flex-1 items-center justify-center min-h-[40vh]">
      <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-primary/60 border-opacity-30" />
    </div>
  );
}

const App = () => {
  const { loading } = useAuth();
  const [updateInfo, setUpdateInfo] = useState<any | null>(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [countdown, setCountdown] = useState(15);
  const countdownRef = useRef<number | null>(null);

  useEffect(() => {
    const e = (window as any).electron;
    if (!e) return;

    try {
      e.on && e.on('update-available', (info: any) => {
        try { toast({ title: 'Update available', description: 'Downloading update…' }); } catch {}
      });

      e.on && e.on('update-downloaded', (info: any) => {
        try {
          // Show toast and modal with non-postponable countdown
          toast({ title: 'Update ready', description: `Version ${info?.version ?? ''} downloaded. Restarting shortly.` });
          setUpdateInfo(info);
          setCountdown(15);
          setUpdateModalOpen(true);

          // start countdown
          if (countdownRef.current) {
            clearInterval(countdownRef.current as unknown as number);
            countdownRef.current = null;
          }
          countdownRef.current = window.setInterval(() => {
            setCountdown((c) => {
              if (c <= 1) {
                try { e.installUpdate(); } catch {}
                if (countdownRef.current) { clearInterval(countdownRef.current as unknown as number); countdownRef.current = null; }
                return 0;
              }
              return c - 1;
            });
          }, 1000) as unknown as number;
        } catch {}
      });

      e.on && e.on('update-error', (err: any) => {
        try { toast({ title: 'Update error', description: String(err), variant: 'destructive' }); } catch {}
      });
    } catch (err) {
      // ignore
    }

    return () => {
      if (countdownRef.current) { clearInterval(countdownRef.current as unknown as number); countdownRef.current = null; }
    };
  }, []);
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-primary/60 border-opacity-30" />
    </div>
  );

  return (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <CurrencyProvider>
          <TooltipProvider>
            <AppErrorBoundary>
              <InstallPrompt />
              <BrandPromptModal />
              <UpdateModal open={updateModalOpen} onOpenChange={setUpdateModalOpen} info={updateInfo} countdown={countdown} />
              <BrandActivationGuard />
              <Suspense fallback={<AppShellLoader />}>
                <Routes>
                  <Route path="/" element={<Landing />} />
                  <Route path="/pos" element={<Navigate to="/app/pos/terminal" replace />} />
                  <Route path="/login" element={<Navigate to="/" replace />} />
                  <Route path="/company-settings" element={<Navigate to="/app/company-settings" replace />} />
                  <Route path="/auth/callback" element={<AuthCallback />} />

                  <Route path="/hub" element={<ProtectedRoute><Hub /></ProtectedRoute>} />
                  <Route path="/tablet-lock" element={<TabletLockMode />} />
                  <Route path="/app" element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
                    <Route index element={<Navigate to="/hub" replace />} />
                    <Route path="dashboard" element={<Dashboard />} />
                    <Route path="back-office" element={<BackOfficeHome />} />
                    <Route path="front-office" element={<FrontOfficeHome />} />
                    <Route path="inventory/stock-items" element={<StockItems />} />
                    <Route path="inventory/stock-issues" element={<StockIssues />} />
                    <Route path="inventory/stock-take" element={<StockTake />} />
                    <Route path="inventory/front-office-stock" element={<FrontOfficeStock />} />
                    <Route path="inventory/front-stock-take" element={<FrontStockTake />} />
                    <Route path="inventory/advanced-gaap" element={<AdvancedGAAP />} />
                    <Route path="inventory/transfer-qr" element={<TransferQR />} />
                    <Route path="manufacturing/recipes" element={<Recipes />} />
                    <Route path="manufacturing/production" element={<BatchProduction />} />
                    <Route path="manufacturing/history" element={<BatchProductionManager />} />
                    <Route path="purchases" element={<Purchases />} />
                    <Route path="staff" element={<Staff />} />
                    <Route path="reports" element={<Reports />} />
                    <Route path="reports/shifts" element={<ShiftReports />} />
                    <Route path="intelligence" element={<IntelligenceWorkspace />} />
                    <Route path="zra-tax-season" element={<ZRATaxSeason />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="settings/tills" element={<TillManagement />} />
                    <Route path="company-settings" element={<CompanySettings />} />
                    <Route path="tax-demo" element={<TaxEngineDemo />} />
                    <Route path="audit-dashboard" element={<AuditDashboard />} />
                    <Route path="security-demo" element={<SecurityDemo />} />
                    <Route path="variance-demo" element={<ProfitProtectionDemo />} />
                    <Route path="zra-invoice-demo" element={<ZRAInvoiceDemo />} />
                    <Route path="report-share-demo" element={<ReportSharerDemo />} />
                    <Route path="receipt-demo" element={<GlobalReceiptDemo />} />
                    <Route path="pos" element={<POSTerminal />} />
                    <Route path="pos/terminal" element={<POSTerminal />} />
                    <Route path="pos/menu" element={<MenuManager />} />
                    <Route path="pos/tables" element={<TableManagement />} />
                    <Route path="pos/cash-up" element={<CashUp />} />
                    <Route path="pos/kitchen" element={<KitchenDisplay />} />
                    <Route path="self-order/:tableNo" element={<SelfOrder />} />
                    <Route path="pos/table-qr" element={<TableQrCodes />} />
                    <Route path="inventory/items" element={<StockItems />} />
                  </Route>
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </AppErrorBoundary>
          </TooltipProvider>
        </CurrencyProvider>
      </BrandingProvider>
    </QueryClientProvider>
  );
};

export default App;

function BrandPromptModal() {
  const { isAuthenticated, user, profileReady } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const navigate = useNavigate();

  React.useEffect(() => {
    // Only prompt once we've synced the server profile at least once,
    // and only if THIS user is not linked to a brand.
    if (isAuthenticated && profileReady && !user?.brand_id && !dismissed) setOpen(true);
    else setOpen(false);
  }, [isAuthenticated, profileReady, user?.brand_id, dismissed]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setDismissed(true); setOpen(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a brand</DialogTitle>
          <DialogDescription>
            You have no brand created yet. Create a brand now to continue — this makes you the owner and sets up branding across the app.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => { setOpen(false); setDismissed(true); }}>Remind me later</Button>
          <Button onClick={() => { setOpen(false); navigate('/app/company-settings'); }}>Create brand</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UpdateModal({ open, onOpenChange, info, countdown }: { open: boolean; onOpenChange: (o: boolean) => void; info: any; countdown: number }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update ready</DialogTitle>
          <DialogDescription>
            A new update (version {info?.version ?? ''}) has been downloaded. The app will restart in {countdown} second{countdown === 1 ? '' : 's'} to apply the update. Please save your work — your data and progress will be preserved.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => { /* intentionally do not allow postponing */ }}>
            Save and restart now
          </Button>
          <Button onClick={() => { try { (window as any).electron?.installUpdate(); } catch {} }}>
            Restart now ({countdown})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
