import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/lib/supabaseClient';
import { useCurrency } from '@/contexts/CurrencyContext';
import { RefreshCw, BellRing, ShoppingCart, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

type TabletMenuRow = {
  brand_id: string;
  table_no: number;
  category_id: string | null;
  category_name: string | null;
  item_id: string;
  item_code: string;
  item_name: string;
  price: number;
  cost: number;
  is_available: boolean;
  image?: string | null;
};

type TabletCartItem = {
  itemId: string;
  code: string;
  name: string;
  price: number;
  qty: number;
};

const TABLET_DEVICE_ID_KEY = 'pmx.tablet.deviceId.v1';

function getOrCreateTabletDeviceId() {
  try {
    const existing = localStorage.getItem(TABLET_DEVICE_ID_KEY);
    if (existing && existing.trim()) return existing.trim();
    const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `tablet-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(TABLET_DEVICE_ID_KEY, uuid);
    return uuid;
  } catch {
    return `tablet-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

export default function TabletLockMode() {
  const { currencyCode, formatNumber } = useCurrency();
  const [deviceId] = useState(() => getOrCreateTabletDeviceId());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tableNo, setTableNo] = useState<number | null>(null);
  const [rows, setRows] = useState<TabletMenuRow[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [cart, setCart] = useState<TabletCartItem[]>([]);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [isLandscapeTablet, setIsLandscapeTablet] = useState(false);
  const [lastSubmittedOrder, setLastSubmittedOrder] = useState<{
    orderId?: string;
    orderNo?: number;
    status: 'delivered' | 'seen';
    deliveredAt: string;
    seenAt?: string;
  } | null>(null);

  const categories = useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of rows) {
      const id = String(r.category_id ?? 'uncategorized');
      const name = String(r.category_name ?? 'Other');
      if (!byId.has(id)) byId.set(id, name);
    }
    return Array.from(byId.entries()).map(([id, name]) => ({ id, name }));
  }, [rows]);

  const visibleItems = useMemo(() => {
    const source = rows;
    const filtered =
      selectedCategory === 'all'
        ? source
        : source.filter((r) => String(r.category_id ?? 'uncategorized') === selectedCategory);
    return filtered.slice().sort((a, b) => {
      if (a.is_available !== b.is_available) return a.is_available ? -1 : 1;
      return String(a.item_name ?? '').localeCompare(String(b.item_name ?? ''));
    });
  }, [rows, selectedCategory]);

  const totals = useMemo(() => {
    const subtotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
    return {
      itemCount: cart.reduce((sum, i) => sum + i.qty, 0),
      subtotal,
      tax: subtotal * 0.16 / 1.16,
      total: subtotal,
    };
  }, [cart]);

  const formatPrice = (amount: number, decimals = 2) => {
    const value = Number.isFinite(amount) ? amount : 0;
    return `${currencyCode} ${formatNumber(value, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
  };

  const loadMenu = async () => {
    if (!supabase) {
      setLoadError('Service unavailable.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.rpc('get_tablet_menu', { p_device_id: deviceId });
      if (error) {
        const msg = String(error.message ?? 'Unable to load tablet menu.');
        if (msg.includes('does not exist') || msg.includes('menu_unavailable')) {
          setLoadError('Menu is not ready yet. Ask admin to publish menu items first.');
        } else {
          setLoadError(msg);
        }
        setRows([]);
        setTableNo(null);
        return;
      }
      const payload = (Array.isArray(data) ? data : []) as TabletMenuRow[];
      setRows(payload);
      setTableNo(payload[0]?.table_no != null ? Number(payload[0].table_no) : null);
      if (!payload.length) {
        setLoadError('This tablet is not assigned yet. Ask staff to register it to a table.');
      }
    } catch (e: any) {
      setRows([]);
      setTableNo(null);
      setLoadError(e?.message ?? 'Unable to load tablet menu.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMenu();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  useEffect(() => {
    if (!categories.length) return;
    if (selectedCategory === 'all') return;
    if (categories.some((c) => c.id === selectedCategory)) return;
    setSelectedCategory('all');
  }, [categories, selectedCategory]);

  useEffect(() => {
    let mounted = true;
    const resolve = async () => {
      const next: Record<string, string> = {};
      for (const r of rows) {
        const raw = String((r as any).image ?? '').trim();
        if (!raw) continue;
        if (raw.startsWith('http://') || raw.startsWith('https://')) {
          next[r.item_id] = raw;
          continue;
        }
        try {
          const path = raw.replace(/^\/+/, '');
          const { data } = supabase?.storage.from('product-images').getPublicUrl(path) ?? { data: null as any };
          const pub = String((data as any)?.publicUrl ?? '').trim();
          if (pub) next[r.item_id] = pub;
        } catch {
          // ignore image resolution errors per-item
        }
      }
      if (mounted) setImageUrls(next);
    };
    void resolve();
    return () => { mounted = false; };
  }, [rows]);

  useEffect(() => {
    const check = () => {
      if (typeof window === 'undefined') return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      setIsLandscapeTablet(w >= 900 && w > h);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const addToCart = (row: TabletMenuRow) => {
    setSubmitMessage(null);
    setCart((prev) => {
      const idx = prev.findIndex((x) => x.itemId === row.item_id);
      if (idx === -1) {
        return [...prev, { itemId: row.item_id, code: row.item_code, name: row.item_name, price: Number(row.price ?? 0), qty: 1 }];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
      return next;
    });
  };

  const updateQty = (itemId: string, nextQty: number) => {
    setCart((prev) => {
      if (nextQty <= 0) return prev.filter((x) => x.itemId !== itemId);
      return prev.map((x) => (x.itemId === itemId ? { ...x, qty: nextQty } : x));
    });
  };

  const clearCart = () => {
    setCart([]);
    setSubmitMessage(null);
  };

  const submitOrder = async () => {
    if (!supabase) return;
    if (!cart.length) return;
    setSubmitBusy(true);
    setSubmitMessage(null);
    try {
      const submissionKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const itemsPayload = cart.map((c) => ({
        menu_item_id: c.itemId,
        quantity: c.qty,
      }));
      const { data, error } = await supabase.rpc('submit_tablet_order', {
        p_device_id: deviceId,
        p_submission_key: submissionKey,
        p_items: itemsPayload,
      });
      if (error) {
        setSubmitMessage(String(error.message ?? 'Unable to place order.'));
        return;
      }
      const ok = Boolean((data as any)?.ok ?? false);
      if (!ok) {
        setSubmitMessage(String((data as any)?.error ?? 'Unable to place order.'));
        return;
      }
      const orderNo = (data as any)?.order_no;
      const rawOrderId = (data as any)?.order_id;
      const orderId = rawOrderId != null ? String(rawOrderId).trim() : '';
      setCart([]);
      setSubmitMessage(orderNo ? `Order #${orderNo} placed successfully.` : 'Order placed successfully.');
      setLastSubmittedOrder({
        orderId: orderId || undefined,
        orderNo: Number.isFinite(Number(orderNo)) ? Number(orderNo) : undefined,
        status: 'delivered',
        deliveredAt: new Date().toISOString(),
      });
    } catch (e: any) {
      setSubmitMessage(e?.message ?? 'Unable to place order.');
    } finally {
      setSubmitBusy(false);
    }
  };

  const callWaiter = async () => {
    if (!supabase) return;
    setSubmitMessage(null);
    try {
      const key = `waiter-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const { data, error } = await supabase.rpc('tablet_call_waiter', {
        p_device_id: deviceId,
        p_submission_key: key,
      });
      if (error) {
        setSubmitMessage(String(error.message ?? 'Unable to call waiter.'));
        return;
      }
      const ok = Boolean((data as any)?.ok ?? false);
      if (!ok) {
        setSubmitMessage(String((data as any)?.error ?? 'Unable to call waiter.'));
        return;
      }
      setSubmitMessage('Waiter has been notified. Thank you!');
    } catch (e: any) {
      setSubmitMessage(e?.message ?? 'Unable to call waiter.');
    }
  };

  useEffect(() => {
    if (!supabase) return;
    const brandId = String(rows[0]?.brand_id ?? '').trim();
    if (!brandId || !lastSubmittedOrder?.orderId) return;
    const channel = supabase
      .channel(`tablet-order-seen-${brandId}-${lastSubmittedOrder.orderId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pos_notifications',
          filter: `brand_id=eq.${brandId}`,
        },
        (payload) => {
          const row = payload.new as any;
          if (String(row?.type ?? '') !== 'tablet_order_seen') return;
          const seenOrderId = String(row?.payload?.orderId ?? '');
          if (!seenOrderId || seenOrderId !== lastSubmittedOrder.orderId) return;
          setLastSubmittedOrder((prev) => (prev ? { ...prev, status: 'seen', seenAt: new Date().toISOString() } : prev));
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [rows, lastSubmittedOrder?.orderId]);

  useEffect(() => {
    if (!lastSubmittedOrder) return;
    // Keep "Delivered" visible until cashier actually sees the order.
    // Once seen, keep the feedback longer, then reset for next customer.
    if (lastSubmittedOrder.status !== 'seen') return;
    const timer = window.setTimeout(() => {
      setLastSubmittedOrder(null);
      setSubmitMessage(null);
    }, 60000);
    return () => window.clearTimeout(timer);
  }, [lastSubmittedOrder?.status, lastSubmittedOrder?.orderId]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/20 p-3 sm:p-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <Card className="border-sky-500/30 bg-sky-500/5">
          <CardContent className="py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <div className="font-medium flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-sky-500" />
                Need help?
              </div>
              <div className="text-xs text-muted-foreground">
                Tap to request a waiter. Your request appears instantly at the cashier terminal.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => void loadMenu()}
                disabled={loading || submitBusy}
                title="Refresh menu"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button
                onClick={callWaiter}
                disabled={loading || submitBusy || !tableNo}
                className="min-w-[130px]"
              >
                <BellRing className="h-4 w-4 mr-2" />
                Call Waiter
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          {tableNo ? <Badge variant="secondary">Table {tableNo}</Badge> : null}
          <Badge variant="outline">{currencyCode}</Badge>
          <Badge variant="secondary">{totals.itemCount} item{totals.itemCount === 1 ? '' : 's'}</Badge>
          <Badge>{formatPrice(totals.total, 2)}</Badge>
        </div>

        {!tableNo ? (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="py-3 space-y-2">
              <div className="text-sm font-medium">Tablet setup required</div>
              <div className="text-xs text-muted-foreground">
                This feature is optional. To use table tablets: first configure tables, then set up this device as a tablet on the Tables page.
              </div>
              <div className="text-xs">
                Device ID: <span className="font-mono">{deviceId}</span>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {loading ? (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">Loading menu...</CardContent>
          </Card>
        ) : loadError ? (
          <Card>
            <CardContent className="py-8 space-y-2">
              <div className="text-sm text-destructive">{loadError}</div>
              <div className="text-xs text-muted-foreground">
                Tablet lock mode requires this device to be registered to a table by admin/supervisor.
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Menu</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={selectedCategory === 'all' ? 'default' : 'outline'}
                    onClick={() => setSelectedCategory('all')}
                  >
                    All
                  </Button>
                  {categories.map((c) => (
                    <Button
                      key={c.id}
                      size="sm"
                      variant={selectedCategory === c.id ? 'default' : 'outline'}
                      onClick={() => setSelectedCategory(c.id)}
                    >
                      {c.name}
                    </Button>
                  ))}
                </div>
                <ScrollArea className="h-[58vh] pr-2">
                  <div className={cn('grid gap-2.5', isLandscapeTablet ? 'grid-cols-3 md:grid-cols-4 xl:grid-cols-5' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4')}>
                    {visibleItems.map((r) => (
                      <button
                        key={r.item_id}
                        type="button"
                        className={cn(
                          'group rounded-xl border bg-card text-left overflow-hidden transition-all',
                          r.is_available
                            ? 'hover:bg-accent/30 hover:shadow-md active:scale-[0.99]'
                            : 'opacity-60 cursor-not-allowed'
                        )}
                        onClick={() => {
                          if (!r.is_available) {
                            setSubmitMessage(`${r.item_name} is currently out of stock.`);
                            return;
                          }
                          addToCart(r);
                        }}
                      >
                        <div className="aspect-[5/4] bg-muted/40 overflow-hidden">
                          {imageUrls[r.item_id] ? (
                            <img
                              src={imageUrls[r.item_id]}
                              alt={r.item_name}
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center text-2xl">🍽️</div>
                          )}
                        </div>
                        <div className="p-2.5">
                          <div className="font-medium text-[13px] leading-tight line-clamp-2">{r.item_name}</div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground truncate">{r.item_code}</div>
                          {!r.is_available ? (
                            <Badge variant="destructive" className="mt-1 text-[10px] h-5">Out of stock</Badge>
                          ) : null}
                          <div className="mt-1.5 font-semibold text-sm">{formatPrice(Number(r.price ?? 0), 2)}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4" />
                  Your Order
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {cart.length > 0 ? (
                  <Button variant="outline" size="sm" className="w-full" onClick={clearCart}>
                    Clear Order
                  </Button>
                ) : null}
                {!cart.length ? (
                  <div className="text-sm text-muted-foreground">Tap any menu item to add it.</div>
                ) : (
                  <div className="space-y-2">
                    {cart.map((c) => (
                      <div key={c.itemId} className="rounded-md border p-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{c.name}</div>
                            <div className="text-xs text-muted-foreground">{c.code}</div>
                          </div>
                          <div className="text-sm font-semibold">{formatPrice(c.price * c.qty, 2)}</div>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => updateQty(c.itemId, c.qty - 1)}>-</Button>
                          <Input
                            value={String(c.qty)}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              if (Number.isFinite(n)) updateQty(c.itemId, Math.max(0, Math.floor(n)));
                            }}
                            className="h-8 text-center"
                            inputMode="numeric"
                          />
                          <Button size="sm" variant="outline" onClick={() => updateQty(c.itemId, c.qty + 1)}>+</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="border-t pt-2 text-sm space-y-1">
                  <div className="flex justify-between"><span>Subtotal</span><span>{formatPrice(totals.subtotal, 2)}</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>VAT</span><span>{formatPrice(totals.tax, 2)}</span></div>
                  <div className="flex justify-between font-semibold"><span>Total</span><span>{formatPrice(totals.total, 2)}</span></div>
                </div>

                <Button className="w-full" disabled={!cart.length || submitBusy} onClick={submitOrder}>
                  {submitBusy ? 'Placing order...' : 'Place Order'}
                </Button>
                {lastSubmittedOrder ? (
                  <div className="rounded-md border px-2.5 py-2 text-xs bg-muted/20">
                    <div className="font-medium">
                      {lastSubmittedOrder.orderNo ? `Order #${lastSubmittedOrder.orderNo}` : 'Latest order'}
                    </div>
                    <div className="mt-0.5 text-muted-foreground">
                      Status:{' '}
                      <span className={cn('inline-flex items-center gap-1 font-semibold', lastSubmittedOrder.status === 'seen' ? 'text-sky-600' : 'text-emerald-600')}>
                      {lastSubmittedOrder.status === 'seen' ? '✓✓ Seen' : '✓ Delivered'}
                      </span>{' '}
                      {lastSubmittedOrder.status === 'seen' && lastSubmittedOrder.seenAt
                        ? `at ${new Date(lastSubmittedOrder.seenAt).toLocaleTimeString()}`
                        : `at ${new Date(lastSubmittedOrder.deliveredAt).toLocaleTimeString()}`}
                    </div>
                  </div>
                ) : null}
                {submitMessage ? <div className="text-sm">{submitMessage}</div> : null}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
