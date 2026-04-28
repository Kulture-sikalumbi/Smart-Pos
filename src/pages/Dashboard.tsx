import { useCurrency } from '@/contexts/CurrencyContext';
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Package, 
  Users, 
  Receipt,
  AlertTriangle,
  Clock,
  ShoppingBag,
  Truck,
  UtensilsCrossed
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { PageHeader, KPICard, DataTableWrapper, NumericCell, StatusBadge } from '@/components/common/PageComponents';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { subscribeOrders, getOrdersSnapshot } from '@/lib/orderStore';
import { subscribeGRVs, getGRVsSnapshot, refreshGRVs } from '@/lib/grvDbStore';
import { subscribeExpenses, getExpensesSnapshot, addExpense } from '@/lib/expenseStore';
import { subscribeStockTakes, getStockTakesSnapshot } from '@/lib/stockTakeStore';
import { computeDelta, computeExecutiveMetrics, fetchDashboardStatsFromDb, mergeDashboardOverview } from '@/lib/dashboardMetrics';
import { useAuth } from '@/contexts/AuthContext';
import { useReportSharer } from '@/hooks/useReportSharer';
import { subscribeToRealtimeOrders } from '@/lib/orderStore';
import { subscribeToRealtimeStockItems } from '@/lib/stockStore';
import { subscribeToRealtimeExpenses } from '@/lib/expenseStore';
import { useDashboardDateRange } from '@/hooks/useDashboardDateRange';
import { fetchFrontReconciliationSummary, fetchFrontVarianceAlerts, type FrontVarianceAlert } from '@/lib/stockTakeStore';
import type { ExpenseCategory } from '@/types';
import type { SalesMixItem, StockVariance } from '@/types';
import type { DashboardStaffRow } from '@/lib/dashboardMetrics';

