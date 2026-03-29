import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Filter, Download, FileSpreadsheet, FileText, Share2, MessageCircle, Bluetooth, Radar } from 'lucide-react';
import { PageHeader, DataTableWrapper, NumericCell, StatusBadge } from '@/components/common/PageComponents';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { v4 as uuidv4 } from 'uuid';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { StockItem, DepartmentId, UnitType } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { subscribeStockItems, getStockItemsSnapshot } from '@/lib/stockStore';
import { getCategoriesSnapshot, refreshCategories, subscribeCategories } from '@/lib/categoriesStore';
import { getSuppliersSnapshot, refreshSuppliers, subscribeSuppliers } from '@/lib/suppliersStore';
export default function StockItems() {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [isEditSaving, setIsEditSaving] = useState(false);
  const stockItems = useSyncExternalStore(subscribeStockItems, getStockItemsSnapshot);
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDept, setSelectedDept] = useState<string>('all');
  const [selectedSupplier, setSelectedSupplier] = useState<string>('all');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    code: '',
    name: '',
    departmentId: '',
    unitType: '',
    lowestCost: '',
    highestCost: '',
    currentCost: '',
    currentStock: '',
    reorderLevel: '',
    itemsPerPack: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  const categoriesSnap = useSyncExternalStore(subscribeCategories, getCategoriesSnapshot, getCategoriesSnapshot);
  const suppliersSnap = useSyncExternalStore(subscribeSuppliers, getSuppliersSnapshot, getSuppliersSnapshot);
  const departmentsList = categoriesSnap.categories;
  const suppliersList = suppliersSnap.suppliers;

  const suppliersById = useMemo(() => {
    return new Map((suppliersList ?? []).map((s) => [String(s.id), s] as const));
  }, [suppliersList]);

  const { hasPermission, brand, user } = useAuth();
  const activeBrandId = String((brand as any)?.id ?? (user as any)?.brand_id ?? '');

  const formatSupabaseError = (err: unknown) => {
    const anyErr = err as any;
    const message =
      anyErr?.message ||
      anyErr?.error_description ||
      anyErr?.details ||
      (typeof anyErr === 'string' ? anyErr : 'Unknown error');
    const details = anyErr?.details;
    const hint = anyErr?.hint;
    const code = anyErr?.code;

    const combined = [message, details, hint].filter(Boolean).join(' — ');
    return code ? `${combined} (code: ${code})` : combined;
  };

  const formatStockItemMutationError = (err: unknown) => {
    const msg = formatSupabaseError(err);
    const lower = msg.toLowerCase();

    if (lower.includes('items_per_pack') && (lower.includes('does not exist') || lower.includes('column'))) {
      return (
        'Your database is missing the `stock_items.items_per_pack` column, but the app is trying to use PACK support. ' +
        'Apply migration 020_stock_items_pack_size.sql in Supabase, or avoid PACK unit for now.\n\n' +
        msg
      );
    }

    // FK delete restriction often surfaces as "violates foreign key constraint".
    if (
      lower.includes('foreign key') ||
      lower.includes('violates') ||
      lower.includes('still referenced') ||
      lower.includes('constraint')
    ) {
      return (
        'Cannot delete this stock item because it is referenced by existing records (e.g. GRVs, recipes, ledger). ' +
        'Create a new item and stop using this one, or implement an archive/deactivate option.\n\n' +
        msg
      );
    }

    if (lower.includes('row-level security') || lower.includes('rls') || lower.includes('permission') || lower.includes('not allowed')) {
      return (
        'Permission denied by database policy (RLS). Check your role/brand access for stock settings.\n\n' +
        msg
      );
    }

    return msg;
  };

  // Initialize filters from URL (deep-link support)
  useEffect(() => {
    const q = searchParams.get('q');
    const dept = searchParams.get('dept');
    const supplier = searchParams.get('supplier');

    if (q) setSearchTerm(q);
    if (dept) setSelectedDept(dept);
    if (supplier) setSelectedSupplier(supplier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Best-effort refresh of reference data on entry.
  useEffect(() => {
    void refreshCategories().catch(() => {});
    void refreshSuppliers().catch(() => {});
  }, []);

  // Keep URL in sync (debounced) so you can share/bookmark filtered views
  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);

      const q = searchTerm.trim();
      if (q) next.set('q', q);
      else next.delete('q');

      if (selectedDept !== 'all') next.set('dept', selectedDept);
      else next.delete('dept');

      if (selectedSupplier !== 'all') next.set('supplier', selectedSupplier);
      else next.delete('supplier');

      setSearchParams(next, { replace: true });
    }, 250);

    return () => window.clearTimeout(t);
  }, [searchParams, searchTerm, selectedDept, selectedSupplier, setSearchParams]);

  function getDepartmentName(deptId: DepartmentId) {
    return departmentsList.find(d => d.id === deptId)?.name || (deptId ?? 'Unassigned');
  }

  const filteredItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return stockItems.filter((item) => {
      const matchesSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.code.toLowerCase().includes(q);
      const matchesDept = selectedDept === 'all' || item.departmentId === selectedDept;
      const matchesSupplier =
        selectedSupplier === 'all' ||
        (selectedSupplier === 'none' ? !item.supplierId : String(item.supplierId ?? '') === selectedSupplier);
      return matchesSearch && matchesDept && matchesSupplier;
    });
  }, [stockItems, searchTerm, selectedDept, selectedSupplier]);

  const exportRows = useMemo(() => {
    return filteredItems.map(item => {
      const stockValue = item.currentStock * item.currentCost;
      const supplierName = item.supplierId ? suppliersById.get(String(item.supplierId))?.name ?? 'Unknown' : 'Unassigned';
      return {
        code: item.code,
        name: item.name,
        department: getDepartmentName(item.departmentId),
        supplier: supplierName,
        unit: item.unitType,
        lowest: item.lowestCost,
        highest: item.highestCost,
        current: item.currentCost,
        stock: item.currentStock,
        value: stockValue,
      };
    });
  }, [filteredItems, suppliersById]);

  const fileBase = useMemo(() => {
    const date = new Date().toISOString().slice(0, 10);
    const dept = selectedDept === 'all' ? 'all' : selectedDept;
    const supplierKey =
      selectedSupplier === 'all'
        ? 'all-suppliers'
        : selectedSupplier === 'none'
          ? 'unassigned'
          : suppliersById.get(String(selectedSupplier))?.code ?? `sup-${selectedSupplier}`;
    return `stock-items_${dept}_${supplierKey}_${date}`;
  }, [selectedDept, selectedSupplier, suppliersById]);

  const downloadBlob = (filename: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const toCsv = () => {
    const headers = ['Code', 'Name', 'Category', 'Supplier', 'Unit', 'Lowest Cost', 'Highest Cost', 'Current Price', 'Stock Level', 'Value'];
    const lines = exportRows.map(r => [
      r.code,
      r.name,
      r.department,
      r.supplier,
      r.unit,
      r.lowest.toFixed(2),
      r.highest.toFixed(2),
      r.current.toFixed(2),
      r.stock.toFixed(2),
      r.value.toFixed(2),
    ]);

    const esc = (v: string) => {
      const s = String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const csv = [headers, ...lines].map(row => row.map(esc).join(',')).join('\n');
    return new Blob([csv], { type: 'text/csv;charset=utf-8' });
  };

  const toWordDoc = () => {
    const rowsHtml = exportRows
      .map(r => {
        const cells = [
          r.code,
          r.name,
          r.department,
          r.supplier,
          r.unit,
          r.lowest.toFixed(2),
          r.highest.toFixed(2),
          r.current.toFixed(2),
          r.stock.toFixed(2),
          r.value.toFixed(2),
        ]
          .map(v => `<td style="border:1px solid #ddd;padding:6px;">${String(v).replace(/</g, '&lt;')}</td>`)
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');

    const html = `<!doctype html><html><head><meta charset="utf-8" />
      <title>Stock Items</title></head><body>
      <h2 style="font-family:Arial;">Stock Items</h2>
      <div style="font-family:Arial;color:#444;margin-bottom:8px;">Exported: ${new Date().toLocaleString()}</div>
      <table style="border-collapse:collapse;font-family:Arial;font-size:12px;">
        <thead><tr>
          <th style="border:1px solid #ddd;padding:6px;background:#f3f4f6;">Code</th>
          <th style="border:1px solid #ddd;padding:6px;background:#f3f4f6;">Name</th>
          <th style="border:1px solid #ddd;padding:6px;background:#f3f4f6;">Category</th>
          <th style="border:1px solid #ddd;padding:6px;background:#f3f4f6;">Supplier</th>
          <th style="border:1px solid #ddd;padding:6px;background:#f3f4f6;">Unit</th>
          <th style="border:1px solid #ddd;padding:6px;background:#f3f4f6;">Lowest Cost</th>
          <th style="border:1px solid #ddd;padding:6px;background:#f3f4f6;">Highest Cost</th>
          <th style="border:1px solid #ddd;padding:6px;background:#f3f4f6;">Current Price</th>
          <th style="border:1px solid #ddd;padding:6px;background:#f3f4f6;">Stock Level</th>
          <th style="border:1px solid #ddd;padding:6px;background:#f3f4f6;">Value</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </body></html>`;

    return new Blob([html], { type: 'application/msword;charset=utf-8' });
  };

  const shareFile = async (file: File, opts?: { title?: string; text?: string }) => {
    const navAny = navigator as any;
    const canShare = typeof navAny?.canShare === 'function' ? navAny.canShare({ files: [file] }) : false;

    if (!navigator.share || !canShare) {
      toast({
        title: 'Sharing not supported',
        description: 'Your browser/device does not support sharing files. Download will start instead.',
      });
      downloadBlob(file.name, file);
      return;
    }

    try {
      await navigator.share({
        title: opts?.title ?? 'Export',
        text: opts?.text,
        files: [file],
      });
    } catch {
      // user cancelled or share failed
    }
  };

  const getStockStatus = (item: StockItem) => {
    if (item.reorderLevel && item.currentStock <= item.reorderLevel) {
      return { status: 'negative' as const, label: 'Low Stock' };
    }
    if (item.currentStock <= 0) {
      return { status: 'negative' as const, label: 'Out of Stock' };
    }
    return { status: 'positive' as const, label: 'In Stock' };
  };

  const mapUnitTypeToUnit = (u: UnitType | undefined): string => {
    switch (u) {
      case 'KG': return 'kg';
      case 'LTRS': return 'l';
      case 'PACK': return 'pack';
      case 'EACH':
      default:
        return 'each';
    }
  };

  const formatNumberTrim = (n: number) => {
    if (!isFinite(n)) return '0';
    // show up to 2 decimals but trim trailing zeros and the dot if unnecessary
    const s = n.toFixed(2);
    return s.replace(/\.00$/, '').replace(/(\.[0-9])0$/, '$1');
  };

  const formatStockLevel = (n: number, ut: UnitType, itemsPerPack?: number) => {
    if (ut === 'PACK') {
      const per = Number(itemsPerPack);
      if (isFinite(per) && per > 0) {
        return `${formatNumberTrim(n / per)} ${mapUnitTypeToUnit(ut)}`;
      }
    }

    return `${formatNumberTrim(n)} ${mapUnitTypeToUnit(ut)}`;
  };

  return (
    <div>
      <PageHeader
        title="Stock Items"
        description="Manage your inventory items, costs, and stock levels"
        actions={
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Add New Stock Item</DialogTitle>
                <DialogDescription>
                  Create a new inventory item with pricing and stock details.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="code">Item Code</Label>
                    <Input id="code" placeholder="e.g., 501" value={addForm.code} onChange={e => setAddForm(f => ({ ...f, code: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name">Item Name</Label>
                    <Input id="name" placeholder="e.g., Flour" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="department">Department</Label>
                    <Select value={addForm.departmentId} onValueChange={val => setAddForm(f => ({ ...f, departmentId: val }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select department" />
                      </SelectTrigger>
                      <SelectContent>
                        {departmentsList.map((dept) => (
                            <SelectItem key={dept.id} value={dept.id}>
                              {dept.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="unit">Unit</Label>
                    <Select value={addForm.unitType} onValueChange={val => setAddForm(f => ({ ...f, unitType: val }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select unit" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="KG">KG</SelectItem>
                        <SelectItem value="LTRS">LTRS</SelectItem>
                        <SelectItem value="EACH">EACH</SelectItem>
                        <SelectItem value="PACK">PACK</SelectItem>
                        <SelectItem value="g">g</SelectItem>
                        <SelectItem value="ml">ml</SelectItem>
                      </SelectContent>
                    </Select>
                        <div className="text-sm text-muted-foreground mt-1">If you enter grams (<strong>g</strong>) or milliliters (<strong>ml</strong>), values will be converted to kg / l on save (for example: <strong>500 g → 0.5 KG</strong>).</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="lowest">Lowest Cost</Label>
                    <Input id="lowest" type="number" step="0.01" value={addForm.lowestCost} onChange={e => setAddForm(f => ({ ...f, lowestCost: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="highest">Highest Cost</Label>
                    <Input id="highest" type="number" step="0.01" value={addForm.highestCost} onChange={e => setAddForm(f => ({ ...f, highestCost: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="current">Current Cost</Label>
                    <Input id="current" type="number" step="0.01" value={addForm.currentCost} onChange={e => setAddForm(f => ({ ...f, currentCost: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    {/* Dynamic label/placeholder based on unitType */}
                    {(() => {
                      const raw = String(addForm.unitType || '').trim();
                      const norm = raw.toLowerCase();
                      const displayUnit = (() => {
                        if (norm === 'g') return 'g';
                        if (norm === 'ml') return 'ml';
                        if (['l', 'ltr', 'ltrs'].includes(norm)) return 'L';
                        if (norm === 'kg') return 'KG';
                        if (norm === 'pack') return 'Packs';
                        if (norm === 'each' || !norm) return 'Units';
                        return raw;
                      })();

                      if (displayUnit === 'KG' || displayUnit === 'L') {
                        return (
                          <>
                            <Label htmlFor="stock">Current Stock (Total {displayUnit})</Label>
                            <Input id="stock" type="number" step="0.01" value={addForm.currentStock} onChange={e => setAddForm(f => ({ ...f, currentStock: e.target.value }))} />
                          </>
                        );
                      }

                      if (displayUnit === 'Packs') {
                        return (
                          <>
                            <Label htmlFor="stock">Number of Packs</Label>
                            <Input id="stock" type="number" step="1" value={addForm.currentStock} onChange={e => setAddForm(f => ({ ...f, currentStock: e.target.value }))} />
                          </>
                        );
                      }

                      // grams, ml, each, or other textual units
                      return (
                        <>
                          <Label htmlFor="stock">Current Stock (Total {displayUnit})</Label>
                          <Input id="stock" type="number" step="1" value={addForm.currentStock} onChange={e => setAddForm(f => ({ ...f, currentStock: e.target.value }))} />
                        </>
                      );
                    })()}
                  </div>
                  <div className="space-y-2">
                    {(() => {
                      const raw = String(addForm.unitType || '').trim();
                      const norm = raw.toLowerCase();
                      const displayUnit = (() => {
                        if (norm === 'g') return 'g';
                        if (norm === 'ml') return 'ml';
                        if (['l', 'ltr', 'ltrs'].includes(norm)) return 'L';
                        if (norm === 'kg') return 'KG';
                        if (norm === 'pack') return 'Packs';
                        if (norm === 'each' || !norm) return 'Units';
                        return raw;
                      })();

                      if (displayUnit === 'KG' || displayUnit === 'L') {
                        return (
                          <>
                            <Label htmlFor="reorder">Reorder Level (Total {displayUnit})</Label>
                            <Input id="reorder" type="number" step="0.01" value={addForm.reorderLevel} onChange={e => setAddForm(f => ({ ...f, reorderLevel: e.target.value }))} />
                          </>
                        );
                      }

                      if (displayUnit === 'Packs') {
                        return (
                          <>
                            <Label htmlFor="reorder">Reorder Level (Packs)</Label>
                            <Input id="reorder" type="number" step="1" value={addForm.reorderLevel} onChange={e => setAddForm(f => ({ ...f, reorderLevel: e.target.value }))} />
                          </>
                        );
                      }

                      return (
                        <>
                          <Label htmlFor="reorder">Reorder Level (Total {displayUnit})</Label>
                          <Input id="reorder" type="number" step={displayUnit === 'g' || displayUnit === 'ml' ? '1' : '1'} value={addForm.reorderLevel} onChange={e => setAddForm(f => ({ ...f, reorderLevel: e.target.value }))} />
                        </>
                      );
                    })()}
                  </div>
                </div>
                {/* Items per Pack and calculation summary for PACK */}
                {String(addForm.unitType || '').toUpperCase() === 'PACK' ? (
                  <div className="space-y-2">
                    <Label htmlFor="itemsPerPack">Items per Pack</Label>
                    <Input id="itemsPerPack" type="number" step="1" value={addForm.itemsPerPack} onChange={e => setAddForm(f => ({ ...f, itemsPerPack: e.target.value }))} />
                    <div className="text-sm text-muted-foreground">Calculation Summary:</div>
                    <div className="rounded-md border p-2 bg-background text-sm">System will record: <strong>{addForm.currentStock || 0}</strong> × <strong>{addForm.itemsPerPack || 0}</strong> = <strong>{(parseFloat(addForm.currentStock || '0') * parseFloat(addForm.itemsPerPack || '0')) || 0}</strong> EACH</div>
                  </div>
                ) : null}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} disabled={isSaving}>
                  Cancel
                </Button>
                <Button
                  onClick={async () => {
                    setIsSaving(true);
                    const { code, name, departmentId, unitType, lowestCost, highestCost, currentCost, currentStock, reorderLevel, itemsPerPack } = addForm;
                    if (!code || !name || !departmentId || !unitType) {
                      toast({ title: 'Missing fields', description: 'Please fill all required fields.' });
                      setIsSaving(false);
                      return;
                    }

                    // For PACK: itemsPerPack is required and we store total units in DB
                    const selectedRawUnit = String(unitType || '').trim();
                    const selectedLower = selectedRawUnit.toLowerCase();
                    const ut = String(unitType || '').toUpperCase();
                    if (ut === 'PACK' && (!itemsPerPack || Number(itemsPerPack) <= 0)) {
                      toast({ title: 'Missing field', description: 'Please enter Items per Pack.' });
                      setIsSaving(false);
                      return;
                    }

                    // Compute the DB values from UI inputs
                    let dbCurrentStock = 0;
                    let dbReorder = undefined as number | undefined;
                    const rawCurrent = parseFloat(currentStock || '0');
                    const rawReorder = parseFloat(reorderLevel || '0');

                    if (ut === 'PACK') {
                      const perPack = parseFloat(itemsPerPack || '0');
                      dbCurrentStock = (isFinite(rawCurrent) ? rawCurrent : 0) * (isFinite(perPack) ? perPack : 0);
                      dbReorder = isFinite(rawReorder) ? rawReorder * (isFinite(perPack) ? perPack : 0) : undefined;
                    } else if (selectedLower === 'g') {
                      // User entered grams; convert to KG base unit
                      dbCurrentStock = isFinite(rawCurrent) ? rawCurrent / 1000.0 : 0;
                      dbReorder = isFinite(rawReorder) ? rawReorder / 1000.0 : undefined;
                    } else if (selectedLower === 'ml') {
                      // User entered milliliters; convert to LTRS base unit
                      dbCurrentStock = isFinite(rawCurrent) ? rawCurrent / 1000.0 : 0;
                      dbReorder = isFinite(rawReorder) ? rawReorder / 1000.0 : undefined;
                    } else if (ut === 'KG' || ut === 'LTRS') {
                      dbCurrentStock = isFinite(rawCurrent) ? rawCurrent : 0; // allow decimals
                      dbReorder = isFinite(rawReorder) ? rawReorder : undefined;
                    } else {
                      // EACH and default: store integer units
                      dbCurrentStock = Math.round(isFinite(rawCurrent) ? rawCurrent : 0);
                      dbReorder = isFinite(rawReorder) ? Math.round(rawReorder) : undefined;
                    }

                    const mapPreciseToUnitType = (u?: string) => {
                      const uu = String(u ?? '').toLowerCase();
                      if (uu === 'g' || uu === 'kg') return 'KG' as UnitType;
                      if (uu === 'ml' || uu === 'l' || uu === 'ltr' || uu === 'ltrs') return 'LTRS' as UnitType;
                      if (uu === 'pack') return 'PACK' as UnitType;
                      return 'EACH' as UnitType;
                    };

                    const finalUnitType = mapPreciseToUnitType(addForm.unitType);

                    const newItem: StockItem = {
                      id: uuidv4(),
                      code,
                      name,
                      departmentId: departmentId as DepartmentId,
                      unitType: finalUnitType,
                      itemsPerPack: ut === 'PACK' ? (Number(itemsPerPack) > 0 ? Number(itemsPerPack) : undefined) : undefined,
                      lowestCost: parseFloat(lowestCost) || 0,
                      highestCost: parseFloat(highestCost) || 0,
                      currentCost: parseFloat(currentCost) || 0,
                      currentStock: dbCurrentStock,
                      reorderLevel: dbReorder,
                    };
                    try {
                      const { addStockItem } = await import('@/lib/stockStore');
                      // Attach precise textual unit (e.g., 'g' or 'ml') so server can store it in `unit` column
                      (newItem as any).unitText = selectedRawUnit;
                      // Attach brand id for brand-scoped policies
                      if (activeBrandId) (newItem as any).brandId = activeBrandId;
                      await addStockItem(newItem as any);
                      setIsAddDialogOpen(false);
                      setAddForm({ code: '', name: '', departmentId: '', unitType: '', lowestCost: '', highestCost: '', currentCost: '', currentStock: '', reorderLevel: '', itemsPerPack: '' });
                      toast({ title: 'Item added', description: `${name} was added to inventory.` });
                    } catch (err) {
                      toast({ title: 'Error', description: formatStockItemMutationError(err), variant: 'destructive' });
                    }
                    setIsSaving(false);
                  }}
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save Item'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by code or name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={selectedDept} onValueChange={setSelectedDept}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="All Departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departmentsList.map((dept) => (
              <SelectItem key={dept.id} value={dept.id}>
                {dept.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="All Suppliers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Suppliers</SelectItem>
            <SelectItem value="none">Unassigned</SelectItem>
            {suppliersList.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={exportRows.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[260px]">
            <DropdownMenuLabel>Download</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() => {
                const blob = toCsv();
                downloadBlob(`${fileBase}.csv`, blob);
              }}
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Excel (CSV)
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                const blob = toCsv();
                downloadBlob(`${fileBase}.csv`, blob);
              }}
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Spreadsheet (CSV)
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                const blob = toWordDoc();
                downloadBlob(`${fileBase}.doc`, blob);
              }}
            >
              <FileText className="h-4 w-4 mr-2" />
              Word (DOC)
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Share</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={async () => {
                const blob = toCsv();
                const file = new File([blob], `${fileBase}.csv`, { type: 'text/csv' });
                await shareFile(file, { title: 'Stock Items Export', text: 'Sharing stock items export…' });

                // WhatsApp Web fallback (message only)
                if (!navigator.share) {
                  const msg = encodeURIComponent('Stock items export downloaded. You can attach the CSV file and send it.');
                  window.open(`https://wa.me/?text=${msg}`, '_blank', 'noopener,noreferrer');
                }
              }}
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              WhatsApp
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                const blob = toCsv();
                const file = new File([blob], `${fileBase}.csv`, { type: 'text/csv' });
                toast({ title: 'Share', description: 'Choose Bluetooth from the share sheet.' });
                await shareFile(file, { title: 'Stock Items Export' });
              }}
            >
              <Bluetooth className="h-4 w-4 mr-2" />
              Bluetooth
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                const blob = toCsv();
                const file = new File([blob], `${fileBase}.csv`, { type: 'text/csv' });
                toast({ title: 'Share', description: 'Choose Nearby Share from the share sheet (if available).' });
                await shareFile(file, { title: 'Stock Items Export' });
              }}
            >
              <Radar className="h-4 w-4 mr-2" />
              Nearby
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                const blob = toCsv();
                const file = new File([blob], `${fileBase}.csv`, { type: 'text/csv' });
                await shareFile(file, { title: 'Stock Items Export' });
              }}
            >
              <Share2 className="h-4 w-4 mr-2" />
              Share…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Data Table */}
      <DataTableWrapper>
        <Table className="data-table">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="w-[60px]">Unit</TableHead>
              <TableHead className="text-right">Lowest Cost</TableHead>
              <TableHead className="text-right">Highest Cost</TableHead>
              <TableHead className="text-right">Current Price</TableHead>
              <TableHead className="text-right">Stock Level</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.map((item) => {
              const stockValue = item.currentStock * item.currentCost;
              const status = getStockStatus(item);
              const supplierValue = item.supplierId ? String(item.supplierId) : 'none';
              return (
                <TableRow key={item.id} className="cursor-pointer hover:bg-muted/50 group">
                  <TableCell className="font-mono">{item.code}</TableCell>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="text-xs">{getDepartmentName(item.departmentId)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Select
                      value={supplierValue}
                      onValueChange={async (next) => {
                        try {
                          const { updateStockItem } = await import('@/lib/stockStore');
                          await updateStockItem(item.id, { supplierId: next === 'none' ? undefined : next });
                          const name = next === 'none' ? 'Unassigned' : suppliersById.get(String(next))?.name ?? 'Supplier';
                          toast({ title: 'Supplier updated', description: `${item.name} → ${name}` });
                        } catch (err) {
                          toast({ title: 'Error', description: formatStockItemMutationError(err), variant: 'destructive' });
                        }
                      }}
                    >
                      <SelectTrigger className="h-8 w-[190px] bg-background">
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {suppliersList.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-xs">{item.unitType}</TableCell>
                  <TableCell className="text-right">
                    <NumericCell value={item.lowestCost} money />
                  </TableCell>
                  <TableCell className="text-right">
                    <NumericCell value={item.highestCost} money />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <NumericCell value={item.currentCost} money />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="font-medium">{formatStockLevel(item.currentStock, item.unitType, item.itemsPerPack)}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    <NumericCell value={stockValue} money />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={status.status}>{status.label}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-right flex gap-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="opacity-60 group-hover:opacity-100 transition"
                      title="Edit item"
                      onClick={e => {
                        e.stopPropagation();
                        setEditItemId(item.id);
                        setEditForm({
                          ...item,
                          itemsPerPack: (item as any).itemsPerPack ?? '',
                          departmentId: item.departmentId ? String(item.departmentId) : '',
                        });
                        setIsEditDialogOpen(true);
                      }}
                    >
                      <span role="img" aria-label="Edit">✏️</span>
                    </Button>
                    {hasPermission('manageSettings') && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="opacity-60 group-hover:opacity-100 transition"
                        title="Delete item"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (window.confirm(`Delete item '${item.name}'? This cannot be undone.`)) {
                            try {
                              const { deleteStockItem } = await import('@/lib/stockStore');
                              await deleteStockItem(item.id);
                              toast({ title: 'Item deleted', description: `${item.name} was removed.` });
                            } catch (err) {
                              toast({ title: 'Error', description: formatStockItemMutationError(err), variant: 'destructive' });
                            }
                          }
                        }}
                      >
                        <span role="img" aria-label="Delete">🗑️</span>
                      </Button>
                    )}
                  </TableCell>
                      {/* Edit Item Dialog */}
                      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                        <DialogContent className="sm:max-w-[500px]">
                          <DialogHeader>
                            <DialogTitle>Edit Stock Item</DialogTitle>
                            <DialogDescription>
                              Update inventory item details.
                            </DialogDescription>
                          </DialogHeader>
                          {editForm && (
                            <div className="grid gap-4 py-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label htmlFor="edit-code">Item Code</Label>
                                  <Input id="edit-code" value={editForm.code} onChange={e => setEditForm(f => ({ ...f, code: e.target.value }))} />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="edit-name">Item Name</Label>
                                  <Input id="edit-name" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label htmlFor="edit-department">Department</Label>
                                  <Select value={editForm.departmentId} onValueChange={val => setEditForm(f => ({ ...f, departmentId: val }))}>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select department" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {departmentsList.map((dept) => (
                                        <SelectItem key={dept.id} value={dept.id}>
                                          {dept.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="edit-unit">Unit Type</Label>
                                  <Select value={editForm.unitType} onValueChange={val => setEditForm(f => ({ ...f, unitType: val }))}>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select unit" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="KG">KG</SelectItem>
                                        <SelectItem value="LTRS">LTRS</SelectItem>
                                        <SelectItem value="EACH">EACH</SelectItem>
                                        <SelectItem value="PACK">PACK</SelectItem>
                                        <SelectItem value="g">g</SelectItem>
                                        <SelectItem value="ml">ml</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2">
                                  <Label htmlFor="edit-lowest">Lowest Cost</Label>
                                  <Input id="edit-lowest" type="number" step="0.01" value={editForm.lowestCost} onChange={e => setEditForm(f => ({ ...f, lowestCost: e.target.value }))} />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="edit-highest">Highest Cost</Label>
                                  <Input id="edit-highest" type="number" step="0.01" value={editForm.highestCost} onChange={e => setEditForm(f => ({ ...f, highestCost: e.target.value }))} />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="edit-current">Current Cost</Label>
                                  <Input id="edit-current" type="number" step="0.01" value={editForm.currentCost} onChange={e => setEditForm(f => ({ ...f, currentCost: e.target.value }))} />
                                  <div className="text-sm text-muted-foreground">You can edit unit price and other item fields here; stock qty is managed via GRV.</div>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  {(() => {
                                    const ut = String(editForm.unitType || '').toUpperCase();
                                    if (ut === 'KG' || ut === 'LTRS') {
                                      return (
                                          <>
                                            <Label htmlFor="edit-stock">Current Stock (Total {ut === 'KG' ? 'KG' : 'L'})</Label>
                                            <Input id="edit-stock" type="number" step="0.01" placeholder="e.g., 50.00" value={String(editForm.currentStock ?? '')} onChange={e => setEditForm(f => ({ ...f, currentStock: e.target.value }))} disabled />
                                            <div className="text-sm text-muted-foreground">You can't edit qty (stock level) here — use GRV to change stock levels.</div>
                                          </>
                                        );
                                    }
                                    if (ut === 'PACK') {
                                      return (
                                        <>
                                          <Label htmlFor="edit-stock">Number of Packs</Label>
                                          <Input id="edit-stock" type="number" step="1" placeholder="e.g., 10" value={String(editForm.currentStock ?? '')} onChange={e => setEditForm(f => ({ ...f, currentStock: e.target.value }))} disabled />
                                          <div className="text-sm text-muted-foreground">You can't edit qty (stock level) here — use GRV to change stock levels.</div>
                                        </>
                                      );
                                    }
                                    return (
                                        <>
                                        <Label htmlFor="edit-stock">Current Stock (Units)</Label>
                                        <Input id="edit-stock" type="number" step="1" placeholder="e.g., 10" value={String(editForm.currentStock ?? '')} onChange={e => setEditForm(f => ({ ...f, currentStock: e.target.value }))} disabled />
                                        <div className="text-sm text-muted-foreground">You can't edit qty (stock level) here — use GRV to change stock levels.</div>
                                      </>
                                    );
                                  })()}
                                </div>
                                <div className="space-y-2">
                                  {(() => {
                                    const ut = String(editForm.unitType || '').toUpperCase();
                                    if (ut === 'KG' || ut === 'LTRS') {
                                      return (
                                        <>
                                          <Label htmlFor="edit-reorder">Reorder Level (Total {ut === 'KG' ? 'KG' : 'L'})</Label>
                                          <Input id="edit-reorder" type="number" step="0.01" placeholder="e.g., 20.00" value={String(editForm.reorderLevel ?? '')} onChange={e => setEditForm(f => ({ ...f, reorderLevel: e.target.value }))} />
                                        </>
                                      );
                                    }
                                    if (ut === 'PACK') {
                                      return (
                                        <>
                                          <Label htmlFor="edit-reorder">Reorder Level (Packs)</Label>
                                          <Input id="edit-reorder" type="number" step="1" placeholder="e.g., 2" value={String(editForm.reorderLevel ?? '')} onChange={e => setEditForm(f => ({ ...f, reorderLevel: e.target.value }))} />
                                        </>
                                      );
                                    }
                                    return (
                                      <>
                                        <Label htmlFor="edit-reorder">Reorder Level (Units)</Label>
                                        <Input id="edit-reorder" type="number" step="1" placeholder="e.g., 5" value={String(editForm.reorderLevel ?? '')} onChange={e => setEditForm(f => ({ ...f, reorderLevel: e.target.value }))} />
                                      </>
                                    );
                                  })()}
                                </div>
                              </div>
                              {String(editForm.unitType || '').toUpperCase() === 'PACK' ? (
                                <div className="space-y-2">
                                  <Label htmlFor="edit-itemsPerPack">Items per Pack</Label>
                                  <Input id="edit-itemsPerPack" type="number" step="1" placeholder="e.g., 12" value={String((editForm as any).itemsPerPack ?? '')} onChange={e => setEditForm(f => ({ ...f, itemsPerPack: e.target.value }))} />
                                  <div className="text-sm text-muted-foreground">Calculation Summary:</div>
                                  <div className="rounded-md border p-2 bg-background text-sm">System will record: <strong>{String(editForm.currentStock ?? 0)}</strong> × <strong>{String((editForm as any).itemsPerPack ?? 0)}</strong> = <strong>{(parseFloat(String(editForm.currentStock ?? '0')) * parseFloat(String((editForm as any).itemsPerPack ?? '0'))) || 0}</strong> EACH</div>
                                </div>
                              ) : null}
                            </div>
                          )}
                          <DialogFooter>
                            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} disabled={isEditSaving}>
                              Cancel
                            </Button>
                                <Button
                              onClick={async () => {
                                setIsEditSaving(true);
                                if (!editForm.code || !editForm.name || !editForm.departmentId || !editForm.unitType) {
                                  toast({ title: 'Missing fields', description: 'Please fill all required fields.' });
                                  setIsEditSaving(false);
                                  return;
                                }
                                try {
                                  const { updateStockItem } = await import('@/lib/stockStore');
                                  // Convert UI inputs into DB values similar to Add dialog
                                  const { lowestCost, highestCost, currentCost, currentStock, reorderLevel } = editForm as any;
                                  const selectedRawUnit = String(editForm.unitType || '').trim();
                                  const selectedLower = selectedRawUnit.toLowerCase();
                                  const ut = String(editForm.unitType || '').toUpperCase();
                                  const rawCurrent = parseFloat(String(currentStock || '0'));
                                  const rawReorder = parseFloat(String(reorderLevel || '0'));
                                  const perPack = parseFloat(String((editForm as any).itemsPerPack || '0'));

                                  let dbCurrentStock = 0;
                                  let dbReorder = undefined as number | undefined;

                                  if (ut === 'PACK') {
                                    if (perPack > 0) {
                                      dbCurrentStock = (isFinite(rawCurrent) ? rawCurrent : 0) * perPack;
                                      dbReorder = isFinite(rawReorder) ? rawReorder * perPack : undefined;
                                    } else {
                                      dbCurrentStock = isFinite(rawCurrent) ? rawCurrent : 0;
                                      dbReorder = isFinite(rawReorder) ? rawReorder : undefined;
                                    }
                                  } else if (selectedLower === 'g') {
                                    dbCurrentStock = isFinite(rawCurrent) ? rawCurrent / 1000.0 : 0;
                                    dbReorder = isFinite(rawReorder) ? rawReorder / 1000.0 : undefined;
                                  } else if (selectedLower === 'ml') {
                                    dbCurrentStock = isFinite(rawCurrent) ? rawCurrent / 1000.0 : 0;
                                    dbReorder = isFinite(rawReorder) ? rawReorder / 1000.0 : undefined;
                                  } else if (ut === 'KG' || ut === 'LTRS') {
                                    dbCurrentStock = isFinite(rawCurrent) ? rawCurrent : 0;
                                    dbReorder = isFinite(rawReorder) ? rawReorder : undefined;
                                  } else {
                                    dbCurrentStock = Math.round(isFinite(rawCurrent) ? rawCurrent : 0);
                                    dbReorder = isFinite(rawReorder) ? Math.round(rawReorder) : undefined;
                                  }

                                  await updateStockItem(editItemId, {
                                    ...editForm,
                                    itemsPerPack: ut === 'PACK' ? (perPack > 0 ? perPack : undefined) : undefined,
                                    lowestCost: parseFloat(String(lowestCost)) || 0,
                                    highestCost: parseFloat(String(highestCost)) || 0,
                                    currentCost: parseFloat(String(currentCost)) || 0,
                                    currentStock: dbCurrentStock,
                                    reorderLevel: dbReorder,
                                  });
                                  setIsEditDialogOpen(false);
                                  toast({ title: 'Item updated', description: `${editForm.name} was updated.` });
                                } catch (err) {
                                  toast({ title: 'Error', description: formatStockItemMutationError(err), variant: 'destructive' });
                                }
                                setIsEditSaving(false);
                              }}
                              disabled={isEditSaving}
                            >
                              {isEditSaving ? 'Saving...' : 'Save Changes'}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataTableWrapper>

      <div className="mt-4 text-sm text-muted-foreground">
        Showing {filteredItems.length} of {stockItems.length} items
      </div>
    </div>
  );
}
