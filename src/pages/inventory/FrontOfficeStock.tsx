import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Search } from 'lucide-react';

import { PageHeader, DataTableWrapper, NumericCell } from '@/components/common/PageComponents';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import {
  getFrontStockSnapshot,
  refreshFrontStock,
  subscribeFrontStock,
  subscribeToRealtimeFrontStock,
  type FrontStockRow,
} from '@/lib/frontStockStore';
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/hooks/use-toast';

type LocationFilter = 'all' | 'MANUFACTURING' | 'SALE';

function normalizeLocationTag(tag: string | null | undefined): 'MANUFACTURING' | 'SALE' | 'OTHER' {
  const t = String(tag ?? '').trim().toUpperCase();
  if (t === 'MANUFACTURING') return 'MANUFACTURING';
  if (t === 'SALE') return 'SALE';
  return 'OTHER';
}

export default function FrontOfficeStock() {
  const { brand, user, hasPermission } = useAuth();
  const activeBrandId = String((brand as any)?.id ?? (user as any)?.brand_id ?? '');
  const rows = useSyncExternalStore(subscribeFrontStock, getFrontStockSnapshot);

  const [tab, setTab] = useState<LocationFilter>('all');
  const [search, setSearch] = useState('');
  const [targetByRowId, setTargetByRowId] = useState<Record<string, 'SALE' | 'MANUFACTURING'>>({});
  const [movingRowId, setMovingRowId] = useState<string | null>(null);
  const [transferRowId, setTransferRowId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeBrandId) return;
    void refreshFrontStock();
    const unsubscribeRealtime = subscribeToRealtimeFrontStock();

    const onVisibilityOrFocus = () => {
      if (!activeBrandId) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void refreshFrontStock();
    };
    if (typeof window !== 'undefined') window.addEventListener('focus', onVisibilityOrFocus);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityOrFocus);

    return () => {
      try {
        unsubscribeRealtime?.();
      } catch {
        // ignore
      }
      try {
        if (typeof window !== 'undefined') window.removeEventListener('focus', onVisibilityOrFocus);
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      } catch {
        // ignore
      }
    };
  }, [activeBrandId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      const loc = normalizeLocationTag(r.locationTag);
      if (tab !== 'all' && loc !== tab) return false;
      if (!q) return true;
      const name = String(r.itemName ?? '').toLowerCase();
      const code = String(r.itemCode ?? '').toLowerCase();
      const unit = String(r.unit ?? '').toLowerCase();
      return name.includes(q) || code.includes(q) || unit.includes(q);
    });
  }, [rows, tab, search]);

  const totals = useMemo(() => {
    let all = 0;
    let m = 0;
    let s = 0;
    for (const r of rows ?? []) {
      const qty = Number(r.quantity ?? 0) || 0;
      all += qty;
      const loc = normalizeLocationTag(r.locationTag);
      if (loc === 'MANUFACTURING') m += qty;
      if (loc === 'SALE') s += qty;
    }
    return { all, manufacturing: m, sale: s };
  }, [rows]);

  if (!hasPermission('viewInventory' as any)) {
    return (
      <div className="p-6">
        <div className="text-sm text-muted-foreground">You don’t have permission to view inventory.</div>
      </div>
    );
  }

  const columns = [
    { key: 'item', header: 'Item' },
    { key: 'location', header: 'Location' },
    { key: 'qty', header: 'Qty' },
    { key: 'unit', header: 'Unit' },
    { key: 'updated', header: 'Updated' },
    { key: 'move', header: 'Move/Transfer' },
  ] as const;
  const transferRow = useMemo(() => (rows ?? []).find((r) => r.id === transferRowId) ?? null, [rows, transferRowId]);

  return (
    <div className="space-y-6">
      <PageHeader title="Front Office Stock" subtitle="Live view of stock transferred from Main Store to Manufacturing/Sale locations." />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={(v) => setTab(v as LocationFilter)}>
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="all" className="flex-1 sm:flex-none">
              All <span className="ml-2 text-xs text-muted-foreground">{Number.isFinite(totals.all) ? totals.all.toFixed(2) : totals.all}</span>
            </TabsTrigger>
            <TabsTrigger value="MANUFACTURING" className="flex-1 sm:flex-none">
              Manufacturing <span className="ml-2 text-xs text-muted-foreground">{Number.isFinite(totals.manufacturing) ? totals.manufacturing.toFixed(2) : totals.manufacturing}</span>
            </TabsTrigger>
            <TabsTrigger value="SALE" className="flex-1 sm:flex-none">
              Sale <span className="ml-2 text-xs text-muted-foreground">{Number.isFinite(totals.sale) ? totals.sale.toFixed(2) : totals.sale}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item…" className="pl-9" />
        </div>
      </div>

      <DataTableWrapper>
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length ? (
                filtered.map((r: FrontStockRow) => {
                  const loc = normalizeLocationTag(r.locationTag);
                  const resolvedName = r.itemName || r.producedName || 'Unknown item';
                  const resolvedCode = r.itemCode || r.producedCode || r.itemId || r.menuItemId || '';
                  const canMoveToManufacturing = Boolean(r.itemId);
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="p-3">
                        <div className="font-medium">{resolvedName}</div>
                        <div className="text-xs text-muted-foreground">{resolvedCode ? `Code: ${resolvedCode}` : 'No code'}</div>
                      </td>
                      <td className="p-3">
                        <span
                          className={cn(
                            'inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold',
                            loc === 'MANUFACTURING' && 'bg-emerald-100 text-emerald-800',
                            loc === 'SALE' && 'bg-blue-100 text-blue-800',
                            loc === 'OTHER' && 'bg-muted text-muted-foreground'
                          )}
                        >
                          {loc === 'OTHER' ? r.locationTag : loc}
                        </span>
                      </td>
                      <td className="p-3">
                        <NumericCell value={r.quantity} />
                      </td>
                      <td className="p-3">{r.unit}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '—'}
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setTargetByRowId((prev) => ({ ...prev, [r.id]: prev[r.id] ?? 'SALE' }));
                              setTransferRowId(r.id);
                            }}
                          >
                            Transfer
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={columns.length} className="p-6 text-center text-sm text-muted-foreground">
                    No items found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </DataTableWrapper>

      <Dialog open={Boolean(transferRowId)} onOpenChange={(open) => { if (!open) setTransferRowId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer Stock</DialogTitle>
            <DialogDescription>
              {transferRow ? `Move "${transferRow.itemName || transferRow.producedName || 'selected item'}" to another location.` : 'Select target location.'}
            </DialogDescription>
          </DialogHeader>
          {transferRow ? (
            <div className="space-y-2">
              <Select
                value={targetByRowId[transferRow.id] ?? 'SALE'}
                onValueChange={(v: 'SALE' | 'MANUFACTURING') =>
                  setTargetByRowId((prev) => ({ ...prev, [transferRow.id]: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose destination" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SALE">Move to SALE</SelectItem>
                  {Boolean(transferRow.itemId) ? (
                    <SelectItem value="MANUFACTURING">Move to MANUFACTURING</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferRowId(null)} disabled={Boolean(movingRowId && transferRowId)}>
              Cancel
            </Button>
            <Button
              disabled={!transferRow || movingRowId === transferRow.id}
              onClick={async () => {
                if (!transferRow) return;
                try {
                  setMovingRowId(transferRow.id);
                  const target = targetByRowId[transferRow.id] ?? 'SALE';
                  const { error } = await supabase.rpc('move_front_stock_location', {
                    p_source_row_id: transferRow.id,
                    p_target_location: target,
                  } as any);
                  if (error) throw new Error(String(error.message ?? error));
                  await refreshFrontStock();
                  toast({ title: 'Stock moved', description: `Moved to ${target}.` });
                  setTransferRowId(null);
                } catch (e) {
                  toast({
                    title: 'Move failed',
                    description: (e as Error)?.message ?? 'Could not move stock.',
                    variant: 'destructive',
                  });
                } finally {
                  setMovingRowId(null);
                }
              }}
            >
              {transferRow && movingRowId === transferRow.id ? 'Moving...' : 'Apply Transfer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

