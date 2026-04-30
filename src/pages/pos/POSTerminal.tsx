import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ShoppingCart, Send, Trash2, Plus, Minus, CreditCard, Users, Percent, Settings as SettingsIcon, RefreshCw, BellRing, FolderOpen, LogOut, MoreHorizontal, Receipt } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useRestaurantTables } from '@/hooks/useRestaurantTables';
import { OrderItem, Order, OrderType, PaymentMethod, POSMenuItem } from '@/types/pos';
import { cn } from '@/lib/utils';
import PaymentDialog from '@/components/pos/PaymentDialog';
import { RecipeIncompleteError } from '@/lib/recipeEngine';
import { getManufacturingRecipesSnapshot } from '@/lib/manufacturingRecipeStore';
import { getOrdersSnapshot, subscribeOrders, subscribeToRealtimeOrders, upsertOrder, sendOrderPayload } from '@/lib/orderStore';
import useKitchenRealtime from '@/hooks/useKitchenRealtime';
import { useToast } from '@/hooks/use-toast';
// debug viewer removed
import MenuItemCard from '@/components/pos/MenuItemCard';
import { getModifierGroup } from '@/data/posModifiers';
import { useBranding } from '@/contexts/BrandingContext';
import ReceiptPrintDialog from '@/components/pos/ReceiptPrintDialog';
import { usePosMenu } from '@/hooks/usePosMenu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { addPosPaymentRequest, getPosPaymentRequestsSnapshot, resolvePosPaymentRequest, subscribePosPaymentRequests } from '@/lib/posPaymentRequestStore';
import { getPosNotificationsSnapshot, subscribePosNotifications, markNotificationsSeen, deleteNotificationById } from '@/lib/posNotificationStore';
import { ROLE_NAMES } from '@/types/auth';
import { supabase } from '@/lib/supabaseClient';
import { useCurrency } from '@/contexts/CurrencyContext';
import { getFrontStockSnapshot, subscribeFrontStock } from '@/lib/frontStockStore';
import { getActiveBrandId } from '@/lib/activeBrand';

