import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';
import { Check, ChevronsUpDown, Sparkles, Wand2 } from 'lucide-react';

import { usePosMenu } from '@/hooks/usePosMenu';
import { getStockItemsSnapshot, subscribeStockItems, applyStockDeductions } from '@/lib/stockStore';
import { getGRVsSnapshot, subscribeGRVs, refreshGRVs } from '@/lib/grvDbStore';
import { getManufacturingRecipesSnapshot, subscribeManufacturingRecipes, upsertManufacturingRecipe } from '@/lib/manufacturingRecipeStore';
import { computeCostTiersFromPurchases, type PurchaseLotLike } from '@/lib/purchaseCosting';
import { addOrder } from '@/lib/orderStore';
import { resetPosMenuToDefaults } from '@/lib/posMenuStore';
import { computeMaxProducible, defaultQtyForUnitType, recommendSellingPrice, type PriceRounding, suggestIngredients } from '@/lib/mthunziSmartAssistant';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';

function fmtPct(n: number) {
  return `${n.toFixed(2)}%`;
}

export default function AdvancedGAAP() {
  const { formatMoneyPrecise } = useCurrency();
  const { user, brand, accountUser } = useAuth();
  const pos = usePosMenu();
  const stockItems = useSyncExternalStore(subscribeStockItems, getStockItemsSnapshot);
  const grvs = useSyncExternalStore(subscribeGRVs, getGRVsSnapshot);
  const recipes = useSyncExternalStore(subscribeManufacturingRecipes, getManufacturingRecipesSnapshot);

  const brandId = (user?.brand_id ?? brand?.id ?? '') as string;
  useEffect(() => {
    if (!accountUser) return;
    if (!brandId) return;
    void refreshGRVs(brandId).catch((e) => console.error('Failed to load GRVs', e));
  }, [accountUser, brandId]);

  const menuItems = pos.items;
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuSearch, setMenuSearch] = useState('');

  const [menuItemId, setMenuItemId] = useState<string>(() => menuItems[0]?.id ?? '');
  const [qty, setQty] = useState(1);
  const [costMode, setCostMode] = useState<'latest' | 'weightedAvg'>('latest');
  const [includeOrder, setIncludeOrder] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [assistantOpen, setAssistantOpen] = useState(false);
  const [targetGp, setTargetGp] = useState<number>(60);
  const [autoPrice, setAutoPrice] = useState(false);
  const [priceRounding, setPriceRounding] = useState<PriceRounding>('0.5');
  const fmtMoney = (n: number) => formatMoneyPrecise(Number(n) || 0, 2);

  useEffect(() => {
    if (!menuItems.length) return;
    if (!menuItems.some((m) => m.id === menuItemId)) {
      setMenuItemId(menuItems[0].id);
    }
  }, [menuItems, menuItemId]);

  const menuItem = menuItems.find((m) => m.id === menuItemId) ?? menuItems[0];

  const [sellingPrice, setSellingPrice] = useState<number>(() => menuItem?.price ?? 0);
  useEffect(() => {
    // When switching items, keep user's "auto price" preference.
    if (!autoPrice) setSellingPrice(menuItem?.price ?? 0);
  }, [menuItemId]);

  const filteredMenu = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    if (!q) return menuItems;
    return menuItems.filter((m) =>
      String(m.name).toLowerCase().includes(q) || String(m.code).toLowerCase().includes(q)
    );
  }, [menuSearch, menuItems]);

  const recipe = useMemo(() => {
    if (!menuItem) return undefined;
    const code = String(menuItem.code ?? '').trim();
    if (code) {
      const byCode = recipes.find((r) => String(r.parentItemCode) === code);
      if (byCode) return byCode;
    }
    const byName = recipes.find((r) => String(r.parentItemName).trim().toLowerCase() === String(menuItem.name).trim().toLowerCase());
    return byName;
  }, [recipes, menuItem]);

  const confirmedGrvs = useMemo(() => grvs.filter((g) => g.status === 'confirmed'), [grvs]);

  const purchasesByItemId = useMemo(() => {
    const byId = new Map<string, Array<PurchaseLotLike & { supplierId: string; supplierName: string }>>();
    for (const g of confirmedGrvs) {
      for (const it of g.items ?? []) {
        const arr = byId.get(it.itemId) ?? [];
        arr.push({ receivedAt: g.date, qty: it.quantity, unitCost: it.unitCost, supplierId: g.supplierId, supplierName: g.supplierName });
        byId.set(it.itemId, arr);
      }
    }
    return byId;
  }, [confirmedGrvs]);

  const [focusIngredientId, setFocusIngredientId] = useState<string>('');
  useEffect(() => {
    if (!recipe?.ingredients?.length) {
      setFocusIngredientId('');
      return;
    }
    if (!recipe.ingredients.some((i) => i.ingredientId === focusIngredientId)) {
      setFocusIngredientId(recipe.ingredients[0].ingredientId);
    }
  }, [recipe?.id, recipe?.ingredients, focusIngredientId]);

  const focusLots = useMemo(() => purchasesByItemId.get(focusIngredientId) ?? [], [purchasesByItemId, focusIngredientId]);
  const focusTiers = useMemo(() => computeCostTiersFromPurchases(focusLots), [focusLots]);

  const sim = useMemo(() => {
    if (!menuItem || !recipe) return null;
    const outputQty = Number.isFinite(recipe.outputQty) && recipe.outputQty > 0 ? recipe.outputQty : 1;
    const multiplier = qty / outputQty;

    const deductions = (recipe.ingredients ?? []).map((ing) => ({
      itemId: ing.ingredientId,
      qty: round2((Number.isFinite(ing.requiredQty) ? ing.requiredQty : 0) * multiplier),
    })).filter((d) => d.qty > 0);

    const costBreakdown = deductions.map((d) => {
      const item = stockItems.find((s) => s.id === d.itemId);
      const purchases = purchasesByItemId.get(d.itemId) ?? [];
      const tiers = computeCostTiersFromPurchases(purchases);

      const weighted = Number.isFinite(item?.currentCost) ? (item!.currentCost) : (tiers.weightedAvg || 0);
      const latest = tiers.latest || weighted;
      const unitCost = costMode === 'latest' ? latest : weighted;
      const lineCost = unitCost * d.qty;
      return { itemId: d.itemId, qty: d.qty, unitCost, lineCost };
    });

    const totalCogs = costBreakdown.reduce((sum, l) => sum + (Number.isFinite(l.lineCost) ? l.lineCost : 0), 0);
    const totalSales = sellingPrice * qty;
    const totalGp = totalSales - totalCogs;
    const gpPercent = totalSales > 0 ? (totalGp / totalSales) * 100 : 0;
    const cogsEach = qty > 0 ? totalCogs / qty : 0;

    return {
      qty,
      sellingPriceEach: sellingPrice,
      cogsEach,
      gpPercent,
      deductions,
      costBreakdown,
      totalSales,
      totalCogs,
      totalGp,
    };
  }, [menuItem, recipe, qty, sellingPrice, stockItems, purchasesByItemId, costMode]);

  const recommendedPrice = useMemo(() => {
    if (!sim) return { raw: 0, recommended: 0 };
    return recommendSellingPrice({ cogsEach: sim.cogsEach, targetGpPercent: targetGp, rounding: priceRounding });
  }, [sim, targetGp, priceRounding]);

  useEffect(() => {
    if (!autoPrice) return;
    if (!sim) return;
    if (!Number.isFinite(recommendedPrice.recommended) || recommendedPrice.recommended <= 0) return;
    setSellingPrice(recommendedPrice.recommended);
  }, [autoPrice, sim?.cogsEach, targetGp, priceRounding]);

  const supplierRipoff = useMemo(() => {
    const threshold = 1.12;
    if (!focusIngredientId) return [] as Array<{ supplierId: string; supplierName: string; avgUnitCost: number; weightedAvg: number; flag: boolean }>;

    const lots = purchasesByItemId.get(focusIngredientId) ?? [];
    const tiers = computeCostTiersFromPurchases(lots);
    const weightedAvg = tiers.weightedAvg;

    const bySupplier = lots.reduce<Record<string, { supplierId: string; supplierName: string; avg: number; qty: number }>>((acc, lot) => {
      const prev = acc[lot.supplierId];
      if (!prev) acc[lot.supplierId] = { supplierId: lot.supplierId, supplierName: lot.supplierName, avg: lot.unitCost, qty: lot.qty };
      else {
        const totalQty = prev.qty + lot.qty;
        const avg = totalQty > 0 ? (prev.avg * prev.qty + lot.unitCost * lot.qty) / totalQty : prev.avg;
        acc[lot.supplierId] = { supplierId: lot.supplierId, supplierName: lot.supplierName, avg, qty: totalQty };
      }
      return acc;
    }, {});

    return Object.values(bySupplier)
      .map((s) => ({
        supplierId: s.supplierId,
        supplierName: s.supplierName,
        avgUnitCost: s.avg,
        weightedAvg,
        flag: weightedAvg > 0 && s.avg > weightedAvg * threshold,
      }))
      .sort((a, b) => (b.flag ? 1 : 0) - (a.flag ? 1 : 0) || b.avgUnitCost - a.avgUnitCost);
  }, [purchasesByItemId, focusIngredientId]);

  const maxProducible = useMemo(() => {
    if (!recipe) return { maxUnits: 0, limitingItemId: null as string | null };
    return computeMaxProducible({ recipe, stockItems });
  }, [recipe?.id, recipe?.ingredients, recipe?.outputQty, stockItems]);

  const suggestedIngredients = useMemo(() => {
    if (!menuItem) return [];
    return suggestIngredients({ menuItem, stockItems, limit: 8 });
  }, [menuItem?.id, stockItems]);

  const limitingIngredientName = useMemo(() => {
    if (!maxProducible.limitingItemId) return null;
    return stockItems.find((s) => s.id === maxProducible.limitingItemId)?.name ?? maxProducible.limitingItemId;
  }, [maxProducible.limitingItemId, stockItems]);

  const lastConfirmedGrv = useMemo(() => {
    const confirmed = confirmedGrvs
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return confirmed[0] ?? null;
  }, [confirmedGrvs]);

  const canAutoBuildRecipe = Boolean(menuItem && !recipe && stockItems.length);

  const autoBuildRecipe = async () => {
    if (!menuItem) return;
    const suggestions = suggestIngredients({ menuItem, stockItems, limit: 10 });
    if (!suggestions.length) {
      toast({ title: 'No suggestions', description: 'Add stock items first, then try again.', variant: 'destructive' });
      return;
    }

    const byId = new Map(stockItems.map((s) => [s.id, s] as const));
    const ingredients = suggestions
      .map((sug, idx) => {
        const s = byId.get(sug.itemId);
        if (!s) return null;
        const qty = defaultQtyForUnitType(s.unitType);
        return {
          id: `ri-${Date.now()}-${idx}`,
          ingredientId: s.id,
          ingredientCode: s.code,
          ingredientName: s.name,
          requiredQty: qty,
          unitType: s.unitType,
          unitCost: s.currentCost ?? 0,
        };
      })
      .filter(Boolean) as any;

    const code = String(menuItem.code ?? '').trim() || String(menuItem.id);
    const created = await upsertManufacturingRecipe({
      parentItemId: code,
      parentItemCode: code,
      parentItemName: String(menuItem.name),
      finishedGoodDepartmentId: 'bakery',
      outputQty: 1,
      outputUnitType: 'EACH',
      ingredients,
    });

    toast({
      title: 'Recipe skeleton created',
      description: `Created a starter recipe with ${created.ingredients.length} suggested ingredients. Edit quantities in Manufacturing → Recipes.`,
    });
  };

  const onPostSale = () => {
    if (!sim || !menuItem || !recipe) return;
    setMessage(null);

    const insufficient = sim.deductions
      .map((d) => {
        const item = stockItems.find((s) => s.id === d.itemId);
        const onHand = Number.isFinite(item?.currentStock) ? item!.currentStock : 0;
        return { ...d, onHand, name: item?.name ?? d.itemId, unitType: item?.unitType ?? '' };
      })
      .find((d) => d.qty > d.onHand + 1e-9);

    if (insufficient) {
      const uom = insufficient.unitType ? ` ${insufficient.unitType}` : '';
      toast({
        title: 'Insufficient stock',
        description: `${insufficient.name}: need ${insufficient.qty}${uom}, on hand ${insufficient.onHand}${uom}.`,
        variant: 'destructive',
      });
      return;
    }

    const res = applyStockDeductions(sim.deductions.map((d) => ({ itemId: d.itemId, qty: d.qty })));
    if (res.ok === false) {
      const first = res.insufficient[0];
      toast({
        title: 'Cannot post sale',
        description: `Insufficient stock for item ${first.itemId}.`,
        variant: 'destructive',
      });
      return;
    }

    if (includeOrder) {
      try {
        const total = sim.totalSales;
        const totalCost = sim.totalCogs;
        const grossProfit = sim.totalGp;
        const gpPercent = sim.gpPercent;

        addOrder({
          staffId: 'system',
          staffName: 'System',
          orderType: 'take_out',
          items: [{
            id: `oi-${Date.now()}`,
            menuItemId: menuItem.id,
            menuItemCode: menuItem.code,
            menuItemName: menuItem.name,
            quantity: sim.qty,
            unitPrice: sim.sellingPriceEach,
            unitCost: sim.cogsEach,
            total,
            isVoided: false,
            sentToKitchen: false,
          }],
          subtotal: total,
          tax: 0,
          total,
          totalCost,
          grossProfit,
          gpPercent,
          status: 'paid',
          paymentMethod: 'cash',
        });
      } catch {
        // ignore, stock deduction already applied
      }
    }

    const modeLabel = costMode === 'latest' ? "today's/latest" : 'weighted average';
    const orderLabel = includeOrder ? 'and sale recorded' : 'sale not recorded';
    setMessage(`Posted. Inventory deducted using ${modeLabel} costs (${orderLabel}).`);
    toast({ title: 'Sale posted', description: 'Inventory updated successfully.' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Mthunzi-Smart</h1>
          <p className="text-sm text-muted-foreground">Recipe Explosion + Real-time GP% + Three-Tier Costing</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/pos/menu">Manage POS Menu</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/app/manufacturing/recipes">Manage Recipes</Link>
          </Button>
          <Button variant="default" onClick={() => setAssistantOpen(true)} disabled={!menuItems.length}>
            <Sparkles className="h-4 w-4 mr-2" />AI Coach
          </Button>
        </div>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">Live</Badge>
            <span>{menuItems.length} menu items</span>
            <span>•</span>
            <span>{stockItems.length} stock items</span>
            <span>•</span>
            <span>{recipes.length} recipes</span>
            <span>•</span>
            <span>{confirmedGrvs.length} confirmed GRVs</span>
            {lastConfirmedGrv?.date ? (
              <>
                <span>•</span>
                <span>last GRV {String(lastConfirmedGrv.date)}</span>
              </>
            ) : null}
          </div>
          {menuItems.length <= 1 ? (
            <div className="flex items-center gap-2">
              <Badge variant="destructive">Menu looks empty</Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  resetPosMenuToDefaults();
                  toast({ title: 'POS menu reset', description: 'Default menu items restored.' });
                }}
              >
                Restore defaults
              </Button>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Menu Item</div>
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span className="truncate">
                    {menuItem ? `${menuItem.name}` : 'Select item…'}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 opacity-70" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search menu items…" value={menuSearch} onValueChange={setMenuSearch} />
                  <CommandEmpty>No menu item found.</CommandEmpty>
                  <CommandGroup>
                    {filteredMenu.map((m) => (
                      <CommandItem
                        key={m.id}
                        value={`${m.name} ${m.code}`}
                        onSelect={() => {
                          setMenuItemId(m.id);
                          setMenuSearch('');
                          setMenuOpen(false);
                        }}
                      >
                        <Check
                          className={cn('mr-2 h-4 w-4', menuItemId === m.id ? 'opacity-100' : 'opacity-0')}
                        />
                        <span className="truncate">{m.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground truncate">{m.code}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Selling Price</div>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={sellingPrice}
              onChange={(e) => setSellingPrice(Math.max(0, Number(e.target.value || 0)))}
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Quantity</div>
            <Input type="number" min={1} value={qty} onChange={e => setQty(Math.max(1, Number(e.target.value || 1)))} />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Cost Mode</div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={costMode === 'latest' ? 'default' : 'outline'}
                onClick={() => setCostMode('latest')}
                className="flex-1"
              >
                Today's (Latest)
              </Button>
              <Button
                type="button"
                variant={costMode === 'weightedAvg' ? 'default' : 'outline'}
                onClick={() => setCostMode('weightedAvg')}
                className="flex-1"
              >
                Weighted Avg
              </Button>
            </div>
          </div>
        </div>

        {!menuItem ? (
          <div className="text-sm text-muted-foreground">No POS menu items found.</div>
        ) : !recipe ? (
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="text-sm text-destructive">
              No recipe found for this menu item. Create one in <Link className="underline" to="/app/manufacturing/recipes">Manufacturing → Recipes</Link>.
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAssistantOpen(true)}
                disabled={!menuItem}
              >
                <Sparkles className="h-4 w-4 mr-2" />Open AI Coach
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!canAutoBuildRecipe}
                onClick={autoBuildRecipe}
              >
                <Wand2 className="h-4 w-4 mr-2" />Auto-build recipe
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Real-time GP% (based on costs)</div>
              <div className="text-3xl font-bold tabular-nums">{sim ? fmtPct(sim.gpPercent) : '—'}</div>
              <div className="text-sm text-muted-foreground mt-1">
                Sales: {fmtMoney(sellingPrice)} each · COGS: {fmtMoney(sim?.cogsEach ?? 0)} each
              </div>
              {sim ? (
                <div className="mt-3 text-xs text-muted-foreground">
                  AI price @ {targetGp}% GP ≈ <span className="font-mono">{fmtMoney(recommendedPrice.recommended)}</span>
                </div>
              ) : null}
            </Card>

            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Ingredient Cost Tiers</div>
              <div className="mt-2">
                <div className="text-xs text-muted-foreground mb-1">Focus Ingredient</div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                      {recipe.ingredients.find((i) => i.ingredientId === focusIngredientId)?.ingredientName ?? 'Select ingredient'}
                      <ChevronsUpDown className="h-4 w-4 opacity-70" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandEmpty>No ingredient found.</CommandEmpty>
                      <CommandGroup>
                        {(recipe.ingredients ?? []).map((ing) => (
                          <CommandItem
                            key={ing.ingredientId}
                            value={`${ing.ingredientName} ${ing.ingredientCode}`}
                            onSelect={() => setFocusIngredientId(ing.ingredientId)}
                          >
                            <Check className={cn('mr-2 h-4 w-4', focusIngredientId === ing.ingredientId ? 'opacity-100' : 'opacity-0')} />
                            <span className="truncate">{ing.ingredientName}</span>
                            <span className="ml-2 text-xs text-muted-foreground truncate">{ing.ingredientCode}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div>Lowest</div><div className="text-right font-mono">{fmtMoney(focusTiers.lowest)}</div>
                <div>Highest</div><div className="text-right font-mono">{fmtMoney(focusTiers.highest)}</div>
                <div>Weighted Avg</div><div className="text-right font-mono">{fmtMoney(focusTiers.weightedAvg)}</div>
                <div>Today's (Latest)</div><div className="text-right font-mono">{fmtMoney(focusTiers.latest)}</div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Post the Sale (Deduct Inventory)</div>
              <div className="text-xs text-muted-foreground mt-1">
                Deducts directly from your live stock balances.
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Record POS order</div>
                  <div className="text-xs text-muted-foreground">Writes a paid order so dashboards update.</div>
                </div>
                <Switch checked={includeOrder} onCheckedChange={setIncludeOrder} />
              </div>
              <div className="mt-3 flex gap-2">
                <Button onClick={onPostSale} disabled={!sim}>Post Sale</Button>
                <Button variant="secondary" onClick={() => setMessage(null)}>Clear</Button>
              </div>
              {message && <div className="mt-2 text-sm">{message}</div>}
              {recipe ? (
                <div className="mt-3 text-xs text-muted-foreground">
                  Max producible now: <span className="font-mono">{maxProducible.maxUnits}</span>
                  {limitingIngredientName ? <span> (limit: {limitingIngredientName})</span> : null}
                </div>
              ) : null}
            </Card>
          </div>
        )}

        {sim && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card className="p-4">
              <div className="font-semibold mb-2">Recipe Explosion (Deduction Logic)</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">On Hand (Main Store)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sim.deductions.map(d => {
                    const item = stockItems.find(i => i.id === d.itemId);
                    const itemName = item?.name ?? d.itemId;
                    const onHand = Number.isFinite(item?.currentStock) ? item!.currentStock : 0;
                    const ok = onHand >= d.qty;
                    return (
                      <TableRow key={d.itemId}>
                        <TableCell className="font-medium">{itemName}</TableCell>
                        <TableCell className="text-right font-mono">{d.qty}</TableCell>
                        <TableCell className="text-right font-mono">
                          <span className={ok ? '' : 'text-destructive'}>{onHand}</span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>

            <Card className="p-4">
              <div className="font-semibold mb-2">COGS Breakdown</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Unit Cost</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Line Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sim.costBreakdown.map(l => {
                    const itemName = stockItems.find(i => i.id === l.itemId)?.name ?? l.itemId;
                    return (
                      <TableRow key={l.itemId}>
                        <TableCell className="font-medium">{itemName}</TableCell>
                        <TableCell className="text-right font-mono">{fmtMoney(l.unitCost)}</TableCell>
                        <TableCell className="text-right font-mono">{l.qty}</TableCell>
                        <TableCell className="text-right font-mono">{fmtMoney(l.lineCost)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="text-lg font-semibold">Supplier Rip-off Flag</div>
            <div className="text-sm text-muted-foreground">Auto-flags suppliers priced &gt; 12% above the overall weighted average for the focus ingredient.</div>
          </div>
        </div>

        <div className="mt-3 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Supplier Avg</TableHead>
                <TableHead className="text-right">Overall W.Avg</TableHead>
                <TableHead className="text-right">Flag</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {supplierRipoff.map((row) => (
                <TableRow key={row.supplierId}>
                  <TableCell className="font-medium">{row.supplierName}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(row.avgUnitCost)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(row.weightedAvg)}</TableCell>
                  <TableCell className="text-right">
                    {row.flag ? <Badge variant="destructive">RIPPING OFF</Badge> : <Badge variant="secondary">OK</Badge>}
                  </TableCell>
                </TableRow>
              ))}
              {!supplierRipoff.length && (
                <TableRow>
                  <TableCell colSpan={4} className="text-sm text-muted-foreground">No confirmed GRV purchases found for the focus ingredient.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={assistantOpen} onOpenChange={setAssistantOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>AI Coach (Mthunzi‑Smart)</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="p-4">
              <div className="text-sm font-semibold">Auto Price</div>
              <div className="mt-1 text-xs text-muted-foreground">Keeps your GP% on target based on live costs.</div>
              <div className="mt-3 flex items-center justify-between">
                <div className="text-sm">Autopilot</div>
                <Switch checked={autoPrice} onCheckedChange={setAutoPrice} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Target GP%</div>
                  <Input type="number" min={0} max={99} value={targetGp} onChange={(e) => setTargetGp(Math.min(99, Math.max(0, Number(e.target.value || 0))))} />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Rounding</div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-between">
                        {priceRounding === 'none' ? 'None' : `Nearest ${priceRounding}`}
                        <ChevronsUpDown className="h-4 w-4 opacity-70" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandGroup>
                          {(['0.5', '1', '5', 'none'] as PriceRounding[]).map((r) => (
                            <CommandItem key={r} value={r} onSelect={() => setPriceRounding(r)}>
                              <Check className={cn('mr-2 h-4 w-4', priceRounding === r ? 'opacity-100' : 'opacity-0')} />
                              {r === 'none' ? 'No rounding' : `Nearest ${r}`}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                Suggested price: <span className="font-mono">{fmtMoney(recommendedPrice.recommended)}</span>
              </div>
              <div className="mt-3">
                <Button
                  className="w-full"
                  variant="secondary"
                  disabled={!sim || recommendedPrice.recommended <= 0}
                  onClick={() => {
                    setSellingPrice(recommendedPrice.recommended);
                    toast({ title: 'Price applied', description: `Selling price set to ${fmtMoney(recommendedPrice.recommended)}.` });
                  }}
                >
                  Apply Suggested Price
                </Button>
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-sm font-semibold">Production Forecast</div>
              <div className="mt-1 text-xs text-muted-foreground">How many units you can make/sell right now from live ingredient stock.</div>
              <div className="mt-3">
                <div className="text-3xl font-bold tabular-nums">{recipe ? maxProducible.maxUnits : '—'}</div>
                <div className="text-xs text-muted-foreground">
                  {recipe ? (limitingIngredientName ? `Limiting ingredient: ${limitingIngredientName}` : 'No limiting ingredient found') : 'Create a recipe to unlock forecasts.'}
                </div>
              </div>
              {recipe && sim ? (
                <div className="mt-3 text-xs text-muted-foreground">
                  Current sale qty: <span className="font-mono">{sim.qty}</span> • Gross profit: <span className="font-mono">{fmtMoney(sim.totalGp)}</span>
                </div>
              ) : null}
            </Card>

            <Card className="p-4">
              <div className="text-sm font-semibold">Recipe Assistant</div>
              <div className="mt-1 text-xs text-muted-foreground">Auto-suggests ingredients from your stock list.</div>
              {recipe ? (
                <div className="mt-3 text-xs text-muted-foreground">Recipe exists. Edit it in Manufacturing → Recipes.</div>
              ) : (
                <>
                  <div className="mt-3 space-y-2">
                    {suggestedIngredients.length ? (
                      <div className="text-xs text-muted-foreground">
                        Suggestions: {suggestedIngredients.map((s) => stockItems.find((x) => x.id === s.itemId)?.name ?? s.itemId).slice(0, 3).join(', ')}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">No suggestions yet. Add more stock items for better matches.</div>
                    )}
                    <Button className="w-full" variant="default" disabled={!canAutoBuildRecipe} onClick={autoBuildRecipe}>
                      <Wand2 className="h-4 w-4 mr-2" />Auto-build Recipe Skeleton
                    </Button>
                  </div>
                </>
              )}
            </Card>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssistantOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
