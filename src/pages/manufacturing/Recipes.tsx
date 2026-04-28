import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, Search, Edit, Trash2, Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { PageHeader, DataTableWrapper, NumericCell } from '@/components/common/PageComponents';
import { useCurrency } from '@/contexts/CurrencyContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { DepartmentId, Recipe, RecipeIngredient, StockItem, UnitType } from '@/types';
import { getManufacturingRecipesSnapshot, subscribeManufacturingRecipes, upsertManufacturingRecipe, deleteManufacturingRecipe, ensureRecipesLoaded } from '@/lib/manufacturingRecipeStore';
import { getStockItemsSnapshot, subscribeStockItems } from '@/lib/stockStore';
import { getFrontStockSnapshot, subscribeFrontStock } from '@/lib/frontStockStore';
import { getPosMenuItemsSnapshot, subscribePosMenu } from '@/lib/posMenuStore';
import { cn } from '@/lib/utils';
import { getCategoriesSnapshot, refreshCategories, subscribeCategories } from '@/lib/categoriesStore';

const mapUnitTypeToUnit = (u?: UnitType): string => {
  switch (u) {
    case 'KG': return 'kg';
    case 'LTRS': return 'l';
    case 'PACK': return 'pack';
    case 'EACH':
    default:
      return 'each';
  }
};

const getStockUnit = (s?: StockItem) => ((s as any)?.unit ?? mapUnitTypeToUnit(s?.unitType));

const formatNumber = (n: number) => {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1) return n.toFixed(3).replace(/\.0+$|(?<=\.[0-9]*?)0+$/,'');
  return n.toFixed(4).replace(/0+$/,'');
};

// Helper to render ingredient quantity with explicit base-unit conversion when
// the recipe stores textual 'g' or 'ml' quantities. Example: "100 ml (0.1 l)".
const formatIngredientDisplay = (ing: any, stock?: StockItem) => {
  const unitText = (ing as any).unit ?? (stock ? ((stock as any).unit) : undefined);
  const qty = Number.isFinite(ing.requiredQty) ? ing.requiredQty : 0;
  if (unitText && stock) {
    const iu = String(unitText).toLowerCase();
    if (iu === 'g' && stock.unitType === 'KG') {
      return `${formatNumber(qty)} g (${formatNumber(qty / 1000)} kg)`;
    }
    if (iu === 'ml' && stock.unitType === 'LTRS') {
      return `${formatNumber(qty)} ml (${formatNumber(qty / 1000)} l)`;
    }
  }
  const unitLabel = (ing as any).unit ?? mapUnitTypeToUnit(ing.unitType);
  return `${formatNumber(qty)} ${unitLabel}`;
};

