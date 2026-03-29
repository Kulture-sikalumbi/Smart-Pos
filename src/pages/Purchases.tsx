import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { CheckCircle2, Filter, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { PageHeader, DataTableWrapper, NumericCell, StatusBadge } from '@/components/common/PageComponents';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import type { GRV, GRVItem, UnitType } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { getStockItemsSnapshot, subscribeStockItems } from '@/lib/stockStore';
import { getSuppliersSnapshot, refreshSuppliers, subscribeSuppliers } from '@/lib/suppliersStore';
import {
  cancelGRV,
  confirmGRV,
  createDraftGRV,
  deleteGRV,
  forceDeleteGRV,
  getGRVsSnapshot,
  makeGRVItemFromStockItem,
  recomputeLine,
  refreshGRVs,
  subscribeGRVs,
  updateGRV,
} from '@/lib/grvDbStore';

function statusToBadge(status: GRV['status']) {
  if (status === 'confirmed') return { tone: 'positive' as const, label: 'confirmed' };
  if (status === 'cancelled') return { tone: 'negative' as const, label: 'cancelled' };
  return { tone: 'warning' as const, label: 'pending' };
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type GRVLine = GRVItem & {
  /** UI-only: what unit the user is entering the quantity in (converted to base for storage). */
  inputUnit?: string;
  /** UI-only: quantity as entered by user in `inputUnit`. */
  inputQty?: number;
};

function baseUnitLabel(unitType: UnitType): string {
  if (unitType === 'KG') return 'kg';
  if (unitType === 'LTRS') return 'l';
  if (unitType === 'PACK') return 'pack';
  return 'each';
}

function allowedInputUnits(unitType: UnitType, itemsPerPack?: number): string[] {
  if (unitType === 'KG') return ['kg', 'g'];
  if (unitType === 'LTRS') return ['l', 'ml'];
  if (unitType === 'PACK') return itemsPerPack && itemsPerPack > 0 ? ['pack', 'each'] : ['pack'];
  return ['each'];
}

function toBaseQuantity(params: {
  qty: number;
  inputUnit: string;
  unitType: UnitType;
  itemsPerPack?: number;
}): number {
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

  // EACH
  return round2(qty);
}

function computeTotals(items: GRVItem[], applyVat: boolean, vatRate: number) {
  const subtotal = round2(items.reduce((sum, i) => sum + round2(i.quantity * i.unitCost), 0));
  const tax = applyVat ? round2(subtotal * vatRate) : 0;
  const total = round2(subtotal + tax);
  return { subtotal, tax, total };
}

export default function Purchases() {
  const { user, brand, accountUser, hasPermission } = useAuth();
  const { formatMoneyPrecise } = useCurrency();
  const canCreate = hasPermission('createGRV');
  const canConfirm = hasPermission('confirmGRV');

  const [isLoadingGrvs, setIsLoadingGrvs] = useState(false);
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null);

  const grvs = useSyncExternalStore(subscribeGRVs, getGRVsSnapshot);

  const stockItems = useSyncExternalStore(subscribeStockItems, getStockItemsSnapshot);
  const stockById = useMemo(() => new Map(stockItems.map((s) => [String(s.id), s] as const)), [stockItems]);

  const formatQty = (qty: number) => {
    const n = Number(qty ?? 0);
    if (!Number.isFinite(n)) return '0';
    if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return n.toFixed(2);
  };

  const brandId = (user?.brand_id ?? brand?.id ?? '') as string;

  useEffect(() => {
    if (!accountUser) return;
    if (!brandId) return;
    let cancelled = false;
    setIsLoadingGrvs(true);
    void refreshGRVs(brandId)
      .catch((e) => {
        console.error('Failed to load GRVs', e);
        toast({
          title: 'Could not load GRVs',
          description: (e as any)?.message ?? 'Please try again.',
          variant: 'destructive',
        });
      })
      .finally(() => {
        if (!cancelled) setIsLoadingGrvs(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accountUser, brandId]);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | GRV['status']>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return grvs.filter(g => {
      if (statusFilter !== 'all' && g.status !== statusFilter) return false;
      if (!q) return true;
      const hay = [
        g.grvNo,
        g.supplierName,
        g.date,
        ...g.items.map(i => i.itemName),
        ...g.items.map(i => i.itemCode),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [grvs, query, statusFilter]);

  const openNew = () => {
    setActiveId(null);
    setDialogOpen(true);
  };

  const openEdit = (id: string) => {
    setActiveId(id);
    setDialogOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Purchases (GRV)"
        description="Goods Received Vouchers and stock purchases"
        actions={
          <Button onClick={openNew} disabled={!canCreate}>
            <Plus className="h-4 w-4 mr-2" />
            New GRV
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search GRV no, supplier, or items..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={v => setStatusFilter(v as any)}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-4">
        {isLoadingGrvs && grvs.length === 0 && (
          <div className="mthunzi-card p-10 text-center">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <div className="text-sm text-muted-foreground">Loading GRVs…</div>
            </div>
          </div>
        )}

        {filtered.map((grv) => (
          <Card
            key={grv.id}
            onDoubleClick={() => setDeleteArmedId((prev) => (prev === grv.id ? null : grv.id))}
          >
            <CardContent className="p-0">
              <div className="flex items-center justify-between p-4 border-b bg-muted/30">
                <div>
                  <p className="font-medium">{grv.grvNo}</p>
                  <p className="text-sm text-muted-foreground">{grv.date} • {grv.supplierName}</p>
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <StatusBadge status={statusToBadge(grv.status).tone}>{statusToBadge(grv.status).label}</StatusBadge>
                    {grv.status === 'pending' && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => openEdit(grv.id)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit
                        </Button>
                        <Button size="sm" onClick={() => setConfirmId(grv.id)} disabled={!canConfirm}>
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                          Confirm
                        </Button>
                      </>
                    )}

                    {deleteArmedId === grv.id && (
                      <Button size="sm" variant="destructive" onClick={() => setDeleteId(grv.id)}>
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </Button>
                    )}
                  </div>
                  <p className="font-medium mt-2">{formatMoneyPrecise(grv.total, 2)}</p>
                </div>
              </div>
              <DataTableWrapper className="border-0 rounded-none">
                <Table className="data-table">
                  <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit Cost</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {grv.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.itemName}</TableCell>
                          <TableCell className="text-right">
                            {formatQty(item.quantity)} {baseUnitLabel(((stockById.get(item.itemId)?.unitType ?? 'EACH') as UnitType))}
                          </TableCell>
                        <TableCell className="text-right"><NumericCell value={item.unitCost} money /></TableCell>
                        <TableCell className="text-right"><NumericCell value={item.totalCost} money /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </DataTableWrapper>
            </CardContent>
          </Card>
        ))}

        {!isLoadingGrvs && filtered.length === 0 && (
          <div className="mthunzi-card p-10 text-center">
            <div className="text-lg font-semibold">No GRVs found</div>
            <div className="text-sm text-muted-foreground mt-1">Try adjusting your search or filters.</div>
          </div>
        )}
      </div>

      <GRVDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        active={activeId ? grvs.find(g => g.id === activeId) ?? null : null}
        currentUserName={user?.name ?? 'System'}
        brandId={brandId}
      />

      <AlertDialog open={!!confirmId} onOpenChange={open => !open && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm GRV?</AlertDialogTitle>
            <AlertDialogDescription>
              This will lock the GRV to prevent further edits.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirmId) return;
                void confirmGRV(confirmId)
                  .then(() => toast({ title: 'GRV confirmed' }))
                  .catch((e) =>
                    toast({
                      title: 'Confirm failed',
                      description: (e as any)?.message ?? 'Please try again.',
                      variant: 'destructive',
                    })
                  )
                  .finally(() => setConfirmId(null));
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete GRV?</AlertDialogTitle>
            <AlertDialogDescription>
              Pending GRVs will be deleted normally. Confirmed/cancelled GRVs will be force-deleted (dev cleanup) and this will NOT roll back stock quantities/costs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!deleteId) return;
                const target = grvs.find((g) => g.id === deleteId) ?? null;
                const op = target?.status === 'pending' ? deleteGRV(deleteId) : forceDeleteGRV(deleteId);

                void op
                  .then(() => toast({ title: 'GRV deleted' }))
                  .catch((e) =>
                    toast({
                      title: 'Delete failed',
                      description: (e as any)?.message ?? 'Please try again.',
                      variant: 'destructive',
                    })
                  )
                  .finally(() => setDeleteId(null));
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GRVDialog({
  open,
  onOpenChange,
  active,
  currentUserName,
  brandId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  active: GRV | null;
  currentUserName: string;
  brandId: string;
}) {
  const { formatMoneyPrecise } = useCurrency();
  const defaults = useMemo(() => {
    return {
      supplierId: '',
      supplierName: '',
      paymentType: 'account' as const,
      receivedBy: currentUserName || 'System',
    };
  }, [currentUserName]);

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [supplierId, setSupplierId] = useState(defaults.supplierId);
  const [supplierName, setSupplierName] = useState(defaults.supplierName);
  const [paymentType, setPaymentType] = useState<GRV['paymentType']>(defaults.paymentType);
  const [receivedBy, setReceivedBy] = useState(defaults.receivedBy);
  const [applyVat, setApplyVat] = useState(true);
  const vatRate = 0.16;
  const [items, setItems] = useState<GRVLine[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const [itemOpen, setItemOpen] = useState(false);
  const [itemQuery, setItemQuery] = useState('');

  const stockItems = useSyncExternalStore(subscribeStockItems, getStockItemsSnapshot);

  const stockById = useMemo(() => {
    return new Map(stockItems.map((s) => [String(s.id), s] as const));
  }, [stockItems]);

  const locked = active ? active.status !== 'pending' : false;

  useEffect(() => {
    if (!open) return;

    if (active) {
      setDate(active.date);
      setSupplierId(active.supplierId);
      setSupplierName(active.supplierName);
      setPaymentType(active.paymentType);
      setReceivedBy(active.receivedBy || currentUserName);
      setItems(
        active.items.map((it) => {
          const base = stockById.get(it.itemId)?.unitType ?? ('EACH' as UnitType);
          const baseUnit = baseUnitLabel(base);
          return {
            ...recomputeLine(it),
            inputUnit: baseUnit,
            inputQty: Number(it.quantity ?? 0),
          };
        })
      );
      setApplyVat(true);
      setItemQuery('');
      return;
    }

    setDate(new Date().toISOString().slice(0, 10));
    setSupplierId(defaults.supplierId);
    setSupplierName(defaults.supplierName);
    setPaymentType(defaults.paymentType);
    setReceivedBy(defaults.receivedBy);
    setItems([]);
    setApplyVat(true);
    setItemQuery('');
  }, [open, active, defaults, currentUserName]);

  const suppliersSnap = useSyncExternalStore(subscribeSuppliers, getSuppliersSnapshot, getSuppliersSnapshot);

  useEffect(() => {
    if (!open) return;
    void refreshSuppliers().catch(() => {});
  }, [open]);

  const supplierOptions = useMemo(() => {
    return (suppliersSnap.suppliers ?? []).map((s) => ({
      id: String(s.id),
      name: String(s.name),
      code: s.code ? String(s.code) : undefined,
    }));
  }, [suppliersSnap.suppliers]);

  const filteredStockItems = useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    if (!q) return stockItems;
    return stockItems.filter(s => `${s.code} ${s.name}`.toLowerCase().includes(q));
  }, [itemQuery, stockItems]);

  const totals = useMemo(() => computeTotals(items, applyVat, vatRate), [items, applyVat, vatRate]);

  const addStockItem = (stockItemId: string) => {
    const newItem = makeGRVItemFromStockItem(stockItemId);
    if (!newItem) return;

    const base = stockById.get(stockItemId)?.unitType ?? ('EACH' as UnitType);
    const baseUnit = baseUnitLabel(base);
    const withUi: GRVLine = { ...newItem, inputUnit: baseUnit, inputQty: 1 };

    setItems(prev => {
      const existing = prev.find(p => p.itemId === newItem.itemId);
      if (!existing) return [...prev, withUi];
      // Add 1 in base unit.
      const baseType = stockById.get(newItem.itemId)?.unitType ?? ('EACH' as UnitType);
      const incBase = toBaseQuantity({ qty: 1, inputUnit: baseUnitLabel(baseType), unitType: baseType, itemsPerPack: stockById.get(newItem.itemId)?.itemsPerPack });
      return prev.map(p =>
        p.itemId === newItem.itemId
          ? ({
              ...recomputeLine({ ...p, quantity: (p.quantity ?? 0) + incBase }),
              inputUnit: (p as any).inputUnit ?? baseUnitLabel(baseType),
              inputQty: ((p as any).inputQty ?? p.quantity ?? 0) + 1,
            } as any)
          : p
      );
    });
  };

  const updateLine = (id: string, patch: Partial<Pick<GRVLine, 'quantity' | 'unitCost' | 'inputQty' | 'inputUnit'>>) => {
    setItems(prev => prev.map(p => (p.id === id ? (recomputeLine({ ...p, ...patch } as any) as any) : p)));
  };

  const removeLine = (id: string) => {
    setItems(prev => prev.filter(p => p.id !== id));
  };

  const hasSupplier = Boolean(supplierId) || Boolean(supplierName.trim());
  const hasValidLines = items.length > 0 && items.every((i) => Number(i.quantity ?? 0) > 0 && Number(i.unitCost ?? 0) >= 0);
  const canSave = !locked && hasSupplier && date && hasValidLines && !isSaving;

  const validateBeforeSave = () => {
    if (!date || isNaN(new Date(date).getTime())) return 'Please provide a valid date.';
    if (!hasSupplier) return 'Please select or enter a supplier.';
    if (!items.length) return 'Add at least one item to the GRV.';
    for (const i of items) {
      if (!(Number(i.quantity) > 0)) return `Item ${i.itemName} has invalid quantity.`;
      if (!(Number(i.unitCost) >= 0)) return `Item ${i.itemName} has invalid unit cost.`;
    }
    if (!receivedBy || !String(receivedBy).trim()) return 'Please enter who received these items.';
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[980px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{active ? `GRV ${active.grvNo}` : 'New GRV'}</DialogTitle>
          <DialogDescription>
            Record items received from a supplier. Totals update automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="grid gap-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="grv-date">Date</Label>
              <Input id="grv-date" type="date" value={date} onChange={e => setDate(e.target.value)} disabled={locked} />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Supplier</Label>
              <Select
                value={supplierId}
                onValueChange={v => {
                  if (v === '__custom__') {
                    setSupplierId('');
                    if (!supplierName || supplierName === 'Supplier') setSupplierName('');
                    return;
                  }

                  setSupplierId(v);
                  const found = supplierOptions.find(s => s.id === v);
                  setSupplierName(found?.name ?? supplierName);
                }}
                disabled={locked}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__custom__">Custom supplier…</SelectItem>
                  {supplierOptions.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.code ? `${s.name} (${s.code})` : s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="mt-2">
                <Input
                  value={supplierName}
                  onChange={(e) => {
                    setSupplierName(e.target.value);
                    if (e.target.value.trim()) setSupplierId('');
                  }}
                  placeholder="Or type supplier name"
                  disabled={locked}
                />
              </div>
            </div>

            <div className="space-y-2 md:col-span-1">
              <Label>Payment</Label>
              <Select value={paymentType} onValueChange={v => setPaymentType(v as any)} disabled={locked}>
                <SelectTrigger>
                  <SelectValue placeholder="Payment type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="account">Account</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="received-by">Received By</Label>
              <Input
                id="received-by"
                value={receivedBy}
                onChange={e => setReceivedBy(e.target.value)}
                placeholder="Name"
                disabled={locked}
              />
            </div>
          </div>

          <div className="mthunzi-card p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div>
                <div className="font-semibold">Items</div>
                <div className="text-sm text-muted-foreground">Search and add stock items, then adjust quantity and cost.</div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Switch checked={applyVat} onCheckedChange={setApplyVat} disabled={locked} />
                  <div className="text-sm">VAT (16%)</div>
                </div>

                <Popover open={itemOpen} onOpenChange={setItemOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" disabled={locked}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Item
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[420px] p-0" align="end">
                    <Command>
                      <CommandInput placeholder="Type to search stock items..." value={itemQuery} onValueChange={setItemQuery} />
                      <CommandList>
                        <CommandEmpty>No items found.</CommandEmpty>
                        <CommandGroup>
                          {filteredStockItems.slice(0, 100).map(s => (
                            <CommandItem
                              key={s.id}
                              value={`${s.code} ${s.name}`}
                              onSelect={() => {
                                addStockItem(s.id);
                                setItemOpen(false);
                                setItemQuery('');
                              }}
                            >
                              <div className="flex w-full items-center justify-between gap-3">
                                <div>
                                  <div className="font-medium">{s.name}</div>
                                  <div className="text-xs text-muted-foreground font-mono">{s.code} • Stock {s.currentStock} {s.unitType}</div>
                                </div>
                                <div className="text-xs font-mono text-muted-foreground">{formatMoneyPrecise(s.currentCost, 2)}</div>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <DataTableWrapper className="border-0 bg-transparent shadow-none">
              <Table className="data-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="w-[220px] text-right">Received Qty</TableHead>
                    <TableHead className="w-[200px] text-right">Unit Cost</TableHead>
                    <TableHead className="w-[160px] text-right">Total</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(i => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <div className="font-medium">{i.itemName}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {i.itemCode}
                          {stockById.get(i.itemId)?.unitType ? ` • ${stockById.get(i.itemId)!.unitType}` : ''}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {(() => {
                          const si = stockById.get(i.itemId);
                          const unitType = (si?.unitType ?? 'EACH') as UnitType;
                          const opts = allowedInputUnits(unitType, si?.itemsPerPack);
                          const baseUnit = baseUnitLabel(unitType);
                          const inputUnit = String((i as any).inputUnit ?? baseUnit).toLowerCase();
                          const inputQty = Number.isFinite((i as any).inputQty) ? Number((i as any).inputQty) : Number(i.quantity ?? 0);

                          return (
                            <>
                              <div className="flex items-center justify-end gap-2">
                                <Input
                                  type="number"
                                  step="0.01"
                                  className="text-right"
                                  value={Number.isFinite(inputQty) ? String(inputQty) : ''}
                                  onChange={(e) => {
                                    const nextQty = Number(e.target.value);
                                    const baseQty = toBaseQuantity({
                                      qty: nextQty,
                                      inputUnit,
                                      unitType,
                                      itemsPerPack: si?.itemsPerPack,
                                    });
                                    updateLine(i.id, { inputQty: nextQty, inputUnit, quantity: baseQty });
                                  }}
                                  disabled={locked}
                                />

                                <Select
                                  value={opts.includes(inputUnit) ? inputUnit : baseUnit}
                                  onValueChange={(v) => {
                                    const nextUnit = String(v).toLowerCase();
                                    const baseQty = toBaseQuantity({
                                      qty: inputQty,
                                      inputUnit: nextUnit,
                                      unitType,
                                      itemsPerPack: si?.itemsPerPack,
                                    });
                                    updateLine(i.id, { inputUnit: nextUnit, inputQty, quantity: baseQty });
                                  }}
                                  disabled={locked}
                                >
                                  <SelectTrigger className="w-[110px]">
                                    <SelectValue placeholder={baseUnit} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {opts.map((u) => (
                                      <SelectItem key={u} value={u}>
                                        {u}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="text-[11px] text-muted-foreground mt-1">
                                Stored in {baseUnit} {unitType === 'PACK' && si?.itemsPerPack ? `(${si.itemsPerPack} each/pack)` : ''}. We convert automatically.
                              </div>
                            </>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.01"
                          className="text-right"
                          value={String(i.unitCost)}
                          onChange={e => updateLine(i.id, { unitCost: Number(e.target.value) })}
                          disabled={locked}
                        />
                        <div className="text-[11px] text-muted-foreground mt-1">
                          Cost per {(baseUnitLabel((stockById.get(i.itemId)?.unitType ?? 'EACH') as UnitType))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <NumericCell value={round2(i.quantity * i.unitCost)} money />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeLine(i.id)}
                          disabled={locked}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}

                  {items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                        Add items to start a GRV.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </DataTableWrapper>

            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mt-4">
              <div className="text-sm text-muted-foreground">
                {active?.status === 'confirmed' && 'This GRV is confirmed and locked.'}
                {active?.status === 'cancelled' && 'This GRV is cancelled and locked.'}
              </div>

              <div className="w-full sm:w-[340px] space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-mono">{formatMoneyPrecise(totals.subtotal, 2)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span className="font-mono">{formatMoneyPrecise(totals.tax, 2)}</span>
                </div>
                <div className="flex items-center justify-between text-base font-semibold">
                  <span>Total</span>
                  <span className="font-mono">{formatMoneyPrecise(totals.total, 2)}</span>
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>

        <DialogFooter className="pt-2">
          {active?.status === 'pending' && (
            <Button
              variant="outline"
              onClick={() => {
                void cancelGRV(active.id)
                  .then(() => toast({ title: 'GRV cancelled' }))
                  .catch((e) =>
                    toast({
                      title: 'Cancel failed',
                      description: (e as any)?.message ?? 'Please try again.',
                      variant: 'destructive',
                    })
                  )
                  .finally(() => onOpenChange(false));
              }}
            >
              Cancel GRV
            </Button>
          )}

          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={!canSave}
            onClick={async () => {
              const validationError = validateBeforeSave();
              if (validationError) {
                toast({ title: 'Validation', description: validationError, variant: 'destructive' });
                return;
              }

              const safeItems = items.map(recomputeLine);

              if (!brandId) {
                toast({ title: 'No brand selected', variant: 'destructive' });
                return;
              }

              setIsSaving(true);
              try {
                if (active) {
                  await updateGRV(active.id, {
                    brandId,
                    date,
                    supplierId,
                    supplierName,
                    paymentType,
                    receivedBy,
                    items: safeItems,
                    applyVat,
                    vatRate,
                  });
                  toast({ title: 'GRV saved' });
                } else {
                  await createDraftGRV({
                    brandId,
                    date,
                    supplierId,
                    supplierName,
                    paymentType,
                    receivedBy,
                    items: safeItems,
                    applyVat,
                    vatRate,
                  });
                  toast({ title: 'Draft GRV created' });
                }
                onOpenChange(false);
              } catch (e) {
                toast({ title: active ? 'Save failed' : 'Create failed', description: (e as any)?.message ?? 'Please try again.', variant: 'destructive' });
              } finally {
                setIsSaving(false);
              }
            }}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
