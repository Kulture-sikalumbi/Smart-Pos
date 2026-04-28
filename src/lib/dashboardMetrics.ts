import type { Expense, ManagementOverview, SalesMixItem, StockTakeSession, StockVariance } from '@/types';
import type { Order } from '@/types/pos';
import type { GRV } from '@/types';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { getStockIssuesSnapshot } from '@/lib/stockIssueStore';
import { getBatchProductionsSnapshot } from '@/lib/batchProductionStore';
import { getCashUpsSnapshot } from '@/lib/cashUpStore';

export type DashboardStaffRow = {
  id: string;
  name: string;
  role: string;
  totalSales: number;
};

export type ExecutiveMetrics = {
  overview: ManagementOverview;
  topSellers: SalesMixItem[];
  lowSeller: SalesMixItem | null;
  staffRows: DashboardStaffRow[];
  varianceItems: StockVariance[];
  operational: {
    stockIssueCount: number;
    stockIssueValue: number;
    productionBatchCount: number;
    averageYieldVariancePercent: number;
    cashUpCount: number;
    cashUpVarianceTotal: number;
  };
};

export function computeDashboardMetrics(params: {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  orders: Order[];
  grvs: GRV[];
  expenses: Expense[];
  stockTakes: StockTakeSession[];
}): {
  overview: ManagementOverview;
  topSellers: SalesMixItem[];
  lowSeller: SalesMixItem | null;
  staffRows: DashboardStaffRow[];
  varianceItems: StockVariance[];
} {
  const { startDate, endDate } = params;

  const paidOrders: Order[] = [];
  let turnoverInclAcc = 0;
  let taxAcc = 0;
  let costAcc = 0;
  const customerKeys = new Set<string>();
  const tableNos = new Set<number>();

  for (const o of params.orders) {
    if (o.status !== 'paid') continue;
    const key = dateKeyFromIso(o.paidAt ?? o.createdAt);
    if (key < startDate || key > endDate) continue;

    paidOrders.push(o);
    const total = Number.isFinite(o.total) ? o.total : 0;
    const tax = Number.isFinite(o.tax) ? o.tax : 0;
    const cost = Number.isFinite(o.totalCost) ? o.totalCost : 0;
    turnoverInclAcc += total;
    taxAcc += tax;
    costAcc += cost;

    const customerKey = o.customerPhone?.trim()
      ? o.customerPhone.trim()
      : o.customerName?.trim()
        ? o.customerName.trim()
        : null;
    if (customerKey) customerKeys.add(customerKey);

    if (typeof o.tableNo === 'number') tableNos.add(o.tableNo);
  }

  const turnoverIncl = round2(turnoverInclAcc);
  const tax = round2(taxAcc);
  const turnoverExcl = round2(turnoverIncl - tax);

  const costOfSales = round2(costAcc);
  const costOfSalesPercent = turnoverExcl > 0 ? round2((costOfSales / turnoverExcl) * 100) : 0;

  const grossProfit = round2(turnoverExcl - costOfSales);
  const grossProfitPercent = turnoverExcl > 0 ? round2((grossProfit / turnoverExcl) * 100) : 0;

  let expensesAcc = 0;
  for (const e of params.expenses) {
    if (e.date < startDate || e.date > endDate) continue;
    const amt = Number.isFinite(e.amount) ? e.amount : 0;
    expensesAcc += amt;
  }
  const expenses = round2(expensesAcc);

  const netProfit = round2(grossProfit - expenses);

  const paymentTotals = computePaymentTotals(paidOrders);

  const invoiceCount = paidOrders.length;
  const avgPerInvoice = invoiceCount > 0 ? round2(turnoverIncl / invoiceCount) : 0;

  const hoursPerDay = computeAvgOpenHoursPerDay(paidOrders, startDate, endDate);
  const minsPerTable = tableNos.size > 0 && hoursPerDay > 0 ? round2((hoursPerDay * 60) / tableNos.size) : 0;
  const tablesPerHour = hoursPerDay > 0 ? round2(tableNos.size / hoursPerDay) : 0;

  let purchasesAcc = 0;
  for (const g of params.grvs) {
    if (g.status !== 'confirmed') continue;
    if (g.date < startDate || g.date > endDate) continue;
    const total = Number.isFinite(g.total) ? g.total : 0;
    purchasesAcc += total;
  }
  const purchases = round2(purchasesAcc);

  const { varianceValue: stockVarianceValue, items: varianceItems } = computeStockVarianceFromTakes(params.stockTakes, startDate, endDate);

  const { sessions, orderTypes } = computeSessionAndOrderTypeBreakdowns(paidOrders, turnoverIncl);

  const drnRange = computeDrnRange(paidOrders);

  const overview: ManagementOverview = {
    reportDate: endDate,
    drnRange,

    cashTotal: paymentTotals.cash,
    chequeTotal: paymentTotals.cheque,
    cardTotal: paymentTotals.card,
    accountTotal: paymentTotals.account,
    nonBankTotal: paymentTotals.non_bank,
    totalPaytypes: round2(
      paymentTotals.cash + paymentTotals.cheque + paymentTotals.card + paymentTotals.account + paymentTotals.non_bank
    ),

    turnoverIncl,
    tax,
    turnoverExcl,

    openingStock: 0,
    purchases,
    stockTransIn: 0,
    stockTransOut: 0,
    closingStock: 0,
    costOfSales,
    costOfSalesPercent,

    grossProfit,
    grossProfitPercent,
    expenses,
    netProfit,

    invoiceCount,
    customerCount: customerKeys.size,
    tableCount: tableNos.size,
    avgPerInvoice,
    tablesPerHour,
    minsPerTable,
    hoursPerDay,

    stockVarianceValue,
    wastageValue: 0,

    sessions,
    orderTypes,
  };

  const salesMix = computeSalesMix(paidOrders, turnoverIncl);

  const topSellers = salesMix
    .slice()
    .sort((a, b) => b.totalSales - a.totalSales)
    .slice(0, 5);

  const lowSeller = salesMix.length
    ? salesMix
        .slice()
        .sort((a, b) => {
          // primarily by qty (volume), then by sales
          if (a.quantity !== b.quantity) return a.quantity - b.quantity;
          return a.totalSales - b.totalSales;
        })[0]
    : null;

  const staffRows = computeStaffSales(paidOrders, turnoverIncl);

  return { overview, topSellers, lowSeller, staffRows, varianceItems };
}