export default function Recipes() {
    const { formatMoneyPrecise } = useCurrency();
  const recipes = useSyncExternalStore(subscribeManufacturingRecipes, getManufacturingRecipesSnapshot);
  const stockItems = useSyncExternalStore(subscribeStockItems, getStockItemsSnapshot);
  const frontStock = useSyncExternalStore(subscribeFrontStock, getFrontStockSnapshot);

  const [searchTerm, setSearchTerm] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const location = useLocation();

  const stockById = useMemo(() => new Map(stockItems.map(s => [s.id, s] as const)), [stockItems]);
  const manufacturingOnHandByItemId = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of frontStock ?? []) {
      if (String(r.locationTag).toUpperCase() !== 'MANUFACTURING') continue;
      const id = String(r.itemId ?? '');
      if (!id) continue;
      m.set(id, Number(r.quantity ?? 0) || 0);
    }
    return m;
  }, [frontStock]);

  const filteredRecipes = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return recipes
      .filter(r => (!q ? true : r.parentItemName.toLowerCase().includes(q) || r.parentItemCode.toLowerCase().includes(q)))
      .slice()
      .sort((a, b) => a.parentItemName.localeCompare(b.parentItemName));
  }, [recipes, searchTerm]);

  const onCreate = () => {
    setEditingId(null);
    setEditorOpen(true);
  };

  const onEdit = (id: string) => {
    setEditingId(id);
    setEditorOpen(true);
  };

  // If navigated with state.openRecipeId, open that recipe in the editor
  useEffect(() => {
    try {
      const stateAny: any = (location && (location.state as any)) ?? null;
      const openRecipeId = stateAny?.openRecipeId;
      if (!openRecipeId) return;

      // If we already have the recipe loaded, open the editor immediately.
      const found = recipes.find(r => r.id === openRecipeId);
      if (found) {
        setEditingId(openRecipeId);
        setEditorOpen(true);
        try { window.history.replaceState({}, ''); } catch {}
        return;
      }

      // Otherwise ensure remote recipes are loaded; when `recipes` updates
      // this effect will run again and open the editor if found.
      void ensureRecipesLoaded();
    } catch {
      // ignore
    }
  }, [location, recipes]);

  useEffect(() => {
    let cancelled = false;
    const loadData = async () => {
      setIsLoading(true);
      try {
        await ensureRecipesLoaded();
      } catch (err) {
        console.warn('Failed to load recipes', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void loadData();
    return () => { cancelled = true; };
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await deleteManufacturingRecipe(id);
      // fetchFromDb is called inside store delete; snapshot subscription will update UI
    } catch (err) {
      console.error('Delete recipe failed', err);
      alert('Failed to delete recipe. Check console for details.');
    }
  };

  return (
    <div>
      <PageHeader
        title="Recipe Management"
        description="Manage parent-child relationships for batch manufacturing"
        actions={<Button onClick={onCreate}><Plus className="h-4 w-4 mr-2" />New Recipe</Button>}
      />

      <div className="flex gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search recipes..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          <span>Loading recipes…</span>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredRecipes.map((recipe) => (
            <Card key={recipe.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">{recipe.parentItemName}</CardTitle>
                  <p className="text-sm text-muted-foreground">Code: {recipe.parentItemCode} • Output: {recipe.outputQty} {recipe.outputUnitType}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold">{formatMoneyPrecise(recipe.unitCost, 2)}/unit</span>
                  <Button variant="ghost" size="icon" onClick={() => onEdit(recipe.id)}><Edit className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => void handleDelete(recipe.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <DataTableWrapper>
                <Table className="data-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ingredient</TableHead>
                      <TableHead className="text-right">Qty Required</TableHead>
                      <TableHead className="text-right">On hand (MFG)</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                      <TableHead className="text-right">Unit Cost</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recipe.ingredients.map((ing) => (
                        <TableRow key={ing.id}>
                          <TableCell>{ing.ingredientName}</TableCell>
                          <TableCell className="text-right">{formatIngredientDisplay(ing, stockById.get(ing.ingredientId))}</TableCell>
                          <TableCell className="text-right">
                            {(() => {
                              const onHand = manufacturingOnHandByItemId.get(String(ing.ingredientId)) ?? 0;
                              const unitLabel = getStockUnit(stockById.get(ing.ingredientId)) ?? mapUnitTypeToUnit(ing.unitType);
                              return `${formatNumber(onHand)} ${unitLabel}`;
                            })()}
                          </TableCell>
                          <TableCell className="text-right">
                            {(() => {
                              const required = Number.isFinite(ing.requiredQty) ? ing.requiredQty : 0;
                              const onHand = manufacturingOnHandByItemId.get(String(ing.ingredientId)) ?? 0;
                              const ok = required <= onHand + 1e-9;
                              return (
                                <span className={ok ? 'text-success' : 'text-destructive'}>
                                  {ok ? 'OK' : 'ISSUE TO MFG'}
                                </span>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="text-right"><NumericCell value={ing.unitCost} money /></TableCell>
                          <TableCell className="text-right"><NumericCell value={ing.requiredQty * ing.unitCost} money /></TableCell>
                        </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </DataTableWrapper>
            </CardContent>
          </Card>
        ))}
      </div>
      )}

      <RecipeEditorDialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) setEditingId(null);
        }}
        editing={editingId ? recipes.find(r => r.id === editingId) ?? null : null}
        stockItems={stockItems}
        manufacturingOnHandByItemId={manufacturingOnHandByItemId}
        onSaved={(r) => {
          // select the saved recipe and close editor
          try { setEditingId(r.id); } catch {}
          setEditorOpen(false);
        }}
      />
    </div>
  );
}

type DraftIngredient = {
  id: string;
  ingredientId: string;
  requiredQty: number | '';
  unit?: string;
};

function safeId(prefix: string) {
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${uuid}`;
}

function computeCosts(params: { draft: { outputQty: number | ''; ingredients: DraftIngredient[] }; stockItems: StockItem[] }) {
  const byId = new Map(params.stockItems.map(s => [s.id, s] as const));
    const total = params.draft.ingredients.reduce((sum, ing) => {
      const s = byId.get(ing.ingredientId);
      // We expect stored ingredient quantities to be in the stock base unit
      // (KG for mass, LTRS for liquids). Some older recipes may still store
      // quantities in 'g'/'ml' textual units; handle that by converting here.
      const ingUnitText = (ing as any).unit ?? (s ? ((s as any).unit) : undefined);
      let effectiveQty = (ing.requiredQty === '' || ing.requiredQty === undefined) ? 0 : (Number.isFinite(ing.requiredQty) ? ing.requiredQty : 0);
      if (s && ingUnitText) {
        const iu = String(ingUnitText).toLowerCase();
        if (iu === 'g' && s.unitType === 'KG') {
          // legacy stored as grams -> convert to kg
          effectiveQty = effectiveQty / 1000;
        }
        if (iu === 'ml' && s.unitType === 'LTRS') {
          // legacy stored as millilitres -> convert to litres
          effectiveQty = effectiveQty / 1000;
        }
      }

      const unitCost = s ? s.currentCost : 0;
      return sum + effectiveQty * (Number.isFinite(unitCost) ? unitCost : 0);
    }, 0);
  const outputQty = (params.draft.outputQty === '' || (typeof params.draft.outputQty === 'number' && params.draft.outputQty <= 0)) ? 1 : Number(params.draft.outputQty);
  const unit = total / outputQty;
  return { totalCost: total, unitCost: unit };
}

export function RecipeEditorDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Recipe | null;
  stockItems: StockItem[];
  manufacturingOnHandByItemId?: Map<string, number>;
  onSaved?: (r: { id: string; parentItemCode: string; parentItemName: string }) => void;
  initialValues?: { parentItemName?: string; parentItemCode?: string; parentItemId?: string; finishedGoodDepartmentId?: DepartmentId };
}) {
  const { open, onOpenChange, editing, stockItems, initialValues, manufacturingOnHandByItemId } = props;

  const { formatMoneyPrecise } = useCurrency();

  const posMenuItems = useSyncExternalStore(subscribePosMenu, getPosMenuItemsSnapshot, getPosMenuItemsSnapshot);

  const categoriesSnap = useSyncExternalStore(subscribeCategories, getCategoriesSnapshot, getCategoriesSnapshot);
  const departmentsList = categoriesSnap.categories;

  const [name, setName] = useState(editing?.parentItemName ?? '');
  const [code, setCode] = useState(editing?.parentItemCode ?? '');
  const [parentItemId, setParentItemId] = useState(editing?.parentItemId ?? '');
  const [autoLinkedCode, setAutoLinkedCode] = useState<string | null>(null);
  const [finishedDept, setFinishedDept] = useState<DepartmentId>((editing?.finishedGoodDepartmentId ?? '') as DepartmentId);
  const [outputQty, setOutputQty] = useState<number | ''>(editing?.outputQty ?? 1);
  const [outputUnitType, setOutputUnitType] = useState<UnitType>((editing?.outputUnitType ?? 'EACH') as UnitType);
  const [ingredients, setIngredients] = useState<DraftIngredient[]>(
    (editing?.ingredients ?? []).map((i) => ({ id: i.id, ingredientId: i.ingredientId, requiredQty: i.requiredQty }))
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const [conversionHelper, setConversionHelper] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  // Reset when opening or changing edit target
  useEffect(() => {
    if (!open) return;
    setName(editing?.parentItemName ?? initialValues?.parentItemName ?? '');
    setCode(editing?.parentItemCode ?? initialValues?.parentItemCode ?? '');
    setParentItemId(editing?.parentItemId ?? initialValues?.parentItemId ?? '');
    setAutoLinkedCode(null);
    setFinishedDept((editing?.finishedGoodDepartmentId ?? initialValues?.finishedGoodDepartmentId ?? (departmentsList.length ? departmentsList[0].id : '')) as DepartmentId);
    setOutputQty(editing?.outputQty ?? 1);
    setOutputUnitType((editing?.outputUnitType ?? 'EACH') as UnitType);
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
    setIngredients((editing?.ingredients ?? []).map((i) => ({ id: i.id, ingredientId: i.ingredientId, requiredQty: i.requiredQty || '', unit: (i as any).unit ?? getStockUnit(byId.get(i.ingredientId)) ?? mapUnitTypeToUnit(i.unitType) })));
    setValidationMessage(null);
  }, [open, editing?.id, departmentsList, initialValues?.parentItemCode, initialValues?.parentItemName]);

  const nameMatches = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (!q) return [] as typeof posMenuItems;
    return posMenuItems.filter(p => (p.name ?? '').toLowerCase().includes(q) || String(p.code ?? '').toLowerCase().includes(q)).slice(0, 10);
  }, [name, posMenuItems]);

  const codeMatches = useMemo(() => {
    const q = code.trim().toLowerCase();
    if (!q) return [] as typeof posMenuItems;
    return posMenuItems.filter(p => String(p.code ?? '').toLowerCase().includes(q) || (p.name ?? '').toLowerCase().includes(q)).slice(0, 10);
  }, [code, posMenuItems]);

  useEffect(() => {
    // Best-effort refresh when opening editor.
    if (!open) return;
    void refreshCategories().catch(() => {});
  }, [open]);

  const matchedItem = useMemo(() => {
    const c = code.trim();
    if (!c) return null as null | { source: 'pos' | 'stock'; id: string; name: string; code: string };

    // Only match POS/menu items for the parent link. Stock items are ingredients
    // and should not be used as the recipe's parent item. If no POS item is
    // found we'll allow a standalone recipe to be created and linked later.
    const mi = posMenuItems.find((x) => String(x.code).trim() === c) ?? null;
    if (mi) return { source: 'pos' as const, id: mi.id, name: mi.name, code: String(mi.code) };

    return null;
  }, [code, posMenuItems, stockItems]);

  useEffect(() => {
    if (!open) return;
    if (!matchedItem) return;

    // Always keep the internal link in sync with a matched code.
    setParentItemId(matchedItem.id);

    // Auto-fill the name only if the user hasn’t manually edited it.
    const canAutofillName = !name.trim() || autoLinkedCode === code.trim();
    if (canAutofillName) {
      setName(matchedItem.name);
      setAutoLinkedCode(code.trim());
    }
  }, [open, matchedItem, code, name, autoLinkedCode]);

  const cost = useMemo(() => computeCosts({ draft: { outputQty, ingredients }, stockItems }), [outputQty, ingredients, stockItems]);
  const byId = useMemo(() => new Map(stockItems.map(s => [s.id, s] as const)), [stockItems]);
  const ingredientAvailability = useMemo(() => {
    return ingredients.map((ing) => {
      const requiredQty = typeof ing.requiredQty === 'number' && Number.isFinite(ing.requiredQty) ? ing.requiredQty : 0;
      const onHand = manufacturingOnHandByItemId?.get(String(ing.ingredientId)) ?? 0;
      const stock = byId.get(ing.ingredientId);
      return {
        id: ing.id,
        name: stock?.name ?? ing.ingredientId,
        requiredQty,
        onHand,
        ok: requiredQty <= onHand + 1e-9,
      };
    });
  }, [ingredients, manufacturingOnHandByItemId, byId]);
  const lowIngredients = useMemo(
    () => ingredientAvailability.filter((x) => x.requiredQty > 0 && !x.ok),
    [ingredientAvailability]
  );

  const addIngredient = (stockItemId: string) => {
    if (ingredients.some(i => i.ingredientId === stockItemId)) {
      setPickerOpen(false);
      return;
    }
    // default unit from the stock item when available
    const stock = stockItems.find(s => s.id === stockItemId);
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
    const defaultUnit = getStockUnit(stock) ?? mapUnitTypeToUnit(stock?.unitType);
    setIngredients(prev => [...prev, { id: safeId('ri'), ingredientId: stockItemId, requiredQty: '', unit: defaultUnit }]);
    setPickerOpen(false);
  };

  const removeIngredient = (id: string) => {
    setIngredients(prev => prev.filter(i => i.id !== id));
  };

  const save = async () => {
    const trimmedName = name.trim();
    const trimmedCode = code.trim();
    const validationErrors: string[] = [];
    if (!trimmedName) validationErrors.push('Name is required.');
    if (!trimmedCode) validationErrors.push('Code is required.');
    if (!(typeof outputQty === 'number' && Number.isFinite(outputQty) && outputQty > 0)) validationErrors.push('Output Qty must be greater than 0.');
    if (outputUnitType === 'EACH' && typeof outputQty === 'number' && Number.isFinite(outputQty) && !Number.isInteger(outputQty)) {
      validationErrors.push('Output Qty must be a whole number for EACH unit recipes.');
    }
    if (!ingredients.length) validationErrors.push('Add at least one ingredient.');

    if (ingredients.length) {
      for (const i of ingredients) {
        const s = byId.get(i.ingredientId);
        const qty = typeof i.requiredQty === 'number' && Number.isFinite(i.requiredQty) ? i.requiredQty : 0;
        if (!s) validationErrors.push('One or more ingredients are invalid. Re-select ingredient(s).');
        if (!(qty > 0)) validationErrors.push(`Ingredient quantity must be > 0 (${s?.name ?? i.ingredientId}).`);
        const unitText = String(i.unit ?? '').toLowerCase();
        if (unitText === 'each' && qty > 0 && !Number.isInteger(qty)) {
          validationErrors.push(`Ingredient quantity must be a whole number for EACH (${s?.name ?? i.ingredientId}).`);
        }
      }
    }

    if (validationErrors.length) {
      setValidationMessage(validationErrors[0]);
      return;
    }

    setIsSaving(true);
    setValidationMessage(null);
    try {

    // Validation: for KG/LTRS stock items the ingredient must use a mass/liquid unit
    for (const i of ingredients) {
      const s = byId.get(i.ingredientId);
      if (!s) continue;
      if (s.unitType === 'KG' || s.unitType === 'LTRS') {
        const ingUnit = (i.unit ?? ((s as any).unit ?? mapUnitTypeToUnit(s.unitType)) ?? '').toString().toLowerCase();
        const okKg = s.unitType === 'KG' && (ingUnit === 'g' || ingUnit === 'kg');
        const okLtr = s.unitType === 'LTRS' && (ingUnit === 'ml' || ingUnit === 'l');
        if (!(okKg || okLtr)) {
          setValidationMessage('Please select a mass/liquid unit for each ingredient.');
          return;
        }
      }
    }

    const recipeIngredients: RecipeIngredient[] = ingredients
      .map((i) => {
        const s = byId.get(i.ingredientId);
        // Determine unitType from the per-ingredient unit selection when present,
        // otherwise fallback to the stock item's unitType
        const mapUnitToUnitType = (u?: string): UnitType => {
          const uu = String(u ?? '').toLowerCase();
          if (uu === 'g' || uu === 'kg') return 'KG';
          if (uu === 'ml' || uu === 'l' || uu === 'ltr' || uu === 'ltrs') return 'LTRS';
          if (uu === 'pack') return 'PACK';
          return 'EACH';
        };

        const detectedUnitType = i.unit ? mapUnitToUnitType(i.unit) : ((s?.unitType ?? 'EACH') as UnitType);

        // Normalize requiredQty to the stock base unit when the user entered
        // grams/ml. Store the numeric value in base units and set the textual
        // unit to the base unit (kg / l) so later math is consistent.
        let reqQty = (i.requiredQty === '' || i.requiredQty === undefined) ? 0 : (Number.isFinite(i.requiredQty) ? i.requiredQty : 0);
        let unitTextToStore: string | undefined = i.unit;
        if (i.unit) {
          const uu = String(i.unit).toLowerCase();
          if (uu === 'g' && detectedUnitType === 'KG') {
            reqQty = reqQty / 1000;
            unitTextToStore = 'kg';
          }
          if (uu === 'ml' && detectedUnitType === 'LTRS') {
            reqQty = reqQty / 1000;
            unitTextToStore = 'l';
          }
        }

        const unitType = detectedUnitType;
        return {
          id: i.id,
          ingredientId: i.ingredientId,
          ingredientCode: s?.code ?? i.ingredientId,
          ingredientName: s?.name ?? i.ingredientId,
          requiredQty: reqQty,
          unitType,
          ...(unitTextToStore ? { unit: unitTextToStore } : {}),
          unitCost: s?.currentCost ?? 0,
        } as any;
      })
      .filter((i) => i.requiredQty > 0);

    const resolvedOutputQty =
      typeof outputQty === 'number' && Number.isFinite(outputQty) && outputQty > 0
        ? outputQty
        : 1;

    await upsertManufacturingRecipe({
      id: editing?.id,
      parentItemId: (parentItemId && parentItemId.trim() ? parentItemId : (editing?.parentItemId ?? trimmedCode)),
      parentItemCode: trimmedCode,
      parentItemName: trimmedName,
      finishedGoodDepartmentId: finishedDept,
      outputQty: resolvedOutputQty,
      outputUnitType,
      ingredients: recipeIngredients,
    });

    // Refresh canonical snapshot and notify parent with the saved recipe
    try {
      // find saved recipe by code from canonical snapshot
      const saved = getManufacturingRecipesSnapshot().find(r => String(r.parentItemCode) === trimmedCode) ?? null;
      if (props.onSaved && saved) {
        props.onSaved({ id: saved.id, parentItemCode: saved.parentItemCode, parentItemName: saved.parentItemName });
      }
    } catch (e) {
      // ignore
    }

    onOpenChange(false);
  } finally {
    setIsSaving(false);
  }
  };

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      if (isSaving) return; // Prevent closing while saving
      onOpenChange(newOpen);
    }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Recipe' : 'New Recipe'}</DialogTitle>
          <DialogDescription>
            Link a recipe to a POS/stock code, then define ingredient quantities per batch.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label>Item Name</Label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setAutoLinkedCode(null);
              }}
              placeholder="e.g. Burger"
            />
            {nameMatches.length > 0 ? (
              <div className="mt-1 max-h-40 overflow-auto rounded-md border bg-background">
                {nameMatches.map((m) => (
                  <button key={m.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted-foreground/5" onClick={() => {
                    setName(m.name);
                    setCode(String(m.code ?? ''));
                    setParentItemId(m.id);
                    setAutoLinkedCode(String(m.code ?? ''));
                  }}>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.code}</div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label>Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 2030" />
            {matchedItem ? (
              <div className="text-xs text-muted-foreground">Matched POS item: <span className="text-foreground font-medium">{matchedItem.name}</span></div>
            ) : code.trim() ? (
              <div className="text-xs text-muted-foreground">No menu item found for this code — the recipe will be saved standalone and can be linked later.</div>
            ) : null}
            {codeMatches.length > 0 ? (
              <div className="mt-1 max-h-40 overflow-auto rounded-md border bg-background">
                {codeMatches.map((m) => (
                  <button key={m.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted-foreground/5" onClick={() => {
                    setCode(String(m.code ?? ''));
                    setName(m.name);
                    setParentItemId(m.id);
                    setAutoLinkedCode(String(m.code ?? ''));
                  }}>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.code}</div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label>Finished Goods Category</Label>
            <Select value={finishedDept} onValueChange={(v) => setFinishedDept(v as DepartmentId)}>
              <SelectTrigger>
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                {departmentsList.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Output Qty</Label>
              <Input type="number" min={0.0001} step={outputUnitType === 'EACH' ? '1' : '0.01'} value={outputQty} onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  setOutputQty('');
                } else {
                  const num = Number(val);
                  setOutputQty(num > 0 ? num : '');
                }
              }} />
            </div>
            <div className="space-y-1">
              <Label>Unit</Label>
              <Input value={outputUnitType} onChange={(e) => setOutputUnitType(e.target.value as UnitType)} placeholder="EACH" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            Total cost: <span className="font-semibold text-foreground">{formatMoneyPrecise(cost.totalCost, 2)}</span> • Unit cost: <span className="font-semibold text-foreground">{formatMoneyPrecise(cost.unitCost, 2)}</span>
          </div>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <Plus className="h-4 w-4 mr-2" /> Add ingredient
                <ChevronsUpDown className="ml-2 h-4 w-4 opacity-70" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[420px] p-0" align="end">
              <Command>
                <CommandInput placeholder="Search stock items..." />
                <CommandEmpty>No stock item found.</CommandEmpty>
                <CommandGroup>
                  {stockItems.map((s) => (
                    <CommandItem key={s.id} value={`${s.name} ${s.code}`} onSelect={() => addIngredient(s.id)}>
                      <Check className={cn('mr-2 h-4 w-4', ingredients.some(i => i.ingredientId === s.id) ? 'opacity-100' : 'opacity-0')} />
                      <span className="truncate">{s.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{s.code}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <DataTableWrapper>
          {validationMessage ? (
            <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {validationMessage}
            </div>
          ) : null}
          {lowIngredients.length > 0 ? (
            <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <div className="font-medium">Low Manufacturing stock detected</div>
              <div className="text-xs mt-1">
                Issue stock from Main Store to Manufacturing first.
                {' '}
                {lowIngredients.length === 1
                  ? `${lowIngredients[0].name} is below required quantity.`
                  : `${lowIngredients.length} ingredients are below required quantity.`}
              </div>
            </div>
          ) : null}
          <Table className="data-table">
            <TableHeader>
              <TableRow>
                <TableHead>Ingredient</TableHead>
                <TableHead className="text-right">Qty Required</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Total Cost</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ingredients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">Add ingredients to build this recipe.</TableCell>
                </TableRow>
              ) : (
                ingredients.map((ing) => {
                  const s = byId.get(ing.ingredientId);
                  const onHand = manufacturingOnHandByItemId?.get(String(ing.ingredientId)) ?? null;
                  // compute effective unit cost respecting per-ingredient unit selection
                  const ingUnit = ing.unit ?? (s ? ((s as any).unit ?? mapUnitTypeToUnit(s.unitType)) : undefined);
                  let unitCost = s?.currentCost ?? 0;
                  if (s && ingUnit) {
                    const iu = String(ingUnit).toLowerCase();
                    if (iu === 'g' && s.unitType === 'KG') unitCost = (s.currentCost || 0) / 1000;
                    if (iu === 'ml' && s.unitType === 'LTRS') unitCost = (s.currentCost || 0) / 1000;
                  }
                  const reqQty = typeof ing.requiredQty === 'number' && Number.isFinite(ing.requiredQty) ? ing.requiredQty : 0;
                  const lineTotal = reqQty * unitCost;
                  return (
                    <TableRow key={ing.id}>
                      <TableCell>
                        <div className="font-medium">{s?.name ?? ing.ingredientId}</div>
                        <div className="text-xs text-muted-foreground">{s?.code ?? ''}</div>
                        {onHand !== null ? (
                          <div className="text-xs text-muted-foreground">
                            On hand (MFG): {formatNumber(onHand)} {getStockUnit(s) ?? mapUnitTypeToUnit(s?.unitType)}
                          </div>
                        ) : null}
                      </TableCell>
                        <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Input
                            className="h-9 w-24 text-right"
                            type="number"
                            min={0}
                            step={(ing.unit ?? '').toLowerCase() === 'each' ? '1' : '0.01'}
                            value={ing.requiredQty}
                            onChange={(e) => {
                              const val = e.target.value;
                              const v = val === '' ? '' : Number(val);
                              setIngredients(prev => prev.map(p => (p.id === ing.id ? { ...p, requiredQty: Number.isFinite(v) ? v : (val === '' ? '' : 0) } : p)));
                            }}
                          />
                          <Select
                            value={ing.unit ?? getStockUnit(byId.get(ing.ingredientId))}
                            onValueChange={(v) => {
                              setIngredients(prev => prev.map(p => {
                                if (p.id !== ing.id) return p;
                                const prevQty = typeof p.requiredQty === 'number' && Number.isFinite(p.requiredQty) ? p.requiredQty : 0;
                                // If user selected grams or millilitres, convert to base unit
                                if (v === 'g' && prevQty > 0) {
                                  const converted = prevQty / 1000;
                                  // store converted qty and set unit to kg (base)
                                  setConversionHelper(ch => ({ ...ch, [p.id]: `Converted ${prevQty} g → ${converted} kg` }));
                                  // clear after short delay
                                  setTimeout(() => setConversionHelper(ch => { const c = { ...ch }; delete c[p.id]; return c; }), 3500);
                                  return { ...p, requiredQty: converted, unit: 'kg' };
                                }
                                if (v === 'ml' && prevQty > 0) {
                                  const converted = prevQty / 1000;
                                  setConversionHelper(ch => ({ ...ch, [p.id]: `Converted ${prevQty} ml → ${converted} l` }));
                                  setTimeout(() => setConversionHelper(ch => { const c = { ...ch }; delete c[p.id]; return c; }), 3500);
                                  return { ...p, requiredQty: converted, unit: 'l' };
                                }
                                // otherwise just set the selected textual unit
                                return { ...p, unit: v };
                              }));
                            }}
                          >
                            <SelectTrigger className="h-9 w-20">
                              <SelectValue placeholder="unit" />
                            </SelectTrigger>
                            <SelectContent>
                              {
                                // restrict dropdown options to the appropriate base units for this stock item
                                (() => {
                                  const stock = s;
                                  const allowed = stock ? (stock.unitType === 'KG' ? ['g', 'kg'] : stock.unitType === 'LTRS' ? ['ml', 'l'] : stock.unitType === 'PACK' ? ['pack', 'each'] : ['each']) : ['each'];
                                  return allowed.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>);
                                })()
                              }
                            </SelectContent>
                          </Select>
                          {conversionHelper[ing.id] ? <div className="text-xs text-muted-foreground mt-1">{conversionHelper[ing.id]}</div> : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right"><NumericCell value={unitCost} prefix="K " /></TableCell>
                      <TableCell className="text-right"><NumericCell value={unitCost} money /></TableCell>
                      <TableCell className="text-right"><NumericCell value={lineTotal} money /></TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => removeIngredient(ing.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </DataTableWrapper>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancel</Button>
          <Button onClick={save} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isSaving ? 'Saving...' : 'Save Recipe'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