type SessionReceiptRow = {
  id: string;
  order_id: string;
  shift_id?: string | null;
  till_id?: string | null;
  till_code?: string | null;
  till_name?: string | null;
  staff_id?: string | null;
  staff_name?: string | null;
  order_no?: number | null;
  payment_method?: PaymentMethod | null;
  subtotal?: number | null;
  discount_amount?: number | null;
  tax?: number | null;
  total?: number | null;
  currency_code?: string | null;
  issued_at?: string | null;
  payload?: any;
};

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
  const frontStock = useSyncExternalStore(subscribeFrontStock, getFrontStockSnapshot);
  const { sections: restaurantTableSections } = useRestaurantTables();
  const tables = useMemo(() => restaurantTableSections.flatMap((s) => s.tables), [restaurantTableSections]);

  // debug viewer removed

  // Subscribe to kitchen realtime events so the POS sees remote kitchen updates
  useKitchenRealtime();

  // Also subscribe to order header/item realtime so table/tablet orders arrive fast.
  useEffect(() => {
    const unsub = subscribeToRealtimeOrders();
    return () => {
      try { if (unsub) unsub(); } catch {}
    };
  }, []);

  const { toast } = useToast();
  const prevReadyRef = useRef<Set<string>>(new Set());
  const seenIncomingOrderIdsRef = useRef<Set<string>>(new Set());
  const seenIncomingCallNotifIdsRef = useRef<Set<string>>(new Set());
  const incomingOrdersInitializedRef = useRef(false);
  const incomingNotifsInitializedRef = useRef(false);
  const [incomingOrders, setIncomingOrders] = useState<Array<{ id: string; orderNo: number; tableNo?: number; tableLabel?: string; total: number; source?: string; createdAt: string }>>([]);
  const [incomingCalls, setIncomingCalls] = useState<Array<{ id: string; kind: 'waiter_call' | 'payment_request'; tableNo?: number; tableLabel?: string; createdAt: string }>>([]);
  const [showIncomingOrders, setShowIncomingOrders] = useState(false);
  const syncedPaymentNotifIdsRef = useRef<Set<string>>(new Set());
  const posNotifs = useSyncExternalStore(subscribePosNotifications, getPosNotificationsSnapshot);
  const requestNotifs = useMemo(
    () => posNotifs.filter((n) => String(n.type ?? '') !== 'waiter_call' && String(n.type ?? '') !== 'tablet_order_seen'),
    [posNotifs]
  );
  const seenTabletOrderIdsFromNotifs = useMemo(() => {
    const ids = new Set<string>();
    for (const n of posNotifs) {
      if (String(n.type ?? '') !== 'tablet_order_seen') continue;
      const orderId = String(n.payload?.orderId ?? '').trim();
      if (orderId) ids.add(orderId);
    }
    return ids;
  }, [posNotifs]);
  const incomingSeenStorageKey = useMemo(() => {
    const brandId = String(getActiveBrandId() ?? 'no-brand').trim() || 'no-brand';
    const userId = String(user?.id ?? 'no-user').trim() || 'no-user';
    return `pmx.pos.incoming.seen.v1:${brandId}:${userId}`;
  }, [user?.id]);

  const persistSeenIncomingOrderIds = () => {
    try {
      localStorage.setItem(
        incomingSeenStorageKey,
        JSON.stringify(Array.from(seenIncomingOrderIdsRef.current).slice(-1000))
      );
    } catch {
      // ignore storage issues
    }
  };

  useEffect(() => {
    seenIncomingOrderIdsRef.current = new Set();
    incomingOrdersInitializedRef.current = false;
    try {
      const raw = localStorage.getItem(incomingSeenStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (const id of parsed) {
        const v = String(id ?? '').trim();
        if (v) seenIncomingOrderIdsRef.current.add(v);
      }
    } catch {
      // ignore malformed cache
    }
  }, [incomingSeenStorageKey]);

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

  // Detect new incoming tablet orders and queue them (never overwrite current cart).
  useEffect(() => {
    try {
      const next: Array<{ id: string; orderNo: number; tableNo?: number; tableLabel?: string; total: number; source?: string; createdAt: string }> = [];
      const nowMs = Date.now();
      if (!incomingOrdersInitializedRef.current) {
        if (!orders.length) return;
        for (const o of orders) {
          const source = (o as any).source ?? 'pos';
          if (source === 'tablet') seenIncomingOrderIdsRef.current.add(o.id);
        }
        persistSeenIncomingOrderIds();
        incomingOrdersInitializedRef.current = true;
        return;
      }
      for (const o of orders) {
        const source = (o as any).source ?? 'pos';
        if (source !== 'tablet') continue;
        if (seenTabletOrderIdsFromNotifs.has(String(o.id))) {
          seenIncomingOrderIdsRef.current.add(o.id);
          continue;
        }
        if (seenIncomingOrderIdsRef.current.has(o.id)) continue;
        const createdMs = new Date(o.createdAt).getTime();
        // Only treat relatively recent arrivals as "incoming" to avoid backfilling noise.
        if (!Number.isFinite(createdMs) || nowMs - createdMs > 1000 * 60 * 30) {
          seenIncomingOrderIdsRef.current.add(o.id);
          continue;
        }
        seenIncomingOrderIdsRef.current.add(o.id);
        next.push({
          id: o.id,
          orderNo: o.orderNo,
          tableNo: o.tableNo,
          tableLabel: o.tableNo ? `Table ${o.tableNo}` : undefined,
          total: o.total,
          source,
          createdAt: o.createdAt,
        });
      }
      persistSeenIncomingOrderIds();
      if (next.length > 0) {
        // Chime once per batch.
        try {
          playNotificationTone();
        } catch {}
        setIncomingOrders((prev) => [...next, ...prev].slice(0, 50));
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, seenTabletOrderIdsFromNotifs]);

  useEffect(() => {
    if (!seenTabletOrderIdsFromNotifs.size) return;
    setIncomingOrders((prev) => prev.filter((o) => !seenTabletOrderIdsFromNotifs.has(String(o.id))));
    let changed = false;
    for (const id of seenTabletOrderIdsFromNotifs) {
      if (!seenIncomingOrderIdsRef.current.has(id)) {
        seenIncomingOrderIdsRef.current.add(id);
        changed = true;
      }
    }
    if (changed) persistSeenIncomingOrderIds();
  }, [seenTabletOrderIdsFromNotifs]);

  // Online/offline status toast and internal state.
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast({ title: 'Online', description: 'Internet connection restored.' });
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast({ title: 'Offline', description: 'Internet disconnected. Orders will queue locally and sync later.', variant: 'destructive' });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [toast]);

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

  useEffect(() => {
    if (menu.items.length > 0 || orders.length > 0) {
      setIsLoading(false);
      return;
    }
    const timer = window.setTimeout(() => setIsLoading(false), 4000);
    return () => window.clearTimeout(timer);
  }, [menu.items.length, orders.length]);
  const categoriesWithAll = useMemo(
    () => [{ id: ALL_CATEGORY_ID, name: 'All', sortOrder: -999, color: 'bg-slate-500' }, ...categories],
    [categories]
  );

  const [selectedCategory, setSelectedCategory] = useState<string>(ALL_CATEGORY_ID);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('eat_in');
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [showTableSelect, setShowTableSelect] = useState(false);
  const [showHeldOrders, setShowHeldOrders] = useState(false);
  const [showPaymentRequests, setShowPaymentRequests] = useState(false);
  const [showKitchenSendReview, setShowKitchenSendReview] = useState(false);
  const [reviewParkAfterSend, setReviewParkAfterSend] = useState(false);
  const [sendKitchenBusy, setSendKitchenBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);

  const [showAdminGate, setShowAdminGate] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);

  const CASHIER_SHIFT_KEY_PREFIX = 'pmx.cashier.shift.active.v1.';
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);
  const [activeTill, setActiveTill] = useState<{ id: string; code: string; name: string } | null>(null);
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

  const POS_DEVICE_ID_KEY = 'pmx.pos.deviceId.v1';
  const getOrCreateDeviceId = () => {
    try {
      const existing = localStorage.getItem(POS_DEVICE_ID_KEY);
      if (existing && existing.trim()) return existing.trim();
      const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(POS_DEVICE_ID_KEY, uuid);
      return uuid;
    } catch {
      return `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
  };

  const deviceId = useMemo(() => getOrCreateDeviceId(), []);

  const [showTillSetup, setShowTillSetup] = useState(false);
  const [tillSetupBusy, setTillSetupBusy] = useState(false);
  const [tillSetupError, setTillSetupError] = useState<string | null>(null);
  const [supervisorEmail, setSupervisorEmail] = useState('');
  const [availableTills, setAvailableTills] = useState<Array<{
    id: string;
    code: string;
    name: string;
    assignedDeviceId?: string | null;
  }>>([]);
  const [selectedTillId, setSelectedTillId] = useState<string>('');
  const [loadedSupervisorEmail, setLoadedSupervisorEmail] = useState('');
  const [showReplaceTillConfirm, setShowReplaceTillConfirm] = useState(false);
  const allowTillSetupCloseRef = useRef(false);

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

  const requestLogout = () => {
    if (logoutBusy) return;
    setLogoutBusy(true);
    navigate('/');
    void logout().catch((err) => {
      console.warn('logout failed', err);
    });
  };

  const [showPostShiftActions, setShowPostShiftActions] = useState(false);

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
        p_device_id: deviceId,
      });
      if (error) {
        const status = (error as any)?.status;
        const message = String((error as any)?.message ?? '');
        const details = String((error as any)?.details ?? '');
        const hint = String((error as any)?.hint ?? '');
        const msg = message.toLowerCase();

        if (status === 404 || msg.includes('404') || msg.includes('could not find the function') || msg.includes('function')) {
          setShiftError('Shift feature is not installed on the server yet. Run the Supabase shift/till migrations and try again.');
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
        // Most common causes: invalid cashier role/PIN OR this terminal isn't assigned to a till yet.
        setShiftError('This terminal is not assigned to a till yet. Ask a supervisor to assign a till for this device.');
        setShowTillSetup(true);
        return false;
      }
      setActiveTill({
        id: String(row?.till_id ?? ''),
        code: String(row?.till_code ?? ''),
        name: String(row?.till_name ?? ''),
      });
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

  const loadTillsForSupervisor = async () => {
    if (!supabase) return;
    const email = supervisorEmail.trim().toLowerCase();
    const brandId = String(user?.brand_id ?? '').trim();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!brandId) {
      setTillSetupError('Missing brand context. Please sign in again.');
      return;
    }
    if (!email) {
      setTillSetupError('Enter admin email.');
      setAvailableTills([]);
      setLoadedSupervisorEmail('');
      return;
    }
    if (!validEmail) {
      setTillSetupError('Enter a valid admin email (example: owner@brand.com).');
      setAvailableTills([]);
      setLoadedSupervisorEmail('');
      return;
    }
    setTillSetupBusy(true);
    setTillSetupError(null);
    setSelectedTillId('');
    try {
      const { data, error } = await supabase.rpc('list_tills_with_assignment_for_brand_admin_email', {
        p_brand_id: brandId,
        p_admin_email: email,
      });

      if (error) {
        setTillSetupError(String((error as any)?.message ?? 'Unable to load tills'));
        setAvailableTills([]);
        return;
      }
      const tills = (Array.isArray(data) ? data : []).map((t: any) => ({
        id: String(t.id),
        code: String(t.code ?? ''),
        name: String(t.name ?? ''),
        assignedDeviceId: t.assigned_device_id ? String(t.assigned_device_id) : null,
      }));
      setAvailableTills(tills);
      setLoadedSupervisorEmail(email);
      if (!tills.length) {
        setTillSetupError('Admin email not allowed for this brand or no active tills found.');
      }
      if (tills.length) setSelectedTillId(tills[0].id);
    } catch (e: any) {
      setTillSetupError(e?.message ?? 'Unable to load tills');
      setAvailableTills([]);
      setLoadedSupervisorEmail('');
    } finally {
      setTillSetupBusy(false);
    }
  };

  useEffect(() => {
    const email = supervisorEmail.trim().toLowerCase();
    if (!email) {
      setAvailableTills([]);
      setSelectedTillId('');
      setLoadedSupervisorEmail('');
      setTillSetupError(null);
      return;
    }
    if (loadedSupervisorEmail && email !== loadedSupervisorEmail) {
      setAvailableTills([]);
      setSelectedTillId('');
    }
  }, [supervisorEmail, loadedSupervisorEmail]);

  const assignTillToThisDevice = async (forceReplace = false) => {
    if (!supabase) return;
    const email = supervisorEmail.trim().toLowerCase();
    const brandId = String(user?.brand_id ?? '').trim();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!brandId) {
      setTillSetupError('Missing brand context. Please sign in again.');
      return;
    }
    if (!email) {
      setTillSetupError('Enter admin email.');
      return;
    }
    if (!validEmail) {
      setTillSetupError('Enter a valid admin email.');
      return;
    }
    if (!selectedTillId) {
      setTillSetupError('Select a till.');
      return;
    }
    if (!loadedSupervisorEmail || loadedSupervisorEmail !== email || !availableTills.length) {
      setTillSetupError('Load tills using this admin email first, then assign.');
      return;
    }
    const selectedTill = availableTills.find((t) => t.id === selectedTillId);
    const assignedDevice = String(selectedTill?.assignedDeviceId ?? '').trim();
    if (
      assignedDevice &&
      assignedDevice.toLowerCase() !== String(deviceId).toLowerCase() &&
      !forceReplace
    ) {
      setShowReplaceTillConfirm(true);
      return;
    }
    setTillSetupBusy(true);
    setTillSetupError(null);
    try {
      const { data, error } = await supabase.rpc('assign_pos_device_to_till_by_brand_admin_email_v2', {
        p_brand_id: brandId,
        p_admin_email: email,
        p_device_id: deviceId,
        p_till_id: selectedTillId,
        p_replace_existing: forceReplace,
      });

      if (error) {
        setTillSetupError(String((error as any)?.message ?? 'Unable to assign till'));
        return;
      }
      const ok = Boolean((data as any)?.ok ?? false);
      if (!ok) {
        const reason = String((data as any)?.error ?? '');
        const assignedDevice = String((data as any)?.assigned_device_id ?? '').trim();
        if (reason === 'till_already_assigned') {
          setTillSetupError(
            assignedDevice
              ? `This till is already assigned to device ${assignedDevice}. Unassign it first to keep one-to-one control.`
              : 'This till is already assigned to another device. Unassign it first to keep one-to-one control.'
          );
        } else {
          setTillSetupError(reason || 'Unable to assign till');
        }
        return;
      }
      allowTillSetupCloseRef.current = true;
      setShowTillSetup(false);
      setShowReplaceTillConfirm(false);
      setShowStartShift(true);
      toast({ title: 'Till assigned', description: 'This terminal is now linked to a till.' });
    } catch (e: any) {
      setTillSetupError(e?.message ?? 'Unable to assign till');
    } finally {
      setTillSetupBusy(false);
    }
  };

  const openIncomingOrder = (incoming: { id: string; orderNo: number; tableNo?: number; createdAt: string }) => {
    const incomingId = String(incoming.id ?? '').trim();
    if (incomingId) {
      seenIncomingOrderIdsRef.current.add(incomingId);
      persistSeenIncomingOrderIds();
    }
    const full = findOrderById(incomingId);
    if (full) loadOrderToTerminal(full);
    if (supabase) {
      void (async () => {
        try {
          await supabase.rpc('tablet_mark_order_seen', { p_order_id: incomingId });
        } catch {
          // non-blocking: UI should still clear incoming card even if seen marker fails
        }
      })();
    }
    // Opening an incoming order counts as attending it: remove from queue and close modal.
    setIncomingOrders((prev) =>
      prev.filter((x) => {
        const sameId = String(x.id ?? '').trim().toLowerCase() === incomingId.toLowerCase();
        const sameFallback =
          Number(x.orderNo) === Number(incoming.orderNo) &&
          Number(x.tableNo ?? -1) === Number(incoming.tableNo ?? -1) &&
          String(x.createdAt ?? '') === String(incoming.createdAt ?? '');
        return !(sameId || sameFallback);
      })
    );
    setShowIncomingOrders(false);
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
          setShiftError(
            'Shift feature is not installed on the server yet. Run the latest shift/till migrations: 2026-04-28-tills-and-pos-devices.sql, 2026-04-28-cashier-shift-start-require-device.sql, and 2026-04-28-cashier-shift-rpcs-v2-till-details.sql.'
          );
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

      // Best-effort: finalize Z-report snapshot with expected totals.
      try {
        await supabase.rpc('cashier_shift_finalize_z_report', {
          p_shift_id: shiftId,
          p_actual_cash: amount,
          p_closed_by_staff_id: user?.id ?? null,
        } as any);
      } catch {
        // ignore finalize failures; shift is still closed via cashier_shift_end
      }

      setActiveShiftId(null);
      setActiveTill(null);
      storeShiftId(null);

      setShowEndShift(false);
      setConfirmEndShift(false);
      setClosingCash('');
      setCashierPin('');
      setShowPostShiftActions(true);
      return true;
    } catch (e: any) {
      setShiftError(e?.message ?? 'Unable to end shift');
      return false;
    } finally {
      setShiftBusy(false);
    }
  };

  useEffect(() => {
    // If cashier: restore active shift (if any). If none exists, enforce till setup first,
    // then show the start-shift cash modal.
    if (!isCashier || !user?.id) return;

    const stored = readStoredShiftId();
    let disposed = false;

    const hasTillAssignedForDevice = async () => {
      if (!supabase) return false;
      const email = String(user?.email ?? '').trim();
      const pin = String(operatorPin ?? '').trim();
      if (!email || !/^[0-9]{4}$/.test(pin)) return false;
      try {
        const { data, error } = await supabase.rpc('get_device_till_for_staff', {
          p_email: email,
          p_pin: pin,
          p_device_id: deviceId,
        });
        if (error) return false;
        const row = Array.isArray(data) ? data[0] : (data as any);
        return Boolean(row?.till_id);
      } catch {
        return false;
      }
    };

    (async () => {
      if (!stored) {
        setActiveShiftId(null);
        setActiveTill(null);
        const assigned = await hasTillAssignedForDevice();
        if (disposed) return;
        setShowTillSetup(!assigned);
        setShowStartShift(assigned);
        return;
      }

      if (!supabase) {
        setActiveShiftId(stored);
        return;
      }

      try {
        const { data, error } = await supabase.rpc('cashier_shift_get', { p_shift_id: stored });
        if (disposed) return;
        if (error) {
          setActiveShiftId(null);
          setActiveTill(null);
          storeShiftId(null);
          const assigned = await hasTillAssignedForDevice();
          if (disposed) return;
          setShowTillSetup(!assigned);
          setShowStartShift(assigned);
          return;
        }
        const row = Array.isArray(data) ? data[0] : (data as any);
        if (!row || row.closed_at) {
          setActiveShiftId(null);
          setActiveTill(null);
          storeShiftId(null);
          const assigned = await hasTillAssignedForDevice();
          if (disposed) return;
          setShowTillSetup(!assigned);
          setShowStartShift(assigned);
          return;
        }
        setActiveShiftId(String(row.id ?? stored));
        setActiveTill({
          id: String(row.till_id ?? ''),
          code: String(row.till_code ?? ''),
          name: String(row.till_name ?? ''),
        });
      } catch {
        if (disposed) return;
        setActiveShiftId(stored);
      }
    })();

    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCashier, user?.id, user?.email, operatorPin, supabase, deviceId]);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [showSessionReceipts, setShowSessionReceipts] = useState(false);
  const [sessionReceipts, setSessionReceipts] = useState<SessionReceiptRow[]>([]);
  const [sessionReceiptsLoading, setSessionReceiptsLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [orderDiscountPercent, setOrderDiscountPercent] = useState(0);
  const [couponCode, setCouponCode] = useState('');
  const [showCoupon, setShowCoupon] = useState(false);

  const paymentRequests = useSyncExternalStore(subscribePosPaymentRequests, getPosPaymentRequestsSnapshot);
  const prevRequestIds = useRef<string>('');
  const prevNotifIds = useRef<string>('');
  const prevIncomingIds = useRef<string>('');
  const [showSlide, setShowSlide] = useState(false);
  const slideTimerRef = useRef<number | null>(null);
  const [slidePayload, setSlidePayload] = useState<{ title: string; body: string; openTarget: 'notifications' | 'incoming' } | null>(null);
  const [lastTabletChannelActivityAt, setLastTabletChannelActivityAt] = useState<number>(Date.now());
  const isFreshRealtimeEvent = (isoAt?: string, maxAgeMinutes = 3) => {
    const ts = String(isoAt ?? '').trim();
    const ms = new Date(ts).getTime();
    if (!Number.isFinite(ms)) return false;
    return Date.now() - ms <= maxAgeMinutes * 60 * 1000;
  };

  const broadcastPaymentTrackingRequest = (params: {
    orderId: string;
    tableNo: number;
    total: number;
    note?: string;
  }) => {
    try {
      const brandId = String(getActiveBrandId() ?? '').trim();
      if (!supabase || !brandId) return;
      void supabase.from('pos_notifications').insert({
        brand_id: brandId,
        type: 'tablet_payment_request',
        payload: {
          orderId: params.orderId,
          tableNo: params.tableNo,
          tableLabel: `Table ${params.tableNo}`,
          total: Number(params.total ?? 0),
          requestedBy: user?.name ?? user?.email ?? 'cashier',
          note: params.note ?? 'Payment tracking request',
          source: 'pos_tracking',
        },
      });
    } catch {
      // non-blocking
    }
  };

  const computeLineTotal = (unitPrice: number, qty: number, discountPercent?: number) => {
    const d = Math.min(100, Math.max(0, discountPercent ?? 0));
    const effective = unitPrice * (1 - d / 100);
    return effective * qty;
  };

  const [recipeError, setRecipeError] = useState<string | null>(null);
  const [recipeErrorDetail, setRecipeErrorDetail] = useState<string | null>(null);
  const [showRecipeError, setShowRecipeError] = useState(false);
  const [showStockBlocked, setShowStockBlocked] = useState(false);
  const [stockBlockTitle, setStockBlockTitle] = useState<string | null>(null);
  const [stockBlockDescription, setStockBlockDescription] = useState<string | null>(null);

  const getItemPrepRoute = (menuItemId: string): 'kitchen' | 'direct_sale' => {
    const mi = items.find((x) => x.id === menuItemId);
    return mi?.prepRoute === 'direct_sale' ? 'direct_sale' : 'kitchen';
  };

  const unsentKitchenItems = useMemo(
    () => orderItems.filter((i) => !i.isVoided && !i.sentToKitchen && getItemPrepRoute(i.menuItemId) === 'kitchen'),
    [orderItems, items]
  );
  const unsentDirectSaleItems = useMemo(
    () => orderItems.filter((i) => !i.isVoided && getItemPrepRoute(i.menuItemId) === 'direct_sale'),
    [orderItems, items]
  );

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
    if (incomingOrders.length > 0 || incomingCalls.length > 0) setLastTabletChannelActivityAt(Date.now());
  }, [incomingOrders.length, incomingCalls.length]);

  useEffect(() => {
    if (posNotifs.some((n) => String(n.type ?? '') === 'waiter_call')) {
      setLastTabletChannelActivityAt(Date.now());
    }
  }, [posNotifs]);

  useEffect(() => {
    const ids = paymentRequests.map((r) => r.id).join('|');
    prevRequestIds.current = ids;
  }, [paymentRequests]);

  useEffect(() => {
    const ids = posNotifs.map((n) => n.id).join('|');
    if (!incomingNotifsInitializedRef.current) {
      prevNotifIds.current = ids;
      for (const n of posNotifs) {
        if (n.type === 'waiter_call' || n.type === 'tablet_payment_request') {
          seenIncomingCallNotifIdsRef.current.add(n.id);
        }
      }
      incomingNotifsInitializedRef.current = true;
      return;
    }
    if (ids !== prevNotifIds.current) {
      const prevSet = new Set(prevNotifIds.current.split('|').filter(Boolean));
      for (const n of posNotifs) {
        if (!prevSet.has(n.id)) {
          const createdAt = String((n as any)?.created_at ?? '');
          const fresh = isFreshRealtimeEvent(createdAt, 3);
          if ((n.type === 'waiter_call' || n.type === 'tablet_payment_request') && !seenIncomingCallNotifIdsRef.current.has(n.id)) {
            seenIncomingCallNotifIdsRef.current.add(n.id);
            if (fresh) {
              setIncomingCalls((prev) => [
                {
                  id: String(n.id),
                  kind: n.type === 'tablet_payment_request' ? 'payment_request' : 'waiter_call',
                  tableNo: n.payload?.tableNo != null ? Number(n.payload.tableNo) : undefined,
                  tableLabel: n.payload?.tableLabel != null ? String(n.payload.tableLabel) : undefined,
                  createdAt: String(n.created_at ?? new Date().toISOString()),
                },
                ...prev,
              ].slice(0, 50));
            }
          }
          if (!fresh) continue;
          try {
            if (n.type === 'waiter_call') {
              toast({
                title: 'Waiter call',
                description: `${n.payload?.tableLabel ?? (n.payload?.tableNo ? `Table ${n.payload.tableNo}` : 'A table')} is requesting service.`,
              });
            } else if (n.type === 'tablet_payment_request') {
              toast({
                title: 'Bill requested',
                description: `${n.payload?.tableLabel ?? (n.payload?.tableNo ? `Table ${n.payload.tableNo}` : 'A table')} requested bill/payment.`,
              });
            } else {
              toast({ title: 'Order Ready', description: `Order #${n.payload?.orderNo}${n.payload?.tableNo ? ` • Table ${n.payload.tableNo}` : ''}` });
            }
          } catch {
            // ignore
          }
          // Non-destructive slide banner from bottom with quick-open action.
          try {
            const body =
              n.type === 'waiter_call'
                ? `${n.payload?.tableLabel ?? (n.payload?.tableNo ? `Table ${n.payload.tableNo}` : 'A table')} calls for waiter`
                : n.type === 'tablet_payment_request'
                  ? `${n.payload?.tableLabel ?? (n.payload?.tableNo ? `Table ${n.payload.tableNo}` : 'A table')} requested bill/payment`
                : `Order #${n.payload?.orderNo}${n.payload?.tableNo ? ` • Table ${n.payload.tableNo}` : ''}`;
            setSlidePayload({
              title: n.type === 'waiter_call' ? 'Waiter Call' : n.type === 'tablet_payment_request' ? 'Bill Requested' : 'Order Ready',
              body,
              openTarget: n.type === 'waiter_call' || n.type === 'tablet_payment_request' ? 'incoming' : 'notifications',
            });
            setShowSlide(true);
            if (slideTimerRef.current) window.clearTimeout(slideTimerRef.current as any);
            slideTimerRef.current = window.setTimeout(() => setShowSlide(false), 6500);
          } catch {}
          try { playNotificationTone(); } catch {}
        }
      }
    }
    prevNotifIds.current = ids;
  }, [posNotifs, toast]);

  useEffect(() => {
    for (const n of posNotifs) {
      if (String(n.type ?? '') !== 'tablet_payment_request') continue;
      if (syncedPaymentNotifIdsRef.current.has(n.id)) continue;
      const payload = (n.payload ?? {}) as any;
      const tableNo = Number(payload.tableNo ?? 0);
      if (!Number.isFinite(tableNo) || tableNo <= 0) continue;
      syncedPaymentNotifIdsRef.current.add(n.id);
      const orderIdRaw = String(payload.orderId ?? '').trim();
      addPosPaymentRequest({
        id: n.id,
        createdAt: String(n.created_at ?? new Date().toISOString()),
        tableNo,
        orderId: orderIdRaw || `notif-${n.id}`,
        total: Number(payload.total ?? 0) || 0,
        requestedBy: String(payload.requestedBy ?? payload.deviceId ?? 'staff'),
        note: String(payload.note ?? 'Tracked'),
      });
    }
  }, [posNotifs]);

  useEffect(() => {
    const ids = incomingOrders.map((o) => o.id).join('|');
    if (ids !== prevIncomingIds.current) {
      const prevSet = new Set(prevIncomingIds.current.split('|').filter(Boolean));
      for (const o of incomingOrders) {
        if (!prevSet.has(o.id)) {
          if (!isFreshRealtimeEvent(String(o.createdAt ?? ''), 3)) continue;
          try {
            setSlidePayload({
              title: 'Incoming Tablet Order',
              body: `Order #${o.orderNo}${o.tableNo ? ` • ${o.tableLabel ?? `Table ${o.tableNo}`}` : ''}`,
              openTarget: 'incoming',
            });
            setShowSlide(true);
            if (slideTimerRef.current) window.clearTimeout(slideTimerRef.current as any);
            slideTimerRef.current = window.setTimeout(() => setShowSlide(false), 6500);
          } catch {}
          break;
        }
      }
    }
    prevIncomingIds.current = ids;
  }, [incomingOrders]);

  useEffect(() => {
    if (!showSessionReceipts) return;
    if (!user?.email || !operatorPin || !supabase) return;

    let cancelled = false;
    setSessionReceiptsLoading(true);

    (async () => {
      const { data, error } = await supabase.rpc('get_staff_shift_receipts', {
        p_email: user.email,
        p_pin: operatorPin,
        p_shift_id: activeShiftId ?? null,
        p_limit: 120,
      });
      if (cancelled) return;
      if (error) {
        console.warn('[POSTerminal] get_staff_shift_receipts error', error);
        setSessionReceipts([]);
      } else {
        setSessionReceipts((Array.isArray(data) ? data : []) as SessionReceiptRow[]);
      }
      setSessionReceiptsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [showSessionReceipts, user?.email, operatorPin, activeShiftId]);

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
      gain.gain.exponentialRampToValueAtTime(4.20, now + 0.02);
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

  const filteredItems = useMemo(() => {
    const base = items.filter((i) => i.isAvailable);
    if (selectedCategory === ALL_CATEGORY_ID) return base;
    return base.filter((item) => item.categoryId === selectedCategory);
  }, [items, selectedCategory]);

  const stockMaps = useMemo(() => {
    const saleByItemId = new Map<string, { qty: number; reorder: number }>();
    const saleByCode = new Map<string, { qty: number; reorder: number }>();
    const mfgByItemId = new Map<string, { qty: number; reorder: number }>();
    for (const r of frontStock ?? []) {
      const loc = String((r as any).locationTag ?? '').toUpperCase();
      const qty = Number((r as any).quantity ?? 0) || 0;
      const reorder = Number((r as any).reorderLevel ?? 0) || 0;
      const itemId = String((r as any).itemId ?? '').trim();
      const code = String((r as any).producedCode ?? (r as any).itemCode ?? '').trim().toLowerCase();
      if (loc === 'SALE') {
        if (itemId) saleByItemId.set(itemId, { qty, reorder });
        if (code) {
          const prev = saleByCode.get(code) ?? { qty: 0, reorder: 0 };
          saleByCode.set(code, { qty: prev.qty + qty, reorder: Math.max(prev.reorder, reorder) });
        }
      }
      if (loc === 'MANUFACTURING') {
        if (itemId) mfgByItemId.set(itemId, { qty, reorder });
      }
    }
    return { saleByItemId, saleByCode, mfgByItemId };
  }, [frontStock]);

  const canSetMenuItemQty = useMemo(() => {
    const recipes = getManufacturingRecipesSnapshot();
    const recipeByCode = new Map(recipes.map((r) => [String(r.parentItemCode).trim().toLowerCase(), r] as const));
    const recipeById = new Map(recipes.map((r) => [String(r.parentItemId), r] as const));

    return (menuItem: POSMenuItem, nextQty: number): { ok: true } | { ok: false; title: string; description: string } => {
      const safeNextQty = Math.max(0, Math.floor(nextQty));
      if (safeNextQty <= 0) return { ok: true };

      const directPhysicalId = String((menuItem as any)?.physicalStockItemId ?? '').trim();
      const code = String(menuItem.code ?? '').trim().toLowerCase();

      // 1) Ready-to-sell SALE by physical item id
      if (directPhysicalId) {
        const onHand = stockMaps.saleByItemId.get(directPhysicalId)?.qty ?? 0;
        const reorder = stockMaps.saleByItemId.get(directPhysicalId)?.reorder ?? 0;
        if (safeNextQty > onHand + 1e-9) {
          const maxAllowed = Math.max(0, Math.floor(onHand + 1e-9));
          return {
            ok: false,
            title: 'Not enough stock',
            description: `You can add up to ${maxAllowed} ${menuItem.name}(s) based on current SALE stock (${onHand}).`,
          };
        }
        if (reorder > 0 && onHand - safeNextQty <= reorder + 1e-9) {
          return { ok: true };
        }
        return { ok: true };
      }

      // 2) Ready-to-sell SALE by produced/item code
      if (code) {
        const hasSaleLinkByCode = stockMaps.saleByCode.has(code);
        if (hasSaleLinkByCode) {
          const onHand = stockMaps.saleByCode.get(code)?.qty ?? 0;
          if (safeNextQty > onHand + 1e-9) {
            const maxAllowed = Math.max(0, Math.floor(onHand + 1e-9));
            return {
              ok: false,
              title: 'Not enough stock',
              description: `You can add up to ${maxAllowed} ${menuItem.name}(s) based on current SALE stock (${onHand}).`,
            };
          }
          return { ok: true };
        }
      }

      // 3) Recipe path: MANUFACTURING ingredients
      const recipe = recipeById.get(String(menuItem.id)) ?? (code ? recipeByCode.get(code) : undefined);
      if (!recipe) return { ok: true }; // allow adding; send-to-kitchen will still enforce recipe completeness

      const outputQty = Number(recipe.outputQty) > 0 ? Number(recipe.outputQty) : 1;
      const multiplier = safeNextQty / outputQty;
      const low: Array<{ name: string; onHand: number; required: number }> = [];
      for (const ing of recipe.ingredients ?? []) {
        const required = (Number((ing as any).requiredQty) || 0) * multiplier;
        if (required <= 0) continue;
        const onHand = stockMaps.mfgByItemId.get(String((ing as any).ingredientId))?.qty ?? 0;
        if (onHand + 1e-9 < required) {
          low.push({ name: String((ing as any).ingredientName ?? (ing as any).ingredientId), onHand, required });
        }
      }
      if (low.length) {
        const first = low[0];
        const maxMakeable = first.required > 0
          ? Math.max(0, Math.floor((first.onHand / first.required) * safeNextQty + 1e-9))
          : 0;
        return {
          ok: false,
          title: 'Not enough ingredients',
          description: `You can add up to ${maxMakeable} ${menuItem.name}(s) with current Manufacturing stock. Limiting ingredient: ${first.name}.`,
        };
      }
      return { ok: true };
    };
  }, [stockMaps]);

  const addItemWithQty = (menuItem: POSMenuItem, qty: number) => {
    const safeQty = Math.max(1, Math.floor(qty));
    setOrderItems(prevOrderItems => {
      const existing = prevOrderItems.find((oi) => oi.menuItemId === menuItem.id);
      if (existing) {
        return prevOrderItems.map((oi) => {
          if (oi.id !== existing.id) return oi;
          const nextQty = oi.quantity + safeQty;
          const check = canSetMenuItemQty(menuItem, nextQty);
          if (!check.ok) {
            setStockBlockTitle(check.title ?? 'Not enough stock');
            setStockBlockDescription(check.description ?? 'Insufficient stock to add this quantity.');
            setShowStockBlocked(true);
            return oi;
          }
          return {
            ...oi,
            quantity: nextQty,
            total: computeLineTotal(oi.unitPrice, nextQty, oi.discountPercent),
          };
        });
      }
      const check = canSetMenuItemQty(menuItem, safeQty);
      if (!check.ok) {
        setStockBlockTitle(check.title ?? 'Not enough stock');
        setStockBlockDescription(check.description ?? 'Insufficient stock to add this quantity.');
        setShowStockBlocked(true);
        return prevOrderItems;
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
      const check = canSetMenuItemQty(menuItem, existing.quantity + 1);
      if (!check.ok) {
        setStockBlockTitle(check.title ?? 'Not enough stock');
        setStockBlockDescription(check.description ?? 'Insufficient stock to add this quantity.');
        setShowStockBlocked(true);
        return;
      }
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

    const check = canSetMenuItemQty(menuItem, 1);
    if (!check.ok) {
      setStockBlockTitle(check.title ?? 'Not enough stock');
      setStockBlockDescription(check.description ?? 'Insufficient stock to add this quantity.');
      setShowStockBlocked(true);
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

  // Non-destructive bottom slide notification UI.
  const SlideNotification = () => {
    if (!showSlide || !slidePayload) return null;
    return (
      <div className={cn(
        'fixed left-1/2 transform -translate-x-1/2 bottom-4 z-50 transition-all duration-300',
        showSlide ? 'translate-y-0 opacity-100 animate-in fade-in-0 slide-in-from-bottom-3 duration-300' : 'translate-y-8 opacity-0'
      )}>
        <div className="max-w-lg w-[min(95vw,520px)] bg-white border shadow-lg rounded-md p-4 flex items-start gap-3">
          <div className="flex-1">
            <div className="font-medium">{slidePayload.title}</div>
            <div className="text-sm text-slate-600">{slidePayload.body}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => { setShowSlide(false); }}>Dismiss</Button>
            <Button
              size="sm"
              onClick={() => {
                if (slidePayload.openTarget === 'incoming') setShowIncomingOrders(true);
                else setShowNotifications(true);
                setShowSlide(false);
              }}
            >
              Open
            </Button>
          </div>
        </div>
      </div>
    );
  };
  
  const updateQuantity = (itemId: string, delta: number) => {
    const updated = orderItems.map(item => {
      if (item.id === itemId) {
        const newQty = Math.max(0, item.quantity + delta);
        const mi = items.find((x) => x.id === item.menuItemId);
        if (mi) {
          const check = canSetMenuItemQty(mi, newQty);
          if (!check.ok) {
            setStockBlockTitle(check.title ?? 'Not enough stock');
            setStockBlockDescription(check.description ?? 'Insufficient stock to set this quantity.');
            setShowStockBlocked(true);
            return item;
          }
        }
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
        const mi = items.find((x) => x.id === item.menuItemId);
        if (mi) {
          const check = canSetMenuItemQty(mi, nextQty);
          if (!check.ok) {
            setStockBlockTitle(check.title ?? 'Not enough stock');
            setStockBlockDescription(check.description ?? 'Insufficient stock to set this quantity.');
            setShowStockBlocked(true);
            return item;
          }
        }
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
      sentToKitchen: params.sent
        ? Boolean(item.sentToKitchen || (!item.isVoided && getItemPrepRoute(item.menuItemId) === 'kitchen'))
        : item.sentToKitchen,
    }));

    const order: Order = {
      id,
      orderNo,
      shiftId: activeShiftId ?? existing?.shiftId,
      tillId: activeTill?.id ?? existing?.tillId,
      tillCode: activeTill?.code ?? existing?.tillCode,
      tillName: activeTill?.name ?? existing?.tillName,
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

  const applyRecipeDeductionsOrThrow = async (targetItems?: OrderItem[]) => {
    // POS-side precheck only:
    // - direct SALE-linked items do not require recipes
    // - non-direct items must have a manufacturing recipe
    //
    // Actual stock deduction is handled server-side via orderStore -> handle_order_stock_deduction.
    const toDeduct = (targetItems ?? orderItems).filter((i) => !i.isVoided && !i.sentToKitchen);
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

    const missingRecipeForMenuItemIds: string[] = [];

    for (const line of toDeduct) {
      const qty = Number.isFinite(line.quantity) ? line.quantity : 0;
      if (qty <= 0) continue;

      const menuItem = menuById.get(line.menuItemId);
      const directFrontStockLinked = Boolean((menuItem as any)?.physicalStockItemId);
      const code = String(menuItem?.code ?? line.menuItemCode).trim();
      const name = String(menuItem?.name ?? '').trim();
      const directProducedSaleLinked = Boolean(code) && saleProducedCodes.has(code.toLowerCase());
      const directSaleCodeLinked = Boolean(code) && saleItemCodes.has(code.toLowerCase());
      const directSaleNameLinked = Boolean(name) && saleItemNames.has(name.toLowerCase());
      // Direct ready-to-sell link: no manufacturing recipe required in POS precheck.
      // Backend dispatcher (handle_order_stock_deduction) handles SALE deduction.
      if (directFrontStockLinked || directProducedSaleLinked || directSaleCodeLinked || directSaleNameLinked) {
        continue;
      }
      const recipe = recipeByParentId.get(line.menuItemId) ?? recipeByCode.get(code);
      if (!recipe) {
        missingRecipeForMenuItemIds.push(line.menuItemId);
        continue;
      }

    }

    if (missingRecipeForMenuItemIds.length) {
      throw new RecipeIncompleteError(missingRecipeForMenuItemIds[0]!, ['NO_MANUFACTURING_RECIPE']);
    }
  };

  const showDeductionError = (e: unknown) => {
    if (e instanceof RecipeIncompleteError) {
      setRecipeError('Recipe Incomplete (Manager Action Required)');
      setRecipeErrorDetail(`MenuItem: ${e.menuItemId}. Missing: ${e.missing.join(', ')}`);
      setShowRecipeError(true);
      return;
    }
    setRecipeError('Inventory Deduction Failed');
    setRecipeErrorDetail(e instanceof Error ? e.message : 'Unknown error');
    setShowRecipeError(true);
  };
  
  const openKitchenSendReview = (parkAfterSend: boolean) => {
    if (orderItems.length === 0) return;
    setReviewParkAfterSend(parkAfterSend);
    setShowKitchenSendReview(true);
  };

  const handleSendToKitchen = async (opts?: { parkAfterSend?: boolean }) => {
    if (sendKitchenBusy) return;
    setSendKitchenBusy(true);
    if (!isOnline) {
      toast({ title: 'No Internet', description: 'You are offline. Send-to-kitchen requests will sync when connection returns.' });
    }
    try {
      const shouldPark = Boolean(opts?.parkAfterSend);
      if (!unsentKitchenItems.length) {
        if (!shouldPark) {
          toast({
            title: 'No kitchen items',
            description: 'All current items are marked as direct sale. Use Proceed to complete payment.',
          });
          return;
        }
        const parked = upsertActiveOrder({ status: 'open', sent: false });
        const parkedTableNo = Number(parked.tableNo ?? selectedTable ?? 0);
        if (parkedTableNo > 0) {
          addPosPaymentRequest({
            tableNo: parkedTableNo,
            orderId: parked.id,
            total: Number(parked.total ?? orderTotals.total ?? 0),
            requestedBy: user?.name ?? user?.email ?? 'cashier',
            note: 'Unpaid (awaiting bill)',
          });
        broadcastPaymentTrackingRequest({
          orderId: parked.id,
          tableNo: parkedTableNo,
          total: Number(parked.total ?? orderTotals.total ?? 0),
          note: 'Unpaid (awaiting bill)',
        });
          clearOrder();
          setShowPaymentRequests(true);
          toast({
            title: 'Order parked',
            description: `Table ${parkedTableNo} moved to payment tracking.`,
          });
        }
        return;
      }

      await applyRecipeDeductionsOrThrow(unsentKitchenItems);

      // Merge duplicate items by menuItemId BEFORE saving
      const mergedItems = orderItems.reduce((acc, it) => {
        const existing = acc.find(a => a.menuItemId === it.menuItemId && !a.isVoided);
        if (existing) {
          existing.quantity += it.quantity;
          existing.total += it.total;
          existing.sentToKitchen = Boolean(existing.sentToKitchen || it.sentToKitchen);
        } else {
          acc.push({ ...it });
        }
        return acc;
      }, [] as OrderItem[]);

      // Save the merged order (guaranteed only once)
      const saved = upsertActiveOrder({ status: 'sent', sent: true, items: mergedItems });

      // debug: removed on-screen merged items

      // Keep the current ticket visible and mark only kitchen-routed lines as sent.
      setOrderItems((prev) =>
        prev.map((item) =>
          (!item.isVoided && getItemPrepRoute(item.menuItemId) === 'kitchen')
            ? { ...item, sentToKitchen: true }
            : item
        )
      );
      setActiveOrderId(saved.id);
      const isTableOrder = orderType === 'eat_in' && Number(selectedTable) > 0;
      if (isTableOrder) {
        addPosPaymentRequest({
          tableNo: Number(selectedTable),
          orderId: saved.id,
          total: Number(saved.total ?? orderTotals.total ?? 0),
          requestedBy: user?.name ?? user?.email ?? 'cashier',
          note: shouldPark ? 'Unpaid (awaiting bill)' : 'Unpaid (auto-tracked)',
        });
        broadcastPaymentTrackingRequest({
          orderId: saved.id,
          tableNo: Number(selectedTable),
          total: Number(saved.total ?? orderTotals.total ?? 0),
          note: shouldPark ? 'Unpaid (awaiting bill)' : 'Unpaid (auto-tracked)',
        });
      }
      if (shouldPark && isTableOrder) {
        clearOrder();
        setShowPaymentRequests(true);
        toast({
          title: 'Order parked',
          description: `Table ${Number(selectedTable)} moved to payment tracking.`,
        });
      }

      // Note: we intentionally do NOT call `sendOrderPayload` here because
      // `upsertOrder` already triggers remote sync (via `sendOrderToSupabase`).
      // Calling both can result in duplicate inserts in some environments
      // due to concurrent retries/deletes. The automatic sync will handle
      // server upsert/insert reliably and is preferred.
    } catch (e) {
      showDeductionError(e);
    } finally {
      setSendKitchenBusy(false);
    }
  };
  
  const handlePaymentComplete = async (method: PaymentMethod) => {
    if (!isOnline) {
      toast({ title: 'No Internet', description: 'You are offline. The payment order will be synced once online.' });
    }

    try {
      await applyRecipeDeductionsOrThrow();

      const saved = upsertActiveOrder({ status: 'paid', paymentMethod: method, sent: false });

      setReceiptOrder(saved);
      setShowReceipt(true);

      setShowPayment(false);
      clearOrder();

      // Resolve payment requests in background so receipt appears immediately.
      setTimeout(() => {
        const req = paymentRequests.find((r) => r.orderId === saved.id);
        if (req) {
          void deleteNotificationById(req.id);
          resolvePosPaymentRequest(req.id);
        }
      }, 0);
      for (const n of posNotifs) {
        if (String(n.type ?? '') !== 'tablet_payment_request') continue;
        const nOrderId = String((n.payload as any)?.orderId ?? '').trim();
        if (nOrderId && nOrderId === saved.id) {
          void deleteNotificationById(n.id);
        }
      }

      // Let table tablets know payment has been confirmed by cashier.
      try {
        const tableNo = Number(saved.tableNo ?? 0);
        const brandId = String(getActiveBrandId() ?? '').trim();
        if (supabase && brandId && Number.isFinite(tableNo) && tableNo > 0) {
          void supabase.from('pos_notifications').insert({
            brand_id: brandId,
            type: 'tablet_payment_status',
            payload: {
              orderId: saved.id,
              tableNo,
              status: 'paid',
              message: 'Payment confirmed by cashier',
            },
          });
        }
      } catch {
        // non-blocking
      }
    } catch (e) {
      setShowPayment(false);
      showDeductionError(e);
    }
  };

  const presentBillForTracking = () => {
    const active = activeOrderId ? findOrderById(activeOrderId) : null;
    const tableOrder = selectedTable ? findLatestActiveOrderForTable(selectedTable) : null;
    const target = active ?? tableOrder;
    if (!target) {
      toast({
        title: 'No active order',
        description: 'Send the order first, then present/request bill for tracking.',
      });
      return;
    }
    const tableNo = Number(target.tableNo ?? selectedTable ?? 0);
    if (!Number.isFinite(tableNo) || tableNo <= 0) {
      toast({
        title: 'Table required',
        description: 'Bill tracking works for table orders. Select a table first.',
      });
      return;
    }
    addPosPaymentRequest({
      tableNo,
      orderId: target.id,
      total: Number(target.total ?? orderTotals.total ?? 0),
      requestedBy: user?.name ?? user?.email ?? 'cashier',
      note: 'Bill presented by cashier',
    });
    broadcastPaymentTrackingRequest({
      orderId: target.id,
      tableNo,
      total: Number(target.total ?? orderTotals.total ?? 0),
      note: 'Bill presented by cashier',
    });
    setShowPaymentRequests(true);
    toast({
      title: 'Bill presented',
      description: `Table ${tableNo} added to payment tracking.`,
    });
  };

  const printPreparationTicket = () => {
    if (orderItems.length === 0) return;
    const existing = activeOrderId ? findOrderById(activeOrderId) : null;
    const orderNo = existing?.orderNo ?? nextOrderNo(orders);
    const tableLabel =
      orderType === 'eat_in'
        ? selectedTable
          ? `Table ${selectedTable}`
          : 'Eat In'
        : 'Take Out';
    const issuedAt = new Date().toLocaleString();
    const itemRows = orderItems
      .map((it) => `<tr><td style="padding:2px 0; width:28px; vertical-align:top; font-weight:700;">${it.quantity}x</td><td style="padding:2px 0 2px 6px;">${String(it.menuItemName ?? '')}</td></tr>`)
      .join('');
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Preparation Ticket</title>
    <style>
      @page { size: 58mm auto; margin: 3mm; }
      body { font-family: Arial, sans-serif; margin: 0; padding: 0; color: #111; width: 58mm; }
      .wrap { padding: 0; }
      .brand { font-size: 12px; font-weight: 700; text-align: center; margin-bottom: 2px; }
      .order-no { font-size: 22px; font-weight: 900; text-align: center; line-height: 1.1; margin: 2px 0 4px; }
      .meta { font-size: 10px; margin: 1px 0; }
      .divider { border-top: 1px dashed #555; margin: 6px 0; }
      table { width: 100%; border-collapse: collapse; }
      .footer { margin-top: 6px; font-size: 11px; text-align: center; font-weight: 700; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="brand">${String(settings.appName ?? 'POS')}</div>
      <div class="order-no">#${String(orderNo)}</div>
      <div class="meta"><strong>${String(tableLabel)}</strong></div>
      <div class="meta">${String(issuedAt)}</div>
      <div class="divider"></div>
      <table>${itemRows}</table>
      <div class="divider"></div>
      <div class="footer">Your order is being prepared, please wait.</div>
    </div>
  </body>
</html>`;
    const w = window.open('', '_blank', 'width=420,height=640');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
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

  const localSessionPaidOrders = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'paid')
        .filter((o) => (activeShiftId ? String(o.shiftId ?? '') === String(activeShiftId) : true))
        .sort((a, b) => String(b.paidAt ?? b.createdAt).localeCompare(String(a.paidAt ?? a.createdAt)))
        .slice(0, 120),
    [orders, activeShiftId]
  );

  const openReceiptFromSessionRow = (row: SessionReceiptRow) => {
    const payloadItems = Array.isArray(row.payload?.items) ? row.payload.items : [];
    const order: Order = {
      id: String(row.order_id ?? row.id),
      orderNo: Number(row.order_no ?? 0),
      shiftId: row.shift_id ? String(row.shift_id) : undefined,
      tillId: row.till_id ? String(row.till_id) : undefined,
      tillCode: row.till_code ? String(row.till_code) : undefined,
      tillName: row.till_name ? String(row.till_name) : undefined,
      tableNo: Number.isFinite(Number(row.payload?.tableNo)) ? Number(row.payload?.tableNo) : undefined,
      orderType: (row.payload?.orderType as OrderType) ?? 'take_out',
      status: 'paid',
      staffId: String(row.staff_id ?? ''),
      staffName: String(row.staff_name ?? 'Cashier'),
      items: payloadItems.map((it: any, idx: number) => ({
        id: String(it?.id ?? `${row.id}-it-${idx}`),
        menuItemId: String(it?.menuItemId ?? ''),
        menuItemCode: String(it?.menuItemCode ?? ''),
        menuItemName: String(it?.menuItemName ?? 'Item'),
        quantity: Number(it?.quantity ?? 0),
        unitPrice: Number(it?.unitPrice ?? 0),
        unitCost: Number(it?.unitCost ?? 0),
        discountPercent: it?.discountPercent != null ? Number(it.discountPercent) : undefined,
        total: Number(it?.total ?? 0),
        notes: it?.notes ? String(it.notes) : undefined,
        modifiers: Array.isArray(it?.modifiers) ? it.modifiers.map((m: any) => String(m)) : undefined,
        isVoided: Boolean(it?.isVoided),
        voidReason: it?.voidReason ? String(it.voidReason) : undefined,
        sentToKitchen: Boolean(it?.sentToKitchen),
        preparedAt: it?.preparedAt ? String(it.preparedAt) : undefined,
      })),
      subtotal: Number(row.subtotal ?? 0),
      discountAmount: Number(row.discount_amount ?? 0),
      discountPercent: 0,
      tax: Number(row.tax ?? 0),
      total: Number(row.total ?? 0),
      totalCost: 0,
      grossProfit: 0,
      gpPercent: 0,
      createdAt: String(row.issued_at ?? new Date().toISOString()),
      paidAt: String(row.issued_at ?? new Date().toISOString()),
      paymentMethod: (row.payment_method as PaymentMethod) ?? undefined,
    };
    setReceiptOrder(order);
    setShowSessionReceipts(false);
    setShowReceipt(true);
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
      <SlideNotification />
      <AlertDialog open={showPostShiftActions} onOpenChange={setShowPostShiftActions}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Shift closed</AlertDialogTitle>
            <AlertDialogDescription>
              Your Z-report snapshot has been saved. Next step: run a Front Office Stock Take to check for leakage and reconcile front stock.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowPostShiftActions(false)}>Later</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowPostShiftActions(false);
                navigate('/app/inventory/front-stock-take');
              }}
            >
              Run Front Stock Take
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={showTillSetup}
        onOpenChange={(o) => {
          // Till assignment is mandatory before shift start; block manual dismiss.
          if (!o && !allowTillSetupCloseRef.current) return;
          setShowTillSetup(o);
          if (!o) {
            setTillSetupError(null);
            setTillSetupBusy(false);
            setAvailableTills([]);
            setSelectedTillId('');
            setSupervisorEmail('');
            setLoadedSupervisorEmail('');
            setShowReplaceTillConfirm(false);
            allowTillSetupCloseRef.current = false;
          }
        }}
      >
        <DialogContent
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Assign this terminal to a till</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              Device ID: <span className="font-mono">{deviceId}</span>
            </div>
            <div className="text-muted-foreground">
              An admin/supervisor must assign this device to a till before shifts can start.
            </div>
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              This step is required for audit trails, cashier accountability, and accurate cash/funds tracking per drawer.
            </div>

            <div className="grid gap-2">
              <div className="grid gap-1">
                <div className="text-xs text-muted-foreground">Admin email</div>
                <Input
                  value={supervisorEmail}
                  onChange={(e) => {
                    setSupervisorEmail(e.target.value);
                    setTillSetupError(null);
                  }}
                  placeholder="e.g. owner@brand.com"
                  autoComplete="username"
                />
              </div>
              <div className="text-xs text-muted-foreground">Enter admin email to load available tills for this brand.</div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={loadTillsForSupervisor}
                  disabled={tillSetupBusy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supervisorEmail.trim().toLowerCase())}
                >
                  Load tills
                </Button>
              </div>
            </div>

            {availableTills.length ? (
              <div className="grid gap-1">
                <div className="text-xs text-muted-foreground">Select till</div>
                <div className="max-h-56 overflow-auto rounded-md border bg-muted/20 p-2 space-y-2">
                  {availableTills.map((t) => {
                    const assignedDevice = String(t.assignedDeviceId ?? '').trim();
                    const assignedToThisDevice = assignedDevice && assignedDevice.toLowerCase() === String(deviceId).toLowerCase();
                    const assignedToOtherDevice = assignedDevice && !assignedToThisDevice;
                    const isSelected = selectedTillId === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedTillId(t.id)}
                        className={cn(
                          'w-full rounded-md border p-2.5 text-left transition-colors',
                          isSelected ? 'border-primary bg-primary/10' : 'border-border bg-background hover:bg-muted/40'
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium text-sm">{t.code} • {t.name}</div>
                          <span
                            className={cn(
                              'text-[11px] rounded-full px-2 py-0.5 border',
                              assignedToThisDevice
                                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700'
                                : assignedToOtherDevice
                                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-700'
                                  : 'bg-sky-500/10 border-sky-500/40 text-sky-700'
                            )}
                          >
                            {assignedToThisDevice
                              ? 'Assigned (this device)'
                              : assignedToOtherDevice
                                ? `Assigned (${assignedDevice})`
                                : 'Unassigned'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Tap any till row to select it. If already assigned to another device, you will be asked to confirm replacement.
                </div>
              </div>
            ) : null}

            {tillSetupError ? <div className="text-sm text-destructive">{tillSetupError}</div> : null}

            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={() => void assignTillToThisDevice(false)} disabled={tillSetupBusy || !selectedTillId}>
                Assign till
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showReplaceTillConfirm} onOpenChange={setShowReplaceTillConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace till assignment?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="text-muted-foreground">
              This till is already linked to another device. Do you want to replace it with this terminal?
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowReplaceTillConfirm(false)} disabled={tillSetupBusy}>
                Cancel
              </Button>
              <Button onClick={() => void assignTillToThisDevice(true)} disabled={tillSetupBusy}>
                {tillSetupBusy ? 'Replacing...' : 'Replace & Assign'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="h-full rounded-2xl border bg-background overflow-auto lg:overflow-hidden overscroll-contain">
        <div className="h-full grid grid-cols-1 lg:grid-cols-[4.5rem_minmax(0,1fr)_minmax(18rem,22rem)] xl:grid-cols-[4.5rem_minmax(0,1fr)_minmax(20rem,25rem)]">
          {/* Left icon rail (POS-like) */}
          <div className="hidden lg:flex flex-col items-center border-r bg-muted/30 py-3">
            <div className="w-12 h-12 rounded-xl border bg-background flex items-center justify-center font-bold">
              {settings.appName.slice(0, 1).toUpperCase()}
            </div>

            <div className="mt-3 w-full px-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" className="h-9 w-full justify-center">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48">
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">{user?.name ?? 'Unknown'}</div>
                    <div className="text-xs text-muted-foreground">{ROLE_NAMES[user?.role ?? 'guest'] ?? user?.role}</div>
                    <div className="h-px bg-border" />
                    <Button variant="ghost" className="w-full justify-start" onClick={openSettings}>
                      <SettingsIcon className="h-4 w-4 mr-2" />
                      Settings
                    </Button>
                    <Button variant="ghost" className="w-full justify-start" onClick={() => {
                      if (isCashier && activeShiftId) {
                        setShiftError(null);
                        setClosingCash('');
                        setCashierPin('');
                        setConfirmEndShift(false);
                        setShowEndShift(true);
                        return;
                      }
                      requestLogout();
                    }}>
                      <LogOut className="h-4 w-4 mr-2" />
                      {logoutBusy ? 'Logging out…' : 'Logout'}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
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
              <Button
                variant="ghost"
                className="mt-2 h-11 w-full justify-center"
                title="Logout / End shift"
                onClick={() => {
                  if (isCashier && activeShiftId) {
                    setShiftError(null);
                    setClosingCash('');
                    setCashierPin('');
                    setConfirmEndShift(false);
                    setShowEndShift(true);
                    return;
                  }
                  requestLogout();
                }}
              >
                <LogOut className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* Middle: Menu */}
          <div className="flex flex-col min-w-0">
            {/* Debug panel removed */}
            {/* Top bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b p-2.5 lg:p-3">
              <div className="hidden sm:block">
                <div className="font-semibold">{settings.appName}</div>
                {activeTill?.id ? (
                  <div className="text-xs text-muted-foreground">
                    Till {activeTill.code || '?'} • {activeTill.name || 'Unnamed'}
                  </div>
                ) : null}
              </div>
              <div className="flex-1 min-w-[80px]" />
              <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    'hidden md:inline-flex',
                    isOnline && Date.now() - lastTabletChannelActivityAt < 1000 * 60 * 5
                      ? 'border-emerald-500/40 text-emerald-600'
                      : 'border-amber-500/40 text-amber-600'
                  )}
                  title="Realtime channel health for tablet calls/orders"
                >
                  Tablet {isOnline && Date.now() - lastTabletChannelActivityAt < 1000 * 60 * 5 ? 'Live' : 'Syncing'}
                </Badge>

                <Button
                  variant="outline"
                  className="relative px-2.5 sm:px-3"
                  title="Requests"
                  onClick={() => setShowNotifications(true)}
                >
                  <BellRing className="h-4 w-4" />
                  <span className="hidden lg:inline ml-2">Requests</span>
                  {requestNotifs.length > 0 ? (
                    <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-bold text-destructive-foreground">
                      {requestNotifs.length}
                    </span>
                  ) : null}
                  {paymentRequests.length > 0 && requestNotifs.length === 0 ? (
                    <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-bold text-destructive-foreground">
                      {paymentRequests.length}
                    </span>
                  ) : null}
                </Button>

                <Button
                  variant={incomingOrders.length + incomingCalls.length > 0 ? 'default' : 'outline'}
                  className={cn('relative px-2.5 sm:px-3', incomingOrders.length + incomingCalls.length > 0 ? 'animate-[pulse_1.15s_ease-in-out_infinite]' : '')}
                  title="Table inbox"
                  onClick={() => setShowIncomingOrders(true)}
                >
                  <Receipt className="h-4 w-4" />
                  <span className="hidden lg:inline ml-2">Table Inbox</span>
                  {incomingOrders.length + incomingCalls.length > 0 ? (
                    <span className="absolute -top-1 -right-1 inline-flex h-3 w-3 rounded-full bg-sky-500 animate-ping" />
                  ) : null}
                  {incomingOrders.length + incomingCalls.length > 0 ? (
                    <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-600 px-1 text-xs font-bold text-white animate-pulse">
                      {incomingOrders.length + incomingCalls.length}
                    </span>
                  ) : null}
                </Button>
                <Button
                  variant={paymentRequests.length > 0 ? 'default' : 'outline'}
                  className="relative px-2.5 sm:px-3"
                  title="Table payments"
                  onClick={() => setShowPaymentRequests(true)}
                >
                  <CreditCard className="h-4 w-4" />
                  <span className="hidden lg:inline ml-2">Table Payments</span>
                  {paymentRequests.length > 0 ? (
                    <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-bold text-destructive-foreground">
                      {paymentRequests.length}
                    </span>
                  ) : null}
                </Button>

                <Dialog open={showNotifications} onOpenChange={setShowNotifications}>
                  <DialogContent className="max-w-md">
                    <div className="space-y-2">
                      <div className="font-medium">Requests</div>
                      {requestNotifs.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No new notifications</div>
                      ) : (
                        requestNotifs.map((n) => (
                          <div key={n.id} className="flex items-start justify-between gap-2">
                            <div className="text-sm">
                              <span>
                                Order #{n.payload?.orderNo}
                                {n.payload?.tableNo ? ` • Table ${n.payload.tableNo}` : ''}
                              </span>
                            </div>
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

                <Dialog open={showIncomingOrders} onOpenChange={setShowIncomingOrders}>
                  <DialogContent className="max-w-md">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">Table Inbox</div>
                        {incomingOrders.length || incomingCalls.length ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setIncomingOrders([]);
                              setIncomingCalls([]);
                            }}
                          >
                            Clear
                          </Button>
                        ) : null}
                      </div>
                      {incomingOrders.length === 0 && incomingCalls.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No new tablet orders.</div>
                      ) : (
                        <div className="space-y-2">
                          {incomingCalls.slice(0, 25).map((c) => (
                            <Card key={`call-${c.id}`} className={cn('p-3', c.kind === 'payment_request' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="font-semibold">
                                    {c.kind === 'payment_request' ? 'Bill request' : 'Waiter call'} • {c.tableLabel ?? (c.tableNo ? `Table ${c.tableNo}` : 'Table')}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {new Date(c.createdAt).toLocaleTimeString()}
                                  </div>
                                </div>
                                <div className="flex flex-col gap-2">
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      setIncomingCalls((prev) => prev.filter((x) => x.id !== c.id));
                                      setShowIncomingOrders(false);
                                    }}
                                  >
                                    Open
                                  </Button>
                                </div>
                              </div>
                            </Card>
                          ))}
                          {incomingOrders.slice(0, 25).map((o) => (
                            <Card key={o.id} className="p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="font-semibold">
                                    Order #{o.orderNo}{o.tableNo ? ` • ${o.tableLabel ?? `Table ${o.tableNo}`}` : ''}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    Tablet • {new Date(o.createdAt).toLocaleTimeString()}
                                  </div>
                                  <div className="text-sm mt-1">
                                    Total: <span className="font-mono">{formatMoneyPrecise(Number(o.total ?? 0), 2)}</span>
                                  </div>
                                </div>
                                <div className="flex flex-col gap-2">
                                  <Button
                                    size="sm"
                                    onClick={() => openIncomingOrder(o)}
                                  >
                                    Open
                                  </Button>
                                </div>
                              </div>
                            </Card>
                          ))}
                        </div>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>

                <Dialog open={showTableSelect} onOpenChange={setShowTableSelect}>
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
                          requestLogout();
                        }}
                        disabled={shiftBusy || logoutBusy}
                      >
                        {logoutBusy ? 'Logging out…' : 'Logout Only'}
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
                                requestLogout();
                              }
                            })();
                          }}
                          disabled={shiftBusy || logoutBusy}
                        >
                          {shiftBusy ? 'Ending…' : logoutBusy ? 'Logging out…' : 'Yes, End & Logout'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>

            {/* Category selector (responsive) */}
            <div className="border-b px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">Category</span>
                <Select
                  value={selectedCategory}
                  onValueChange={(value) => {
                    setSelectedCategory(value);
                  }}
                >
                  <SelectTrigger className="min-w-[150px]">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoriesWithAll.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Menu Grid */}
            <ScrollArea className="flex-1">
              <div className="p-3">
                {items.length === 0 && isLoading ? (
                  <div className="mb-3 rounded-lg border bg-muted/30 p-3 text-sm">
                    <div className="font-medium">Loading menu items...</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Fetching items from cloud. Please wait a few seconds.
                    </div>
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="h-24 rounded-lg border border-muted/50 bg-slate-700/30 animate-pulse" />
                      ))}
                    </div>
                  </div>
                ) : items.length === 0 ? (
                  <div className="mb-3 rounded-lg border bg-muted/30 p-3 text-sm">
                    <div className="font-medium">No menu items available.</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Add items in POS Menu Manager to start taking orders.
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => navigate('/app/pos/menu')}>Open POS Menu Manager</Button>
                    </div>
                  </div>
                ) : items.length === 1 ? (
                  <div className="mb-3 rounded-lg border bg-muted/30 p-3 text-sm">
                    <div className="font-medium">Only one menu item found.</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Add more items in POS Menu Manager for a complete selection.
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => navigate('/app/pos/menu')}>Open POS Menu Manager</Button>
                    </div>
                  </div>
                ) : null}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                  {filteredItems.map(item => (
                    <MenuItemCard key={item.id} item={item} onAdd={addItem} />
                  ))}
                </div>
              </div>
            </ScrollArea>
          </div>

          {/* Right: Cart */}
          <div className="border-t lg:border-t-0 lg:border-l bg-muted/20 flex flex-col min-h-0 min-w-0 w-full max-w-full lg:w-[min(34vw,22rem)] xl:w-[min(30vw,25rem)]">
        {/* Order Header */}
        <div className="p-2.5 lg:p-3 border-b bg-background/50">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <ShoppingCart className="h-5 w-5" />
              <span className="font-semibold truncate">Current Order</span>
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

          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {orderType === 'eat_in' ? (selectedTable ? `Table ${selectedTable}` : 'No table') : orderType.replace('_', ' ')}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setShowTableSelect(true)}
                title="Select table"
              >
                <span className="hidden sm:inline">{selectedTable ? `Table ${selectedTable}` : 'Select Table'}</span>
                <span className="inline sm:hidden">Table</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setShowHeldOrders(true)}
                title="Resume held orders"
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Held</span>
                <span className="inline sm:hidden">Held</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setOrderType(orderType === 'eat_in' ? 'take_out' : 'eat_in')}
                title="Toggle Eat-in / Take-out"
              >
                <Users className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">{orderType === 'eat_in' ? 'Eat In' : 'Take Out'}</span>
                <span className="inline sm:hidden">{orderType === 'eat_in' ? 'In' : 'Out'}</span>
              </Button>
            </div>
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
                    <div className="mt-1">
                      <Badge variant={getItemPrepRoute(item.menuItemId) === 'direct_sale' ? 'secondary' : 'outline'}>
                        {getItemPrepRoute(item.menuItemId) === 'direct_sale' ? 'Direct Sale' : (item.sentToKitchen ? 'Kitchen Sent' : 'Kitchen Item')}
                      </Badge>
                    </div>
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

          <div className="mb-2 flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={sendKitchenBusy || orderItems.length === 0 || orderItems.every((i) => i.sentToKitchen)}
              onClick={() => openKitchenSendReview(false)}
            >
              {sendKitchenBusy ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              {sendKitchenBusy ? 'Sending...' : 'Send to Kitchen'}
            </Button>
            <div
              className={cn(
                'transition-all duration-200',
                orderItems.length > 0 || !!receiptOrder || !!activeOrderId
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-60 translate-y-0'
              )}
            >
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="icon" title="More actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 p-2">
                  <div className="space-y-2">
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    disabled={!receiptOrder}
                    onClick={() => setShowReceipt(true)}
                  >
                    Print Receipt
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => setShowSessionReceipts(true)}
                  >
                    <Receipt className="h-4 w-4 mr-2" />
                    Session Receipts
                  </Button>

                  <div className="h-px bg-border my-2" />

                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div
            className={cn(
              'mb-2 transition-all duration-200',
              orderItems.length > 0 ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1 h-0 overflow-hidden'
            )}
          >
            <Button
              variant="outline"
              className="w-full"
              disabled={orderItems.length === 0}
              onClick={printPreparationTicket}
            >
              Print Preparation Ticket
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

      <Dialog open={showKitchenSendReview} onOpenChange={setShowKitchenSendReview}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Review Kitchen Send</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border p-3">
              <div className="font-medium">Will send to kitchen ({unsentKitchenItems.length})</div>
              {unsentKitchenItems.length === 0 ? (
                <div className="mt-1 text-muted-foreground">No kitchen-routed items in this order.</div>
              ) : (
                <div className="mt-1 space-y-1">
                  {unsentKitchenItems.map((it) => (
                    <div key={`k-${it.id}`} className="text-muted-foreground">{it.quantity}x {it.menuItemName}</div>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-md border p-3">
              <div className="font-medium">Direct sale / no kitchen ({unsentDirectSaleItems.length})</div>
              {unsentDirectSaleItems.length === 0 ? (
                <div className="mt-1 text-muted-foreground">None</div>
              ) : (
                <div className="mt-1 space-y-1">
                  {unsentDirectSaleItems.map((it) => (
                    <div key={`d-${it.id}`} className="text-muted-foreground">{it.quantity}x {it.menuItemName}</div>
                  ))}
                </div>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              This review does not remove any items from the order. It only confirms routing.
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowKitchenSendReview(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  setShowKitchenSendReview(false);
                  void handleSendToKitchen({ parkAfterSend: reviewParkAfterSend });
                }}
              >
                {reviewParkAfterSend ? 'Confirm Send & Park' : 'Confirm Send'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Table Payments (from table orders -> till) */}
      <Dialog open={showPaymentRequests} onOpenChange={setShowPaymentRequests}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Table Payments</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {paymentRequests.length === 0 ? (
              <div className="text-sm text-muted-foreground">No unpaid table payments right now.</div>
            ) : (
              paymentRequests.map((r) => (
                <Card key={r.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">Table {r.tableNo}</div>
                      <div className="text-xs text-muted-foreground">
                        Requested by {r.requestedBy ?? 'staff'} • {new Date(r.createdAt).toLocaleTimeString()}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant="destructive">Unpaid</Badge>
                        <Badge variant={String(r.note ?? '').toLowerCase().includes('presented') ? 'default' : 'secondary'}>
                          {String(r.note ?? '').trim() || 'Tracked'}
                        </Badge>
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
                          setShowPaymentRequests(false);
                        }}
                      >
                        Open & Settle
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void deleteNotificationById(r.id);
                          resolvePosPaymentRequest(r.id);
                        }}
                      >
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
                        <div className="flex items-center gap-2 font-semibold">
                          <span>Order #{o.orderNo}{o.tableNo ? ` • Table ${o.tableNo}` : ''}</span>
                          {o.source === 'tablet' ? <Badge variant="secondary">Tablet</Badge> : null}
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

      <Dialog open={showSessionReceipts} onOpenChange={setShowSessionReceipts}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Session Receipts</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-auto space-y-2">
            {sessionReceiptsLoading ? (
              <div className="text-sm text-muted-foreground">Loading receipts...</div>
            ) : sessionReceipts.length > 0 ? (
              sessionReceipts.map((r) => (
                <Card key={r.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">
                        Receipt #{r.order_no ?? '-'} {r.till_code || r.till_name ? `• Till ${r.till_code ?? '?'} ${r.till_name ?? ''}` : ''}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {String(r.staff_name ?? 'Cashier')} • {r.issued_at ? new Date(r.issued_at).toLocaleString() : 'Unknown time'}
                      </div>
                      <div className="text-sm mt-1">
                        Total: <span className="font-mono">{formatMoneyPrecise(Number(r.total ?? 0), 2)}</span>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => openReceiptFromSessionRow(r)}>
                      Reprint
                    </Button>
                  </div>
                </Card>
              ))
            ) : localSessionPaidOrders.length > 0 ? (
              localSessionPaidOrders.map((o) => (
                <Card key={o.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">Receipt #{o.orderNo}</div>
                      <div className="text-xs text-muted-foreground">
                        {o.staffName} • {new Date(String(o.paidAt ?? o.createdAt)).toLocaleString()}
                      </div>
                      <div className="text-sm mt-1">
                        Total: <span className="font-mono">{formatMoneyPrecise(o.total, 2)}</span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setReceiptOrder(o);
                        setShowSessionReceipts(false);
                        setShowReceipt(true);
                      }}
                    >
                      Reprint
                    </Button>
                  </div>
                </Card>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">No receipts in this session yet.</div>
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
        formatMoney={(amount) => formatMoneyPrecise(amount, 2)}
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

      <AlertDialog open={showStockBlocked} onOpenChange={setShowStockBlocked}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{stockBlockTitle ?? 'Stock unavailable'}</AlertDialogTitle>
            <AlertDialogDescription>
              {stockBlockDescription ?? 'This item cannot be added due to current stock levels.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Debug modal removed */}
    </div>
  );
}