export default function Dashboard() {
  const { user, brand, accountUser } = useAuth();
  const { formatMoneyPrecise, currencySymbol } = useCurrency();
  const orders = useSyncExternalStore(subscribeOrders, getOrdersSnapshot);
  const grvs = useSyncExternalStore(subscribeGRVs, getGRVsSnapshot);
  const expenses = useSyncExternalStore(subscribeExpenses, getExpensesSnapshot);
  const stockTakes = useSyncExternalStore(subscribeStockTakes, getStockTakesSnapshot);

  const brandId = (user?.brand_id ?? brand?.id ?? '') as string;
  useEffect(() => {
    if (!accountUser) return;
    if (!brandId) return;
    void refreshGRVs(brandId).catch((e) => console.error('Failed to load GRVs', e));

    // Setup realtime subscriptions so KPI cards update instantly when other devices change data.
    const unsubbers: Array<(() => void) | null> = [];
    try {
      const oUnsub = subscribeToRealtimeOrders();
      if (oUnsub) unsubbers.push(oUnsub);
    } catch {
      // realtime optional
    }
    try {
      const sUnsub = subscribeToRealtimeStockItems();
      if (sUnsub) unsubbers.push(sUnsub);
    } catch {
      // realtime optional
    }
    try {
      const eUnsub = subscribeToRealtimeExpenses();
      if (eUnsub) unsubbers.push(eUnsub);
    } catch {
      // realtime optional
    }

    return () => {
      for (const u of unsubbers) {
        try {
          if (u) u();
        } catch {
          // ignore unsubscriber failures
        }
      }
    };
  }, [accountUser, brandId]);

  

  const {
    today,
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    safeRange,
    previousRange,
    isTodayRange,
    rangeLabel,
    preset,
    applyPreset,
  } = useDashboardDateRange();
  const [showDateFilters, setShowDateFilters] = useState<boolean>(false);
  const fromInputRef = useRef<HTMLInputElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const [dbSnapshot, setDbSnapshot] = useState<Record<string, unknown> | null>(null);
  const [dbSnapshotPrev, setDbSnapshotPrev] = useState<Record<string, unknown> | null>(null);
  const [frontVarianceSummary, setFrontVarianceSummary] = useState({
    count: 0,
    varianceQtyTotal: 0,
    varianceValueEstimate: 0,
    byLocation: {
      MANUFACTURING: { count: 0, varianceQty: 0, varianceValue: 0 },
      SALE: { count: 0, varianceQty: 0, varianceValue: 0 },
    },
  });
  const [frontVarianceAlerts, setFrontVarianceAlerts] = useState<FrontVarianceAlert[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Always fetch DB metrics on mount and when brand/date changes
  const refreshDbMetrics = async () => {
    setIsLoading(true);
    const start = Date.now();
    try {
      const res = await fetchDashboardStatsFromDb(brandId, safeRange.startDate, safeRange.endDate);
      const prevRes = await fetchDashboardStatsFromDb(brandId, previousRange.startDate, previousRange.endDate);
      const frontVar = await fetchFrontReconciliationSummary({ from: safeRange.startDate, to: safeRange.endDate });
      const frontAlerts = await fetchFrontVarianceAlerts({ from: safeRange.startDate, to: safeRange.endDate, limit: 5 });
      if (res) {
        const typedRes = res as Record<string, unknown>;
        setDbSnapshot(typedRes);
        if (typedRes.last_updated) setLastUpdated(String(typedRes.last_updated));
      }
      setDbSnapshotPrev((prevRes as Record<string, unknown> | null) ?? null);
      setFrontVarianceSummary(frontVar);
      setFrontVarianceAlerts(frontAlerts);
    } catch (e) {
      console.error('Failed to fetch dashboard stats from DB', e);
    } finally {
      const elapsed = Date.now() - start;
      const minDelay = 600;
      const wait = elapsed < minDelay ? minDelay - elapsed : 0;
      window.setTimeout(() => setIsLoading(false), wait);
    }
  };

  useEffect(() => {
    if (!accountUser || !brandId) return;
    refreshDbMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountUser, brandId, safeRange.startDate, safeRange.endDate, previousRange.startDate, previousRange.endDate]);

  // Always compute local metrics for instant feedback
  const metrics = useMemo(() => {
    return computeExecutiveMetrics({
      startDate: safeRange.startDate,
      endDate: safeRange.endDate,
      orders,
      grvs,
      expenses,
      stockTakes,
    });
  }, [safeRange.startDate, safeRange.endDate, orders, grvs, expenses, stockTakes]);

  const previousMetrics = useMemo(() => {
    return computeExecutiveMetrics({
      startDate: previousRange.startDate,
      endDate: previousRange.endDate,
      orders,
      grvs,
      expenses,
      stockTakes,
    });
  }, [previousRange.startDate, previousRange.endDate, orders, grvs, expenses, stockTakes]);

  // Keep all displayed metrics firmly bound to selected date range via the local computeDashboardMetrics result.
  const data = useMemo(() => metrics.overview, [metrics.overview]);
  const displayData = useMemo(() => mergeDashboardOverview(data, dbSnapshot), [data, dbSnapshot]);
  const prevDisplayData = useMemo(
    () => mergeDashboardOverview(previousMetrics.overview, dbSnapshotPrev),
    [previousMetrics.overview, dbSnapshotPrev]
  );

  // Unified data state: prefer DB arrays when present, else local computed.
  const topSellers = useMemo(() => {
    const fromDb = (dbSnapshot as any)?.topSellers;
    return (Array.isArray(fromDb) && fromDb.length ? (fromDb as SalesMixItem[]) : metrics.topSellers) as SalesMixItem[];
  }, [dbSnapshot, metrics.topSellers]);

  const staffRows = useMemo(() => {
    const fromDb = (dbSnapshot as any)?.staffRows;
    return (Array.isArray(fromDb) && fromDb.length ? (fromDb as DashboardStaffRow[]) : metrics.staffRows) as DashboardStaffRow[];
  }, [dbSnapshot, metrics.staffRows]);

  const topVariances = useMemo(() => {
    const fromDb = (dbSnapshot as any)?.varianceItems;
    return (Array.isArray(fromDb) && fromDb.length ? (fromDb as StockVariance[]) : metrics.varianceItems) as StockVariance[];
  }, [dbSnapshot, metrics.varianceItems]);

  const lowSeller = useMemo(() => {
    const fromDb = (dbSnapshot as any)?.lowSeller;
    return fromDb ?? metrics.lowSeller;
  }, [dbSnapshot, metrics.lowSeller]);

  const { shareDailyReport, downloadCsv, downloadDoc, shareViaWhatsApp, downloadMetricCsv } = useReportSharer();

  const paymentBreakdown = useMemo(() => {
    return {
      cashTotal: Number(displayData.cashTotal ?? 0),
      cardTotal: Number(displayData.cardTotal ?? 0),
      chequeTotal: Number(displayData.chequeTotal ?? 0),
      totalPaytypes: Number(displayData.totalPaytypes ?? 0),
    };
  }, [displayData]);

  const hoursPerDay = useMemo(() => {
    return Number(displayData.hoursPerDay ?? 0);
  }, [displayData.hoursPerDay]);

  const cashierShiftsByStaff: Array<Record<string, any>> = Array.isArray((dbSnapshot as any)?.cashierShiftsByStaff)
    ? (((dbSnapshot as any).cashierShiftsByStaff as Array<Record<string, any>>) ?? [])
    : [];

  const cashierShiftCount = Number(dbSnapshot?.cashierShiftCount ?? 0);
  const cashierShiftClosedCount = Number(dbSnapshot?.cashierShiftClosedCount ?? 0);
  const cashierShiftOpeningTotal = Number(dbSnapshot?.cashierShiftOpeningTotal ?? 0);
  const cashierShiftClosingTotal = Number(dbSnapshot?.cashierShiftClosingTotal ?? 0);
  const cashierShiftVarianceTotal = Number(dbSnapshot?.cashierShiftVarianceTotal ?? 0);

  const dashboardReport = useMemo(() => {
    return {
      date: safeRange.endDate,
      startDate: safeRange.startDate,
      endDate: safeRange.endDate,
      brandName: brand?.name || user?.name || 'Profit Maker POS',
      totals: {
        netSales: Number(displayData.turnoverExcl || 0),
        grossSales: Number(displayData.turnoverIncl || 0),
        cogs: Number(displayData.costOfSales || 0),
        profit: Number(displayData.grossProfit || 0),
        laborCost: Number(displayData.expenses || 0),
      },
      topSellingItems: topSellers.slice(0, 20).map((item) => ({
        name: item.itemName || 'N/A',
        quantity: Number(item.quantity || 0),
        totalSales: Number(item.totalSales || 0),
      })),
      stockVariances: topVariances.slice(0, 20).map((item) => ({
        item: item.itemName || 'N/A',
        theoretical: Number(item.systemQty || 0),
        actual: Number(item.physicalQty || 0),
        uom: 'units',
        cost: Number(item.varianceValue || 0),
      })),
      voids: [],
    };
  }, [safeRange.endDate, safeRange.startDate, displayData, topSellers, topVariances, brand?.name, user?.name]);

  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseDate, setExpenseDate] = useState<string>(endDate);
  const [expenseCategory, setExpenseCategory] = useState<string>('utilities');
  const [expenseAmount, setExpenseAmount] = useState<string>('');
  const [expenseDescription, setExpenseDescription] = useState<string>('');

  const totalStaffSales = useMemo(
    () => staffRows.reduce((sum, s) => sum + (Number.isFinite(s.totalSales) ? s.totalSales : 0), 0),
    [staffRows]
  );

  const hasReportActivity = useMemo(() => {
    return (
      Number(displayData.turnoverIncl ?? 0) > 0 ||
      Number(displayData.invoiceCount ?? 0) > 0 ||
      Number(displayData.customerCount ?? 0) > 0 ||
      Number(displayData.totalPaytypes ?? 0) > 0 ||
      topSellers.length > 0
    );
  }, [displayData, topSellers]);

  function openDateFilters() {
    setShowDateFilters(true);
    window.setTimeout(() => {
      fromInputRef.current?.focus();
      fromInputRef.current?.showPicker?.();
    }, 30);
  }

  function handleAddExpense() {
    const amount = Number(expenseAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    addExpense({
      date: expenseDate,
      category: expenseCategory as ExpenseCategory,
      amount,
      description: expenseDescription,
    });
    setExpenseAmount('');
    setExpenseDescription('');
    setExpenseOpen(false);
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader 
        title="Management Overview" 
        description={`Report Date: ${data.reportDate}${data?.drnRange?.from ? ` | DRN: ${data.drnRange.from} → ${data.drnRange.to}` : ''}`}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">Export</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[220px]">
              <DropdownMenuLabel>Export Options</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => downloadCsv(dashboardReport)}>
                All Metrics (CSV)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadDoc(dashboardReport)}>
                All Metrics (DOC)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => shareDailyReport(dashboardReport)}>
                All Metrics (PDF)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => shareViaWhatsApp(dashboardReport)}>
                Share via WhatsApp
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      {isTodayRange ? (
        <div className="mb-4 text-center">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Today's Reports</h2>
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="text-sm text-muted-foreground font-medium">{rangeLabel}</div>
        <Button size="sm" variant={preset === 'today' ? 'default' : 'outline'} onClick={() => applyPreset('today')}>Today</Button>
        <Button size="sm" variant={preset === 'last7' ? 'default' : 'outline'} onClick={() => applyPreset('last7')}>Last 7d</Button>
        <Button size="sm" variant={preset === 'last30' ? 'default' : 'outline'} onClick={() => applyPreset('last30')}>Last 30d</Button>
      </div>
      {!isLoading && isTodayRange && !hasReportActivity ? (
        <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-4 text-center">
          <div className="text-base sm:text-lg font-semibold">No activity recorded for today yet.</div>
          <div className="mt-1 text-sm text-muted-foreground">
            To view past performance, choose another day or date range.
          </div>
          <Button className="mt-3" onClick={openDateFilters}>
            See Reports (Metrics) For Other Days
          </Button>
        </div>
      ) : null}
      {isLoading ? (
        <div className="mb-4 flex items-center gap-3 rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/50 border-t-transparent" />
          <div>
            <div className="font-medium">Fetching dashboard metrics…</div>
            <div className="text-xs text-muted-foreground">Loading the selected date range and syncing live totals.</div>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {!showDateFilters ? (
          <Button variant="secondary" onClick={() => setShowDateFilters(true)}>
            Select Date To View Reports
          </Button>
        ) : (
          <div
            className="flex items-center gap-4 rounded border border-muted/40 p-2 cursor-pointer"
            onClick={() => {
              fromInputRef.current?.focus();
              fromInputRef.current?.showPicker?.();
            }}
          >
            <div className="grid gap-1">
              <Label className="text-xs">From</Label>
              <Input
                ref={fromInputRef}
                className="h-9"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                onClick={(e) => {
                  e.stopPropagation();
                  fromInputRef.current?.focus();
                  fromInputRef.current?.showPicker?.();
                }}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">To</Label>
              <Input
                ref={toInputRef}
                className="h-9"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                onClick={(e) => {
                  e.stopPropagation();
                  toInputRef.current?.focus();
                  toInputRef.current?.showPicker?.();
                }}
              />
            </div>
          </div>
        )}
        <Button variant="outline" onClick={() => {
          setExpenseDate(endDate);
          setExpenseOpen(true);
        }}>
          Add Expense
        </Button>
        {showDateFilters ? (
          <Button variant="ghost" onClick={() => setShowDateFilters(false)}>
            Hide Date Filters
          </Button>
        ) : null}
        {lastUpdated && (
          <div className="text-xs text-muted-foreground">
            Last Updated: {new Date(lastUpdated).toLocaleString()}
          </div>
        )}
      </div>

      {/* Primary KPIs */}
      <div className="grid [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))] gap-4 mb-6">
        {[
          {
            title: 'Total Turnover (Incl)',
            value: formatMoneyPrecise(displayData.turnoverIncl, 2),
            rawValue: displayData.turnoverIncl,
            subtitle: `Excl Tax: ${formatMoneyPrecise(displayData.turnoverExcl, 2)}`,
            icon: <DollarSign className="h-5 w-5 text-primary" />,
            metricName: 'Total Turnover',
          },
          {
            title: 'Cost of Sales',
            value: formatMoneyPrecise(displayData.costOfSales, 2),
            rawValue: displayData.costOfSales,
            subtitle: `${Number(displayData.costOfSalesPercent ?? 0).toFixed(2)}% of sales`,
            variant: 'warning',
            icon: <TrendingDown className="h-5 w-5 text-warning" />,
            metricName: 'Cost of Sales',
          },
            {
            title: 'Net Profit',
            value: formatMoneyPrecise(displayData.netProfit, 2),
            rawValue: displayData.netProfit,
            subtitle: `Expenses: ${formatMoneyPrecise(displayData.expenses, 2)}`,
            variant: displayData.netProfit >= 0 ? 'success' : 'danger',
            icon: <DollarSign className={`h-5 w-5 ${displayData.netProfit >= 0 ? 'text-success' : 'text-destructive'}`} />,
            metricName: 'Net Profit',
          },
          {
            title: 'Gross Profit',
            value: formatMoneyPrecise(displayData.grossProfit, 2),
            rawValue: displayData.grossProfit,
            subtitle: `${Number(displayData.grossProfitPercent ?? 0).toFixed(2)}% margin`,
            variant: displayData.grossProfit >= 0 ? 'success' : 'danger',
            icon: <TrendingUp className={`h-5 w-5 ${displayData.grossProfit >= 0 ? 'text-success' : 'text-destructive'}`} />,
            metricName: 'Gross Profit',
          },
        ].map((kpi) => (
          <div key={kpi.title} className="relative">
            <KPICard
              title={kpi.title}
              value={kpi.value}
              loading={isLoading}
              subtitle={kpi.subtitle}
              variant={kpi.variant as 'warning' | 'success' | 'danger' | undefined}
              icon={kpi.icon}
            />
            <button
              className="absolute top-2 right-2 rounded px-2 py-1 text-xs border border-secondary text-secondary hover:bg-secondary/10"
              onClick={() => downloadMetricCsv(kpi.metricName, kpi.rawValue, dashboardReport)}
              title={`Export ${kpi.metricName}`}
            >
              Export
            </button>
          </div>
        ))}
      </div>
      <div className="mb-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <h3 className="text-sm font-semibold mb-3">Period-over-period deltas</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          {[
            { label: 'Turnover', value: computeDelta(displayData.turnoverIncl, prevDisplayData.turnoverIncl).deltaPercent },
            { label: 'Net Profit', value: computeDelta(displayData.netProfit, prevDisplayData.netProfit).deltaPercent },
            { label: 'Invoices', value: computeDelta(displayData.invoiceCount, prevDisplayData.invoiceCount).deltaPercent },
            { label: 'Variance Value', value: computeDelta(displayData.stockVarianceValue, prevDisplayData.stockVarianceValue).deltaPercent },
          ].map((d) => (
            <div key={d.label} className="rounded border bg-background/70 p-3">
              <p className="text-muted-foreground">{d.label}</p>
              <p className={`font-semibold ${d.value >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{d.value >= 0 ? '+' : ''}{d.value.toFixed(2)}%</p>
            </div>
          ))}
        </div>
      </div>

      {/* Secondary KPIs */}
      <div className="grid [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] gap-4 mb-6">
        <KPICard
          title="Invoices"
          value={displayData.invoiceCount}
          loading={isLoading}
          subtitle={`Avg: ${formatMoneyPrecise(displayData.avgPerInvoice, 2)}`}
          icon={<Receipt className="h-4 w-4 text-muted-foreground" />}
        />
        <KPICard
          title="Customers"
          value={displayData.customerCount}
          loading={isLoading}
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
        />
        <KPICard
          title="Tables"
          value={displayData.tableCount}
          loading={isLoading}
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
        />
        <KPICard
          title="Stock Variance"
          value={formatMoneyPrecise(displayData.stockVarianceValue, 2)}
          icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
        />
        <KPICard
          title="Purchases"
          value={formatMoneyPrecise(displayData.purchases, 2)}
          icon={<Package className="h-4 w-4 text-muted-foreground" />}
        />
        <KPICard
          title="Hours/Day"
          value={(() => {
            return Number(displayData.hoursPerDay ?? 0).toFixed(1);
          })()}
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
        />
        <KPICard
          title="Shift Closed"
          value={cashierShiftClosedCount}
          loading={isLoading}
          subtitle={`Total shifts: ${cashierShiftCount}`}
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
        />
        <KPICard
          title="Open Shifts"
          value={cashierShiftCount - cashierShiftClosedCount}
          loading={isLoading}
          subtitle="Open shifts currently"
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
        />
        <KPICard
          title="Cashier Overage/Short"
          value={formatMoneyPrecise(cashierShiftVarianceTotal, 2)}
          loading={isLoading}
          subtitle={`Opening: ${formatMoneyPrecise(cashierShiftOpeningTotal, 2)} · Closing: ${formatMoneyPrecise(cashierShiftClosingTotal, 2)}`}
          variant={cashierShiftVarianceTotal >= 0 ? 'success' : 'danger'}
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
        />
      </div>

      <Card className="mthunzi-card mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Cashier Shift Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          {Array.isArray(cashierShiftsByStaff) && cashierShiftsByStaff.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b-white/10">
                    <TableHead>Cashier</TableHead>
                    <TableHead className="text-right">Shifts</TableHead>
                    <TableHead className="text-right">Opening Cash</TableHead>
                    <TableHead className="text-right">Closing Cash</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cashierShiftsByStaff.map((item: Record<string, any>, idx: number) => (
                    <TableRow key={String(item.staff_id ?? `cashier-${idx}`)} className="border-b-white/10">
                      <TableCell className="font-medium">{String(item.staff_name ?? '')}</TableCell>
                      <TableCell className="text-right">{Number(item.shifts || 0)}</TableCell>
                      <TableCell className="text-right">{formatMoneyPrecise(Number(item.opening_cash || 0), 2)}</TableCell>
                      <TableCell className="text-right">{formatMoneyPrecise(Number(item.closing_cash || 0), 2)}</TableCell>
                      <TableCell className="text-right">{formatMoneyPrecise(Number(item.total_variance || 0), 2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-md border border-white/10 bg-white/5 p-3 text-sm text-muted-foreground">
              No closed cashier shifts found for this period.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Payment Breakdown */}
        <Card className="mthunzi-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Payment Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {typeof paymentBreakdown.totalPaytypes === 'number' && paymentBreakdown.totalPaytypes > 0 ? (
              <>
                <div className="flex justify-between text-sm">
                  <span>Cash</span>
                  <span className="font-medium">{formatMoneyPrecise(Number(paymentBreakdown.cashTotal), 2)}</span>
                </div>
                <Progress value={(Number(paymentBreakdown.cashTotal) / Number(paymentBreakdown.totalPaytypes)) * 100} className="h-2" />

                <div className="flex justify-between text-sm">
                  <span>Credit Card</span>
                  <span className="font-medium">{formatMoneyPrecise(Number(paymentBreakdown.cardTotal), 2)}</span>
                </div>
                <Progress value={(Number(paymentBreakdown.cardTotal) / Number(paymentBreakdown.totalPaytypes)) * 100} className="h-2" />

                <div className="flex justify-between text-sm">
                  <span>Cheque</span>
                  <span className="font-medium">{formatMoneyPrecise(Number(paymentBreakdown.chequeTotal), 2)}</span>
                </div>
                <Progress value={(Number(paymentBreakdown.chequeTotal) / Number(paymentBreakdown.totalPaytypes)) * 100} className="h-2" />

                <div className="border-t pt-3 mt-3 flex justify-between font-medium">
                  <span>Total Paytypes</span>
                  <span>{formatMoneyPrecise(Number(paymentBreakdown.totalPaytypes), 2)}</span>
                </div>
              </>
            ) : (
              <div className="rounded-md border border-white/10 bg-white/5 p-3 text-sm text-muted-foreground">
                No payments recorded for this period.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Order Types */}
        <Card className="mthunzi-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Order Types</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              // Use DB snapshot if available, else fallback to local
              const eatIn = displayData.orderTypes?.eatIn ?? { value: 0, percent: 0 };
              const takeOut = displayData.orderTypes?.takeOut ?? { value: 0, percent: 0 };
              const delivery = displayData.orderTypes?.delivery ?? { value: 0, percent: 0 };
              return (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <UtensilsCrossed className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Eat-In</span>
                    </div>
                    <div className="text-right">
                      <span className="font-medium">{formatMoneyPrecise(eatIn.value, 2)}</span>
                      <span className="text-xs text-muted-foreground ml-2">({eatIn.percent}%)</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Take-Out</span>
                    </div>
                    <div className="text-right">
                      <span className="font-medium">{formatMoneyPrecise(takeOut.value, 2)}</span>
                      <span className="text-xs text-muted-foreground ml-2">({takeOut.percent}%)</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Delivery</span>
                    </div>
                    <div className="text-right">
                      <span className="font-medium">{formatMoneyPrecise(delivery.value, 2)}</span>
                      <span className="text-xs text-muted-foreground ml-2">({delivery.percent}%)</span>
                    </div>
                  </div>
                </>
              );
            })()}

            <div className="border-t pt-3 mt-3">
              <p className="text-sm font-medium mb-2">Session Breakdown</p>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="bg-primary/10 rounded p-2">
                  <p className="font-medium">05h-11h</p>
                  <p className="text-muted-foreground">{displayData.sessions.morning.percent}%</p>
                </div>
                <div className="bg-primary/10 rounded p-2">
                  <p className="font-medium">11h-17h</p>
                  <p className="text-muted-foreground">{displayData.sessions.afternoon.percent}%</p>
                </div>
                <div className="bg-primary/10 rounded p-2">
                  <p className="font-medium">17h-05h</p>
                  <p className="text-muted-foreground">{displayData.sessions.evening.percent}%</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card className="mthunzi-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Inventory Intelligence (Back + Front)</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div className="rounded border p-3">
              <p className="text-muted-foreground">Back-office variance value</p>
              <p className="font-semibold">{formatMoneyPrecise(displayData.stockVarianceValue, 2)}</p>
            </div>
            <div className="rounded border p-3">
              <p className="text-muted-foreground">Front reconciliation value</p>
              <p className="font-semibold">{formatMoneyPrecise(frontVarianceSummary.varianceValueEstimate, 2)}</p>
            </div>
            <div className="rounded border p-3">
              <p className="text-muted-foreground">Front reconciliation lines</p>
              <p className="font-semibold">{frontVarianceSummary.count}</p>
            </div>
            <div className="rounded border p-3">
              <p className="text-muted-foreground">Front variance qty total</p>
              <p className="font-semibold">{frontVarianceSummary.varianceQtyTotal.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="mthunzi-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Production & Operations</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div className="rounded border p-3">
              <p className="text-muted-foreground">Stock issues</p>
              <p className="font-semibold">{metrics.operational.stockIssueCount}</p>
              <p className="text-xs text-muted-foreground">Value {formatMoneyPrecise(metrics.operational.stockIssueValue, 2)}</p>
            </div>
            <div className="rounded border p-3">
              <p className="text-muted-foreground">Batches recorded</p>
              <p className="font-semibold">{metrics.operational.productionBatchCount}</p>
            </div>
            <div className="rounded border p-3">
              <p className="text-muted-foreground">Avg yield variance</p>
              <p className="font-semibold">{metrics.operational.averageYieldVariancePercent.toFixed(2)}%</p>
            </div>
            <div className="rounded border p-3">
              <p className="text-muted-foreground">Cash-up variance</p>
              <p className={`font-semibold ${metrics.operational.cashUpVarianceTotal >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {formatMoneyPrecise(metrics.operational.cashUpVarianceTotal, 2)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Stock Variances Alert */}
        <Card className="mthunzi-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Stock Variance Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded border px-2 py-1">Back Office</span>
              <span className="rounded border px-2 py-1">Front Office</span>
            </div>
            <DataTableWrapper>
              <Table>
                <TableHeader>
                  <TableRow className="border-b-white/10">
                    <TableHead>Source</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Variance Qty</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, idx) => (
                      <TableRow key={`variance-loading-${idx}`} className="border-b-white/10 animate-pulse">
                        <TableCell><div className="h-4 w-14 bg-muted/20 rounded" /></TableCell>
                        <TableCell className="font-medium"><div className="h-4 w-24 bg-muted/20 rounded" /></TableCell>
                        <TableCell><div className="h-4 w-14 bg-muted/20 rounded" /></TableCell>
                        <TableCell className="text-right"><div className="h-4 w-10 bg-muted/20 rounded ml-auto" /></TableCell>
                        <TableCell className="text-right"><div className="h-4 w-16 bg-muted/20 rounded ml-auto" /></TableCell>
                      </TableRow>
                    ))
                  ) : topVariances.length || frontVarianceAlerts.length ? (
                    [...topVariances.map((item) => ({ source: 'BACK' as const, location: 'MAIN', item })), ...frontVarianceAlerts.map((item) => ({ source: 'FRONT' as const, location: item.locationTag, item }))]
                      .sort((a, b) => Math.abs(Number(b.item.varianceValue ?? 0)) - Math.abs(Number(a.item.varianceValue ?? 0)))
                      .slice(0, 8)
                      .map((entry, idx) => (
                      <TableRow key={`${entry.source}-${entry.item.id}-${idx}`} className="border-b-white/10">
                        <TableCell>
                          <StatusBadge status={entry.source === 'BACK' ? 'neutral' : 'positive'}>
                            {entry.source}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="font-medium">{entry.item.itemName}</TableCell>
                        <TableCell>{entry.location}</TableCell>
                        <TableCell className="text-right">
                          <NumericCell value={entry.item.varianceQty} showSign colorCode />
                        </TableCell>
                        <TableCell className="text-right">
                          <NumericCell value={entry.item.varianceValue} money showSign colorCode />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow className="border-b-white/10">
                      <TableCell colSpan={5} className="text-sm text-muted-foreground">
                        No stock take saved for this period.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </DataTableWrapper>
          </CardContent>
        </Card>

        {/* Top Sellers */}
        <Card className="mthunzi-card">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <CardTitle className="text-base font-medium">Top Selling Items</CardTitle>
              {lowSeller && !isLoading && (
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                    <TrendingDown className="h-3.5 w-3.5" />
                    <span>Low selling</span>
                  </div>
                  <div className="text-sm font-medium leading-tight max-w-[240px] truncate">
                    {lowSeller.itemName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Qty {lowSeller.quantity} · {formatMoneyPrecise(lowSeller.totalSales, 0)}
                  </div>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <DataTableWrapper>
              <Table>
                <TableHeader>
                  <TableRow className="border-b-white/10">
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                    <TableHead className="text-right">GP%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    // Loading skeleton rows
                    Array.from({ length: 5 }).map((_, idx) => (
                      <TableRow key={`skeleton-top-seller-${idx}`} className="border-b-white/10 animate-pulse">
                        <TableCell className="font-medium">
                          <div className="h-4 w-24 bg-muted/20 rounded" />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="h-4 w-10 bg-muted/20 rounded ml-auto" />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="h-4 w-16 bg-muted/20 rounded ml-auto" />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="h-4 w-10 bg-muted/20 rounded ml-auto" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <>
                      {topSellers.map((item, idx) => (
                        <TableRow key={`${item.itemName}-${idx}`} className="border-b-white/10">
                          <TableCell className="font-medium">{item.itemName}</TableCell>
                          <TableCell className="text-right">{item.quantity}</TableCell>
                          <TableCell className="text-right">
                            <NumericCell value={item.totalSales} money />
                          </TableCell>
                          <TableCell className="text-right">
                            <StatusBadge status={item.gpAfterDiscount >= 45 ? 'positive' : item.gpAfterDiscount >= 35 ? 'neutral' : 'negative'}>
                              {item.gpAfterDiscount.toFixed(1)}%
                            </StatusBadge>
                          </TableCell>
                        </TableRow>
                      ))}
                      {!topSellers.length && (
                        <TableRow className="border-b-white/10">
                          <TableCell colSpan={4} className="text-sm text-muted-foreground">
                            No paid orders in this period.
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )}
                </TableBody>
              </Table>
            </DataTableWrapper>
          </CardContent>
        </Card>
      </div>

      {/* Staff Performance */}
      <Card className="mthunzi-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Staff Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTableWrapper>
            <Table>
              <TableHeader>
                <TableRow className="border-b-white/10">
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Total Sales</TableHead>
                  <TableHead className="text-right">% of Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, idx) => (
                    <TableRow key={`skeleton-staff-${idx}`} className="border-b-white/10 animate-pulse">
                      <TableCell className="font-medium">
                        <div className="h-4 w-24 bg-muted/20 rounded" />
                      </TableCell>
                      <TableCell>
                        <div className="h-4 w-16 bg-muted/20 rounded" />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="h-4 w-16 bg-muted/20 rounded ml-auto" />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="h-4 w-10 bg-muted/20 rounded ml-auto" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <>
                    {staffRows.map((member) => {
                      const percent = totalStaffSales > 0 ? (member.totalSales / totalStaffSales) * 100 : 0;
                      return (
                        <TableRow key={member.id} className="border-b-white/10">
                          <TableCell className="font-medium">{member.name}</TableCell>
                          <TableCell className="capitalize">{member.role ? member.role.replace('_', ' ') : ''}</TableCell>
                          <TableCell className="text-right">
                            <NumericCell value={member.totalSales} money />
                          </TableCell>
                          <TableCell className="text-right">
                            <NumericCell value={percent} decimals={1} />%
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!staffRows.length && (
                      <TableRow className="border-b-white/10">
                        <TableCell colSpan={4} className="text-sm text-muted-foreground">
                          No staff sales yet for this period.
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                )}
              </TableBody>
            </Table>
          </DataTableWrapper>
        </CardContent>
      </Card>

      <Dialog open={expenseOpen} onOpenChange={setExpenseOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Add Expense</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Date</Label>
              <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
            </div>

            <div className="grid gap-2">
              <Label>Category</Label>
              <Select value={expenseCategory} onValueChange={setExpenseCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rent">Rent</SelectItem>
                  <SelectItem value="salaries">Salaries</SelectItem>
                  <SelectItem value="utilities">Utilities</SelectItem>
                  <SelectItem value="fuel">Fuel</SelectItem>
                  <SelectItem value="repairs">Repairs</SelectItem>
                  <SelectItem value="marketing">Marketing</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Amount ({currencySymbol})</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="0.00"
                value={expenseAmount}
                onChange={(e) => setExpenseAmount(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label>Description (optional)</Label>
              <Input value={expenseDescription} onChange={(e) => setExpenseDescription(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setExpenseOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddExpense} disabled={!Number.isFinite(Number(expenseAmount)) || Number(expenseAmount) <= 0}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function dateKeyLocal(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
