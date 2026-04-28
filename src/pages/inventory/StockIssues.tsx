import React, { useMemo, useState, useSyncExternalStore, useEffect } from 'react';
import { AlertTriangle, ArrowLeftRight, ArrowRight, Calendar, Check, ChevronsUpDown, Plus, Search } from 'lucide-react';

import { PageHeader, DataTableWrapper, NumericCell } from '@/components/common/PageComponents';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/use-toast';

import type { StockItem } from '@/types';
import { getStockItemsSnapshot, subscribeStockItems } from '@/lib/stockStore';
import { useCurrency } from '@/contexts/CurrencyContext';
import {
  createStockIssue,
  getStockIssuesSnapshot,
  StockIssueError,
  subscribeStockIssues,
  subscribeStockIssuesLoading,
  getStockIssuesLoadingSnapshot,
  ensureStockIssuesLoaded,
} from '@/lib/stockIssueStore';
import { getActiveBrandId } from '@/lib/activeBrand';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { getStockItemById } from '@/lib/stockStore';

type DraftIssueLine = {
  id: string;
  stockItemId: string;
  qty: string; // user-entered qty in inputUnit
  inputUnit?: string; // e.g., 'kg','g','l','ml','each','pack'
  issueType?: 'Wastage' | 'Expired' | 'Staff Meal' | 'Theft' | 'Damage' | 'Manufacturing' | 'Sale';
  notes?: string;
};

