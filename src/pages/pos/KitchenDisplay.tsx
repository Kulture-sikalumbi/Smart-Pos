import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Clock, Check, ChefHat, AlertCircle, Flame, Play, Undo2, Filter, Search, CheckCircle2, Volume2, VolumeX } from 'lucide-react';
import { PageHeader } from '@/components/common/PageComponents';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  getOrdersSnapshot,
  markOrderItemPrepared,
  markOrderStarted,
  markOrderReady,
  markOrderServed,
  notifyOrderReady,
  subscribeOrders,
} from '@/lib/orderStore';
import {
  clearKitchenForOrder,
  ensureKitchenItemsFromOrders,
  getKitchenSnapshot,
  upsertKitchenItemStatus,
  subscribeKitchen,
  type KitchenItemStatus,
} from '@/lib/kitchenStore';
import useKitchenRealtime from '@/hooks/useKitchenRealtime';
import { fetchAndReplaceOrdersFromSupabase } from '@/lib/orderStore';
import { useAuth } from '@/contexts/AuthContext';
import { ROLE_NAMES } from '@/types/auth';
import type { OrderItem } from '@/types/pos';
// debug viewer removed

export default function KitchenDisplay() {
  const { user } = useAuth();
  // subscribe to DB realtime events for kitchen items
  useKitchenRealtime();
  const prefersReducedMotion = useReducedMotion();

  // Seed from DB on mount so KDS doesn't depend on local storage
  useEffect(() => {
    void fetchAndReplaceOrdersFromSupabase().catch(() => undefined);
  }, []);

  const orders = useSyncExternalStore(subscribeOrders, getOrdersSnapshot, getOrdersSnapshot);

  // Local state for kitchen items to force re-renders
  const [localKitchenItems, setLocalKitchenItems] = useState(() => getKitchenSnapshot().items);
  // debug viewer removed

  // render summary

  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      return localStorage.getItem('mthunzi.kds.sound.v1') !== '0';
    } catch {
      return true;
    }
  });

  const audioCtxRef = useRef<AudioContext | null>(null);
  const initializedOrdersRef = useRef(false);
  const prevTicketIdsRef = useRef<Set<string>>(new Set());
  const initializedUrgentRef = useRef(false);
  const prevUrgentIdsRef = useRef<Set<string>>(new Set());

  function ensureAudioContext() {
    if (typeof window === 'undefined') return null;
    const AnyWindow = window as any;
    const Ctx = window.AudioContext ?? AnyWindow.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
    const ctx = audioCtxRef.current;
    // Browsers require a user gesture to start audio; toggling sound counts.
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined);
    }
    return ctx;
  }

  function playBeep(pattern: 'new' | 'urgent' = 'new') {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const base = pattern === 'urgent' ? 980 : 880;
    const count = pattern === 'urgent' ? 2 : 1;

    for (let i = 0; i < count; i++) {
      const start = now + i * 0.18;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(base, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + 0.16);
    }
  }

  useEffect(() => {
    try {
      localStorage.setItem('mthunzi.kds.sound.v1', soundEnabled ? '1' : '0');
    } catch {
      // ignore
    }
  }, [soundEnabled]);

  useEffect(() => {
    // Live timers (elapsed minutes)
    const t = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    // Ensure newly-sent items have a persisted kitchen status
    ensureKitchenItemsFromOrders(orders);
  }, [orders]);

  useEffect(() => {
    // Keep localKitchenItems in sync with persisted kitchen store so UI reflects
    // updates made elsewhere (e.g., ensureKitchenItemsFromOrders or other tabs).
    const unsub = subscribeKitchen(() => {
      try {
        setLocalKitchenItems(getKitchenSnapshot().items);
      } catch {
        // ignore
      }
    });
    return () => unsub();
  }, []);

  const kitchenKey = useMemo(() => {
    const m = new Map<string, KitchenItemStatus>();
    for (const it of localKitchenItems) m.set(`${it.orderId}:${it.itemId}`, it.status);
    // kitchenKey updated
    return m;
  }, [localKitchenItems]);

  function getItemStatus(order: (typeof orders)[number], item: (typeof orders)[number]['items'][number]): KitchenItemStatus {
    // Prefer local kitchen store first (so UI actions like "Done" are immediate),
    // then fall back to preparedAt and DB-backed `kitchenStatus`.
    const localKey = kitchenKey.get(`${order.id}:${item.id}`);
    if (localKey) {
      if (localKey === 'ready' || localKey === 'served') return 'ready';
      if (localKey === 'preparing' || localKey === 'in_progress') return 'preparing';
      return 'pending';
    }

    if (item.preparedAt) return 'ready';

    const ks = (item as any).kitchenStatus ?? undefined;
    if (ks) {
      if (ks === 'ready' || ks === 'served') return 'ready';
      if (ks === 'preparing' || ks === 'in_progress') return 'preparing';
      return 'pending';
    }

    return 'pending';
  }

  function getElapsedMinutes(order: (typeof orders)[number]) {
    const base = order.sentAt ?? order.createdAt;
    const ms = now - new Date(base).getTime();
    return Math.max(0, Math.floor(ms / 60000));
  }

  function setItem(orderId: string, itemId: string, status: KitchenItemStatus, preparedAt?: string) {
    // setItem called
    upsertKitchenItemStatus({ orderId, itemId, status });
    // NOTE: do NOT persist per-item prepared state here. We keep it local in the
    // kitchen store so clicking "Done" keeps the ticket in Ready To Pass without
    // notifying the POS. The explicit "Pass" button will call `markOrderReady`
    // to persist the order and notify the POS.
    
    // Update local state to force re-render
    setLocalKitchenItems(prev => {
      const existingIndex = prev.findIndex(item => item.orderId === orderId && item.itemId === itemId);
      const newItem = {
        orderId,
        itemId,
        status,
        updatedAt: new Date().toISOString()
      };
      
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = newItem;
        return updated;
      } else {
        return [...prev, newItem];
      }
    });
  }

  function isTicketComplete(order: (typeof orders)[number]) {
    const kitchenItems = order.items.filter((i) => i.sentToKitchen && !i.isVoided);
    if (!kitchenItems.length) return true;
    return kitchenItems.every((it) => getItemStatus(order, it) === 'ready');
  }

  const activeOrders = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result = orders
      .filter((o) => ['sent', 'in_progress', 'ready', 'paid', 'open'].includes(o.status))
      // include any order that has kitchen items (even if they're all ready)
      .filter((o) => o.items.some((i) => i.sentToKitchen === true && !i.isVoided))
      .filter((o) => {
        if (!q) return true;
        const hay = `${o.orderNo} ${o.tableNo ?? ''} ${o.staffName} ${o.orderType}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => new Date(a.sentAt ?? a.createdAt).getTime() - new Date(b.sentAt ?? b.createdAt).getTime());
    
    return result;
  }, [orders, query]);

  useEffect(() => {
    // Sound notification for new kitchen tickets (only once per ticket).
    const currentTicketIds = new Set(activeOrders.filter((o) => o.status === 'sent').map((o) => o.id));

    if (!initializedOrdersRef.current) {
      initializedOrdersRef.current = true;
      prevTicketIdsRef.current = currentTicketIds;
      return;
    }

    if (soundEnabled) {
      let hasNew = false;
      for (const id of currentTicketIds) {
        if (!prevTicketIdsRef.current.has(id)) {
          hasNew = true;
          break;
        }
      }
      if (hasNew) playBeep('new');
    }

    prevTicketIdsRef.current = currentTicketIds;
  }, [activeOrders, soundEnabled]);

  useEffect(() => {
    // Urgent alert (15+ minutes) once per ticket.
    const urgentIds = new Set(
      activeOrders
        .filter((o) => o.status === 'sent')
        .filter((o) => getElapsedMinutes(o) >= 15)
        .map((o) => o.id)
    );

    if (!initializedUrgentRef.current) {
      initializedUrgentRef.current = true;
      prevUrgentIdsRef.current = urgentIds;
      return;
    }

    if (soundEnabled) {
      let newUrgent = false;
      for (const id of urgentIds) {
        if (!prevUrgentIdsRef.current.has(id)) {
          newUrgent = true;
          break;
        }
      }
      if (newUrgent) playBeep('urgent');
    }

    prevUrgentIdsRef.current = urgentIds;
  }, [activeOrders, now, soundEnabled]);

  // Helper function to check if an order has been started (has any items in preparing or ready status)
  function isOrderStarted(order: (typeof orders)[number]) {
    const kitchenItems = order.items.filter((i) => i.sentToKitchen && !i.isVoided);
    const result = kitchenItems.some((it) => {
      const status = getItemStatus(order, it);
      return status === 'preparing' || status === 'ready';
    });
    // isOrderStarted for order
    return result;
  }

  const pendingTickets = useMemo(
    () => {
      const result = activeOrders.filter((o) => o.status === 'sent' && !isOrderStarted(o));
      // pendingTickets computed
      return result;
    },
    [activeOrders, localKitchenItems]
  );
  const inProgressTickets = useMemo(
    () => {
      const result = activeOrders.filter((o) => (o.status === 'in_progress' || (o.status === 'sent' && isOrderStarted(o))) && !isTicketComplete(o));
      // inProgressTickets computed
      return result;
    },
    [activeOrders, localKitchenItems]
  );
  const readyTickets = useMemo(
    () => {
      const result = activeOrders.filter((o) => o.status === 'ready' || ((o.status === 'sent' || o.status === 'in_progress') && isTicketComplete(o)));
      // readyTickets computed
      return result;
    },
    [activeOrders, localKitchenItems]
  );

  const urgentCount = useMemo(
    () => activeOrders.filter((o) => getElapsedMinutes(o) >= 15).length,
    [activeOrders, now]
  );

  const motionProps = prefersReducedMotion
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -10 } };

  function TicketCard({ order }: { order: (typeof orders)[number] }) {
    const elapsed = getElapsedMinutes(order);
    const urgent = elapsed >= 15;
    const complete = isTicketComplete(order);
    const kitchenItems = order.items.filter((i) => i.sentToKitchen && !i.isVoided);

    // Debug: show raw kitchen items so we can detect upstream duplication
    // TicketCard raw kitchenItems for order

    // De-duplicate by item `id` (defensive: if duplicates are already present upstream)
    const uniqueKitchenItems = kitchenItems.filter((it, idx, arr) => arr.findIndex(x => x.id === it.id) === idx);
    if (uniqueKitchenItems.length !== kitchenItems.length) {
      console.warn('Duplicate kitchen items detected and deduped for order', order.id);
    }

    // Group uniqueKitchenItems by menuItemId and sum quantities
    const groupedKitchenItems: OrderItem[] = Object.values(uniqueKitchenItems.reduce((acc: Record<string, OrderItem>, it) => {
      if (!acc[it.menuItemId]) {
        acc[it.menuItemId] = { ...it };
      } else {
        acc[it.menuItemId].quantity += it.quantity;
        // Optionally, merge statuses: if any is not ready, show the least advanced status
        if (getItemStatus(order, it) !== 'ready') {
          acc[it.menuItemId].status = getItemStatus(order, it);
        }
      }
      return acc;
    }, {}));

    // TicketCard groupedKitchenItems for order

    return (
      <motion.div layout {...motionProps} transition={{ duration: 0.18 }}>
        <Card
          className={cn(
            'border-2 overflow-hidden',
            urgent ? 'border-orange-500/70' : 'border-border',
            complete && order.status !== 'ready' ? 'border-emerald-500/70 bg-emerald-50/60 dark:bg-emerald-950/20' : ''
          )}
        >
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">#{order.orderNo}</span>
                  {order.tableNo != null && <Badge variant="outline">Table {order.tableNo}</Badge>}
                  <Badge variant={order.orderType === 'eat_in' ? 'default' : 'secondary'}>
                    {order.orderType.replace('_', ' ')}
                  </Badge>
                  {urgent && (
                    <Badge className="bg-orange-600 hover:bg-orange-600 text-white">
                      <Flame className="h-3.5 w-3.5 mr-1" /> URGENT
                    </Badge>
                  )}
                </CardTitle>
                <div className="text-xs text-muted-foreground mt-1">
                  {order.staffName}
                </div>
              </div>

              <div className={cn('flex items-center gap-1 text-sm font-medium shrink-0', urgent ? 'text-orange-600' : 'text-muted-foreground')}>
                {urgent && <AlertCircle className="h-4 w-4" />}
                <Clock className="h-4 w-4" />
                {elapsed}m
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            <div className="space-y-2">
              {groupedKitchenItems.map((it) => {
                const status = getItemStatus(order, it);
                const isReady = status === 'ready';
                const isPreparing = status === 'preparing';

                return (
                  <div
                    key={it.menuItemId}
                    className={cn(
                      'rounded-lg border p-3 transition-colors',
                      isReady ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-500/30' : 'bg-background'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className={cn('font-medium leading-tight', isReady && 'text-muted-foreground line-through')}>
                          {it.menuItemName}
                        </div>
                        {(it.notes || (it.modifiers?.length ?? 0) > 0) && (
                          <div className="mt-1 text-xs text-orange-600">
                            {it.notes ? `Note: ${it.notes}` : null}
                            {!it.notes && it.modifiers?.length ? `Mods: ${it.modifiers.join(', ')}` : null}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="text-lg font-semibold">×{it.quantity}</div>
                        <Badge
                          variant={isReady ? 'default' : isPreparing ? 'secondary' : 'outline'}
                          className={cn(isReady && 'bg-emerald-600 hover:bg-emerald-600 text-white')}
                        >
                          {isReady ? 'Ready' : isPreparing ? 'In Prep' : 'Pending'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Order Lifecycle Buttons */}
            <div className="mt-4 flex gap-2">
              {order.status === 'sent' && !isOrderStarted(order) ? (
                // Pending: Start Order
                <Button
                  className="flex-1 gap-2"
                  onClick={() => {
                    markOrderStarted(order.id);
                    kitchenItems
                      .filter((it) => getItemStatus(order, it) === 'pending')
                      .forEach((it) => setItem(order.id, it.id, 'preparing', it.preparedAt));
                  }}
                >
                  <Play className="h-4 w-4" /> Start Order
                </Button>
              ) : complete && order.status !== 'ready' ? (
                // Complete on kitchen: Pass -> mark order as ready (notify POS)
                <Button
                  className="flex-1 gap-2"
                  onClick={() => {
                    // Ensure items are marked ready locally
                    kitchenItems
                      .filter((it) => getItemStatus(order, it) !== 'ready')
                      .forEach((it) => setItem(order.id, it.id, 'ready', it.preparedAt));
                    // Explicit pass: persist order ready and notify remote
                    markOrderReady(order.id);
                    // Explicit DB-backed brand-scoped notification — only send
                    // when the kitchen operator clicks Pass.
                    void notifyOrderReady(order.id);
                  }}
                >
                  <Check className="h-4 w-4" /> Pass
                </Button>
              ) : order.status === 'in_progress' || (order.status === 'sent' && isOrderStarted(order)) ? (
                // In Progress: Done -> mark all items ready locally (don't notify POS yet)
                <Button
                  className="flex-1 gap-2"
                  onClick={() => {
                    kitchenItems
                      .filter((it) => getItemStatus(order, it) !== 'ready')
                      .forEach((it) => setItem(order.id, it.id, 'ready', it.preparedAt));
                  }}
                >
                  <Check className="h-4 w-4" /> Done
                </Button>
              ) : order.status === 'ready' ? (
                // Ready To Pass: Serve
                <Button
                  className="flex-1 gap-2"
                  variant="default"
                  onClick={() => {
                    markOrderServed(order.id);
                    clearKitchenForOrder(order.id);
                  }}
                >
                  <Check className="h-4 w-4" /> Serve
                </Button>
              ) : (
                // Fallback for unexpected states
                <Button className="flex-1 gap-2" onClick={() => { markOrderStarted(order.id); }}>
                  <Play className="h-4 w-4" /> Start Order
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }
  
  return (
    <div className="p-4">
      {/* Debug panel removed */}
      <PageHeader
        title="Kitchen Display"
        description="Live kitchen screen (orders from POS)"
        actions={
          user ? (
            <>
              <Badge variant="secondary" className="max-w-[240px] truncate">
                {user.name}
              </Badge>
              <Badge variant="outline">{ROLE_NAMES[user.role] ?? user.role}</Badge>
            </>
          ) : null
        }
      />

      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Filter className="h-4 w-4" />
          <span>{activeOrders.length} active</span>
          <span className="text-muted-foreground/50">•</span>
          <span className={cn(urgentCount ? 'text-orange-600 font-medium' : '')}>{urgentCount} urgent</span>
        </div>
        <div className="md:ml-auto flex items-center gap-2 w-full md:w-[420px]">
          <Button
            type="button"
            variant="outline"
            size="icon"
            title={soundEnabled ? 'Sound on' : 'Sound off'}
            onClick={() => {
              setSoundEnabled((v) => {
                const next = !v;
                if (next) {
                  // user gesture -> unlock audio
                  playBeep('new');
                }
                return next;
              });
            }}
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search order #, table, staff..." />
        </div>
      </div>

      <Tabs defaultValue="board" className="space-y-3">
        <TabsList>
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="ready">Ready</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="space-y-3">
          {activeOrders.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ChefHat className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">No kitchen orders yet.</p>
                <p className="text-xs text-muted-foreground mt-2">Orders appear here after they are sent to kitchen.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Pending</CardTitle>
                  <div className="text-xs text-muted-foreground">New tickets & pending items</div>
                </CardHeader>
                <CardContent className="pt-0">
                  <ScrollArea className="h-[70vh] pr-2">
                    <div className="space-y-3">
                      <AnimatePresence initial={false}>
                        {pendingTickets.map((order) => (
                          <TicketCard key={order.id} order={order} />
                        ))}
                      </AnimatePresence>
                      {!pendingTickets.length && (
                        <div className="text-sm text-muted-foreground py-6 text-center">No pending tickets.</div>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">In Progress</CardTitle>
                  <div className="text-xs text-muted-foreground">Items currently being prepared</div>
                </CardHeader>
                <CardContent className="pt-0">
                  <ScrollArea className="h-[70vh] pr-2">
                    <div className="space-y-3">
                      <AnimatePresence initial={false}>
                          {inProgressTickets.map((order) => (
                            <TicketCard key={order.id} order={order} />
                          ))}
                      </AnimatePresence>
                      {!inProgressTickets.length && (
                        <div className="text-sm text-muted-foreground py-6 text-center">No tickets in progress.</div>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Ready To Pass</CardTitle>
                  <div className="text-xs text-muted-foreground">Complete tickets waiting for handoff</div>
                </CardHeader>
                <CardContent className="pt-0">
                  <ScrollArea className="h-[70vh] pr-2">
                    <div className="space-y-3">
                      <AnimatePresence initial={false}>
                        {readyTickets
                          .filter((o) => o.status !== 'ready')
                          .map((order) => (
                            <TicketCard key={order.id} order={order} />
                          ))}
                      </AnimatePresence>
                      {!readyTickets.filter((o) => o.status !== 'ready').length && (
                        <div className="text-sm text-muted-foreground py-6 text-center">Nothing ready yet.</div>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="ready" className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Ready Tickets</CardTitle>
              <div className="text-xs text-muted-foreground">Marked ready (can be cleared when served)</div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <AnimatePresence initial={false}>
                  {readyTickets
                    .filter((o) => o.status === 'ready')
                    .map((order) => (
                      <TicketCard key={order.id} order={order} />
                    ))}
                </AnimatePresence>
                {!readyTickets.filter((o) => o.status === 'ready').length && (
                  <div className="col-span-full text-sm text-muted-foreground py-10 text-center">No ready tickets.</div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      
    </div>
  );
}
