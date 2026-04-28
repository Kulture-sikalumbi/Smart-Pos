import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { getActiveBrandId, subscribeActiveBrandId } from '@/lib/activeBrand';
import { pushDebug } from '@/lib/debugLog';

type Notif = {
  id: string;
  brand_id: string;
  type: string;
  payload: any;
  created_at: string;
};

const LISTEN_CHANNEL = 'pos-notifications-channel';
const LAST_SEEN_KEY = 'mthunzi.pos.notifications.lastSeen.v1';

const POLL_INTERVAL_MS = 8000;

let lastRealtimeAt = 0;
let pollTimer: any = null;
let bcChannel: BroadcastChannel | null = null;

let inMemory: Notif[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function getLastSeen(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

function setLastSeen(ts: string) {
  try {
    localStorage.setItem(LAST_SEEN_KEY, ts);
  } catch {}
}

export function getPosNotificationsSnapshot(): Notif[] {
  return inMemory;
}

export function subscribePosNotifications(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

async function fetchInitial() {
  if (!isSupabaseConfigured() || !supabase) return;
  const brandId = getActiveBrandId();
  if (!brandId) return;
  try {
    const lastSeen = getLastSeen();
    let q = supabase.from('pos_notifications').select('*').eq('brand_id', brandId).order('created_at', { ascending: false }).limit(50);
    const { data, error } = await q;
    if (error) {
      try { pushDebug('[posNotificationStore] fetchInitial error: ' + String(error)); } catch {}
      return;
    }
    if (!data) return;
    const rows = (data as any[])
      .filter(Boolean)
      .map((r) => ({ id: String(r.id), brand_id: String(r.brand_id), type: String(r.type), payload: r.payload, created_at: r.created_at } as Notif));
    // Keep only those after lastSeen (if set)
    if (lastSeen) {
      const cutoff = new Date(lastSeen).getTime();
      inMemory = rows.filter((r) => new Date(r.created_at).getTime() > cutoff);
    } else {
      inMemory = rows;
    }
    emit();
  } catch (e) {
    try { pushDebug('[posNotificationStore] fetchInitial exception: ' + String(e)); } catch {}
  }
}

function setupRealtime() {
  if (!isSupabaseConfigured() || !supabase) return;
  const brandId = getActiveBrandId();
  if (!brandId) return;
  try {
    const channel = supabase.channel(LISTEN_CHANNEL + '.' + brandId);
    // Listen to multiple request types (kitchen ready + customer tablet calls).
    const filt = `brand_id=eq.${brandId}`;
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'pos_notifications', filter: filt }, (payload) => {
      try {
        const newRow = (payload?.new ?? payload?.record) as any;
        if (!newRow) return;
        const n: Notif = { id: String(newRow.id), brand_id: String(newRow.brand_id), type: String(newRow.type), payload: newRow.payload, created_at: newRow.created_at };
        lastRealtimeAt = Date.now();
        const lastSeen = getLastSeen();
        if (lastSeen && new Date(n.created_at).getTime() <= new Date(lastSeen).getTime()) return;
        // prepend
        inMemory = [n, ...inMemory].slice(0, 200);
        emit();
        try { pushDebug('[posNotificationStore] realtime received pos_notification: ' + JSON.stringify(n)); } catch {}
      } catch (e) {
        try { pushDebug('[posNotificationStore] realtime handler error: ' + String(e)); } catch {}
      }
    });
    channel.subscribe();
    return () => {
      try { if ((supabase as any).removeChannel) (supabase as any).removeChannel(channel); } catch {}
    };
  } catch (e) {
    try { pushDebug('[posNotificationStore] setupRealtime failed: ' + String(e)); } catch {}
  }
}

let cleanupRealtime: (() => void) | null = null;

function startPolling() {
  try {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      try {
        // If we've seen a realtime event recently, skip polling this tick
        if (Date.now() - lastRealtimeAt < POLL_INTERVAL_MS) return;
        fetchInitial();
      } catch {
        // ignore
      }
    }, POLL_INTERVAL_MS);
  } catch {
    // ignore
  }
}

function stopPolling() {
  try {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  } catch {}
}

function setupBroadcastChannel() {
  try {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      bcChannel = new BroadcastChannel('mthunzi.kitchen');
      bcChannel.onmessage = (ev: MessageEvent) => {
        try {
          const msg = ev.data ?? {};
          if (msg && msg.type === 'pos_notification' && msg.notification) {
            const r = msg.notification;
            const n: Notif = { id: String(r.id), brand_id: String(r.brand_id), type: String(r.type), payload: r.payload, created_at: r.created_at };
            // Respect active brand scoping for same-origin broadcasts
            const active = getActiveBrandId();
            if (!active || String(n.brand_id) !== String(active)) return;
            // prepend if not duplicate
            if (!inMemory.some(x => x.id === n.id)) {
              inMemory = [n, ...inMemory].slice(0, 200);
              emit();
              try { pushDebug('[posNotificationStore] broadcast received pos_notification: ' + JSON.stringify(n)); } catch {}
            }
          }
        } catch {}
      };
    } catch {}
  } catch {}
}

function teardownBroadcastChannel() {
  try {
    if (bcChannel) {
      try { bcChannel.close(); } catch {}
      bcChannel = null;
    }
  } catch {}
}

export function markNotificationsSeen() {
  (async () => {
    try {
      // Delete visible notifications from DB to save storage
      if (isSupabaseConfigured() && supabase && inMemory.length) {
        const ids = inMemory.map((n) => n.id);
        await supabase.from('pos_notifications').delete().in('id', ids);
        try { pushDebug('[posNotificationStore] deleted notifications: ' + ids.join(',')); } catch {}
      }
    } catch (e) {
      try { pushDebug('[posNotificationStore] failed deleting notifications: ' + String(e)); } catch {}
    } finally {
      const now = new Date().toISOString();
      setLastSeen(now);
      inMemory = [];
      emit();
    }
  })();
}

export async function deleteNotificationById(id: string) {
  try {
    if (!isSupabaseConfigured() || !supabase) return;
    const { error } = await supabase.from('pos_notifications').delete().eq('id', id);
    if (error) {
      try { pushDebug('[posNotificationStore] deleteNotificationById error: ' + String(error)); } catch {}
      return;
    }
    inMemory = inMemory.filter((n) => n.id !== id);
    emit();
  } catch (e) {
    try { pushDebug('[posNotificationStore] deleteNotificationById exception: ' + String(e)); } catch {}
  }
}

// Initialize when brand changes
subscribeActiveBrandId(() => {
  // tear down existing
  try { if (cleanupRealtime) cleanupRealtime(); } catch {}
  inMemory = [];
  fetchInitial();
  cleanupRealtime = setupRealtime() ?? null;
  // start polling fallback and broadcast listener
  try { stopPolling(); } catch {}
  try { teardownBroadcastChannel(); } catch {}
  startPolling();
  setupBroadcastChannel();
});

// Try initial setup in case brand already set
(async () => {
  await fetchInitial();
  cleanupRealtime = setupRealtime() ?? null;
  startPolling();
  setupBroadcastChannel();
})();

export async function fetchPosNotificationsNow() {
  await fetchInitial();
}
