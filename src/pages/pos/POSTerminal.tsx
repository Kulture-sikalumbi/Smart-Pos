import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ShoppingCart, Send, Trash2, Plus, Minus, CreditCard, Users, Percent, Settings as SettingsIcon, RefreshCw, Wifi, BellRing, FolderOpen, LogOut } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { tables } from '@/data/posData';
import { OrderItem, Order, OrderType, PaymentMethod, POSMenuItem } from '@/types/pos';
import { cn } from '@/lib/utils';
import PaymentDialog from '@/components/pos/PaymentDialog';
import { InsufficientStockError, RecipeIncompleteError } from '@/lib/recipeEngine';
import { getManufacturingRecipesSnapshot } from '@/lib/manufacturingRecipeStore';
import { applyStockDeductions, getStockItemById, deductStockItemsRemote } from '@/lib/stockStore';
import { getOrdersSnapshot, subscribeOrders, upsertOrder, sendOrderPayload } from '@/lib/orderStore';
import useKitchenRealtime from '@/hooks/useKitchenRealtime';
import { useToast } from '@/hooks/use-toast';
// debug viewer removed
import MenuItemCard from '@/components/pos/MenuItemCard';
import { getModifierGroup } from '@/data/posModifiers';
import { useBranding } from '@/contexts/BrandingContext';
import ReceiptPrintDialog from '@/components/pos/ReceiptPrintDialog';
import { usePosMenu } from '@/hooks/usePosMenu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { parseSmartQuantityQuery, smartSearchMenuItems } from '@/lib/smartMenuSearch';
import { getPosPaymentRequestsSnapshot, resolvePosPaymentRequest, subscribePosPaymentRequests } from '@/lib/posPaymentRequestStore';
import { getPosNotificationsSnapshot, subscribePosNotifications, markNotificationsSeen, deleteNotificationById } from '@/lib/posNotificationStore';
import { ROLE_NAMES } from '@/types/auth';
import { supabase } from '@/lib/supabaseClient';
import { useCurrency } from '@/contexts/CurrencyContext';