export function computeExecutiveMetrics(params: {
  startDate: string;
  endDate: string;
  orders: Order[];
  grvs: GRV[];
  expenses: Expense[];
  stockTakes: StockTakeSession[];
}): ExecutiveMetrics {
  const core = computeDashboardMetrics(params);
  const stockIssues = getStockIssuesSnapshot().filter((i) => i.date >= params.startDate && i.date <= params.endDate);
  const batches = getBatchProductionsSnapshot().filter((b) => b.batchDate >= params.startDate && b.batchDate <= params.endDate);
  const cashUps = getCashUpsSnapshot().filter((c) => c.date >= params.startDate && c.date <= params.endDate);

  const stockIssueValue = round2(sum(stockIssues.map((i) => Number(i.totalValueLost ?? 0))));
  const avgYieldVariancePct = batches.length
    ? round2(sum(batches.map((b) => Number(b.yieldVariancePercent ?? 0))) / batches.length)
    : 0;
  const cashUpVarianceTotal = round2(sum(cashUps.map((c) => Number(c.shortageOverage ?? 0))));

  return {
    ...core,
    operational: {
      stockIssueCount: stockIssues.length,
      stockIssueValue,
      productionBatchCount: batches.length,
      averageYieldVariancePercent: avgYieldVariancePct,
      cashUpCount: cashUps.length,
      cashUpVarianceTotal,
    },
  };
}

