import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/common/PageComponents';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboardDateRange } from '@/hooks/useDashboardDateRange';
import { supabase } from '@/lib/supabaseClient';
import { useCurrency } from '@/contexts/CurrencyContext';
import { Skeleton } from '@/components/ui/skeleton';

type ShiftRow = {
  id: string;
  staff_id: string;
  staff_name?: string | null;
  till_id?: string | null;
  till_code?: string | null;
  till_name?: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  actual_cash: number;
  expected_cash: number;
  variance_cash: number;
  z_report_summary: any;
};

type ShiftOption = {
  id: string;
  opened_at: string;
  closed_at: string | null;
  staff_id: string;
  staff_name?: string | null;
  till_id?: string | null;
  till_code?: string | null;
  till_name?: string | null;
};

function formatShiftLabel(shift: ShiftOption) {
  const opened = new Date(shift.opened_at).toLocaleString();
  const state = shift.closed_at ? 'Closed' : 'Open';
  const staffName = String(shift.staff_name ?? `Staff ${String(shift.staff_id).slice(0, 8)}...`);
  const till = shift.till_code || shift.till_name
    ? `Till ${String(shift.till_code ?? '').trim() || '?'} • ${String(shift.till_name ?? '').trim() || 'Unnamed'}`
    : 'Till (unassigned)';
  return `${state} • ${till} • ${opened} • ${staffName}`;
}

