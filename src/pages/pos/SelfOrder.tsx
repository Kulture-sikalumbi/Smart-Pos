import { useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import type { OrderItem } from '@/types/pos';
import { addOrder } from '@/lib/orderStore';
import { RecipeIncompleteError } from '@/lib/recipeEngine';
import { getManufacturingRecipesSnapshot } from '@/lib/manufacturingRecipeStore';
import { usePosMenu } from '@/hooks/usePosMenu';
import { useCurrency } from '@/contexts/CurrencyContext';
import { getFrontStockSnapshot, subscribeFrontStock } from '@/lib/frontStockStore';
import { useBranding } from '@/contexts/BrandingContext';
import { hexToHslVar } from '@/lib/color';
import { defaultCompanySettings } from '@/lib/companySettingsStore';
import { cn } from '@/lib/utils';

export default function SelfOrder() {
  const { formatMoneyPrecise } = useCurrency();
  const menu = usePosMenu();
  const categories = useMemo(() => menu.categories.slice().sort((a, b) => a.sortOrder - b.sortOrder), [menu.categories]);
  const menuItems = useMemo(() => menu.items.slice(), [menu.items]);
  const { tableNo } = useParams();
  const tableNumber = tableNo ? Number(tableNo) : null;

  const [selectedCategory, setSelectedCategory] = useState<string>(categories[0]?.id ?? 'breads');
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const frontStock = useSyncExternalStore(subscribeFrontStock, getFrontStockSnapshot);
  const { settings } = useBranding();
  const tabletBrandTheme = useMemo(() => {
    const hex = String(settings.primaryColorHex ?? '').trim();
    if (!hex || hex.toLowerCase() === String(defaultCompanySettings.primaryColorHex).toLowerCase()) return null;
    const hsl = hexToHslVar(hex);
    if (!hsl) return null;
    const hue = Number.parseFloat(String(hsl).split(' ')[0] ?? '24');
    const safeHue = Number.isFinite(hue) ? hue : 24;
    return {
      '--primary': hsl,
      '--ring': hsl,
      '--foreground': `${safeHue} 34% 8%`,
      '--background': `${safeHue} 58% 95%`,
      '--card': `${safeHue} 54% 98%`,
      '--card-foreground': `${safeHue} 34% 8%`,
      '--popover': `${safeHue} 54% 98%`,
      '--popover-foreground': `${safeHue} 34% 8%`,
      '--secondary': `${safeHue} 52% 90%`,
      '--secondary-foreground': `${safeHue} 34% 14%`,
      '--muted': `${safeHue} 44% 88%`,
      '--muted-foreground': `${safeHue} 20% 30%`,
      '--accent': `${safeHue} 52% 86%`,
      '--accent-foreground': `${safeHue} 34% 14%`,
      '--border': `${safeHue} 42% 74%`,
      '--input': `${safeHue} 42% 74%`,
    } as CSSProperties;
  }, [settings.primaryColorHex]);

  const items = useMemo(() => menuItems.filter(i => i.categoryId === selectedCategory && i.isAvailable), [menuItems, selectedCategory]);

  const totals = useMemo(() => {
    const subtotal = cart.reduce((sum, i) => sum + i.total, 0);
    const totalCost = cart.reduce((sum, i) => sum + (i.unitCost * i.quantity), 0);
    const tax = subtotal * 0.16 / 1.16;
    const grossProfit = subtotal - totalCost;
    return {
      subtotal,
      tax,
      total: subtotal,
      totalCost,
      grossProfit,
      gpPercent: subtotal > 0 ? (grossProfit / subtotal) * 100 : 0,
      itemCount: cart.reduce((sum, i) => sum + i.quantity, 0),
    };
  }, [cart]);

  const add = (menuItem: (typeof menuItems)[number]) => {
    setCart(prev => {
      const idx = prev.findIndex(p => p.menuItemId === menuItem.id);
      if (idx >= 0) {
        const next = [...prev];
        const item = next[idx];
        const q = item.quantity + 1;
        next[idx] = { ...item, quantity: q, total: q * item.unitPrice };
        return next;
      }
      return [
        ...prev,
        {
          id: `soi-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          menuItemId: menuItem.id,
          menuItemCode: menuItem.code,
          menuItemName: menuItem.name,
          quantity: 1,
          unitPrice: menuItem.price,
          unitCost: menuItem.cost,
          total: menuItem.price,
          isVoided: false,
          sentToKitchen: true,
        },
      ];
    });
  };

  const submit = () => {
    setMessage(null);
    if (!cart.length) return;

    try {
      const recipes = getManufacturingRecipesSnapshot();
      const recipeByCode = new Map(recipes.map((r) => [String(r.parentItemCode), r] as const));
      const menuById = new Map(menuItems.map((m) => [m.id, m] as const));
      const saleProducedCodes = new Set(
        (frontStock ?? [])
          .filter((r) => String(r.locationTag ?? '').toUpperCase() === 'SALE')
          .map((r) => String(r.producedCode ?? '').trim().toLowerCase())
          .filter(Boolean)
      );
      const saleItemCodes = new Set(
        (frontStock ?? [])
          .filter((r) => String(r.locationTag ?? '').toUpperCase() === 'SALE')
          .map((r) => String((r as any).itemCode ?? '').trim().toLowerCase())
          .filter(Boolean)
      );
      const saleItemNames = new Set(
        (frontStock ?? [])
          .filter((r) => String(r.locationTag ?? '').toUpperCase() === 'SALE')
          .map((r) => String((r as any).itemName ?? (r as any).producedName ?? '').trim().toLowerCase())
          .filter(Boolean)
      );

      for (const line of cart) {
        const mi = menuById.get(line.menuItemId);
        const code = String(mi?.code ?? line.menuItemCode);
        const name = String(mi?.name ?? '');
        const qty = Number.isFinite(line.quantity) ? line.quantity : 0;
        if (qty <= 0) continue;

        const directFrontStockLinked = Boolean((mi as any)?.physicalStockItemId);
        const directProducedSaleLinked = Boolean(code && saleProducedCodes.has(String(code).trim().toLowerCase()));
        const directSaleCodeLinked = Boolean(code && saleItemCodes.has(String(code).trim().toLowerCase()));
        const directSaleNameLinked = Boolean(name && saleItemNames.has(String(name).trim().toLowerCase()));
        if (directFrontStockLinked || directProducedSaleLinked || directSaleCodeLinked || directSaleNameLinked) {
          continue;
        }

        const recipe = recipeByCode.get(String(code));
        if (!recipe) throw new RecipeIncompleteError(line.menuItemId, ['NO_MANUFACTURING_RECIPE']);
      }

      addOrder({
        staffId: 'customer',
        staffName: 'Customer Self-Order',
        orderType: 'eat_in',
        tableNo: tableNumber ?? undefined,
        items: cart,
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        totalCost: totals.totalCost,
        grossProfit: totals.grossProfit,
        gpPercent: totals.gpPercent,
        status: 'sent',
      });

      setCart([]);
      setMessage('Order sent to kitchen. Thank you!');
    } catch (e) {
      if (e instanceof RecipeIncompleteError) {
        setMessage(`Recipe incomplete: ${e.menuItemId}. Manager must complete the recipe.`);
        return;
      }
      setMessage(e instanceof Error ? e.message : 'Failed to submit order');
    }
  };

  return (
    <div
      className={cn(
        'p-4 max-w-5xl mx-auto space-y-4',
        tabletBrandTheme
          ? 'min-h-screen bg-[radial-gradient(90%_66%_at_50%_-10%,hsl(var(--primary)/0.18),transparent_62%),radial-gradient(42%_36%_at_90%_16%,hsl(var(--primary)/0.12),transparent_76%)]'
          : ''
      )}
      style={tabletBrandTheme ?? undefined}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Self-Order</h1>
          <p className="text-sm text-muted-foreground">Table {tableNumber ?? '—'} · Scan QR and order directly</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{totals.itemCount} items</Badge>
          <Badge variant="default">{formatMoneyPrecise(totals.total, 0)}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Menu</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 flex-wrap mb-3">
              {categories.map(c => (
                <Button key={c.id} variant={selectedCategory === c.id ? 'default' : 'outline'} onClick={() => setSelectedCategory(c.id)}>
                  {c.name}
                </Button>
              ))}
            </div>

            <ScrollArea className="h-[520px]">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pr-2">
                {items.map(i => (
                  <Button key={i.id} variant="outline" className="h-auto py-3 justify-between" onClick={() => add(i)}>
                    <span className="text-left">
                      <span className="block font-medium text-sm">{i.name}</span>
                      <span className="block text-xs text-muted-foreground">{i.code}</span>
                    </span>
                    <span className="font-bold">{formatMoneyPrecise(Number(i.price), 2)}</span>
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your Order</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {cart.length === 0 ? (
              <div className="text-sm text-muted-foreground">Add items to your cart.</div>
            ) : (
              <div className="space-y-2">
                {cart.map(i => (
                  <div key={i.id} className="flex justify-between text-sm">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{i.menuItemName}</div>
                      <div className="text-xs text-muted-foreground">x{i.quantity}</div>
                    </div>
                    <div className="font-semibold">{formatMoneyPrecise(i.total, 0)}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-2 border-t text-sm space-y-1">
              <div className="flex justify-between"><span>Subtotal</span><span>{formatMoneyPrecise(totals.subtotal, 2)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>VAT</span><span>{formatMoneyPrecise(totals.tax, 2)}</span></div>
              <div className="flex justify-between font-bold"><span>Total</span><span>{formatMoneyPrecise(totals.total, 2)}</span></div>
            </div>

            <Button className="w-full" disabled={!cart.length} onClick={submit}>Send to Kitchen</Button>
            {message && <div className="text-sm">{message}</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