// Fetch precomputed aggregates from DB via RPC `get_dashboard_stats` when available.
export async function fetchDashboardStatsFromDb(brandId: string, startDate: string, endDate: string) {
  if (!isSupabaseConfigured() || !supabase) return null;
  if (!brandId) return null;
  try {
    const { data, error } = await supabase.rpc('get_dashboard_stats', { p_brand_id: brandId, p_start_date: startDate, p_end_date: endDate });
    if (error) {
      console.warn('[dashboardMetrics] rpc get_dashboard_stats error', error);
      return null;
    }
    // Map the RPC result to the UI keys expected by Dashboard
    const raw = (Array.isArray(data) && data.length ? data[0] : data) as Record<string, unknown> | null;
    if (!raw) return null;
    const rawStaff = Array.isArray(raw.staff_performance) ? (raw.staff_performance as Array<Record<string, unknown>>) : [];
    const staffRows: DashboardStaffRow[] = rawStaff.length
      ? rawStaff.map((row, idx: number) => ({
          id: String(row.staff_id ?? row.id ?? `staff-${idx}`),
          name: String(row.name ?? row.staff_name ?? 'Staff'),
          role: String(row.role ?? 'staff'),
          totalSales: Number(row.totalSales ?? row.total_sales ?? row.sales ?? 0),
        }))
      : [];

    const rawTopSelling = Array.isArray(raw.top_selling)
      ? (raw.top_selling as Array<Record<string, unknown>>)
      : Array.isArray(raw.top_selling_items)
        ? (raw.top_selling_items as Array<Record<string, unknown>>)
        : [];
    const topSellers: SalesMixItem[] = rawTopSelling.length
      ? rawTopSelling.map((item, idx: number) => ({
          itemNo: Number(item.item_no ?? idx + 1),
          itemName: String(item.name ?? item.item_name ?? 'Item'),
          quantity: Number(item.qty ?? item.quantity ?? 0),
          costPerItem: Number(item.cost_per_item ?? 0),
          sellExcl: Number(item.sell_excl ?? 0),
          sellIncl: Number(item.sell_incl ?? item.sales ?? 0),
          gpBeforeDiscount: Number(item.gp_before_discount ?? 0),
          gpAfterDiscount: Number(item.gp_after_discount ?? 0),
          totalCost: Number(item.total_cost ?? 0),
          totalSales: Number(item.sales ?? item.total_sales ?? 0),
          totalProfit: Number(item.total_profit ?? 0),
          percentOfTurnover: Number(item.percent_of_turnover ?? 0),
        }))
      : [];

    const rawVarianceItems = Array.isArray(raw.varianceItems)
      ? (raw.varianceItems as Array<Record<string, unknown>>)
      : Array.isArray(raw.variance_items)
        ? (raw.variance_items as Array<Record<string, unknown>>)
        : Array.isArray(raw.variance_alerts)
          ? (raw.variance_alerts as Array<Record<string, unknown>>)
          : [];
    const varianceItems: StockVariance[] = rawVarianceItems.map((item, idx: number) => ({
      id: String(item.id ?? `variance-${idx}`),
      itemId: String(item.itemId ?? item.item_id ?? item.id ?? `variance-${idx}`),
      itemCode: String(item.itemCode ?? item.item_code ?? ''),
      itemName: String(item.itemName ?? item.item_name ?? 'Unknown item'),
      departmentId: 'all',
      unitType: 'EACH',
      lowestCost: Number(item.lowestCost ?? item.lowest_cost ?? 0),
      highestCost: Number(item.highestCost ?? item.highest_cost ?? 0),
      currentCost: Number(item.currentCost ?? item.current_cost ?? 0),
      systemQty: Number(item.systemQty ?? item.system_qty ?? 0),
      physicalQty: Number(item.physicalQty ?? item.physical_qty ?? 0),
      varianceQty: Number(item.varianceQty ?? item.variance_qty ?? 0),
      varianceValue: Number(item.varianceValue ?? item.variance_value ?? 0),
      countDate: String(item.countDate ?? item.count_date ?? endDate),
      timesHadVariance: Number(item.timesHadVariance ?? item.times_had_variance ?? 1),
    }));

    const turnoverIncl = Number(raw.turnoverIncl ?? raw.turnover_incl ?? raw.total_revenue ?? 0);
    const expenses = Number(raw.expenses ?? raw.total_expenses ?? 0);
    const invoiceCount = Number(raw.invoiceCount ?? raw.invoices_count ?? raw.order_count ?? 0);
    const derivedTurnoverExcl = Number(raw.turnoverExcl ?? raw.turnover_excl ?? turnoverIncl);
    const derivedCostOfSales = Number(raw.costOfSales ?? raw.cost_of_sales ?? 0);
    const derivedGrossProfit = Number(raw.grossProfit ?? raw.gross_profit ?? (derivedTurnoverExcl - derivedCostOfSales));
    const derivedNetProfit = Number(raw.netProfit ?? raw.net_profit ?? (derivedGrossProfit - expenses));

    const supplemental = await fetchOrdersSupplementalFromDb(brandId, startDate, endDate);

    const paymentBreakdown =
      typeof raw.payment_breakdown === 'object' && raw.payment_breakdown !== null
        ? raw.payment_breakdown
        : supplemental.paymentBreakdown;

    return {
      ...raw,
      turnoverIncl,
      turnoverExcl: derivedTurnoverExcl,
      costOfSales: derivedCostOfSales,
      grossProfit: derivedGrossProfit,
      expenses,
      netProfit: derivedNetProfit,
      cashierShiftCount: Number(raw.cashier_shift_count ?? 0),
      cashierShiftClosedCount: Number(raw.cashier_shift_closed_count ?? 0),
      cashierShiftOpeningTotal: Number(raw.cashier_shift_opening_total ?? 0),
      cashierShiftClosingTotal: Number(raw.cashier_shift_closing_total ?? 0),
      cashierShiftVarianceTotal: Number(raw.cashier_shift_variance_total ?? 0),
      cashierShiftsByStaff: Array.isArray(raw.cashier_shifts_by_staff) ? raw.cashier_shifts_by_staff : [],
      staffRows,
      topSellers,
      varianceItems: varianceItems.length ? varianceItems : supplemental.varianceItems,
      paymentBreakdown,
      hoursPerDay: Array.isArray(raw.hours_per_day) ? raw.hours_per_day : [],
      invoiceCount: invoiceCount || supplemental.invoiceCount,
      customerCount: Number(raw.customerCount ?? raw.customer_count ?? supplemental.customerCountEstimate ?? 0),
      orderTypes:
        (raw.orderTypes as unknown) ??
        (raw.order_types as unknown) ??
        supplemental.orderTypes,
      cashTotal: Number(
        raw.cashTotal ??
          raw.cash_total ??
          (paymentBreakdown as Record<string, unknown>)?.cashTotal ??
          (paymentBreakdown as Record<string, unknown>)?.cash ??
          supplemental.paymentBreakdown.cash ??
          0
      ),
      cardTotal: Number(
        raw.cardTotal ??
          raw.card_total ??
          (paymentBreakdown as Record<string, unknown>)?.cardTotal ??
          (paymentBreakdown as Record<string, unknown>)?.card ??
          supplemental.paymentBreakdown.card ??
          0
      ),
      chequeTotal: Number(
        raw.chequeTotal ??
          raw.cheque_total ??
          (paymentBreakdown as Record<string, unknown>)?.chequeTotal ??
          (paymentBreakdown as Record<string, unknown>)?.cheque ??
          supplemental.paymentBreakdown.cheque ??
          0
      ),
      accountTotal: Number(
        raw.accountTotal ??
          raw.account_total ??
          (paymentBreakdown as Record<string, unknown>)?.accountTotal ??
          (paymentBreakdown as Record<string, unknown>)?.account ??
          supplemental.paymentBreakdown.account ??
          0
      ),
      nonBankTotal: Number(
        raw.nonBankTotal ??
          raw.non_bank_total ??
          (paymentBreakdown as Record<string, unknown>)?.nonBankTotal ??
          (paymentBreakdown as Record<string, unknown>)?.non_bank ??
          supplemental.paymentBreakdown.non_bank ??
          0
      ),
      totalPaytypes: Number(
        raw.totalPaytypes ??
          raw.total_paytypes ??
          (paymentBreakdown as Record<string, unknown>)?.totalPaytypes ??
          supplemental.totalPaytypes ??
          0
      ),
    };
  } catch (e) {
    console.warn('[dashboardMetrics] fetchDashboardStatsFromDb exception', e);
    return null;
  }
}

