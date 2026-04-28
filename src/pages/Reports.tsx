import { FileText, TrendingUp, Package, ArrowRightLeft, Factory, Users, BarChart3, ShoppingCart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { PageHeader } from '@/components/common/PageComponents';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDashboardDateRange } from '@/hooks/useDashboardDateRange';
import { subscribeOrders, getOrdersSnapshot } from '@/lib/orderStore';
import { subscribeGRVs, getGRVsSnapshot } from '@/lib/grvDbStore';
import { subscribeExpenses, getExpensesSnapshot } from '@/lib/expenseStore';
import { subscribeStockTakes, getStockTakesSnapshot, fetchFrontReconciliationSummary } from '@/lib/stockTakeStore';
import { computeExecutiveMetrics } from '@/lib/dashboardMetrics';
import { useReportSharer } from '@/hooks/useReportSharer';
import { useAuth } from '@/contexts/AuthContext';

const reports = [
  { title: 'Management Overview', description: 'Daily summary with KPIs, profit, and activity', icon: BarChart3, path: '/app/dashboard' },
  { title: 'ZRA Tax Season', description: 'One-click export of sales + VAT for ZRA portal', icon: FileText, path: '/app/zra-tax-season' },
  { title: 'Shift X / Z Reports', description: 'Shift summaries, Z-report variance, and reconciliation', icon: FileText, path: '/app/reports/shifts' },
  { title: 'Purchases (GRV)', description: 'Goods received vouchers, costs, and supplier receipts', icon: ShoppingCart, path: '/app/purchases' },
  { title: 'Stock on Hand', description: 'Current inventory levels by department', icon: Package, path: '/app/inventory/items' },
  { title: 'Stock Issues Report', description: 'Internal transfer history', icon: ArrowRightLeft, path: '/app/inventory/stock-issues' },
  { title: 'Stock Variance Report', description: 'Physical vs system count analysis', icon: TrendingUp, path: '/app/inventory/stock-take' },
  { title: 'Manufacturing Report', description: 'Batch production and yield analysis', icon: Factory, path: '/app/manufacturing/production' },
  { title: 'Staff Cashup Report', description: 'Staff sales and reconciliation', icon: Users, path: '/app/staff' },
];

export default function Reports() {
  const { user, brand } = useAuth();
  const orders = useSyncExternalStore(subscribeOrders, getOrdersSnapshot);
  const grvs = useSyncExternalStore(subscribeGRVs, getGRVsSnapshot);
  const expenses = useSyncExternalStore(subscribeExpenses, getExpensesSnapshot);
  const stockTakes = useSyncExternalStore(subscribeStockTakes, getStockTakesSnapshot);
  const { safeRange, startDate, endDate, setStartDate, setEndDate, preset, applyPreset } = useDashboardDateRange();
  const { shareDailyReport, downloadCsv, downloadDoc, shareViaWhatsApp } = useReportSharer();
  const [frontVarianceValue, setFrontVarianceValue] = useState(0);
  const metrics = useMemo(
    () =>
      computeExecutiveMetrics({
        startDate: safeRange.startDate,
        endDate: safeRange.endDate,
        orders,
        grvs,
        expenses,
        stockTakes,
      }),
    [safeRange.startDate, safeRange.endDate, orders, grvs, expenses, stockTakes]
  );

  const dashboardReport = useMemo(() => {
    return {
      date: safeRange.endDate,
      startDate: safeRange.startDate,
      endDate: safeRange.endDate,
      brandName: brand?.name || user?.name || 'Profit Maker POS',
      totals: {
        netSales: metrics.overview.turnoverExcl,
        grossSales: metrics.overview.turnoverIncl,
        cogs: metrics.overview.costOfSales,
        profit: metrics.overview.grossProfit,
        laborCost: metrics.overview.expenses,
      },
      topSellingItems: metrics.topSellers.slice(0, 20).map((item) => ({
        name: item.itemName,
        quantity: item.quantity,
        totalSales: item.totalSales,
      })),
      stockVariances: metrics.varianceItems.slice(0, 20).map((item) => ({
        item: item.itemName || 'N/A',
        theoretical: Number(item.systemQty || 0),
        actual: Number(item.physicalQty || 0),
        uom: 'units',
        cost: Number(item.varianceValue || 0),
      })),
      voids: [],
    };
  }, [safeRange.endDate, safeRange.startDate, brand?.name, user?.name, metrics]);

  useEffect(() => {
    let disposed = false;
    const run = async () => {
      const s = await fetchFrontReconciliationSummary({ from: safeRange.startDate, to: safeRange.endDate });
      if (!disposed) setFrontVarianceValue(s.varianceValueEstimate);
    };
    void run();
    return () => {
      disposed = true;
    };
  }, [safeRange.startDate, safeRange.endDate]);

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Executive pack generation + operational report shortcuts"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => downloadCsv(dashboardReport)}>Export CSV</Button>
            <Button variant="outline" onClick={() => downloadDoc(dashboardReport)}>Export DOC</Button>
            <Button onClick={() => shareDailyReport(dashboardReport)}>Export PDF</Button>
          </div>
        }
      />
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Executive Pack Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">From</span>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">To</span>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <Button size="sm" variant={preset === 'today' ? 'default' : 'outline'} onClick={() => applyPreset('today')}>Today</Button>
          <Button size="sm" variant={preset === 'last7' ? 'default' : 'outline'} onClick={() => applyPreset('last7')}>Last 7d</Button>
          <Button size="sm" variant={preset === 'last30' ? 'default' : 'outline'} onClick={() => applyPreset('last30')}>Last 30d</Button>
          <Button variant="secondary" onClick={() => shareViaWhatsApp(dashboardReport)}>Share via WhatsApp</Button>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 mb-5">
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Sales & Margin</p><p className="font-semibold">{metrics.overview.turnoverIncl.toFixed(2)}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Back Variance</p><p className="font-semibold">{metrics.overview.stockVarianceValue.toFixed(2)}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Front Variance</p><p className="font-semibold">{frontVarianceValue.toFixed(2)}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Stock Issues</p><p className="font-semibold">{metrics.operational.stockIssueCount}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Batch Production</p><p className="font-semibold">{metrics.operational.productionBatchCount}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Cash-up Variance</p><p className="font-semibold">{metrics.operational.cashUpVarianceTotal.toFixed(2)}</p></CardContent></Card>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {reports.map((report) => (
          <Link key={report.title} to={report.path}>
            <Card className="hover:border-primary transition-colors cursor-pointer h-full">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-primary/10"><report.icon className="h-5 w-5 text-primary" /></div>
                  <CardTitle className="text-base">{report.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent><p className="text-sm text-muted-foreground">{report.description}</p></CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
