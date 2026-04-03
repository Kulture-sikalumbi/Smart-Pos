import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getActiveUserId, loadAuthSnapshot, saveAuthSnapshot } from '@/lib/authCache';

/**
 * Hook that monitors the current brand's activation status in real-time
 * If the brand's is_active status changes in the database, this hook
 * will detect it and trigger a profile refresh
 */
export function useBrandActivationMonitor() {
  const { brand, profileReady, refreshProfile } = useAuth();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastCheckRef = useRef<number>(0);

  useEffect(() => {
    if (!brand?.id || !profileReady || !supabase) return;

    // Set up real-time listener for brand changes
    const subscription = supabase
      .channel(`brands:${brand.id}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to all changes (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'brands',
          filter: `id=eq.${brand.id}`,
        },
        async (payload) => {
          console.log('[BrandActivationMonitor] Brand changed:', payload);

          // Keep cache in sync immediately so users do not get stuck on stale state.
          try {
            const uid = getActiveUserId();
            const nextIsActive = (payload as any)?.new?.is_active;
            if (uid && typeof nextIsActive === 'boolean') {
              const snap = loadAuthSnapshot(uid);
              if (snap?.brand) {
                saveAuthSnapshot({
                  ...snap,
                  cachedAt: Date.now(),
                  brand: {
                    ...snap.brand,
                    is_active: nextIsActive,
                  },
                });
              }
            }
          } catch {
            // ignore cache sync issues
          }
          
          // Refresh the entire auth profile to get the latest brand data
          if (refreshProfile) {
            void refreshProfile();
          }
        }
      )
      .subscribe((status) => {
        console.log('[BrandActivationMonitor] Subscription status:', status);
      });

    channelRef.current = subscription;

    // Fallback: Periodic check every 60 seconds (for connection issues)
    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastCheckRef.current > 60_000) {
        lastCheckRef.current = now;
        console.log('[BrandActivationMonitor] Periodic check...');
        if (refreshProfile) {
          void refreshProfile();
        }
      }
    }, 60_000);

    return () => {
      clearInterval(interval);
      if (subscription) {
        void subscription.unsubscribe();
      }
    };
  }, [brand?.id, profileReady, refreshProfile]);
}