async function fetchOrdersSupplementalFromDb(brandId: string, startDate: string, endDate: string) {
  const empty = {
    paymentBreakdown: { cash: 0, card: 0, cheque: 0, account: 0, non_bank: 0 },
    totalPaytypes: 0,
    invoiceCount: 0,
    customerCountEstimate: 0,
    orderTypes: {
      eatIn: { value: 0, percent: 0 },
      takeOut: { value: 0, percent: 0 },
      delivery: { value: 0, percent: 0 },
    },
    varianceItems: [] as StockVariance[],
  };
  if (!isSupabaseConfigured() || !supabase || !brandId) return empty;

  const fromTs = `${startDate}T00:00:00`;
  const toTs = `${endDate}T23:59:59`;
  let { data, error } = await supabase
    .from('pos_orders')
    .select('total, payment_method, order_type, customer_phone, customer_name')
    .eq('brand_id', brandId)
    .eq('status', 'paid')
    .gte('paid_at', fromTs)
    .lte('paid_at', toTs)
    .limit(20000);

  if (error) {
    const retry = await supabase
      .from('pos_orders')
      .select('total, payment_method, order_type')
      .eq('brand_id', brandId)
      .eq('status', 'paid')
      .gte('paid_at', fromTs)
      .lte('paid_at', toTs)
      .limit(20000);
    data = retry.data;
    error = retry.error;
  }

  if (error || !Array.isArray(data)) return empty;

  let cash = 0;
  let card = 0;
  let cheque = 0;
  let account = 0;
  let nonBank = 0;
  let eatIn = 0;
  let takeOut = 0;
  let delivery = 0;
  const customerKeys = new Set<string>();

  for (const row of data as Array<Record<string, unknown>>) {
    const total = Number(row.total ?? 0);
    const paymentMethod = String(row.payment_method ?? '').toLowerCase();
    if (paymentMethod === 'cash') cash += total;
    else if (paymentMethod === 'card') card += total;
    else if (paymentMethod === 'cheque') cheque += total;
    else if (paymentMethod === 'account') account += total;
    else if (paymentMethod === 'non_bank') nonBank += total;

    const orderType = String(row.order_type ?? '').toLowerCase();
    if (orderType === 'eat_in') eatIn += total;
    else if (orderType === 'take_out') takeOut += total;
    else if (orderType === 'delivery') delivery += total;

    const phone = String(row.customer_phone ?? '').trim();
    const name = String(row.customer_name ?? '').trim().toLowerCase();
    if (phone) customerKeys.add(`p:${phone}`);
    else if (name) customerKeys.add(`n:${name}`);
  }

  const totalPaytypes = round2(cash + card + cheque + account + nonBank);
  const orderTypeDenom = totalPaytypes > 0 ? totalPaytypes : 1;
  return {
    paymentBreakdown: {
      cash: round2(cash),
      card: round2(card),
      cheque: round2(cheque),
      account: round2(account),
      non_bank: round2(nonBank),
    },
    totalPaytypes,
    invoiceCount: data.length,
    // If customer columns are not populated, this naturally falls back later to invoice count.
    customerCountEstimate: customerKeys.size > 0 ? customerKeys.size : data.length,
    orderTypes: {
      eatIn: { value: round2(eatIn), percent: round2((eatIn / orderTypeDenom) * 100) },
      takeOut: { value: round2(takeOut), percent: round2((takeOut / orderTypeDenom) * 100) },
      delivery: { value: round2(delivery), percent: round2((delivery / orderTypeDenom) * 100) },
    },
    varianceItems: [],
  };
}