export default function ShiftReports() {
  const { user, brand, hasPermission } = useAuth();
  const brandId = String((brand as any)?.id ?? (user as any)?.brand_id ?? '');
  const { currencyCode, formatMoneyPrecise } = useCurrency();

  const { safeRange, startDate, endDate, setStartDate, setEndDate, preset, applyPreset } = useDashboardDateRange();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ShiftRow[]>([]);

  const [leakage, setLeakage] = useState<any | null>(null);
  const [leakageBusy, setLeakageBusy] = useState(false);

  const [shiftId, setShiftId] = useState('');
  const [shiftOptions, setShiftOptions] = useState<ShiftOption[]>([]);
  const [xReport, setXReport] = useState<any | null>(null);
  const [xBusy, setXBusy] = useState(false);
  const [xError, setXError] = useState<string | null>(null);

  const canView = hasPermission('viewReports') || hasPermission('viewAllCashUps') || hasPermission('manageSettings');

  useEffect(() => {
    if (!supabase) return;
    if (!brandId) return;
    if (!canView) return;
    let disposed = false;
    (async () => {
      setLoading(true);
      try {
        const [reportsRes, shiftsRes, leakageRes] = await Promise.all([
          supabase.rpc('get_shift_z_reports', {
            p_brand_id: brandId,
            p_from: safeRange.startDate,
            p_to: safeRange.endDate,
          }),
          supabase
            .from('cashier_shifts')
            .select('id, opened_at, closed_at, staff_id, till_id')
            .eq('brand_id', brandId)
            .order('opened_at', { ascending: false })
            .limit(50),
          supabase.rpc('get_shift_leakage_report', {
            p_brand_id: brandId,
            p_from: safeRange.startDate,
            p_to: safeRange.endDate,
          }),
        ]);

        if (disposed) return;

        const { data: reportData, error: reportError } = reportsRes;
        if (reportError) {
          console.warn('get_shift_z_reports error', reportError);
          setRows([]);
        } else {
          setRows((Array.isArray(reportData) ? reportData : []) as ShiftRow[]);
        }

        const { data: shiftData, error: shiftError } = shiftsRes;
        if (shiftError) {
          console.warn('cashier_shifts select failed', shiftError);
          setShiftOptions([]);
        } else {
          const baseOptions = (Array.isArray(shiftData) ? shiftData : []) as ShiftOption[];
          const staffIds = Array.from(new Set(baseOptions.map((row) => String(row.staff_id || '')).filter(Boolean)));
          const tillIds = Array.from(new Set(baseOptions.map((row) => String((row as any).till_id || '')).filter(Boolean)));
          let staffNames = new Map<string, string>();
          let tillNames = new Map<string, { code: string; name: string }>();

          if (staffIds.length > 0) {
            const { data: staffRows, error: staffError } = await supabase
              .from('under_brand_staff')
              .select('id, name')
              .in('id', staffIds);

            if (!disposed && staffError) {
              console.warn('under_brand_staff select failed', staffError);
            }
            if (!disposed && Array.isArray(staffRows)) {
              staffNames = new Map(staffRows.map((row: any) => [String(row.id), String(row.name ?? '')]));
            }
          }

          if (tillIds.length > 0) {
            const { data: tillRows, error: tillError } = await supabase
              .from('tills')
              .select('id, code, name')
              .in('id', tillIds);

            if (!disposed && tillError) {
              console.warn('tills select failed', tillError);
            }
            if (!disposed && Array.isArray(tillRows)) {
              tillNames = new Map(tillRows.map((row: any) => [String(row.id), { code: String(row.code ?? ''), name: String(row.name ?? '') }]));
            }
          }

          if (disposed) return;

          const options = baseOptions.map((row) => ({
            ...row,
            staff_name: staffNames.get(String(row.staff_id)) ?? null,
            till_id: (row as any).till_id ? String((row as any).till_id) : null,
            till_code: tillNames.get(String((row as any).till_id ?? ''))?.code ?? null,
            till_name: tillNames.get(String((row as any).till_id ?? ''))?.name ?? null,
          }));
          setShiftOptions(options);
          setShiftId((current) => {
            if (current && options.some((option) => option.id === current)) return current;
            return options[0]?.id ? String(options[0].id) : '';
          });
        }

        const { data: leakageData, error: leakageError } = leakageRes;
        if (leakageError) {
          console.warn('get_shift_leakage_report error', leakageError);
          setLeakage(null);
        } else {
          setLeakage(leakageData ?? null);
        }
      } catch (error) {
        console.warn('shift reports load failed', error);
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [brandId, canView, safeRange.startDate, safeRange.endDate]);

  const totalVariance = useMemo(() => rows.reduce((s, r) => s + (Number(r.variance_cash) || 0), 0), [rows]);

  const reportMoney = useCallback(
    (amount: number, decimals = 2) => `${currencyCode} ${formatMoneyPrecise(amount, decimals).replace(/^[^\d-]+/, '').trim()}`,
    [currencyCode, formatMoneyPrecise]
  );

  const runXReport = useCallback(async () => {
    if (!supabase) return;
    const id = shiftId.trim();
    if (!id) return;
    setXBusy(true);
    setXError(null);
    try {
      const { data, error } = await supabase.rpc('cashier_shift_x_report', { p_shift_id: id });
      if (error) {
        setXError(String((error as any)?.message ?? 'Unable to load X-report'));
        setXReport(null);
        return;
      }
      if (!data || (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0)) {
        setXError('No X-report data found for that shift.');
        setXReport(null);
        return;
      }
      setXReport(data ?? null);
    } catch (e: any) {
      setXError(e?.message ?? 'Unable to load X-report');
      setXReport(null);
    } finally {
      setXBusy(false);
    }
  }, [shiftId]);

  useEffect(() => {
    if (!shiftId.trim()) return;
    void runXReport();
  }, [runXReport, shiftId]);

  const selectedShift = useMemo(
    () => shiftOptions.find((option) => option.id === shiftId) ?? null,
    [shiftId, shiftOptions]
  );

  const openShifts = useMemo(
    () => shiftOptions.filter((option) => !option.closed_at),
    [shiftOptions]
  );

  const openShiftCount = useMemo(
    () => openShifts.length,
    [openShifts]
  );

  const closedShiftCount = rows.length;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="X / Z Reports"
        description="Review open-shift cash position with X-Reports and closed-shift cash-ups with Z-Reports."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Date Range</CardTitle>
          <CardDescription>Choose the period you want to review.</CardDescription>
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
          <div className="ml-auto text-xs text-muted-foreground">
            {loading ? 'Refreshing reports...' : `${rows.length} Z-Reports • Total variance ${reportMoney(totalVariance, 2)}`}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Open shifts</CardDescription>
            <CardTitle>{loading ? <Skeleton className="h-8 w-16" /> : openShiftCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Z-Reports</CardDescription>
            <CardTitle>{loading ? <Skeleton className="h-8 w-16" /> : closedShiftCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total variance</CardDescription>
            <CardTitle>{loading ? <Skeleton className="h-8 w-32" /> : reportMoney(totalVariance, 2)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,420px)_1fr] gap-6 mb-6">
        <Card className="mthunzi-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">X-Report (Open Shifts)</CardTitle>
            <CardDescription>All currently open shifts are shown below. Pick one till to view its X-Report.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : openShifts.length ? (
                <div className="space-y-2">
                  {openShifts.map((shift) => {
                    const selected = shift.id === shiftId;
                    return (
                      <button
                        key={shift.id}
                        type="button"
                        onClick={() => setShiftId(shift.id)}
                        className={`w-full rounded-md border px-3 py-3 text-left transition-colors ${
                          selected ? 'border-primary bg-primary/10' : 'border-border/60 bg-muted/10 hover:bg-muted/20'
                        }`}
                      >
                        <div className="text-sm font-medium">{String(shift.staff_name ?? 'Unknown')}</div>
                        <div className="text-xs text-muted-foreground">{new Date(shift.opened_at).toLocaleString()}</div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border/60 px-3 py-4 text-sm text-muted-foreground">
                  No open shifts right now.
                </div>
              )}

              {selectedShift ? (
                <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  Selected: {formatShiftLabel(selectedShift)}
                </div>
              ) : null}

              {xError ? <div className="text-sm text-destructive">{xError}</div> : null}
            </div>

            {xBusy && !xReport ? (
              <div className="rounded-md border p-4 space-y-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ) : xReport ? (
              <div className="rounded-md border p-4 text-sm space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Opening float</span>
                  <span className="font-medium">{reportMoney(Number(xReport.opening_cash ?? 0), 2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cash sales</span>
                  <span className="font-medium">{reportMoney(Number(xReport?.totals?.cash ?? 0), 2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Expected cash</span>
                  <span className="font-semibold">{reportMoney(Number(xReport.expected_cash ?? 0), 2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total sales</span>
                  <span className="font-medium">{reportMoney(Number(xReport?.totals?.total ?? 0), 2)}</span>
                </div>
                <div className="grid gap-1 rounded-md bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  <div>
                    Till:{' '}
                    {String(xReport.till_code ?? '').trim() || String(xReport.till_name ?? '').trim()
                      ? `${String(xReport.till_code ?? '').trim() || '?'} • ${String(xReport.till_name ?? '').trim() || 'Unnamed'}`
                      : 'Unassigned'}
                  </div>
                  <div>Cashier: {String(xReport.staff_name ?? xReport.staff_id ?? 'Unknown')}</div>
                  <div>Orders: {Number(xReport.order_count ?? 0)}</div>
                  <div>Opened: {new Date(String(xReport.opened_at ?? '')).toLocaleString()}</div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Select any open shift above to view its X-Report. This does not close the shift.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mthunzi-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Z-Reports (Closed Shifts)</CardTitle>
            <CardDescription>Simple view of what was expected, counted, and any variance.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b-white/10">
                    <TableHead>Staff</TableHead>
                    <TableHead>Till</TableHead>
                    <TableHead>Shift</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 4 }).map((_, idx) => (
                      <TableRow key={`loading-${idx}`} className="border-b-white/10">
                        <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                        <TableCell className="text-right"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                        <TableCell className="text-right"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                        <TableCell className="text-right"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      </TableRow>
                    ))
                  ) : !rows.length ? (
                    <TableRow className="border-b-white/10">
                      <TableCell colSpan={6} className="text-sm text-muted-foreground">
                        No closed shifts in this range.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.slice(0, 50).map((r) => (
                      <TableRow key={r.id} className="border-b-white/10">
                        <TableCell className="text-xs">{String(r.staff_name ?? r.staff_id ?? 'Unknown')}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {String(r.till_code ?? '').trim() || String(r.till_name ?? '').trim()
                            ? `${String(r.till_code ?? '').trim() || '?'} • ${String(r.till_name ?? '').trim() || 'Unnamed'}`
                            : 'Unassigned'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(r.closed_at ?? r.opened_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">{reportMoney(Number(r.expected_cash ?? 0), 2)}</TableCell>
                        <TableCell className="text-right">{reportMoney(Number(r.actual_cash ?? 0), 2)}</TableCell>
                        <TableCell className={`text-right font-medium ${Number(r.variance_cash ?? 0) === 0 ? 'text-foreground' : Number(r.variance_cash ?? 0) > 0 ? 'text-amber-500' : 'text-red-500'}`}>
                          {reportMoney(Number(r.variance_cash ?? 0), 2)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mthunzi-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Leakage Estimate</CardTitle>
          <CardDescription>Quick estimate of revenue versus production cost for the selected period.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {loading || leakageBusy ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div key={idx} className="rounded border p-3 space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-6 w-28" />
                </div>
              ))}
            </div>
          ) : leakage ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">Revenue (shift-linked)</div>
                <div className="font-semibold">{reportMoney(Number(leakage.revenue ?? 0), 2)}</div>
              </div>
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">Ingredient cost estimate</div>
                <div className="font-semibold">{reportMoney(Number(leakage.ingredient_cost_estimate ?? 0), 2)}</div>
              </div>
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">Gross profit estimate</div>
                <div className="font-semibold">{reportMoney(Number(leakage.gross_profit_estimate ?? 0), 2)}</div>
              </div>
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">GP% estimate</div>
                <div className="font-semibold">{Number(leakage.gross_profit_percent_estimate ?? 0).toFixed(2)}%</div>
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground">
              Leakage report not available yet for this range.
            </div>
          )}

          <div className="mt-3 text-xs text-muted-foreground">
            This is a v1 estimate: it compares batch production cost recorded in the period against revenue from shift-linked paid orders.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

