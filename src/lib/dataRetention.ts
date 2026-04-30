import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { getActiveBrandId } from '@/lib/activeBrand';

const LAST_RUN_KEY = 'mthunzi.retention.lastRunAt.v1';
const DISABLED_KEY = 'mthunzi.retention.disabled.v1';
const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day

function shouldRunNow() {
  try {
    if (localStorage.getItem(DISABLED_KEY) === '1') return false;
    const raw = localStorage.getItem(LAST_RUN_KEY);
    if (!raw) return true;
    const last = new Date(raw).getTime();
    if (!Number.isFinite(last)) return true;
    return Date.now() - last >= RUN_INTERVAL_MS;
  } catch {
    return true;
  }
}

function markRanNow() {
  try {
    localStorage.setItem(LAST_RUN_KEY, new Date().toISOString());
  } catch {
    // ignore
  }
}

export async function runTransientDataRetention(): Promise<void> {
  if (!isSupabaseConfigured() || !supabase) return;
  if (!shouldRunNow()) return;

  const brandId = String(getActiveBrandId() ?? '').trim();
  if (!brandId) return;

  try {
    const { error } = await supabase.rpc('cleanup_transient_data', {
      p_brand_id: brandId,
      p_notifications_keep_days: 14,
      p_tablet_keep_days: 30,
      p_receipts_keep_days: 1,
    } as any);
    if (error) {
      const msg = String((error as any)?.message ?? '').toLowerCase();
      const status = Number((error as any)?.status ?? 0);
      const isMissingRpc =
        status === 404 ||
        msg.includes('function') ||
        msg.includes('does not exist') ||
        msg.includes('not found');
      if (isMissingRpc) {
        try {
          localStorage.setItem(DISABLED_KEY, '1');
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // best-effort maintenance, no UX interruption
  } finally {
    markRanNow();
  }
}

