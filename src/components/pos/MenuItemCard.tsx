import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { POSMenuItem } from '@/types/pos';
import { useEffect, useState, useMemo, useSyncExternalStore } from 'react';
import { isSupabaseConfigured, supabase, SUPABASE_BUCKET } from '@/lib/supabaseClient';
import { subscribeStockItems, getStockItemsSnapshot } from '@/lib/stockStore';
import { subscribeManufacturingRecipes, getManufacturingRecipesSnapshot } from '@/lib/manufacturingRecipeStore';
import { subscribeFrontStock, getFrontStockSnapshot } from '@/lib/frontStockStore';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCurrency } from '@/contexts/CurrencyContext';

type Props = {
  item: POSMenuItem;
  onAdd: (item: POSMenuItem) => void;
  className?: string;
};

export default function MenuItemCard({ item, onAdd, className }: Props) {
  const { formatMoneyPrecise } = useCurrency();
  const [imgSrc, setImgSrc] = useState<string | undefined>(undefined);
  const stockItems = useSyncExternalStore(subscribeStockItems, getStockItemsSnapshot);
  const frontStock = useSyncExternalStore(subscribeFrontStock, getFrontStockSnapshot);
  const recipes = useSyncExternalStore(subscribeManufacturingRecipes, getManufacturingRecipesSnapshot);
  const [showLowStockModal, setShowLowStockModal] = useState(false);
  const [lowStockDetails, setLowStockDetails] = useState<Array<{ ingredientId: string; requiredPerUnit: number; onHand: number; name?: string }>>([]);
  const mfgOnHandByItemId = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of frontStock ?? []) {
      if (String(r.locationTag ?? '').toUpperCase() !== 'MANUFACTURING') continue;
      const id = String(r.itemId ?? '').trim();
      if (!id) continue;
      m.set(id, Number(r.quantity ?? 0) || 0);
    }
    return m;
  }, [frontStock]);
  const mfgMetaByItemId = useMemo(() => {
    const m = new Map<string, { qty: number; reorder: number }>();
    for (const r of frontStock ?? []) {
      if (String(r.locationTag ?? '').toUpperCase() !== 'MANUFACTURING') continue;
      const id = String(r.itemId ?? '').trim();
      if (!id) continue;
      const qty = Number(r.quantity ?? 0) || 0;
      const reorder = Number((r as any).reorderLevel ?? 0) || 0;
      m.set(id, { qty, reorder });
    }
    return m;
  }, [frontStock]);
  const saleOnHandByItemId = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of frontStock ?? []) {
      if (String(r.locationTag ?? '').toUpperCase() !== 'SALE') continue;
      const id = String(r.itemId ?? '').trim();
      if (!id) continue;
      m.set(id, Number(r.quantity ?? 0) || 0);
    }
    return m;
  }, [frontStock]);
  const saleMetaByItemId = useMemo(() => {
    const m = new Map<string, { qty: number; reorder: number }>();
    for (const r of frontStock ?? []) {
      if (String(r.locationTag ?? '').toUpperCase() !== 'SALE') continue;
      const id = String(r.itemId ?? '').trim();
      if (!id) continue;
      const qty = Number(r.quantity ?? 0) || 0;
      const reorder = Number((r as any).reorderLevel ?? 0) || 0;
      m.set(id, { qty, reorder });
    }
    return m;
  }, [frontStock]);
  const saleOnHandByCode = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of frontStock ?? []) {
      if (String(r.locationTag ?? '').toUpperCase() !== 'SALE') continue;
      const code = String(r.producedCode ?? r.itemCode ?? '').trim().toLowerCase();
      if (!code) continue;
      m.set(code, (m.get(code) ?? 0) + (Number(r.quantity ?? 0) || 0));
    }
    return m;
  }, [frontStock]);
  const saleMetaByCode = useMemo(() => {
    const m = new Map<string, { qty: number; reorder: number }>();
    for (const r of frontStock ?? []) {
      if (String(r.locationTag ?? '').toUpperCase() !== 'SALE') continue;
      const code = String(r.producedCode ?? r.itemCode ?? '').trim().toLowerCase();
      if (!code) continue;
      const qty = Number(r.quantity ?? 0) || 0;
      const reorder = Number((r as any).reorderLevel ?? 0) || 0;
      const prev = m.get(code) ?? { qty: 0, reorder: 0 };
      m.set(code, { qty: prev.qty + qty, reorder: Math.max(prev.reorder, reorder) });
    }
    return m;
  }, [frontStock]);
  const saleMetaByName = useMemo(() => {
    const m = new Map<string, { qty: number; reorder: number }>();
    for (const r of frontStock ?? []) {
      if (String(r.locationTag ?? '').toUpperCase() !== 'SALE') continue;
      const name = String(r.producedName ?? r.itemName ?? '').trim().toLowerCase();
      if (!name) continue;
      const qty = Number(r.quantity ?? 0) || 0;
      const reorder = Number((r as any).reorderLevel ?? 0) || 0;
      const prev = m.get(name) ?? { qty: 0, reorder: 0 };
      m.set(name, { qty: prev.qty + qty, reorder: Math.max(prev.reorder, reorder) });
    }
    return m;
  }, [frontStock]);

  const stockStatus = useMemo(() => {
    const directPhysicalId = String((item as any)?.physicalStockItemId ?? '').trim();
    const itemCode = String((item as any)?.code ?? '').trim().toLowerCase();
    const itemName = String((item as any)?.name ?? '').trim().toLowerCase();

    // 1) Ready-to-sell by physical item id
    if (directPhysicalId) {
      const meta = saleMetaByItemId.get(directPhysicalId) ?? { qty: 0, reorder: 0 };
      const onHand = Number(meta.qty ?? 0) || 0;
      const reorder = Number(meta.reorder ?? 0) || 0;
      const out = onHand <= 0;
      const atReorder = reorder > 0 && onHand > 0 && onHand <= reorder + 1e-9;
      const msg = out
        ? `Out of stock — restock ${item.name}`
        : atReorder
          ? `Only ${onHand} left — restock soon`
          : null;
      return { mode: 'SALE_PHYSICAL' as const, onHand, reorder, out, atReorder, msg };
    }

    // 2) Ready-to-sell by produced/item code
    if (itemCode) {
      const meta = saleMetaByCode.get(itemCode);
      // IMPORTANT: if there is a SALE row for this code, treat it as ready-to-sell linked
      // even when qty is 0 (still should NOT fall back to recipe; show out-of-stock instead).
      if (meta) {
        const onHand = Number(meta.qty ?? 0) || 0;
        const reorder = Number(meta.reorder ?? 0) || 0;
        const out = onHand <= 0;
        const atReorder = reorder > 0 && onHand > 0 && onHand <= reorder + 1e-9;
        const msg = out
          ? `Out of stock — restock ${item.name}`
          : atReorder
            ? `Only ${onHand} left — restock soon`
            : null;
        return { mode: 'SALE_CODE' as const, onHand, reorder, out, atReorder, msg };
      }
    }

    // 2b) Ready-to-sell by name (fallback for older/dirty menu codes)
    if (itemName) {
      const meta = saleMetaByName.get(itemName);
      if (meta) {
        const onHand = Number(meta.qty ?? 0) || 0;
        const reorder = Number(meta.reorder ?? 0) || 0;
        const out = onHand <= 0;
        const atReorder = reorder > 0 && onHand > 0 && onHand <= reorder + 1e-9;
        const msg = out
          ? `Out of stock — restock ${item.name}`
          : atReorder
            ? `Only ${onHand} left — restock soon`
            : null;
        return { mode: 'SALE_NAME' as const, onHand, reorder, out, atReorder, msg };
      }
    }

    // 3) Recipe path: estimate how many can still be made from MANUFACTURING.
    const recipe = recipes.find((r) => String(r.parentItemCode) === String(item.code) || String(r.parentItemId) === String(item.id));
    if (!recipe) return { mode: 'NONE' as const, onHand: null, reorder: null, out: false, atReorder: false, msg: null };

    const outputQty = recipe.outputQty && recipe.outputQty > 0 ? recipe.outputQty : 1;
    let limitingUnits = Infinity;
    let limitingName: string | null = null;
    let reorderUnits = Infinity;

    for (const ing of recipe.ingredients ?? []) {
      const requiredPerUnit = (Number(ing.requiredQty) || 0) / outputQty;
      if (requiredPerUnit <= 0) continue;
      const meta = mfgMetaByItemId.get(String(ing.ingredientId)) ?? { qty: 0, reorder: 0 };
      const onHand = Number(meta.qty ?? 0) || 0;
      const units = onHand / requiredPerUnit;
      if (units < limitingUnits) {
        limitingUnits = units;
        limitingName = String((ing as any).ingredientName ?? ing.ingredientId);
      }
      if (Number(meta.reorder ?? 0) > 0) {
        const ru = Number(meta.reorder ?? 0) / requiredPerUnit;
        reorderUnits = Math.min(reorderUnits, ru);
      }
    }

    const est = Number.isFinite(limitingUnits) ? Math.max(0, limitingUnits) : 0;
    const estWhole = Math.floor(est + 1e-9);
    const out = estWhole <= 0;
    const atReorder = Number.isFinite(reorderUnits) && reorderUnits !== Infinity && estWhole > 0 && est <= reorderUnits + 1e-9;

    const msg = out
      ? `Out of stock — restock ${limitingName ?? 'ingredients'}`
      : atReorder
        ? `Only ~${estWhole} left to make — restock ${limitingName ?? 'ingredients'}`
        : null;

    return { mode: 'RECIPE' as const, onHand: estWhole, reorder: Number.isFinite(reorderUnits) && reorderUnits !== Infinity ? Math.floor(reorderUnits) : null, out, atReorder, msg };
  }, [item, recipes, saleMetaByItemId, saleMetaByCode, saleMetaByName, mfgMetaByItemId]);

  const lowStock = useMemo(() => {
    try {
      const directPhysicalId = String((item as any)?.physicalStockItemId ?? '').trim();
      const itemCode = String((item as any)?.code ?? '').trim().toLowerCase();
      const itemName = String((item as any)?.name ?? '').trim().toLowerCase();
      if (directPhysicalId) {
        const saleOnHand = Number(saleOnHandByItemId.get(directPhysicalId) ?? 0);
        return saleOnHand < 1;
      }
      // Ready-to-sell linkage takes precedence over recipe path (even at qty 0).
      // If it's linked to SALE by code/name, show lowStock based on SALE qty and never use recipe.
      if (itemCode && saleMetaByCode.has(itemCode)) {
        const saleOnHandByMatchedCode = Number(saleOnHandByCode.get(itemCode) ?? 0);
        return saleOnHandByMatchedCode < 1;
      }
      if (itemName && saleMetaByName.has(itemName)) {
        const saleOnHandByMatchedName = Number(saleMetaByName.get(itemName)?.qty ?? 0) || 0;
        return saleOnHandByMatchedName < 1;
      }
      if (!recipes || !recipes.length) {
        console.debug('[MenuItemCard] lowStock check - no recipes', { code: item.code });
        return false;
      }
      const recipe = recipes.find((r) => String(r.parentItemCode) === String(item.code) || String(r.parentItemId) === String(item.id));
      if (!recipe) {
        console.debug('[MenuItemCard] lowStock check - no recipe for item', { code: item.code });
        return false;
      }
      const outputQty = recipe.outputQty && recipe.outputQty > 0 ? recipe.outputQty : 1;
      for (const ing of recipe.ingredients ?? []) {
        const requiredPerUnit = (Number(ing.requiredQty) || 0) / outputQty;
        const onHand = Number(mfgOnHandByItemId.get(String(ing.ingredientId)) ?? 0);
        console.debug('[MenuItemCard] lowStock check - ingredient', { code: item.code, ingredientId: ing.ingredientId, requiredPerUnit, onHand });
        if (onHand < requiredPerUnit) {
          console.debug('[MenuItemCard] lowStock=true', { code: item.code, ingredientId: ing.ingredientId, requiredPerUnit, onHand });
          return true;
        }
      }
      console.debug('[MenuItemCard] lowStock=false', { code: item.code });
      return false;
    } catch (err) {
      console.error('[MenuItemCard] lowStock check error', err, { code: item.code });
      return false;
    }
  }, [recipes, item, mfgOnHandByItemId, saleOnHandByItemId, saleOnHandByCode, saleMetaByCode, saleMetaByName]);

  useEffect(() => {
    let mounted = true;
    const resolve = async () => {
      try {
        const img = (item as any).image;
        if (!img) {
          if (mounted) setImgSrc(undefined);
          return;
        }
        if (typeof img === 'string' && img.startsWith('http')) {
          if (mounted) setImgSrc(img);
          return;
        }
        if (isSupabaseConfigured() && supabase && typeof img === 'string') {
          try {
            const path = img.replace(/^\/+/, '');
            const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
            const pub = (data as any)?.publicUrl ?? undefined;
            if (mounted) setImgSrc(pub);
            return;
          } catch (e) {
            // fallthrough to undefined
          }
        }
      } catch {
        // ignore
      }
      if (mounted) setImgSrc(undefined);
    };
    void resolve();
    return () => { mounted = false; };
  }, [item]);
  return (
    <Card
      className={cn(
        'group relative overflow-hidden bg-muted/30 hover:ring-2 hover:ring-primary transition-all active:scale-[0.99] aspect-[4/3]',
        className,
        lowStock ? 'opacity-85' : 'cursor-pointer'
      )}
      onClick={() => {
        try {
          if (lowStock) {
            // compute details and show modal
            const directPhysicalId = String((item as any)?.physicalStockItemId ?? '').trim();
            const itemCode = String((item as any)?.code ?? '').trim().toLowerCase();
            if (directPhysicalId) {
              const stock = stockItems.find((s) => s.id === directPhysicalId);
              const onHand = Number(saleOnHandByItemId.get(directPhysicalId) ?? 0);
              setLowStockDetails([{
                ingredientId: directPhysicalId,
                requiredPerUnit: 1,
                onHand,
                name: stock?.name ?? item.name,
              }]);
              setShowLowStockModal(true);
              return;
            }
            if (itemCode) {
              const onHand = Number(saleOnHandByCode.get(itemCode) ?? 0);
              if (onHand <= 0) {
                setLowStockDetails([{
                  ingredientId: itemCode,
                  requiredPerUnit: 1,
                  onHand,
                  name: item.name,
                }]);
                setShowLowStockModal(true);
                return;
              }
            }
            const recipe = recipes.find((r) => String(r.parentItemCode) === String(item.code) || String(r.parentItemId) === String(item.id));
            const outputQty = recipe?.outputQty && recipe.outputQty > 0 ? recipe.outputQty : 1;
            const details: Array<{ ingredientId: string; requiredPerUnit: number; onHand: number; name?: string }> = [];
            for (const ing of recipe?.ingredients ?? []) {
              const requiredPerUnit = (Number(ing.requiredQty) || 0) / outputQty;
              const stock = stockItems.find((s) => s.id === ing.ingredientId);
              const onHand = Number(mfgOnHandByItemId.get(String(ing.ingredientId)) ?? 0);
              if (onHand < requiredPerUnit) {
                details.push({ ingredientId: ing.ingredientId, requiredPerUnit, onHand, name: stock?.name });
              }
            }
            setLowStockDetails(details);
            setShowLowStockModal(true);
            console.debug('[MenuItemCard] click blocked - lowStock', { code: item.code, details });
            return;
          }
        } catch (err) {
          console.error('[MenuItemCard] click error computing lowStock details', err);
        }
        console.log('[MenuItemCard] click', { code: item.code, lowStock });
        let clickFired = false;
        if (!clickFired) {
          clickFired = true;
          onAdd(item);
        }
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (lowStock) {
            // simulate click to show modal
            setShowLowStockModal(true);
            return;
          }
          console.debug('[MenuItemCard] key add', { code: item.code, lowStock });
          onAdd(item);
        }
      }}
    >
      <CardContent className="p-0 h-full">
        <div className="absolute inset-0">
          <img
            src={imgSrc ?? '/menu/placeholder-burger.svg'}
            alt={item.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.src = '/menu/placeholder-burger.svg';
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
        </div>

        <div className="relative h-full p-3 flex flex-col justify-between">
          <div className="flex items-start justify-end">
            <div className="rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white/90">
              {item.code}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold leading-snug text-white line-clamp-2">{item.name}</p>
            <div className="mt-2 flex items-end justify-between">
              <span className="text-[11px] text-white/80">{lowStock ? 'Low stock' : 'Tap to add'}</span>
              <span className="text-sm font-bold text-white">{formatMoneyPrecise(item.price, 2)}</span>
            </div>
          </div>
        </div>
      </CardContent>
      {lowStock ? (
        <div className="absolute top-2 left-2 rounded-md bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">Low Stock</div>
      ) : null}
      {stockStatus?.out ? (
        <div className="absolute top-2 left-2 rounded-md bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">Out of stock</div>
      ) : stockStatus?.atReorder ? (
        <div className="absolute top-2 left-2 rounded-md bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">Restock soon</div>
      ) : null}
      {stockStatus?.msg ? (
        <div className="absolute bottom-2 left-2 right-2 rounded-md bg-black/55 px-2 py-1 text-[11px] text-white">
          {stockStatus.msg}
        </div>
      ) : null}

      <Dialog open={showLowStockModal} onOpenChange={setShowLowStockModal}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Low stock: {item.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm">This item cannot be added because the following ingredients are low on stock:</p>
            <ul className="list-disc pl-5">
              {lowStockDetails.length ? lowStockDetails.map(d => (
                <li key={d.ingredientId} className="text-sm">
                  {d.name ?? d.ingredientId}: on hand {d.onHand} &lt; required {d.requiredPerUnit}
                </li>
              )) : <li className="text-sm">Insufficient stock</li>}
            </ul>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => setShowLowStockModal(false)}>Close</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