export function mergeDashboardOverview(localOverview: ManagementOverview, dbSnapshot: Record<string, unknown> | null): ManagementOverview {
  if (!dbSnapshot) return localOverview;
  const normalizedPayment =
    dbSnapshot.paymentBreakdown && typeof dbSnapshot.paymentBreakdown === 'object' ? dbSnapshot.paymentBreakdown : null;
  const hoursPerDay =
    Array.isArray(dbSnapshot.hoursPerDay) && dbSnapshot.hoursPerDay.length > 0
      ? Number(((dbSnapshot.hoursPerDay as Array<Record<string, unknown>>).reduce((sum: number, h) => sum + Number(h.total || 0), 0) / (dbSnapshot.hoursPerDay as Array<unknown>).length).toFixed(1))
      : Number(localOverview.hoursPerDay ?? 0);
  const metricNumber = (dbValue: unknown, localValue: number) => {
    const local = Number.isFinite(localValue) ? localValue : 0;
    const parsed = typeof dbValue === 'number' ? dbValue : typeof dbValue === 'string' ? Number(dbValue) : NaN;
    if (!Number.isFinite(parsed)) return local;
    // Prefer live local metrics when they exist (responsive cards),
    // but allow DB to fill gaps when local cache is empty after a reset.
    if (local !== 0) return local;
    return parsed;
  };
  const normalizedOrderTypes = normalizeOrderTypes(
    (dbSnapshot.orderTypes ?? dbSnapshot.order_types) as unknown,
    Number(localOverview.turnoverIncl ?? 0) || Number(dbSnapshot.turnoverIncl ?? dbSnapshot.turnover_incl ?? 0)
  );
  return {
    ...localOverview,
    turnoverIncl: metricNumber(dbSnapshot.turnoverIncl ?? dbSnapshot.turnover_incl, localOverview.turnoverIncl ?? 0),
    turnoverExcl: metricNumber(dbSnapshot.turnoverExcl ?? dbSnapshot.turnover_excl, localOverview.turnoverExcl ?? 0),
    tax: metricNumber(dbSnapshot.tax, localOverview.tax ?? 0),
    costOfSales: metricNumber(dbSnapshot.costOfSales ?? dbSnapshot.cost_of_sales, localOverview.costOfSales ?? 0),
    costOfSalesPercent: metricNumber(dbSnapshot.costOfSalesPercent ?? dbSnapshot.cost_of_sales_percent, localOverview.costOfSalesPercent ?? 0),
    grossProfit: metricNumber(dbSnapshot.grossProfit ?? dbSnapshot.gross_profit, localOverview.grossProfit ?? 0),
    grossProfitPercent: metricNumber(dbSnapshot.grossProfitPercent ?? dbSnapshot.gross_profit_percent, localOverview.grossProfitPercent ?? 0),
    expenses: metricNumber(dbSnapshot.expenses, localOverview.expenses ?? 0),
    netProfit: metricNumber(dbSnapshot.netProfit ?? dbSnapshot.net_profit, localOverview.netProfit ?? 0),
    invoiceCount: metricNumber(dbSnapshot.invoiceCount ?? dbSnapshot.invoices_count, localOverview.invoiceCount ?? 0),
    customerCount: metricNumber(dbSnapshot.customerCount ?? dbSnapshot.customer_count, localOverview.customerCount ?? 0),
    tableCount: metricNumber(dbSnapshot.tableCount ?? dbSnapshot.table_count, localOverview.tableCount ?? 0),
    avgPerInvoice: metricNumber(dbSnapshot.avgPerInvoice ?? dbSnapshot.avg_per_invoice, localOverview.avgPerInvoice ?? 0),
    tablesPerHour: metricNumber(dbSnapshot.tablesPerHour ?? dbSnapshot.tables_per_hour, localOverview.tablesPerHour ?? 0),
    minsPerTable: metricNumber(dbSnapshot.minsPerTable ?? dbSnapshot.mins_per_table, localOverview.minsPerTable ?? 0),
    hoursPerDay,
    stockVarianceValue: metricNumber(dbSnapshot.stockVarianceValue ?? dbSnapshot.stock_variance_value, localOverview.stockVarianceValue ?? 0),
    wastageValue: metricNumber(dbSnapshot.wastageValue ?? dbSnapshot.wastage_value, localOverview.wastageValue ?? 0),
    cashTotal: metricNumber(dbSnapshot.cashTotal ?? dbSnapshot.cash_total ?? normalizedPayment?.cash, localOverview.cashTotal ?? 0),
    chequeTotal: metricNumber(dbSnapshot.chequeTotal ?? dbSnapshot.cheque_total ?? normalizedPayment?.cheque, localOverview.chequeTotal ?? 0),
    cardTotal: metricNumber(dbSnapshot.cardTotal ?? dbSnapshot.card_total ?? normalizedPayment?.card, localOverview.cardTotal ?? 0),
    accountTotal: metricNumber(dbSnapshot.accountTotal ?? dbSnapshot.account_total ?? normalizedPayment?.account, localOverview.accountTotal ?? 0),
    nonBankTotal: metricNumber(dbSnapshot.nonBankTotal ?? dbSnapshot.non_bank_total ?? normalizedPayment?.non_bank, localOverview.nonBankTotal ?? 0),
    totalPaytypes: metricNumber(dbSnapshot.totalPaytypes ?? dbSnapshot.total_paytypes, localOverview.totalPaytypes ?? 0),
    sessions: dbSnapshot.sessions ?? dbSnapshot.session_breakdown ?? localOverview.sessions,
    orderTypes: normalizedOrderTypes ?? localOverview.orderTypes,
  };
}