export default function POSTerminal() {
  const auth = useAuth();
  const { user, hasPermission, logout, operatorPin } = auth;
  const { settings } = useBranding();
  const { formatMoneyPrecise } = useCurrency();
  const navigate = useNavigate();
  const location = useLocation();
  const menu = usePosMenu();
  const categories = useMemo(() => menu.categories.slice().sort((a, b) => a.sortOrder - b.sortOrder), [menu.categories]);
  const items = useMemo(() => menu.items.slice(), [menu.items]);
  const orders = useSyncExternalStore(subscribeOrders, getOrdersSnapshot);

  // debug viewer removed

  // Subscribe to kitchen realtime events so the POS sees remote kitchen updates
  useKitchenRealtime();

  const { toast } = useToast();
  const prevReadyRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const readyIds = new Set(orders.filter((o) => o.status === 'ready').map((o) => o.id));
    for (const id of readyIds) {
      if (!prevReadyRef.current.has(id)) {
        const ord = orders.find((o) => o.id === id);
        if (ord) {
          try {
            toast({
              title: 'Order Ready',
              description: `Order #${ord.orderNo}${ord.tableNo ? ` • Table ${ord.tableNo}` : ''}`,
            });
          } catch {
            // ignore toast failures
          }
        }
      }
    }
    prevReadyRef.current = readyIds;
  }, [orders, toast]);

  // Also listen for BroadcastChannel notifications from the kitchen (fast local notify)
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('mthunzi.kitchen');
      bc.onmessage = (ev: MessageEvent) => {
        try {
          const msg = ev.data ?? {};
          if (msg && msg.type === 'order_ready') {
            toast({ title: 'Order Ready', description: `Order #${msg.orderNo}${msg.tableNo ? ` • Table ${msg.tableNo}` : ''}` });
          }
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore
    }
    return () => {
      try {
        if (bc) {
          bc.close();
        }
      } catch {
        // ignore
      }
    };
  }, [toast]);

  const ALL_CATEGORY_ID = 'all';
  const categoriesWithAll = useMemo(
    () => [{ id: ALL_CATEGORY_ID, name: 'All', sortOrder: -999, color: 'bg-slate-500' }, ...categories],
    [categories]
  );

  const [selectedCategory, setSelectedCategory] = useState<string>(ALL_CATEGORY_ID);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('eat_in');
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showTableSelect, setShowTableSelect] = useState(false);
  const [showHeldOrders, setShowHeldOrders] = useState(false);
  const [showPaymentRequests, setShowPaymentRequests] = useState(false);

  const [showAdminGate, setShowAdminGate] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);

  const CASHIER_SHIFT_KEY_PREFIX = 'pmx.cashier.shift.active.v1.';
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);
  const [showStartShift, setShowStartShift] = useState(false);
  const [openingCash, setOpeningCash] = useState('');
  const [confirmStartShift, setConfirmStartShift] = useState(false);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [shiftError, setShiftError] = useState<string | null>(null);

  const [showEndShift, setShowEndShift] = useState(false);
  const [closingCash, setClosingCash] = useState('');
  const [confirmEndShift, setConfirmEndShift] = useState(false);
  // Fallback PIN prompt (only used if we don't have the pin from staff login)
  const [cashierPin, setCashierPin] = useState('');

  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

  const [selectedOrderItemId, setSelectedOrderItemId] = useState<string | null>(null);

  const isCashier = user?.role === 'cashier';

  // debug modal removed

  const getShiftStorageKey = () => {
    const staffId = user?.id ? String(user.id) : 'unknown';
    return `${CASHIER_SHIFT_KEY_PREFIX}${staffId}`;
  };

  const readStoredShiftId = () => {
    try {
      if (!user?.id) return null;
      return localStorage.getItem(getShiftStorageKey());
    } catch {
      return null;
    }
  };

  const storeShiftId = (shiftId: string | null) => {
    try {
      if (!user?.id) return;
      const key = getShiftStorageKey();
      if (!shiftId) localStorage.removeItem(key);
      else localStorage.setItem(key, shiftId);
    } catch {
      // ignore
    }
  };

  const parseMoney = (value: string) => {
    const cleaned = value.replace(/[^0-9.]/g, '');
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, n);
  };

  const formatMoney = (n: number) => {
    try {
      return n.toFixed(2);
    } catch {
      return String(n);
    }
  };

  const getEffectiveCashierPin = () => (operatorPin ?? cashierPin).trim();

  const startShift = async (amount: number) => {
    if (!supabase) {
      setShiftError('Supabase not configured.');
      return false;
    }
    if (!user?.email) {
      setShiftError('Missing staff email.');
      return false;
    }
    const effectivePin = getEffectiveCashierPin();
    if (!/^[0-9]{4}$/.test(effectivePin)) {
      setShiftError('Enter your 4-digit PIN.');
      return false;
    }

    setShiftBusy(true);
    setShiftError(null);
    try {
      const { data, error } = await supabase.rpc('cashier_shift_start', {
        p_email: user.email,
        p_pin: effectivePin,
        p_opening_cash: amount,
      });
      if (error) {
        const status = (error as any)?.status;
        const message = String((error as any)?.message ?? '');
        const details = String((error as any)?.details ?? '');
        const hint = String((error as any)?.hint ?? '');
        const msg = message.toLowerCase();

        if (status === 404 || msg.includes('404') || msg.includes('could not find the function') || msg.includes('function')) {
          setShiftError('Shift feature is not installed on the server yet. Run Supabase migration 013 (cashier_shift_rpcs) and try again.');
        } else if (status === 400) {
          // Surface server-side errors to make debugging deploy/RPC issues straightforward.
          const extra = [details, hint].filter(Boolean).join(' ');
          setShiftError(`Unable to start shift: ${message || 'Bad request.'}${extra ? ` ${extra}` : ''}`);
        } else {
          setShiftError(message ? `Unable to start shift: ${message}` : 'Unable to start shift. Please try again.');
        }
        return false;
      }
      const row = Array.isArray(data) ? data[0] : (data as any);
      const shiftId = row?.shift_id ?? row?.id;
      if (!shiftId) {
        // The server returns an empty set when cashier credentials/role are invalid.
        setShiftError('Unable to start shift. Check your PIN and ensure your role is cashier.');
        return false;
      }
      setActiveShiftId(String(shiftId));
      storeShiftId(String(shiftId));
      setShowStartShift(false);
      setConfirmStartShift(false);
      setOpeningCash('');
      setCashierPin('');
      return true;
    } catch (e: any) {
      setShiftError(e?.message ?? 'Unable to start shift');
      return false;
    } finally {
      setShiftBusy(false);
    }
  };

  const endShift = async (amount: number) => {
    if (!supabase) {
      setShiftError('Supabase not configured.');
      return false;
    }
    if (!user?.email) {
      setShiftError('Missing staff email.');
      return false;
    }
    const effectivePin = getEffectiveCashierPin();
    if (!/^[0-9]{4}$/.test(effectivePin)) {
      setShiftError('Enter your 4-digit PIN.');
      return false;
    }

    setShiftBusy(true);
    setShiftError(null);
    try {
      const { data, error } = await supabase.rpc('cashier_shift_end', {
        p_email: user.email,
        p_pin: effectivePin,
        p_closing_cash: amount,
      });
      if (error) {
        const status = (error as any)?.status;
        const message = String((error as any)?.message ?? '');
        const details = String((error as any)?.details ?? '');
        const hint = String((error as any)?.hint ?? '');
        const msg = message.toLowerCase();

        if (status === 404 || msg.includes('404') || msg.includes('could not find the function') || msg.includes('function')) {
          setShiftError('Shift feature is not installed on the server yet. Run Supabase migration 013 (cashier_shift_rpcs) and try again.');
        } else if (status === 400) {
          const extra = [details, hint].filter(Boolean).join(' ');
          setShiftError(`Unable to end shift: ${message || 'Bad request.'}${extra ? ` ${extra}` : ''}`);
        } else {
          setShiftError(message ? `Unable to end shift: ${message}` : 'Unable to end shift. Please try again.');
        }
        return false;
      }
      const row = Array.isArray(data) ? data[0] : (data as any);
      const shiftId = row?.shift_id ?? row?.id;
      if (!shiftId) {
        // The server returns an empty set when cashier credentials/role are invalid or no open shift exists.
        setShiftError('No open shift found to close. Check your PIN and ensure you have an active shift.');
        return false;
      }

      setActiveShiftId(null);
      storeShiftId(null);

      setShowEndShift(false);
      setConfirmEndShift(false);
      setClosingCash('');
      setCashierPin('');
      return true;
    } catch (e: any) {
      setShiftError(e?.message ?? 'Unable to end shift');
      return false;
    } finally {
      setShiftBusy(false);
    }
  };

  useEffect(() => {
    // If cashier: restore active shift (if any) and prompt for start shift when none exists.
    if (!isCashier || !user?.id) return;

    const stored = readStoredShiftId();
    if (!stored) {
      setActiveShiftId(null);
      setShowStartShift(true);
      return;
    }

    // We don't fetch shift details here (keeps shift data brand-guarded).
    // If the shift was closed elsewhere, the end-shift RPC will reject it.
    setActiveShiftId(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCashier, user?.id]);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const [orderDiscountPercent, setOrderDiscountPercent] = useState(0);
  const [couponCode, setCouponCode] = useState('');
  const [showCoupon, setShowCoupon] = useState(false);

  const paymentRequests = useSyncExternalStore(subscribePosPaymentRequests, getPosPaymentRequestsSnapshot);
  const posNotifs = useSyncExternalStore(subscribePosNotifications, getPosNotificationsSnapshot);
  const prevRequestIds = useRef<string>('');
  const prevNotifIds = useRef<string>('');
  const [showSlide, setShowSlide] = useState(false);
  const slideTimerRef = useRef<number | null>(null);

  const computeLineTotal = (unitPrice: number, qty: number, discountPercent?: number) => {
    const d = Math.min(100, Math.max(0, discountPercent ?? 0));
    const effective = unitPrice * (1 - d / 100);
    return effective * qty;
  };

  const [recipeError, setRecipeError] = useState<string | null>(null);
  const [recipeErrorDetail, setRecipeErrorDetail] = useState<string | null>(null);
  const [showRecipeError, setShowRecipeError] = useState(false);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    // Keep category selection valid as menu loads/changes.
    const valid = categoriesWithAll.some((c) => c.id === selectedCategory);
    if (!valid) setSelectedCategory(ALL_CATEGORY_ID);
  }, [categoriesWithAll, selectedCategory]);

  useEffect(() => {
    // When navigated from Tables, preselect/resume.
    const st = location.state as any;
    if (!st) return;

    if (typeof st.tableNo === 'number') {
      setOrderType('eat_in');
      setSelectedTable(st.tableNo);
      const existing = findLatestActiveOrderForTable(st.tableNo);
      if (existing) loadOrderToTerminal(existing);
      return;
    }

    if (typeof st.orderId === 'string') {
      const existing = findOrderById(st.orderId);
      if (existing) loadOrderToTerminal(existing, { openPayment: Boolean(st.openPayment) });
    }
  }, [location.key, orders]);

  useEffect(() => {
    const ids = paymentRequests.map((r) => r.id).join('|');
    prevRequestIds.current = ids;
  }, [paymentRequests]);

  useEffect(() => {
    const ids = posNotifs.map((n) => n.id).join('|');
    if (ids !== prevNotifIds.current) {
      const prevSet = new Set(prevNotifIds.current.split('|').filter(Boolean));
      for (const n of posNotifs) {
        if (!prevSet.has(n.id)) {
          try {
            toast({ title: 'Order Ready', description: `Order #${n.payload?.orderNo}${n.payload?.tableNo ? ` • Table ${n.payload.tableNo}` : ''}` });
          } catch {
            // ignore
          }
          // Open slide-down panel and play sound to attract attention
          try {
            setShowSlide(true);
            if (slideTimerRef.current) window.clearTimeout(slideTimerRef.current as any);
            slideTimerRef.current = window.setTimeout(() => setShowSlide(false), 8000);
          } catch {}
          try { playNotificationTone(); } catch {}
        }
      }
    }
    prevNotifIds.current = ids;
  }, [posNotifs, toast]);

  function playNotificationTone() {
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.value = 0.0;
      gain.connect(ctx.destination);

      // Short two-tone pattern, louder but short so it's not unpleasant
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(1200, now);
      osc1.connect(gain);

      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(800, now + 0.12);
      osc2.connect(gain);

      // Envelope: quick attack, medium decay
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);

      osc1.start(now);
      osc1.stop(now + 0.18);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.36);

      setTimeout(() => {
        try { osc1.disconnect(); } catch {}
        try { osc2.disconnect(); } catch {}
        try { gain.disconnect(); } catch {}
        try { ctx.close(); } catch {}
      }, 700);
    } catch {}
  }

  const popularItems = useMemo(() => {
    // Local "AI" suggestion: top-selling items from paid orders.
    const counts = new Map<string, { item: POSMenuItem; qty: number }>();
    const byId = new Map(items.map((i) => [i.id, i] as const));
    for (const o of orders) {
      if (o.status !== 'paid') continue;
      for (const it of o.items) {
        const mi = byId.get(it.menuItemId);
        if (!mi) continue;
        const prev = counts.get(mi.id);
        const qty = Number.isFinite(it.quantity) ? it.quantity : 0;
        counts.set(mi.id, { item: mi, qty: (prev?.qty ?? 0) + qty });
      }
    }
    return Array.from(counts.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10)
      .map((x) => x.item);
  }, [orders, items]);
  
  const smartMatches = useMemo(() => {
    const { query } = parseSmartQuantityQuery(searchQuery);
    return smartSearchMenuItems({ query, items: items.filter((i) => i.isAvailable), limit: 30 });
  }, [items, searchQuery]);

  const filteredItems = useMemo(() => {
    if (searchQuery.trim()) {
      return smartMatches;
    }

    const base = items.filter((i) => i.isAvailable);
    if (selectedCategory === ALL_CATEGORY_ID) return base;
    return base.filter((item) => item.categoryId === selectedCategory);
  }, [items, selectedCategory, searchQuery, smartMatches]);

  const addItemWithQty = (menuItem: POSMenuItem, qty: number) => {
    const safeQty = Math.max(1, Math.floor(qty));
    setOrderItems(prevOrderItems => {
      const existing = prevOrderItems.find((oi) => oi.menuItemId === menuItem.id);
      if (existing) {
        return prevOrderItems.map((oi) => {
          if (oi.id !== existing.id) return oi;
          const nextQty = oi.quantity + safeQty;
          return {
            ...oi,
            quantity: nextQty,
            total: computeLineTotal(oi.unitPrice, nextQty, oi.discountPercent),
          };
        });
      }
      const newItem: OrderItem = {
        id: `oi-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        menuItemId: menuItem.id,
        menuItemCode: menuItem.code,
        menuItemName: menuItem.name,
        quantity: safeQty,
        unitPrice: menuItem.price,
        unitCost: menuItem.cost,
        discountPercent: 0,
        total: computeLineTotal(menuItem.price, safeQty, 0),
        isVoided: false,
        sentToKitchen: false,
      };
      return [...prevOrderItems, newItem];
    });
  };
  
  const orderTotals = useMemo(() => {
    const itemCount = orderItems.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = orderItems.reduce((sum, item) => sum + item.total, 0);
    const totalCost = orderItems.reduce((sum, item) => sum + item.unitCost * item.quantity, 0);
    const discountPercent = Math.min(100, Math.max(0, orderDiscountPercent));
    const discountAmount = subtotal * (discountPercent / 100);
    const total = Math.max(0, subtotal - discountAmount);
    const tax = total * 0.16 / 1.16; // VAT inclusive
    const grossProfit = total - totalCost;
    const gpPercent = total > 0 ? (grossProfit / total) * 100 : 0;
    return {
      itemCount,
      subtotal,
      discountPercent,
      discountAmount,
      tax,
      total,
      totalCost,
      grossProfit,
      gpPercent,
    };
  }, [orderItems, orderDiscountPercent]);

  const addItem = (menuItem: POSMenuItem) => {
    console.log('[addItem] called for', menuItem.name, menuItem.id);
    const existing = orderItems.find((oi) => oi.menuItemId === menuItem.id);
    if (existing) {
      setOrderItems(
        orderItems.map((oi) => {
          if (oi.id !== existing.id) return oi;
          const nextQty = oi.quantity + 1;
          return {
            ...oi,
            quantity: nextQty,
            total: computeLineTotal(oi.unitPrice, nextQty, oi.discountPercent),
          };
        })
      );
      return;
    }

    const newItem: OrderItem = {
      id: `oi-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      menuItemId: menuItem.id,
      menuItemCode: menuItem.code,
      menuItemName: menuItem.name,
      quantity: 1,
      unitPrice: menuItem.price,
      unitCost: menuItem.cost,
      discountPercent: 0,
      total: computeLineTotal(menuItem.price, 1, 0),
      isVoided: false,
      sentToKitchen: false,
    };

    setOrderItems([...orderItems, newItem]);
  };

  // Slide-down notification UI (renders near top of the page)
  const SlideNotification = () => {
    if (!showSlide || posNotifs.length === 0) return null;
    const n = posNotifs[0];
    return (
      <div className={cn(
        'fixed left-1/2 transform -translate-x-1/2 top-4 z-50 transition-transform duration-300',
        showSlide ? 'translate-y-0' : '-translate-y-20'
      )}>
        <div className="max-w-lg w-[min(95vw,480px)] bg-white border shadow-lg rounded-md p-4 flex items-start gap-3">
          <div className="flex-1">
            <div className="font-medium">Order Ready</div>
            <div className="text-sm text-slate-600">Order #{n.payload?.orderNo}{n.payload?.tableNo ? ` • Table ${n.payload.tableNo}` : ''}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => { setShowSlide(false); }}>Dismiss</Button>
            <Button size="sm" onClick={() => { setShowNotifications(true); setShowSlide(false); }}>Open</Button>
          </div>
        </div>
      </div>
    );
  };
  
  const updateQuantity = (itemId: string, delta: number) => {
    const updated = orderItems.map(item => {
      if (item.id === itemId) {
        const newQty = Math.max(0, item.quantity + delta);
        return {
          ...item,
          quantity: newQty,
          total: computeLineTotal(item.unitPrice, newQty, item.discountPercent),
        };
      }
      return item;
    }).filter(item => item.quantity > 0);
    setOrderItems(updated);
  };

  const setQuantity = (itemId: string, qty: number) => {
    const updated = orderItems
      .map(item => {
        if (item.id !== itemId) return item;
        const nextQty = Math.max(0, Math.floor(qty));
        return {
          ...item,
          quantity: nextQty,
          total: computeLineTotal(item.unitPrice, nextQty, item.discountPercent),
        };
      })
      .filter(item => item.quantity > 0);
    setOrderItems(updated);
  };

  const setDiscountPercent = (itemId: string, discountPercent: number) => {
    const d = Math.min(100, Math.max(0, discountPercent));
    const updated = orderItems.map(item => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        discountPercent: d,
        total: computeLineTotal(item.unitPrice, item.quantity, d),
      };
    });
    setOrderItems(updated);
  };
  
  const clearOrder = () => {
    setOrderItems([]);
    setSelectedTable(null);
    setSelectedOrderItemId(null);
    setOrderDiscountPercent(0);
    setCouponCode('');
    setActiveOrderId(null);
  };

  const nextOrderNo = (existing: Order[]) => {
    const max = existing.reduce((m, o) => Math.max(m, o.orderNo ?? 0), 0);
    return max > 0 ? max + 1 : 2000;
  };

  const findOrderById = (orderId: string) => orders.find((o) => o.id === orderId) ?? null;

  const findLatestActiveOrderForTable = (tableNo: number) => {
    const matches = orders
      .filter((o) => o.tableNo === tableNo)
      .filter((o) => o.status !== 'paid' && o.status !== 'voided')
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return matches[0] ?? null;
  };

  const loadOrderToTerminal = (order: Order, opts?: { openPayment?: boolean }) => {
    setActiveOrderId(order.id);
    setOrderType(order.orderType);
    setSelectedTable(order.orderType === 'eat_in' ? (order.tableNo ?? null) : null);
    setOrderItems((order.items ?? []).map((it) => ({ ...it })));
    setOrderDiscountPercent(Number(order.discountPercent ?? 0));
    setSelectedOrderItemId(null);
    setSearchQuery('');
    setSearchOpen(false);
    if (opts?.openPayment) setShowPayment(true);
  };

  const upsertActiveOrder = (params: { status: Order['status']; paymentMethod?: PaymentMethod; sent?: boolean; items?: OrderItem[] }) => {
    const now = new Date().toISOString();
    const tableNo = orderType === 'eat_in' ? selectedTable : null;

    const existingById = activeOrderId ? findOrderById(activeOrderId) : null;
    const existingByTable = tableNo ? findLatestActiveOrderForTable(tableNo) : null;
    const existing = existingById ?? existingByTable;

    const id = existing?.id ?? `ord-${Date.now()}`;
    const orderNo = existing?.orderNo ?? nextOrderNo(orders);
    const createdAt = existing?.createdAt ?? now;
    const sentAt = params.status === 'sent' ? (existing?.sentAt ?? now) : existing?.sentAt;
    const paidAt = params.status === 'paid' ? now : existing?.paidAt;

    // Use merged items if provided, otherwise use orderItems
    const itemsToSave = (params.items ?? orderItems).map((item) => ({
      ...item,
      sentToKitchen: params.sent ? true : item.sentToKitchen,
    }));

    const order: Order = {
      id,
      orderNo,
      tableId: tableNo ? `t${tableNo}` : undefined,
      tableNo: tableNo ?? undefined,
      orderType,
      status: params.status,
      staffId: user?.id ?? 'unknown',
      staffName: user?.name ?? 'Unknown',
      items: itemsToSave,
      subtotal: orderTotals.subtotal,
      discountAmount: orderTotals.discountAmount,
      discountPercent: orderTotals.discountPercent,
      tax: orderTotals.tax,
      total: orderTotals.total,
      totalCost: orderTotals.totalCost,
      grossProfit: orderTotals.grossProfit,
      gpPercent: orderTotals.gpPercent,
      createdAt,
      sentAt,
      paidAt,
      paymentMethod: params.paymentMethod ?? existing?.paymentMethod,
    };

    upsertOrder(order);
    setActiveOrderId(id);
    return order;
  };

  const selectedOrderItem = useMemo(
    () => orderItems.find(i => i.id === selectedOrderItemId) ?? null,
    [orderItems, selectedOrderItemId]
  );

  const selectedMenuItem = useMemo(() => {
    if (!selectedOrderItem) return null;
    return items.find(mi => mi.id === selectedOrderItem.menuItemId) ?? null;
  }, [items, selectedOrderItem]);

  const toggleModifier = (orderItemId: string, modifierLabel: string) => {
    setOrderItems(prev =>
      prev.map(item => {
        if (item.id !== orderItemId) return item;

        const current = item.modifiers ?? [];
        const next = current.includes(modifierLabel)
          ? current.filter(m => m !== modifierLabel)
          : [...current, modifierLabel];
        return { ...item, modifiers: next };
      })
    );
  };

  const setItemNote = (orderItemId: string, notes: string) => {
    setOrderItems(prev => prev.map(item => (item.id === orderItemId ? { ...item, notes } : item)));
  };

  const handleHoldOrder = () => {
    if (orderItems.length === 0) return;
    upsertActiveOrder({ status: 'open', sent: false });
    clearOrder();
  };

  const applyRecipeDeductionsOrThrow = async () => {
    // Unit-blind deduction: assume recipe.ingredients[].requiredQty is already
    // expressed in the base unit (KG / LTR) and is the amount needed per
    // single menu item. Do not perform any divisions or unit conversions.
    const toDeduct = orderItems.filter((i) => !i.isVoided && !i.sentToKitchen);
    if (!toDeduct.length) return;

    // Ensure recipes are loaded (best-effort) so snapshot is populated.
    try {
      const mr = await import('@/lib/manufacturingRecipeStore');
      if (mr && typeof mr.ensureRecipesLoaded === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        await mr.ensureRecipesLoaded();
      }
    } catch {
      // ignore
    }

    const recipes = getManufacturingRecipesSnapshot();
    const recipeByParentId = new Map(recipes.map((r) => [String(r.parentItemId), r] as const));
    const recipeByCode = new Map(recipes.map((r) => [String(r.parentItemCode), r] as const));
    const menuById = new Map(items.map((mi) => [mi.id, mi] as const));

    const byItemId = new Map<string, number>();
    const missingRecipeForMenuItemIds: string[] = [];
    const missingStockItemIds: string[] = [];

    for (const line of toDeduct) {
      const qty = Number.isFinite(line.quantity) ? line.quantity : 0;
      if (qty <= 0) continue;

      const menuItem = menuById.get(line.menuItemId);
      const code = String(menuItem?.code ?? line.menuItemCode);
      const recipe = recipeByParentId.get(line.menuItemId) ?? recipeByCode.get(code);
      if (!recipe) {
        missingRecipeForMenuItemIds.push(line.menuItemId);
        continue;
      }

      for (const ing of recipe.ingredients ?? []) {
        const req = Number.isFinite(ing.requiredQty) ? ing.requiredQty : 0;
        if (req <= 0) continue;
        const add = req * qty; // unit-blind multiply
        byItemId.set(ing.ingredientId, (byItemId.get(ing.ingredientId) ?? 0) + add);
      }
    }

    if (missingRecipeForMenuItemIds.length) {
      throw new RecipeIncompleteError(missingRecipeForMenuItemIds[0]!, ['NO_MANUFACTURING_RECIPE']);
    }

    const deductions = Array.from(byItemId.entries()).map(([itemId, qty]) => ({ itemId, qty }));
    console.debug('[POS] prepared unit-blind deductions', { deductions });

    for (const d of deductions) {
      if (!getStockItemById(d.itemId)) missingStockItemIds.push(d.itemId);
    }
    if (missingStockItemIds.length) {
      throw new RecipeIncompleteError('STOCK_ITEMS_MISSING', missingStockItemIds.slice(0, 10));
    }

    const res = await deductStockItemsRemote(deductions as any);
    if (res.ok !== true) {
      const first = (res as any).insufficient?.[0];
      if (first) {
        throw new InsufficientStockError(first.itemId, first.requiredQty, first.onHandQty);
      }
      throw new InsufficientStockError('unknown', 0, 0);
    }
  };

  const showDeductionError = (e: unknown) => {
    if (e instanceof RecipeIncompleteError) {
      setRecipeError('Recipe Incomplete (Manager Action Required)');
      setRecipeErrorDetail(`MenuItem: ${e.menuItemId}. Missing: ${e.missing.join(', ')}`);
      setShowRecipeError(true);
      return;
    }
    if (e instanceof InsufficientStockError) {
      setRecipeError('Insufficient Stock');
      setRecipeErrorDetail(`${e.stockItemId}: required ${e.requiredQty}, on hand ${e.onHandQty}`);
      setShowRecipeError(true);
      return;
    }

    setRecipeError('Inventory Deduction Failed');
    setRecipeErrorDetail(e instanceof Error ? e.message : 'Unknown error');
    setShowRecipeError(true);
  };
  
  const handleSendToKitchen = async () => {
    try {
      await applyRecipeDeductionsOrThrow();

      // Merge duplicate items by menuItemId BEFORE saving
      const mergedItems = orderItems.reduce((acc, it) => {
        const existing = acc.find(a => a.menuItemId === it.menuItemId && !a.isVoided);
        if (existing) {
          existing.quantity += it.quantity;
          existing.total += it.total;
        } else {
          acc.push({ ...it });
        }
        return acc;
      }, [] as OrderItem[]);

      // Save the merged order (guaranteed only once)
      const saved = upsertActiveOrder({ status: 'sent', sent: true, items: mergedItems });

      // debug: removed on-screen merged items

      // Clear local items after sending to prevent accidental re-send
      setOrderItems([]);

      // Note: we intentionally do NOT call `sendOrderPayload` here because
      // `upsertOrder` already triggers remote sync (via `sendOrderToSupabase`).
      // Calling both can result in duplicate inserts in some environments
      // due to concurrent retries/deletes. The automatic sync will handle
      // server upsert/insert reliably and is preferred.
    } catch (e) {
      showDeductionError(e);
    }
  };
  
  const handlePaymentComplete = async (method: PaymentMethod) => {
    try {
      await applyRecipeDeductionsOrThrow();

      const saved = upsertActiveOrder({ status: 'paid', paymentMethod: method, sent: true });

      // Resolve any outstanding payment request for this order.
      const req = paymentRequests.find((r) => r.orderId === saved.id);
      if (req) resolvePosPaymentRequest(req.id);

      setReceiptOrder(saved);
      setShowReceipt(true);

      setShowPayment(false);
      clearOrder();
    } catch (e) {
      setShowPayment(false);
      showDeductionError(e);
    }
  };

  const isAdminOperator = user?.role === 'owner' || user?.role === 'manager';

  const openSettings = () => {
    if (isAdminOperator) {
      navigate('/app/settings');
      return;
    }
    setAdminError(null);
    setAdminEmail('');
    setAdminPassword('');
    setShowAdminGate(true);
  };

  const unlockAdminAndOpenSettings = async () => {
    setAdminError(null);
    const email = adminEmail.trim();
    const password = adminPassword;
    if (!email) {
      setAdminError('Enter admin email.');
      return;
    }
    if (!password) {
      setAdminError('Enter admin password.');
      return;
    }

    setAdminBusy(true);
    try {
      const ok = await auth.login(email, password);
      if (!ok) {
        setAdminError('Invalid admin credentials.');
        return;
      }
      setShowAdminGate(false);
      navigate('/app/settings');
    } catch (e: any) {
      setAdminError(e?.message ?? 'Admin unlock failed');
    } finally {
      setAdminBusy(false);
    }
  };
  
  return (
    <div className="h-screen p-3 pos-light">
      <div className="h-full rounded-2xl border bg-background overflow-auto lg:overflow-hidden overscroll-contain">
        <div className="h-full grid grid-cols-1 lg:grid-cols-[4.5rem_1fr_26rem]">
          {/* Left icon rail (POS-like) */}
          <div className="hidden lg:flex flex-col items-center border-r bg-muted/30 py-3">
            <div className="w-12 h-12 rounded-xl border bg-background flex items-center justify-center font-bold">
              {settings.appName.slice(0, 1).toUpperCase()}
            </div>

            <div className="mt-2 flex-1" />

            <div className="w-full px-2">
              <Button
                variant={location.pathname.startsWith('/app/settings') ? 'default' : 'ghost'}
                className="h-11 w-full justify-center"
                title="Settings"
                onClick={openSettings}
              >
                <SettingsIcon className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* Middle: Menu */}
          <div className="flex flex-col min-w-0">
            {/* Debug panel removed */}
            {/* Top bar */}
            <div className="flex items-center justify-between gap-3 border-b p-3">
              <div className="font-semibold hidden sm:block">{settings.appName}</div>
              <div className="flex-1 max-w-xl">
                <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                  <PopoverTrigger asChild>
                    <Input
                      placeholder="Search products… (try: 2x coke, 1002 bread)"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        if (!searchOpen) setSearchOpen(true);
                      }}
                      onFocus={() => setSearchOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setSearchOpen(false);
                          return;
                        }
                        if (e.key === 'Enter') {
                          const { qty, query } = parseSmartQuantityQuery(searchQuery);
                          const match = smartSearchMenuItems({ query, items: items.filter((i) => i.isAvailable), limit: 1 })[0];
                          if (match) {
                            e.preventDefault();
                            addItemWithQty(match, qty ?? 1);
                            setSearchQuery('');
                            setSearchOpen(false);
                          }
                        }
                      }}
                    />
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandList>
                        {!searchQuery.trim() ? (
                          <>
                            <CommandGroup heading="Popular (auto)">
                              {popularItems.slice(0, 8).map((it) => (
                                <CommandItem
                                  key={it.id}
                                  value={`${it.name} ${it.code}`}
                                  onSelect={() => {
                                    addItem(it);
                                    setSearchOpen(false);
                                  }}
                                >
                                  <span className="truncate">{it.name}</span>
                                  <span className="ml-2 text-xs text-muted-foreground truncate">{it.code}</span>
                                </CommandItem>
                              ))}
                              {!popularItems.length && (
                                <div className="px-2 py-3 text-xs text-muted-foreground">No sales history yet.</div>
                              )}
                            </CommandGroup>
                            <CommandGroup heading="Tip">
                              <div className="px-2 py-3 text-xs text-muted-foreground">
                                Start typing to search. Press <span className="font-medium">Enter</span> to add the top match.
                              </div>
                            </CommandGroup>
                          </>
                        ) : smartMatches.length ? (
                          <CommandGroup heading="Matches">
                            {smartMatches.map((it) => (
                              <CommandItem
                                key={it.id}
                                value={`${it.name} ${it.code}`}
                                onSelect={() => {
                                  const { qty } = parseSmartQuantityQuery(searchQuery);
                                  addItemWithQty(it, qty ?? 1);
                                  setSearchQuery('');
                                  setSearchOpen(false);
                                }}
                              >
                                <span className="truncate">{it.name}</span>
                                <span className="ml-2 text-xs text-muted-foreground truncate">{it.code}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        ) : (
                          <CommandEmpty>No matching menu items.</CommandEmpty>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex items-center gap-2">
                {user ? (
                  <div className="hidden md:flex items-center gap-2 mr-1">
                    <Badge variant="secondary" className="max-w-[220px] truncate">
                      {user.name}
                    </Badge>
                    <Badge variant="outline">{ROLE_NAMES[user.role] ?? user.role}</Badge>
                  </div>
                ) : null}
                <Button
                  variant="outline"
                  className="hidden sm:inline-flex"
                  title="Logout"
                  onClick={() => {
                    if (isCashier && activeShiftId) {
                      setShiftError(null);
                      setClosingCash('');
                      setCashierPin('');
                      setConfirmEndShift(false);
                      setShowEndShift(true);
                      return;
                    }

                    void (async () => {
                      await logout();
                      navigate('/');
                    })();
                  }}
                >
                  <LogOut className="h-4 w-4 mr-2" /> Logout
                </Button>
                <Button variant="outline" size="icon" title="Refresh" onClick={() => window.location.reload()}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" title={isOnline ? 'Online' : 'Offline'}>
                  <Wifi className={cn('h-4 w-4', isOnline ? 'text-emerald-500' : 'text-muted-foreground')} />
                </Button>

                <Button variant="outline" className="relative" title="Requests" onClick={() => setShowNotifications(true)}>
                  <BellRing className="h-4 w-4 mr-2" /> Requests
                  {posNotifs.length > 0 ? (
                    <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-bold text-destructive-foreground">
                      {posNotifs.length}
                    </span>
                  ) : null}
                  {paymentRequests.length > 0 && posNotifs.length === 0 ? (
                    <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-bold text-destructive-foreground">
                      {paymentRequests.length}
                    </span>
                  ) : null}
                </Button>

                <Dialog open={showNotifications} onOpenChange={setShowNotifications}>
                  <DialogContent className="max-w-md">
                    <div className="space-y-2">
                      <div className="font-medium">Notifications</div>
                      {posNotifs.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No new notifications</div>
                      ) : (
                        posNotifs.map((n) => (
                          <div key={n.id} className="flex items-start justify-between gap-2">
                            <div className="text-sm">Order #{n.payload?.orderNo}{n.payload?.tableNo ? ` • Table ${n.payload.tableNo}` : ''}</div>
                            <div className="flex items-center gap-2">
                              <div className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleTimeString()}</div>
                              <Button
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={async () => { await deleteNotificationById(n.id); }}
                              >
                                Done
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                      <div className="h-px bg-border my-2" />
                      <div className="flex gap-2">
                        <Button className="flex-1" variant="outline" onClick={() => { markNotificationsSeen(); }}>
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>

                <Button variant="outline" onClick={() => setShowHeldOrders(true)} title="Resume held orders">
                  <FolderOpen className="h-4 w-4 mr-2" /> Held
                </Button>

                {/* Table picker */}
                <Dialog open={showTableSelect} onOpenChange={setShowTableSelect}>
                  <DialogTrigger asChild>
                    <Button className="h-10" variant="default">
                      Select Table
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Select Table</DialogTitle>
                    </DialogHeader>
                    <div className="grid grid-cols-4 gap-2">
                      {tables.filter(t => t.status === 'available').map(table => (
                        <Button
                          key={table.id}
                          variant={selectedTable === table.number ? 'default' : 'outline'}
                          onClick={() => {
                            setOrderType('eat_in');
                            setSelectedTable(table.number);
                            const existing = findLatestActiveOrderForTable(table.number);
                            if (existing) loadOrderToTerminal(existing);
                            setShowTableSelect(false);
                          }}
                          className="h-16"
                        >
                          <div className="text-center">
                            <div className="font-bold">{table.number}</div>
                            <div className="text-xs">{table.seats} seats</div>
                          </div>
                        </Button>
                      ))}
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            <Dialog open={showAdminGate} onOpenChange={(open) => {
              if (!open) {
                setAdminBusy(false);
                setAdminError(null);
              }
              setShowAdminGate(open);
            }}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Admin Unlock</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    Enter an admin email and password to open Settings.
                  </div>
                  <Input
                    placeholder="Admin email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    disabled={adminBusy}
                    autoComplete="username"
                  />
                  <Input
                    placeholder="Admin password"
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    disabled={adminBusy}
                    autoComplete="current-password"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void unlockAdminAndOpenSettings();
                      }
                    }}
                  />
                  {adminError ? (
                    <div className="text-sm text-destructive">{adminError}</div>
                  ) : null}
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowAdminGate(false)}
                      disabled={adminBusy}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void unlockAdminAndOpenSettings()}
                      disabled={adminBusy}
                    >
                      {adminBusy ? 'Unlocking…' : 'Unlock'}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Cashier: Start shift prompt */}
            <Dialog open={showStartShift} onOpenChange={(open) => {
              // Starting shift is required for cashier. Keep this modal open until shift starts.
              if (!open) return;
              if (shiftBusy) return;
              setShowStartShift(true);
            }}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Start Shift</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    How much cash did you find in the cash register?
                  </div>
                  <Input
                    placeholder="Starting cash (e.g. 200.00)"
                    inputMode="decimal"
                    value={openingCash}
                    onChange={(e) => setOpeningCash(e.target.value)}
                    disabled={shiftBusy}
                  />
                  {!operatorPin ? (
                    <Input
                      placeholder="Enter your 4-digit PIN"
                      inputMode="numeric"
                      type="password"
                      value={cashierPin}
                      onChange={(e) => setCashierPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      disabled={shiftBusy}
                    />
                  ) : null}
                  {shiftError ? <div className="text-sm text-destructive">{shiftError}</div> : null}

                  {!confirmStartShift ? (
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <Button
                        type="button"
                        onClick={() => {
                          const amount = parseMoney(openingCash);
                          if (amount === null) {
                            setShiftError('Enter a valid amount.');
                            return;
                          }
                          setShiftError(null);
                          setConfirmStartShift(true);
                        }}
                        disabled={shiftBusy}
                      >
                        Start Shift
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-sm">
                        Confirm: is <span className="font-medium">{formatMoney(parseMoney(openingCash) ?? 0)}</span> the correct starting balance?
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setConfirmStartShift(false)}
                          disabled={shiftBusy}
                        >
                          Back
                        </Button>
                        <Button
                          type="button"
                          onClick={() => {
                            const amount = parseMoney(openingCash);
                            if (amount === null) {
                              setShiftError('Enter a valid amount.');
                              setConfirmStartShift(false);
                              return;
                            }
                            void startShift(amount);
                          }}
                          disabled={shiftBusy}
                        >
                          {shiftBusy ? 'Starting…' : 'Yes, Start'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>

            {/* Cashier: End shift prompt on logout */}
            <Dialog open={showEndShift} onOpenChange={(open) => {
              if (shiftBusy) return;
              setShowEndShift(open);
              if (!open) {
                setConfirmEndShift(false);
                setShiftError(null);
              }
            }}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>End Shift</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    Enter the closing cash balance in the register.
                  </div>
                  <Input
                    placeholder="Closing cash (e.g. 450.00)"
                    inputMode="decimal"
                    value={closingCash}
                    onChange={(e) => setClosingCash(e.target.value)}
                    disabled={shiftBusy}
                  />
                  {!operatorPin ? (
                    <Input
                      placeholder="Enter your 4-digit PIN"
                      inputMode="numeric"
                      type="password"
                      value={cashierPin}
                      onChange={(e) => setCashierPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      disabled={shiftBusy}
                    />
                  ) : null}
                  {shiftError ? <div className="text-sm text-destructive">{shiftError}</div> : null}

                  {!confirmEndShift ? (
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowEndShift(false)}
                        disabled={shiftBusy}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          // Allow logout without ending shift (in case of mistakes / handover)
                          void (async () => {
                            await logout();
                            navigate('/');
                          })();
                        }}
                        disabled={shiftBusy}
                      >
                        Logout Only
                      </Button>
                      <Button
                        type="button"
                        onClick={() => {
                          const amount = parseMoney(closingCash);
                          if (amount === null) {
                            setShiftError('Enter a valid amount.');
                            return;
                          }
                          setShiftError(null);
                          setConfirmEndShift(true);
                        }}
                        disabled={shiftBusy}
                      >
                        End Shift
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-sm">
                        Confirm: is <span className="font-medium">{formatMoney(parseMoney(closingCash) ?? 0)}</span> the correct closing balance?
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setConfirmEndShift(false)}
                          disabled={shiftBusy}
                        >
                          Back
                        </Button>
                        <Button
                          type="button"
                          onClick={() => {
                            const amount = parseMoney(closingCash);
                            if (amount === null) {
                              setShiftError('Enter a valid amount.');
                              setConfirmEndShift(false);
                              return;
                            }

                            void (async () => {
                              const ok = await endShift(amount);
                              if (ok) {
                                await logout();
                                navigate('/');
                              }
                            })();
                          }}
                          disabled={shiftBusy}
                        >
                          {shiftBusy ? 'Ending…' : 'Yes, End & Logout'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>

            {/* Category tabs */}
            <div className="border-b px-3 py-2">
              <div className="flex flex-wrap gap-2">
                {categoriesWithAll.map(cat => (
                  <Button
                    key={cat.id}
                    variant={selectedCategory === cat.id ? 'default' : 'outline'}
                    className={cn('h-9 rounded-full', selectedCategory === cat.id && cat.color)}
                    onClick={() => {
                      setSelectedCategory(cat.id);
                      setSearchQuery('');
                    }}
                  >
                    {cat.name}
                  </Button>
                ))}
              </div>
            </div>

            {/* Menu Grid */}
            <ScrollArea className="flex-1">
              <div className="p-3">
                {items.length <= 1 && (
                  <div className="mb-3 rounded-lg border bg-muted/30 p-3 text-sm">
                    <div className="font-medium">Only {items.length} menu item found.</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Go to POS Menu to add items, or reset to defaults.
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => navigate('/pos/menu')}>Open POS Menu</Button>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                  {filteredItems.map(item => (
                    <MenuItemCard key={item.id} item={item} onAdd={addItem} />
                  ))}
                </div>
              </div>
            </ScrollArea>
          </div>

          {/* Right: Cart */}
          <div className="border-l bg-muted/20 flex flex-col min-h-0">
        {/* Order Header */}
        <div className="p-3 border-b bg-background/50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              <span className="font-semibold">Current Order</span>
              {orderItems.length > 0 && (
                <Badge variant="secondary">{orderTotals.itemCount} items</Badge>
              )}
            </div>
            {orderItems.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearOrder}>
                <Trash2 className="h-4 w-4 mr-1" /> Clear
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {orderType === 'eat_in' ? (selectedTable ? `Table ${selectedTable}` : 'No table') : orderType.replace('_', ' ')}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOrderType(orderType === 'eat_in' ? 'take_out' : 'eat_in')}
              title="Toggle Eat-in / Take-out"
            >
              <Users className="h-4 w-4 mr-2" />
              {orderType === 'eat_in' ? 'Eat In' : 'Take Out'}
            </Button>
          </div>
        </div>
        
        {/* Order Items */}
        <ScrollArea className="flex-1 min-h-0">
          {orderItems.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground p-3">
              <p>Tap items to add to order</p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {orderItems.map(item => (
                <div
                  key={item.id}
                  className={cn(
                    'flex items-center justify-between p-2 rounded-md border cursor-pointer',
                    selectedOrderItemId === item.id ? 'bg-primary/10 border-primary' : 'bg-muted/50 border-transparent'
                  )}
                  onClick={() => setSelectedOrderItemId(item.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setSelectedOrderItemId(item.id);
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{item.menuItemName}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.quantity} × {formatMoneyPrecise(item.unitPrice, 2)}
                      {(item.discountPercent ?? 0) > 0 ? `  (−${item.discountPercent}%)` : ''}
                    </p>
                    {(item.modifiers?.length ?? 0) > 0 && (
                      <p className="text-xs text-muted-foreground truncate">{item.modifiers?.join(' · ')}</p>
                    )}
                    {item.notes && (
                      <p className="text-xs text-muted-foreground truncate">Note: {item.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateQuantity(item.id, -1);
                      }}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-8 text-center font-medium">{item.quantity}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateQuantity(item.id, 1);
                      }}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                    <span className="w-20 text-right font-bold">{formatMoneyPrecise(item.total, 0)}</span>
                  </div>
                </div>
              ))}

              {selectedOrderItem && (
                <div className="mt-3 rounded-md border bg-background p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-sm">Item options</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {selectedOrderItem.menuItemName}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedOrderItemId(null)}>
                      Done
                    </Button>
                  </div>

                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-sm font-medium">Quantity</div>
                        <Input
                          className="mt-2"
                          type="number"
                          value={selectedOrderItem.quantity}
                          min={1}
                          onChange={(e) => setQuantity(selectedOrderItem.id, Number(e.target.value))}
                        />
                      </div>
                      <div>
                        <div className="text-sm font-medium">Discount(%)</div>
                        <Input
                          className="mt-2"
                          type="number"
                          value={selectedOrderItem.discountPercent ?? 0}
                          min={0}
                          max={100}
                          onChange={(e) => setDiscountPercent(selectedOrderItem.id, Number(e.target.value))}
                        />
                      </div>
                    </div>

                    {(selectedMenuItem?.modifierGroups ?? []).length === 0 ? (
                      <div className="text-sm text-muted-foreground">No modifiers configured for this item.</div>
                    ) : (
                      (selectedMenuItem?.modifierGroups ?? []).map(groupId => {
                        const group = getModifierGroup(groupId);
                        if (!group) return null;

                        return (
                          <div key={group.id}>
                            <div className="text-sm font-medium">{group.name}</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {group.options.map(opt => {
                                const active = (selectedOrderItem.modifiers ?? []).includes(opt);
                                return (
                                  <Button
                                    key={opt}
                                    type="button"
                                    variant={active ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => toggleModifier(selectedOrderItem.id, opt)}
                                  >
                                    {opt}
                                  </Button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    )}

                    <div>
                      <div className="text-sm font-medium">Note</div>
                      <Input
                        value={selectedOrderItem.notes ?? ''}
                        onChange={(e) => setItemNote(selectedOrderItem.id, e.target.value)}
                        placeholder="e.g. No onions, extra sauce"
                        className="mt-2"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
        
        {/* Order Totals & Actions */}
        <div className="p-3 border-t bg-background/60">
          <div className="space-y-1 mb-3">
            <div className="flex justify-between text-sm">
              <span>Subtotal</span>
              <span>{formatMoneyPrecise(orderTotals.subtotal, 2)}</span>
            </div>
            {orderTotals.discountAmount > 0 ? (
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Discount ({orderTotals.discountPercent.toFixed(0)}%)</span>
                <span>− {formatMoneyPrecise(orderTotals.discountAmount, 2)}</span>
              </div>
            ) : null}
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>VAT (16%)</span>
              <span>{formatMoneyPrecise(orderTotals.tax, 2)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold pt-1 border-t">
              <span>Total</span>
              <span className="text-primary">{formatMoneyPrecise(orderTotals.total, 2)}</span>
            </div>
          </div>

          <div className="mb-2">
            <Button
              variant="outline"
              className="w-full"
              disabled={orderItems.length === 0 || orderItems.every((i) => i.sentToKitchen)}
              onClick={handleSendToKitchen}
            >
              <Send className="h-4 w-4 mr-2" /> Send to Kitchen
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              className="h-12 bg-orange-500 hover:bg-orange-600 text-white"
              disabled={orderItems.length === 0}
              onClick={handleHoldOrder}
            >
              Hold Order
            </Button>
            <Button
              className="h-12 bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={orderItems.length === 0}
              onClick={() => setShowPayment(true)}
            >
              Proceed
            </Button>
          </div>

          <div className="mt-2">
            <Button
              variant="outline"
              className="w-full"
              disabled={!receiptOrder}
              onClick={() => setShowReceipt(true)}
            >
              Print Receipt
            </Button>
          </div>

          <div className="mt-2 grid grid-cols-4 gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={orderItems.length === 0}
              onClick={() => setSelectedOrderItemId((prev) => prev ?? orderItems[orderItems.length - 1]?.id ?? null)}
            >
              Add
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={orderItems.length === 0}
              onClick={() => setSelectedOrderItemId((prev) => prev ?? orderItems[orderItems.length - 1]?.id ?? null)}
            >
              Discount
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={orderItems.length === 0}
              onClick={() => setShowCoupon(true)}
            >
              Coupon
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={orderItems.length === 0}
              onClick={() => setSelectedOrderItemId((prev) => prev ?? orderItems[orderItems.length - 1]?.id ?? null)}
            >
              Note
            </Button>
          </div>
          
          {hasPermission('applyDiscounts') && (
            <Button
              variant="ghost"
              className="w-full mt-2"
              size="sm"
              disabled={orderItems.length === 0}
              onClick={() => setShowCoupon(true)}
            >
              <Percent className="h-4 w-4 mr-2" /> Apply Discount
            </Button>
          )}
        </div>
          </div>
        </div>
      </div>
      
      {/* Payment Dialog */}
      <PaymentDialog
        open={showPayment}
        onOpenChange={setShowPayment}
        total={orderTotals.total}
        onComplete={handlePaymentComplete}
      />

      {/* Payment Requests (from Tables -> Till) */}
      <Dialog open={showPaymentRequests} onOpenChange={setShowPaymentRequests}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Payment Requests</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {paymentRequests.length === 0 ? (
              <div className="text-sm text-muted-foreground">No payment requests right now.</div>
            ) : (
              paymentRequests.map((r) => (
                <Card key={r.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">Table {r.tableNo}</div>
                      <div className="text-xs text-muted-foreground">
                        Requested by {r.requestedBy ?? 'staff'} • {new Date(r.createdAt).toLocaleTimeString()}
                      </div>
                      <div className="text-sm mt-1">
                        Total: <span className="font-mono">{formatMoneyPrecise(Number(r.total), 2)}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          const o = findOrderById(r.orderId);
                          if (o) loadOrderToTerminal(o, { openPayment: true });
                          resolvePosPaymentRequest(r.id);
                          setShowPaymentRequests(false);
                        }}
                      >
                        Open & Pay
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => resolvePosPaymentRequest(r.id)}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Held Orders */}
      <Dialog open={showHeldOrders} onOpenChange={setShowHeldOrders}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Held Orders</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {orders.filter((o) => o.status === 'open').length === 0 ? (
              <div className="text-sm text-muted-foreground">No held orders.</div>
            ) : (
              orders
                .filter((o) => o.status === 'open')
                .slice()
                .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
                .slice(0, 25)
                .map((o) => (
                  <Card key={o.id} className={cn('p-3', activeOrderId === o.id ? 'border-primary' : '')}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">
                          Order #{o.orderNo}{o.tableNo ? ` • Table ${o.tableNo}` : ''}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {o.staffName} • {new Date(o.createdAt).toLocaleString()}
                        </div>
                        <div className="text-sm mt-1">
                          Total: <span className="font-mono">{formatMoneyPrecise(o.total, 2)}</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          loadOrderToTerminal(o);
                          setShowHeldOrders(false);
                        }}
                      >
                        Resume
                      </Button>
                    </div>
                  </Card>
                ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showCoupon} onOpenChange={setShowCoupon}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Coupon / Discount</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">Coupon code</div>
              <Input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="e.g. WELCOME10" />
              <div className="text-xs text-muted-foreground">Optional. Use discount % below to apply.</div>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Order discount (%)</div>
              <Input
                type="number"
                min={0}
                max={100}
                value={orderDiscountPercent}
                onChange={(e) => setOrderDiscountPercent(Number(e.target.value) || 0)}
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setOrderDiscountPercent(0);
                  setCouponCode('');
                  setShowCoupon(false);
                }}
              >
                Clear
              </Button>
              <Button className="flex-1" onClick={() => setShowCoupon(false)}>
                Apply
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ReceiptPrintDialog
        open={showReceipt}
        onOpenChange={setShowReceipt}
        appName={settings.appName}
        order={receiptOrder}
      />

      <AlertDialog open={showRecipeError} onOpenChange={setShowRecipeError}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{recipeError ?? 'Recipe Error'}</AlertDialogTitle>
            <AlertDialogDescription>
              {recipeErrorDetail ?? 'Please ask a manager to resolve.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            {/* Manager override removed: sales cannot bypass inventory deductions here. */}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Debug modal removed */}
    </div>
  );
}