function StockItemPicker(props: {
  value: string;
  onChange: (id: string) => void;
  items: StockItem[];
  placeholder: string;
  disabled?: boolean;
}) {
  const selected = props.items.find((i) => i.id === props.value) ?? null;
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between', !selected && 'text-muted-foreground')}
          disabled={props.disabled}
        >
          {selected ? `${selected.code} - ${selected.name} (Stock: ${Number.isFinite(selected.currentStock) ? selected.currentStock.toFixed(2) : selected.currentStock} ${baseUnitLabel(selected.unitType)})` : props.placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Type code or name..." />
          <CommandList>
            <CommandEmpty>No item found.</CommandEmpty>
            <CommandGroup>
              {props.items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.code} ${item.name}`}
                  onSelect={() => {
                    props.onChange(item.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn('mr-2 h-4 w-4', props.value === item.id ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{item.code} - {item.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">Stock: {Number.isFinite(item.currentStock) ? item.currentStock.toFixed(2) : item.currentStock} {baseUnitLabel(item.unitType)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function baseUnitLabel(unitType: any) {
  if (unitType === 'KG') return 'kg';
  if (unitType === 'LTRS') return 'l';
  if (unitType === 'PACK') return 'pack';
  return 'each';
}

function dateKeyLocal(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function StockIssues() {
    const { formatMoneyPrecise } = useCurrency();
  const stockItems = useSyncExternalStore(subscribeStockItems, getStockItemsSnapshot);
  const issues = useSyncExternalStore(subscribeStockIssues, getStockIssuesSnapshot);
  const loading = useSyncExternalStore(subscribeStockIssuesLoading, getStockIssuesLoadingSnapshot);

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const submitLockRef = React.useRef(false);
  const [issueDate, setIssueDate] = useState<string>(dateKeyLocal(new Date()));
  const [createdBy, setCreatedBy] = useState('System');
  const { user: authUser, allUsers } = useAuth();
  const currentUserId = authUser?.id ?? null;
  const currentUserFullName = authUser?.name ?? authUser?.email ?? '';

  useEffect(() => {
    setCreatedBy(currentUserFullName || 'System');
  }, [currentUserFullName]);

  const userNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const u of allUsers ?? []) {
      if (u?.id) m.set(u.id, u.name ?? '');
    }
    return m;
  }, [allUsers]);
  const [search, setSearch] = useState('');

  const [draftLines, setDraftLines] = useState<DraftIssueLine[]>(() => [
    { id: `dl-${crypto.randomUUID()}`, stockItemId: '', qty: '', inputUnit: undefined, issueType: 'Sale', notes: '' },
  ]);

  const storeItems = useMemo(() => {
    const store = stockItems.filter((s) => String(s.code).startsWith('4'));
    return store.length ? store : stockItems;
  }, [stockItems]);

  const departmentItems = useMemo(() => {
    const dept = stockItems.filter((s) => !String(s.code).startsWith('4'));
    return dept.length ? dept : stockItems;
  }, [stockItems]);

  function round2(n: number) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  

  function allowedInputUnits(unitType: any, itemsPerPack?: number) {
    if (unitType === 'KG') return ['kg', 'g'];
    if (unitType === 'LTRS') return ['l', 'ml'];
    if (unitType === 'PACK') return itemsPerPack && itemsPerPack > 0 ? ['pack', 'each'] : ['pack'];
    return ['each'];
  }

  function toBaseQuantity(params: { qty: number; inputUnit: string; unitType: any; itemsPerPack?: number }) {
    const qty = Number.isFinite(params.qty) ? params.qty : 0;
    const inputUnit = String(params.inputUnit || '').toLowerCase();

    if (params.unitType === 'KG') {
      if (inputUnit === 'g') return round2(qty / 1000);
      return round2(qty);
    }

    if (params.unitType === 'LTRS') {
      if (inputUnit === 'ml') return round2(qty / 1000);
      return round2(qty);
    }

    if (params.unitType === 'PACK') {
      if (inputUnit === 'each') {
        const n = Number(params.itemsPerPack ?? 0);
        if (!n || n <= 0) return 0;
        return round2(qty / n);
      }
      return round2(qty);
    }

    return round2(qty);
  }

  const isTransferIssueType = (t?: DraftIssueLine['issueType']) => t === 'Manufacturing' || t === 'Sale';
  const isLossIssueType = (t?: DraftIssueLine['issueType']) =>
    t === 'Wastage' || t === 'Expired' || t === 'Staff Meal' || t === 'Theft' || t === 'Damage';

  const validated = useMemo(() => {
    const eps = 1e-9;
    const lines = draftLines.map((l) => {
      const item = stockItems.find((s) => s.id === l.stockItemId) ?? null;
      const qtyRaw = Number(l.qty);
      const qty = Number.isFinite(qtyRaw) ? qtyRaw : 0;
      const touched = Boolean(l.stockItemId || (l.qty && l.qty.trim()));

      const inputUnit = l.inputUnit ?? (item ? baseUnitLabel(item.unitType) : 'each');
      const baseQty = item ? toBaseQuantity({ qty, inputUnit, unitType: item.unitType, itemsPerPack: item.itemsPerPack }) : 0;

      const errors: string[] = [];
      if (touched) {
        if (!item) errors.push('Select an item.');
        if (!(qty > 0)) errors.push('Enter an issue quantity > 0.');
        if (item?.unitType === 'EACH' && !Number.isInteger(qty)) {
          errors.push('Whole numbers only for EACH items (no decimals).');
        }
        if (item) {
          const onHand = Number.isFinite(item.currentStock) ? item.currentStock : 0;
          if (baseQty > onHand + eps) errors.push(`Insufficient stock (on hand: ${onHand}).`);
        }
        // Notes are optional now; do not force entry for Theft/Damage.
      }

      const ok = touched ? errors.length === 0 : false;
      return { ...l, item, qty, inputUnit, baseQty, touched, ok, errors } as any;
    });

    const validLines = lines.filter((l) => l.ok);
    const invalidTouchedLines = lines.filter((l) => l.touched && !l.ok);
    const totalValue = validLines.reduce((sum, l) => {
      const unitCost = l.item && Number.isFinite(l.item.currentCost) ? l.item.currentCost : 0;
      return sum + l.baseQty * unitCost;
    }, 0);

    return {
      lines,
      validLines,
      invalidTouchedLines,
      totalValue,
      canConfirm: validLines.length > 0 && invalidTouchedLines.length === 0,
    };
  }, [draftLines, stockItems]);

  const issueGroups = useMemo(() => {
    // Group stock_issue rows that belong to the same RPC batch by createdAt + createdBy
    const all = (issues || []).slice().sort((a, b) => {
      const ta = a.createdAt ?? a.created_at ?? a.date ?? '';
      const tb = b.createdAt ?? b.created_at ?? b.date ?? '';
      return String(tb).localeCompare(String(ta));
    });

    // bucket by key
    const groups = new Map<string, any>();
    for (const r of all) {
      const createdAt = String(r.createdAt ?? r.created_at ?? r.date ?? '');
      const createdById = String(r.createdBy ?? r.created_by ?? '');
      const key = `${createdById}::${createdAt}`;
      if (!groups.has(key)) groups.set(key, { key, createdAt, createdById, lines: [] as any[] });
      groups.get(key).lines.push(r);
    }

    const q = search.trim().toLowerCase();
    const out = Array.from(groups.values()).map((g) => {
      // compute group metadata
      const totalValue = g.lines.reduce((s: number, l: any) => s + Number(l.totalValueLost ?? l.total_value_lost ?? 0), 0);
      const first = g.lines[0];
      return {
        key: g.key,
        createdAt: g.createdAt,
        createdById: g.createdById,
        totalValue,
        lines: g.lines,
        first,
      };
    }).filter((grp) => {
      if (!q) return true;
      // match if any line matches
      return grp.lines.some((it: any) => {
        const item = getStockItemById(it.stockItemId);
        const code = item?.code ?? '';
        const name = item?.name ?? '';
        const date = String(it.createdAt ?? it.created_at ?? it.date ?? '');
        const creatorName = userNameById.get(String(it.createdBy ?? it.created_by ?? '')) ?? String(it.createdBy ?? it.created_by ?? '');
        return (`${code} ${name}`.toLowerCase().includes(q)) || date.toLowerCase().includes(q) || creatorName.toLowerCase().includes(q);
      });
    });

    return out;
  }, [issues, search, userNameById]);

  function resetDialog() {
    setDraftLines([{ id: `dl-${crypto.randomUUID()}`, stockItemId: '', qty: '', inputUnit: undefined, issueType: 'Sale', notes: '' }]);
    setCreatedBy('System');
    setIssueDate(dateKeyLocal(new Date()));
  }

  // Trigger initial load on mount; loading state comes from the store.
  useEffect(() => {
    void ensureStockIssuesLoaded();
  }, []);

  function addLine() {
    setDraftLines((prev) => [...prev, { id: `dl-${crypto.randomUUID()}`, stockItemId: '', qty: '', inputUnit: undefined, issueType: 'Sale', notes: '' }]);
  }

  function removeLine(id: string) {
    setDraftLines((prev) => prev.filter((l) => l.id !== id));
  }

  async function confirmIssue() {
    if (!validated.canConfirm) return;
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    const brandId = getActiveBrandId();
    const payloadLines = validated.validLines.map((l: any) => {
      const unitCost = l.item?.currentCost ?? 0;
      const totalValue = Math.round((Number(l.baseQty ?? 0) * unitCost + Number.EPSILON) * 100) / 100;
      return {
        id: l.id ?? `iss-${crypto.randomUUID()}`,
        stock_item_id: l.stockItemId,
        issue_type: l.issueType,
        qty_issued: l.baseQty,
        unit_cost_at_time: unitCost,
        total_value_lost: totalValue,
        notes: l.notes ?? null,
      };
    });

    setIsSaving(true);
    try {
      if (!currentUserId) {
        toast({ title: 'No active user', description: 'Select an operator before submitting.', variant: 'destructive' });
        return;
      }
      await createStockIssue({
        brandId: brandId,
        date: issueDate,
        createdBy: currentUserId,
        lines: payloadLines,
      } as any);

      toast({ title: 'Stock issued', description: `Saved ${payloadLines.length} issue(s).` });
      setIsAddDialogOpen(false);
      resetDialog();
    } catch (e) {
      const msg = e instanceof StockIssueError ? e.message : (e as Error)?.message ?? 'Failed to create issue.';
      // Specific handling for DB-reported insufficiency (user-friendly toast)
      if (/insufficient stock|insufficient|low stock/i.test(String(msg))) {
        toast({ title: 'Insufficient stock', description: msg, variant: 'destructive' });
      } else if (/42501|permission|forbid|forbidden|403/i.test(String(msg))) {
        toast({
          title: 'Permission denied',
          description: 'Cannot modify stock directly. Ensure the `process_stock_issue` RPC is available and run the debug steps in cd.md.',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Cannot issue stock', description: msg, variant: 'destructive' });
      }
    } finally {
      setIsSaving(false);
      submitLockRef.current = false;
    }
  }

  return (
    <div>
      <PageHeader
        title="Stock Issues"
        description="Record internal stock transfers from Main Store to Categories"
        actions={
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                New Issue
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-auto">
              <DialogHeader>
                <DialogTitle>Create Stock Issue</DialogTitle>
                <DialogDescription>Transfer stock from Main Store to a Category</DialogDescription>
              </DialogHeader>

              {validated.invalidTouchedLines.length ? (
                <div className="p-3 bg-destructive/5 border border-destructive/10 rounded-md mb-2">
                  <p className="text-sm font-medium text-destructive">Fix the following errors before saving:</p>
                  <ul className="mt-2 text-sm text-destructive list-disc list-inside">
                    {validated.invalidTouchedLines.map((ln) => {
                      const idx = draftLines.findIndex(d => d.id === ln.id);
                      return <li key={ln.id}>Line {idx + 1}: {ln.errors?.[0] ?? 'Invalid'}</li>;
                    })}
                  </ul>
                </div>
              ) : null}

              <div className="grid gap-6 py-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="issueDate">Date</Label>
                    <Input
                      id="issueDate"
                      type="date"
                      value={issueDate}
                      onChange={(e) => setIssueDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="createdBy">Created By</Label>
                    <Input
                      id="createdBy"
                      value={createdBy}
                      disabled
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Issue Lines</Label>
                      <p className="text-xs text-muted-foreground">You can add multiple products — each will be saved as its own issue. Notes are optional.</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={addLine}>
                      <Plus className="h-4 w-4 mr-2" /> Add another item
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {draftLines.map((l, idx) => {
                      const item = stockItems.find((s) => s.id === l.stockItemId) ?? null;
                      const qty = Number(l.qty);
                      const qtyNum = Number.isFinite(qty) ? qty : 0;
                      const inputUnit = l.inputUnit ?? (item ? baseUnitLabel(item.unitType) : 'each');
                      const unitOptions = item ? allowedInputUnits(item.unitType, item.itemsPerPack) : ['each'];

                      const validatedLine = validated.lines.find((x) => x.id === l.id) as any;
                      const invalid = Boolean(validatedLine?.touched && !validatedLine?.ok);

                      return (
                        <Card key={l.id} className="bg-muted/30">
                          <CardContent className="p-3 space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-medium">Line {idx + 1}</div>
                              {draftLines.length > 1 ? (
                                <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(l.id)}>
                                  Remove
                                </Button>
                              ) : null}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="space-y-2">
                                <Label>Item</Label>
                                <StockItemPicker
                                  value={l.stockItemId}
                                  onChange={(v) => setDraftLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, stockItemId: v } : x)))}
                                  items={stockItems}
                                  placeholder="Select item"
                                />
                              </div>

                              <div className="space-y-2">
                                <Label>Issue Type</Label>
                                <Select value={l.issueType ?? 'Sale'} onValueChange={(v) => setDraftLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, issueType: v as any } : x)))}>
                                  <SelectTrigger className={cn('h-9 w-full', invalid && 'border-destructive')}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="Sale">Transfer to Sales (ready to sell)</SelectItem>
                                    <SelectItem value="Manufacturing">Transfer to Manufacturing</SelectItem>
                                    <SelectItem value="Wastage">Wastage</SelectItem>
                                    <SelectItem value="Expired">Expired</SelectItem>
                                    <SelectItem value="Staff Meal">Staff Meal</SelectItem>
                                    <SelectItem value="Theft">Theft</SelectItem>
                                    <SelectItem value="Damage">Damage</SelectItem>
                                  </SelectContent>
                                </Select>

                                {isTransferIssueType(l.issueType) ? (
                                  <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800">
                                    <ArrowLeftRight className="h-4 w-4" />
                                    <span>
                                      Transfer: stock will be moved to the Front Office, not deleted.
                                    </span>
                                  </div>
                                ) : isLossIssueType(l.issueType) ? (
                                  <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                                    <AlertTriangle className="h-4 w-4" />
                                    <span>
                                      Loss: this will reduce Main Store stock (not a transfer).
                                    </span>
                                  </div>
                                ) : null}
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                              <div className="space-y-2 sm:col-span-1">
                                <Label>Qty</Label>
                                <Input
                                  type="number"
                                  step={item?.unitType === 'EACH' ? '1' : '0.01'}
                                  min={item?.unitType === 'EACH' ? '1' : '0.01'}
                                  placeholder="0"
                                  value={l.qty}
                                  className={cn(invalid && 'border-destructive')}
                                  onChange={(e) => setDraftLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, qty: e.target.value } : x)))}
                                />
                              </div>

                              <div className="space-y-2">
                                <Label>Unit</Label>
                                <Select value={inputUnit} onValueChange={(v) => setDraftLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, inputUnit: v } : x)))}>
                                  <SelectTrigger className={cn('h-9 w-full', invalid && 'border-destructive')}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {unitOptions.map((u) => (
                                      <SelectItem key={u} value={u}>{u}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="space-y-2 sm:col-span-2">
                                <Label>Notes <span className="text-xs text-muted-foreground">(optional)</span></Label>
                                <Input value={l.notes ?? ''} className={cn(invalid && 'border-destructive')} onChange={(e) => setDraftLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, notes: e.target.value } : x)))} />
                              </div>
                            </div>

                            <div>
                              {item && qtyNum > 0 ? (
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <div className="text-xs text-muted-foreground">Current Stock</div>
                                    <div className="font-medium">{item.currentStock.toFixed(2)} {item.unitType}</div>
                                  </div>
                                  <div>
                                    <div className="text-xs text-muted-foreground">New Stock</div>
                                    <div className="font-medium">{(item.currentStock - (validatedLine?.baseQty ?? 0)).toFixed(2)} {item.unitType}</div>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground">Select item and qty to preview.</div>
                              )}
                            </div>

                            {validatedLine?.touched && validatedLine?.errors?.length ? (
                              <div className="text-xs text-destructive">{validatedLine.errors[0]}</div>
                            ) : null}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>

                  {validated.validLines.length > 0 || validated.invalidTouchedLines.length > 0 ? (
                    <Card className="border-primary">
                      <CardContent className="p-3">
                        <p className="text-sm font-medium mb-2">Issue Summary</p>
                        <div className="flex items-center justify-between text-sm">
                          <span>Valid lines:</span>
                          <span className="font-medium">{validated.validLines.length}</span>
                        </div>
                        {validated.invalidTouchedLines.length ? (
                          <div className="flex items-center justify-between text-sm text-destructive">
                            <span>Lines to fix:</span>
                            <span className="font-medium">{validated.invalidTouchedLines.length}</span>
                          </div>
                        ) : null}
                        <div className="flex items-center justify-between text-sm">
                          <span>Estimated value:</span>
                          <span className="font-medium">{formatMoneyPrecise(validated.totalValue, 2)}</span>
                        </div>
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} disabled={isSaving}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={confirmIssue}
                  disabled={!validated.canConfirm || isSaving || !currentUserId}
                  aria-busy={isSaving}
                  className={cn(
                    'inline-flex items-center gap-2 transition-transform duration-150',
                    isSaving ? 'scale-95 opacity-80 animate-pulse' : 'hover:scale-[1.02]'
                  )}
                >
                  {isSaving ? (
                    <>
                      <span className="inline-block h-4 w-4 mr-2 animate-spin rounded-full border-t-2 border-b-2 border-white/50" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4 mr-2 opacity-90" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v7l4 2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      Confirm Issue
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {/* loading spinner moved below the search (cards area) */}

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search issues..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" disabled>
          <Calendar className="h-4 w-4 mr-2" />
          Date Range
        </Button>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-primary/60 border-opacity-30" />
          </div>
        ) : null}

        {issueGroups.map((grp) => {
          const first = grp.first;
          const item = getStockItemById(first.stockItemId);
          const code = item?.code ?? first.stockItemId;
          const name = item?.name ?? '';
          const date = grp.createdAt ?? first.createdAt ?? first.date ?? '';
          const creatorId = grp.createdById ?? first.createdBy ?? first.created_by ?? '';
          const creator = userNameById.get(String(creatorId)) ?? (String(creatorId) === String(currentUserId) ? currentUserFullName : String(creatorId));
          const issueType = grp.lines.length === 1 ? (first.issueType ?? first.issue_type) : (() => {
            const types = Array.from(new Set(grp.lines.map((l: any) => (l.issueType ?? l.issue_type))));
            return types.length === 1 ? types[0] : 'Multiple';
          })();

          return (
            <Card key={grp.key}>
              <CardContent className="p-0">
                <div className="flex items-center justify-between p-4 border-b bg-muted/30">
                  <div>
                              <div className="flex items-center gap-3">
                                {grp.issueNo ? (
                                  <p className="font-medium text-white">Issue {grp.issueNo}</p>
                                ) : (
                                  <p className="font-medium text-white">{new Date(date).toLocaleString()}</p>
                                )}
                                <span className="inline-flex items-center px-2 py-0.5 rounded bg-primary text-white text-xs font-semibold">{issueType}</span>
                                {grp.lines.length > 1 ? <span className="text-sm text-muted-foreground ml-2">{grp.lines.length} items</span> : null}
                              </div>
                              <p className="text-sm text-white/80">By {creator}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Value</p>
                          <p className="font-medium">{formatMoneyPrecise(Number(grp.totalValue ?? 0), 2)}</p>
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  {grp.lines.map((line: any) => {
                    const liItem = getStockItemById(line.stockItemId);
                    const liCode = liItem?.code ?? line.stockItemId;
                    const liName = liItem?.name ?? '';
                    const liUnit = liItem ? baseUnitLabel(liItem.unitType) : '';
                    return (
                      <div key={line.id} className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                        <div>
                          <div className="text-xs text-muted-foreground">Item</div>
                          <div className="font-medium">{liCode} • {liName}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Qty Issued</div>
                          <div className="font-medium text-right">{Number(line.qtyIssued ?? line.qty_issued ?? 0)} {liUnit}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Unit Cost</div>
                          <div className="font-medium text-right">{formatMoneyPrecise(Number(line.unitCostAtTime ?? line.unit_cost_at_time ?? 0), 2)}</div>
                        </div>
                        <div className="sm:col-span-1">
                          <div className="text-xs text-muted-foreground">Notes</div>
                          <div className="text-sm">{line.notes ?? ''}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {!issueGroups.length && (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">No stock issues found.</CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