export function computeDelta(current: number, previous: number) {
  const deltaValue = round2(current - previous);
  const deltaPercent = previous !== 0 ? round2((deltaValue / previous) * 100) : current === 0 ? 0 : 100;
  return { deltaValue, deltaPercent };
}

function normalizeOrderTypes(value: unknown, turnoverIncl: number): ManagementOverview['orderTypes'] | null {
  const fallback: ManagementOverview['orderTypes'] = {
    eatIn: { value: 0, percent: 0 },
    takeOut: { value: 0, percent: 0 },
    delivery: { value: 0, percent: 0 },
  };
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;

  // Already in expected shape
  if (v.eatIn && typeof v.eatIn === 'object') {
    const eatIn = v.eatIn as Record<string, unknown>;
    const takeOut = (v.takeOut as Record<string, unknown>) ?? {};
    const delivery = (v.delivery as Record<string, unknown>) ?? {};
    return {
      eatIn: { value: Number(eatIn.value ?? 0), percent: Number(eatIn.percent ?? 0) },
      takeOut: { value: Number(takeOut.value ?? 0), percent: Number(takeOut.percent ?? 0) },
      delivery: { value: Number(delivery.value ?? 0), percent: Number(delivery.percent ?? 0) },
    };
  }

  // RPC `order_types` often returns numeric totals in snake_case
  const eat = Number(v.eat_in ?? v.eatIn ?? 0);
  const take = Number(v.take_out ?? v.takeOut ?? 0);
  const del = Number(v.delivery ?? 0);
  const denom = turnoverIncl > 0 ? turnoverIncl : eat + take + del > 0 ? eat + take + del : 1;

  return {
    ...fallback,
    eatIn: { value: round2(eat), percent: round2((eat / denom) * 100) },
    takeOut: { value: round2(take), percent: round2((take / denom) * 100) },
    delivery: { value: round2(del), percent: round2((del / denom) * 100) },
  };
}

