import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Routes, Route, Navigate } from "react-router-dom";
import { BrandingProvider } from "./contexts/BrandingContext";
import { CurrencyProvider } from "./contexts/CurrencyContext";
import { MainLayout } from "./components/layout/MainLayout";
import { RoleGateway } from "./components/common/RoleGateway";
import { useAuth } from '@/contexts/AuthContext';
import { ProtectedRoute } from './components/common/ProtectedRoute';
import React, { Suspense } from "react";
import { InstallPrompt } from "@/components/common/InstallPrompt";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

import Dashboard from "./pages/Dashboard";
import StockItems from "./pages/inventory/StockItems";
import StockIssues from "./pages/inventory/StockIssues";
import StockTake from "./pages/inventory/StockTake";
import Recipes from "./pages/manufacturing/Recipes";
import BatchProduction from "./pages/manufacturing/BatchProduction";
import Purchases from "./pages/Purchases";
import Staff from "./pages/Staff";
import Reports from "./pages/Reports";
import IntelligenceWorkspace from "./pages/IntelligenceWorkspace";
import Settings from "./pages/Settings";
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
import ZRATaxSeason from './pages/ZRATaxSeason';
import CompanySettings from './pages/CompanySettings';
import Landing from './pages/Landing';
// AuthPage removed: using in-place overlay form instead
import AuthCallback from './pages/AuthCallback';
import AdvancedGAAP from "./pages/inventory/AdvancedGAAP";

const queryClient = new QueryClient();

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
            <InstallPrompt />
            <BrandPromptModal />
              <Suspense fallback={<AppShellLoader />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/login" element={<Navigate to="/" replace />} />
                <Route path="/company-settings" element={<Navigate to="/app/company-settings" replace />} />
                <Route path="/auth/callback" element={<AuthCallback />} />

                <Route path="/app" element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
                  <Route index element={<Dashboard />} />
                  <Route path="inventory/stock-items" element={<StockItems />} />
                  <Route path="inventory/stock-issues" element={<StockIssues />} />
                  <Route path="inventory/stock-take" element={<StockTake />} />
                  <Route path="inventory/advanced-gaap" element={<AdvancedGAAP />} />
                  <Route path="inventory/transfer-qr" element={<TransferQR />} />
                  <Route path="manufacturing/recipes" element={<Recipes />} />
                  <Route path="manufacturing/production" element={<BatchProduction />} />
                  <Route path="purchases" element={<Purchases />} />
                  <Route path="staff" element={<Staff />} />
                  <Route path="reports" element={<Reports />} />
                  <Route path="intelligence" element={<IntelligenceWorkspace />} />
                  <Route path="zra-tax-season" element={<ZRATaxSeason />} />
                  <Route path="settings" element={<Settings />} />
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
