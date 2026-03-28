import { useEffect, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { fetchAndReplaceOrdersFromSupabase } from '@/lib/orderStore';
import { getActiveBrandId, subscribeActiveBrandId } from '@/lib/activeBrand';
import { pushDebug } from '@/lib/debugLog';

/**
 * Hook: useKitchenRealtime
 * Subscribes to Postgres INSERT/UPDATE events on public.pos_order_items
 * filtered to `sent_to_kitchen = true` and triggers a re-fetch of grouped
 * tickets by calling `fetchAndReplaceOrdersFromSupabase`.
 */
export default function useKitchenRealtime() {
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) return;
    if (subscribedRef.current) return;
    subscribedRef.current = true;

    // subscribe to all changes where sent_to_kitchen = true (INSERT/UPDATE/DELETE)
    const channel = supabase.channel('kitchen-pos-order-items');

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pos_order_items', filter: 'sent_to_kitchen=eq.true' },
      async (payload) => {
        console.debug('[useKitchenRealtime] postgres payload (items)', payload);
        try {
          await fetchAndReplaceOrdersFromSupabase();
          console.debug('[useKitchenRealtime] fetchAndReplaceOrdersFromSupabase completed');
          try { pushDebug('[useKitchenRealtime] pos_order_items payload received and fetched orders'); } catch {}
        } catch (e) {
          console.warn('[useKitchenRealtime] refetch failed', e);
          try { pushDebug('[useKitchenRealtime] refetch failed: ' + String(e)); } catch {}
        }
      }
    );

    // Additionally subscribe to brand-scoped notifications (pos_notifications).
    // Auth may not have set the active brand yet when this hook runs, so listen
    // for brand changes and attach the notifications listener as soon as a
    // brand id becomes available.
    const notifSubscribedRef: { current: boolean } = { current: false };

    function ensureNotifSubscription(brandId: string | null) {
      if (!brandId || notifSubscribedRef.current) return;
      try {
        const notifFilter = `brand_id=eq.${brandId},type=eq.order_ready`;
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'pos_notifications', filter: notifFilter },
          async (payload) => {
            console.debug('[useKitchenRealtime] postgres payload (notifications)', payload);
            try {
              try { pushDebug('[useKitchenRealtime] pos_notifications payload received: ' + JSON.stringify(payload)); } catch {}
              // When a brand notification arrives, re-fetch orders so POS/KDS refresh
              await fetchAndReplaceOrdersFromSupabase();
              try { pushDebug('[useKitchenRealtime] fetched orders after notification'); } catch {}
            } catch (e) {
              console.warn('[useKitchenRealtime] notification fetch failed', e);
              try { pushDebug('[useKitchenRealtime] notification fetch failed: ' + String(e)); } catch {}
            }
          }
        );
        notifSubscribedRef.current = true;
      } catch (e) {
        console.warn('[useKitchenRealtime] failed to subscribe to pos_notifications', e);
        try { pushDebug('[useKitchenRealtime] failed to subscribe to pos_notifications: ' + String(e)); } catch {}
      }
    }

    // Try to subscribe immediately if brand is already known
    ensureNotifSubscription(getActiveBrandId());

    // Also watch for brand changes and ensure subscription when brand becomes available
    const unsubBrand = subscribeActiveBrandId(() => ensureNotifSubscription(getActiveBrandId()));

    channel.subscribe();

    return () => {
      try {
        // unsubscribe channel
        // supabase-js v2: channel.unsubscribe()
        if (channel && typeof (channel as any).unsubscribe === 'function') (channel as any).unsubscribe();
        // also try removeChannel if available
        if ((supabase as any).removeChannel) (supabase as any).removeChannel(channel);
      } catch (e) {
        // ignore
      }
      try { if (typeof unsubBrand === 'function') unsubBrand(); } catch {}
    };
  }, []);
}