function dateKeyFromIso(value: unknown) {
  if (typeof value === 'string' && value.length >= 10) {
    const y = value.slice(0, 4);
    const m = value.slice(5, 7);
    const d = value.slice(8, 10);
    if (value[4] === '-' && value[7] === '-' && isDigits(y) && isDigits(m) && isDigits(d)) {
      return `${y}-${m}-${d}`;
    }
  }
  return dateKeyLocal(new Date(value as string | number | Date));
}

function isDigits(s: string) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

function computeDrnRange(orders: Order[]): { from: number; to: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const o of orders) {
    const n = o.orderNo;
    if (!Number.isFinite(n)) continue;
    if (n < min) min = n;
    if (n > max) max = n;
  }
  if (min === Infinity || max === -Infinity) return { from: 0, to: 0 };
  return { from: min, to: max };
}

function computePaymentTotals(orders: Order[]) {
  const totals = { cash: 0, card: 0, cheque: 0, account: 0, non_bank: 0 };

  for (const o of orders) {
    const splits = o.splitPayments?.filter((s) => Number.isFinite(s.amount) && s.amount > 0) ?? [];
    if (splits.length) {
      for (const s of splits) {
        if (s.method in totals) totals[s.method as keyof typeof totals] += s.amount;
      }
      continue;
    }

    const method = (o.paymentMethod ?? 'cash') as keyof typeof totals;
    const amt = Number.isFinite(o.total) ? o.total : 0;
    if (method in totals) totals[method] += amt;
  }

  return {
    cash: round2(totals.cash),
    card: round2(totals.card),
    cheque: round2(totals.cheque),
    account: round2(totals.account),
    non_bank: round2(totals.non_bank),
  };
}

function computeSessionAndOrderTypeBreakdowns(orders: Order[], turnoverIncl: number) {
  let morning = 0;
  let afternoon = 0;
  let evening = 0;

  let eatIn = 0;
  let takeOut = 0;
  let delivery = 0;

  for (const o of orders) {
    const total = Number.isFinite(o.total) ? o.total : 0;
    const dt = new Date(o.paidAt ?? o.createdAt);
    const hour = dt.getHours();

    // 05-11, 11-17, 17-05
    if (hour >= 5 && hour < 11) morning += total;
    else if (hour >= 11 && hour < 17) afternoon += total;
    else evening += total;

    if (o.orderType === 'eat_in') eatIn += total;
    else if (o.orderType === 'take_out') takeOut += total;
    else if (o.orderType === 'delivery') delivery += total;
  }

  const denom = turnoverIncl > 0 ? turnoverIncl : 1;

  const sessions = {
    morning: { recorded: round2(morning), percent: round2((morning / denom) * 100) },
    afternoon: { recorded: round2(afternoon), percent: round2((afternoon / denom) * 100) },
    evening: { recorded: round2(evening), percent: round2((evening / denom) * 100) },
  };

  const orderTypes = {
    eatIn: { value: round2(eatIn), percent: round2((eatIn / denom) * 100) },
    takeOut: { value: round2(takeOut), percent: round2((takeOut / denom) * 100) },
    delivery: { value: round2(delivery), percent: round2((delivery / denom) * 100) },
  };

  return { sessions, orderTypes };
}

