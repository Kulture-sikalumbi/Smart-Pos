import { useEffect, useMemo, useState } from 'react';
import { Check, ClipboardCheck, Filter, Save } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';
import { getFrontStockSnapshot, refreshFrontStock, subscribeFrontStock } from '@/lib/frontStockStore';
import { supabase } from '@/lib/supabaseClient';
import type { UserRole } from '@/types/auth';

type LocationTag = 'MANUFACTURING' | 'SALE';

type ReconciliationRow = {
  id: string;
  createdAt: string;
  locationTag: LocationTag;
  systemQty: number;
  physicalQty: number;
  variance: number;
  reason: string | null;
  itemName: string;
  itemCode: string;
  unit: string;
  staffName: string;
};

export default function FrontStockTake() {
  const { user, brand } = useAuth();
  const role = (user?.role ?? 'cashier') as UserRole;
  const canRunTake = role === 'manager' || role === 'front_supervisor' || role === 'owner';

  const rows = useSyncExternalStore(subscribeFrontStock, getFrontStockSnapshot);
  const [locationTag, setLocationTag] = useState<LocationTag>('MANUFACTURING');
  const [reason, setReason] = useState('');
  const [physicalCounts, setPhysicalCounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [isStockTakeMode, setIsStockTakeMode] = useState(false);

  const [history, setHistory] = useState<ReconciliationRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [fromDate, setFromDate] = useState(dateKeyLocal(daysAgo(7)));
  const [toDate, setToDate] = useState(dateKeyLocal(new Date()));
  const [historyLocation, setHistoryLocation] = useState<'all' | LocationTag>('all');

  const scopedRows = useMemo(() => rows.filter((r) => r.locationTag === locationTag), [rows, locationTag]);

  const payload = useMemo(() => {
    return scopedRows
      .map((r) => {
        const raw = physicalCounts[r.id];
        if (raw === undefined || raw === '') return null;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < 0) return null;
        return {
          front_stock_id: r.id,
          physical_qty: parsed,
        };
      })
      .filter(Boolean) as Array<{ front_stock_id: string; physical_qty: number }>;
  }, [scopedRows, physicalCounts]);

  const hasAnyInput = payload.length > 0;

  const historyFiltered = useMemo(() => {
    return history.filter((h) => (historyLocation === 'all' ? true : h.locationTag === historyLocation));
  }, [history, historyLocation]);

  const historySummary = useMemo(() => {
    const total = historyFiltered.reduce((sum, h) => sum + h.variance, 0);
    const positives = historyFiltered.filter((h) => h.variance > 0).length;
    const negatives = historyFiltered.filter((h) => h.variance < 0).length;
    return { total, positives, negatives };
  }, [historyFiltered]);

  async function loadHistory() {
    if (!brand?.id) return;
    setHistoryLoading(true);
    try {
      const fromTs = `${fromDate}T00:00:00`;
      const toTs = `${toDate}T23:59:59`;
      const { data, error } = await supabase
        .from('front_stock_reconciliations')
        .select('id, created_at, location_tag, system_qty, physical_qty, variance, reason, front_stock!inner(item_id, produced_name, produced_code, unit), staff_id')
        .eq('brand_id', brand.id)
        .gte('created_at', fromTs)
        .lte('created_at', toTs)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;

      const staffIds = Array.from(
        new Set(
          (data ?? [])
            .map((r: any) => (r.staff_id ? String(r.staff_id) : ''))
            .filter(Boolean)
        )
      );
      let staffNameById = new Map<string, string>();
      if (staffIds.length) {
        const { data: staffRows } = await supabase
          .from('under_brand_staff')
          .select('id, name')
          .in('id', staffIds)
          .eq('brand_id', brand.id);
        staffNameById = new Map((staffRows ?? []).map((s: any) => [String(s.id), String(s.name ?? 'Unknown')]));
      }

      const itemIds = Array.from(
        new Set(
          (data ?? [])
            .map((r: any) => String((r.front_stock as any)?.item_id ?? ''))
            .filter(Boolean)
        )
      );
      let itemNameById = new Map<string, { name: string; code: string }>();
      if (itemIds.length) {
        const { data: itemRows } = await supabase
          .from('stock_items')
          .select('id, name, item_code')
          .eq('brand_id', brand.id)
          .in('id', itemIds);
        itemNameById = new Map(
          (itemRows ?? []).map((i: any) => [String(i.id), { name: String(i.name ?? ''), code: String(i.item_code ?? '') }])
        );
      }

      const mapped: ReconciliationRow[] = (data ?? []).map((r: any) => {
        const fs = (r.front_stock as any) ?? {};
        const itemId = String(fs.item_id ?? '');
        const itemMeta = itemNameById.get(itemId);
        return {
          id: String(r.id),
          createdAt: String(r.created_at),
          locationTag: String(r.location_tag) as LocationTag,
          systemQty: Number(r.system_qty ?? 0),
          physicalQty: Number(r.physical_qty ?? 0),
          variance: Number(r.variance ?? 0),
          reason: r.reason ? String(r.reason) : null,
          itemName: itemMeta?.name || String(fs.produced_name ?? 'Unknown item'),
          itemCode: itemMeta?.code || String(fs.produced_code ?? 'NO-CODE'),
          unit: String(fs.unit ?? ''),
          staffName: staffNameById.get(String(r.staff_id ?? '')) ?? 'Unknown',
        };
      });

      setHistory(mapped);
    } catch (err: any) {
      toast({
        title: 'History load failed',
        description: err?.message ?? 'Could not fetch front stock take history.',
        variant: 'destructive',
      });
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    void loadHistory();
  }, [brand?.id, fromDate, toDate]);

  const onSave = async () => {
    if (!canRunTake) {
      toast({
        title: 'Access restricted',
        description: 'Only Front Office Supervisors can run stock take.',
        variant: 'destructive',
      });
      return;
    }
    if (!brand?.id) {
      toast({ title: 'No brand selected', variant: 'destructive' });
      return;
    }
    if (!hasAnyInput) {
      toast({ title: 'No counts entered', description: 'Enter at least one physical count.' });
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('record_front_stock_take_reconciliation', {
        p_brand_id: brand.id,
        p_staff_id: user?.id ?? null,
        p_location_tag: locationTag,
        p_counts: payload,
        p_reason: reason || null,
      });
      if (error) throw error;

      await refreshFrontStock();
      await loadHistory();
      setPhysicalCounts({});
      setReason('');
      setIsStockTakeMode(false);

      toast({
        title: 'Front stock take saved',
        description: `Reconciled ${(data as any)?.reconciled_rows ?? payload.length} rows.`,
      });
    } catch (err: any) {
      toast({
        title: 'Save failed',
        description: err?.message ?? 'Could not complete reconciliation.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Front Office Stock Take Audit
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Auditing + reconciliation. Use history view for past takes, then toggle into count mode when needed.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {!isStockTakeMode ? (
            <Button
              onClick={() => {
                setIsStockTakeMode(true);
                setPhysicalCounts({});
              }}
              disabled={!canRunTake}
            >
              <Check className="h-4 w-4 mr-2" />
              Start Stock Take
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setIsStockTakeMode(false)}>
                Cancel
              </Button>
              <Button onClick={onSave} disabled={!canRunTake || !hasAnyInput || submitting}>
                <Save className="h-4 w-4 mr-2" />
                {submitting ? 'Saving...' : 'Save Stock Take'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {isStockTakeMode ? (
        <Card>
          <CardHeader>
            <CardTitle>Count Session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>Location</Label>
                <Select value={locationTag} onValueChange={(v) => setLocationTag(v as LocationTag)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANUFACTURING">Manufacturing</SelectItem>
                    <SelectItem value="SALE">Sale</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label>Reason (optional)</Label>
                <Input
                  placeholder="Spillage, waste, theft, correction..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            </div>

            {!canRunTake && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                Only Front Office Supervisors can run stock take. The stock users cannot perform the count.
              </div>
            )}

            <div className="grid grid-cols-1 gap-3">
              {scopedRows.map((row) => {
                const physicalRaw = physicalCounts[row.id] ?? '';
                const physical = physicalRaw === '' ? null : Number(physicalRaw);
                const variance = physical === null || !Number.isFinite(physical) ? null : physical - row.quantity;
                const varianceClass =
                  variance === null
                    ? 'text-muted-foreground'
                    : variance < 0
                    ? 'text-destructive'
                    : variance > 0
                    ? 'text-emerald-600'
                    : 'text-muted-foreground';

                return (
                  <Card key={row.id}>
                    <CardContent className="pt-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-medium">{row.itemName || row.producedName || 'Unnamed item'}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.itemCode || row.producedCode || 'NO-CODE'} · {row.unit}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Current Stock</div>
                          <div className="font-semibold">{row.quantity}</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 items-end">
                        <div>
                          <Label className="text-xs">Physical Count</Label>
                          <Input
                            type="number"
                            inputMode="decimal"
                            step={row.unit?.toLowerCase() === 'each' ? '1' : '0.01'}
                            min="0"
                            className="h-12 text-lg"
                            value={physicalRaw}
                            onChange={(e) =>
                              setPhysicalCounts((prev) => ({
                                ...prev,
                                [row.id]: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Variance</div>
                          <div className={`text-lg font-semibold ${varianceClass}`}>
                            {variance === null ? '-' : variance > 0 ? `+${variance}` : variance}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs text-muted-foreground">Total variance</div>
                <div className={`text-xl font-semibold ${historySummary.total < 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                  {historySummary.total > 0 ? `+${historySummary.total}` : historySummary.total}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs text-muted-foreground">Positive lines</div>
                <div className="text-xl font-semibold text-emerald-600">{historySummary.positives}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs text-muted-foreground">Negative lines</div>
                <div className="text-xl font-semibold text-destructive">{historySummary.negatives}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs text-muted-foreground">Records</div>
                <div className="text-xl font-semibold">{historyFiltered.length}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reconciliation History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div>
                  <Label>From</Label>
                  <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                </div>
                <div>
                  <Label>To</Label>
                  <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </div>
                <div>
                  <Label>Location</Label>
                  <Select value={historyLocation} onValueChange={(v) => setHistoryLocation(v as 'all' | LocationTag)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="MANUFACTURING">Manufacturing</SelectItem>
                      <SelectItem value="SALE">Sale</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2 flex items-end">
                  <Button variant="outline" onClick={() => void loadHistory()}>
                    <Filter className="h-4 w-4 mr-2" />
                    Refresh History
                  </Button>
                </div>
              </div>

              {historyLoading ? (
                <div className="text-sm text-muted-foreground">Loading reconciliation history...</div>
              ) : (
                <div className="rounded-md border overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead className="text-right">System</TableHead>
                        <TableHead className="text-right">Physical</TableHead>
                        <TableHead className="text-right">Variance</TableHead>
                        <TableHead>By</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyFiltered.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                            No reconciliation records for this range.
                          </TableCell>
                        </TableRow>
                      ) : (
                        historyFiltered.map((h) => (
                          <TableRow key={h.id}>
                            <TableCell className="text-xs">{new Date(h.createdAt).toLocaleString()}</TableCell>
                            <TableCell>
                              <div className="font-medium">{h.itemName}</div>
                              <div className="text-xs text-muted-foreground">{h.itemCode}</div>
                            </TableCell>
                            <TableCell>{h.locationTag}</TableCell>
                            <TableCell className="text-right">{h.systemQty}</TableCell>
                            <TableCell className="text-right">{h.physicalQty}</TableCell>
                            <TableCell className={`text-right font-semibold ${h.variance < 0 ? 'text-destructive' : h.variance > 0 ? 'text-emerald-600' : ''}`}>
                              {h.variance > 0 ? `+${h.variance}` : h.variance}
                            </TableCell>
                            <TableCell>{h.staffName}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{h.reason || '-'}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function daysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function dateKeyLocal(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