function computeSalesMix(orders: Order[], turnoverIncl: number): SalesMixItem[] {
  const map = new Map<string, { name: string; qty: number; sales: number; cost: number }>();

  for (const o of orders) {
    for (const it of o.items ?? []) {
      if (it.isVoided) continue;
      const key = it.menuItemCode || it.menuItemId;
      const qty = Number.isFinite(it.quantity) ? it.quantity : 0;
      const sales = Number.isFinite(it.total) ? it.total : qty * (it.unitPrice ?? 0);
      const cost = qty * (Number.isFinite(it.unitCost) ? it.unitCost : 0);
      if (!key) continue;

      const prev = map.get(key);
      if (!prev) map.set(key, { name: it.menuItemName ?? key, qty, sales, cost });
      else map.set(key, { ...prev, qty: prev.qty + qty, sales: prev.sales + sales, cost: prev.cost + cost });
    }
  }

  const denom = turnoverIncl > 0 ? turnoverIncl : 1;

  return Array.from(map.entries()).map(([code, v]) => {
    const qty = v.qty > 0 ? v.qty : 1;
    const costPerItem = round2(v.cost / qty);
    const sellIncl = round2(v.sales / qty);
    const gpPct = sellIncl > 0 ? round2(((sellIncl - costPerItem) / sellIncl) * 100) : 0;

    return {
      itemNo: Number.isFinite(Number(code)) ? Number(code) : 0,
      itemName: v.name,
      quantity: round2(v.qty),
      costPerItem,
      sellExcl: sellIncl,
      sellIncl,
      gpBeforeDiscount: gpPct,
      gpAfterDiscount: gpPct,
      totalCost: round2(v.cost),
      totalSales: round2(v.sales),
      totalProfit: round2(v.sales - v.cost),
      percentOfTurnover: round2((v.sales / denom) * 100),
    };
  });
}

function computeStaffSales(orders: Order[], turnoverIncl: number): DashboardStaffRow[] {
  const map = new Map<string, { name: string; total: number }>();
  for (const o of orders) {
    const id = o.staffId || o.staffName || 'staff';
    const name = o.staffName || 'Staff';
    const total = Number.isFinite(o.total) ? o.total : 0;
    const prev = map.get(id);
    if (!prev) map.set(id, { name, total });
    else map.set(id, { ...prev, total: prev.total + total });
  }

  return Array.from(map.entries())
    .map(([id, v]) => ({ id, name: v.name, role: 'staff', totalSales: round2(v.total) }))
    .sort((a, b) => b.totalSales - a.totalSales);
}

function computeStockVarianceFromTakes(stockTakes: StockTakeSession[], startDate: string, endDate: string) {
  const inRange = stockTakes
    .filter((s) => s.date >= startDate && s.date <= endDate)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // Aggregate all variance lines across the selected period so the dashboard
  // reflects the full date range instead of only the latest stock take.
  const aggregated = new Map<string, StockVariance>();
  for (const session of inRange) {
    for (const item of session.variances ?? []) {
      const key = String(item.itemId || item.itemCode || item.id);
      const existing = aggregated.get(key);
      if (!existing) {
        aggregated.set(key, { ...item });
        continue;
      }

      aggregated.set(key, {
        ...existing,
        systemQty: round2(existing.systemQty + item.systemQty),
        physicalQty: round2(existing.physicalQty + item.physicalQty),
        varianceQty: round2(existing.varianceQty + item.varianceQty),
        varianceValue: round2(existing.varianceValue + item.varianceValue),
        timesHadVariance: Number(existing.timesHadVariance ?? 0) + Number(item.timesHadVariance ?? 0),
        countDate: item.countDate || existing.countDate,
      });
    }
  }

  const items = Array.from(aggregated.values());
  const varianceValue = round2(sum(items.map((v) => v.varianceValue)));

  return {
    varianceValue,
    items: items
      .slice()
      .sort((a, b) => Math.abs(b.varianceValue) - Math.abs(a.varianceValue))
      .slice(0, 5),
  };
}

function computeAvgOpenHoursPerDay(orders: Order[], startDate: string, endDate: string) {
  const byDay = new Map<string, { min: number; max: number }>();
  for (const o of orders) {
    const iso = (o.paidAt ?? o.createdAt) as string;
    const key = dateKeyFromIso(iso);
    if (key < startDate || key > endDate) continue;
    const t = Date.parse(String(iso));
    if (!Number.isFinite(t)) continue;
    const prev = byDay.get(key);
    if (!prev) byDay.set(key, { min: t, max: t });
    else byDay.set(key, { min: Math.min(prev.min, t), max: Math.max(prev.max, t) });
  }

  const dayKeys = Array.from(byDay.keys());
  if (!dayKeys.length) return 0;

  const hours = dayKeys.map((k) => {
    const mm = byDay.get(k);
    if (!mm) return 0;
    if (mm.max <= mm.min) return 0;
    return (mm.max - mm.min) / (1000 * 60 * 60);
  });

  const avg = sum(hours) / hours.length;
  return round2(avg);
}

function sum(nums: number[]) {
  return nums.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function dateKeyLocal(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
