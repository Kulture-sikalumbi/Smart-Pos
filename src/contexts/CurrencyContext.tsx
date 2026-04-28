import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { CurrencyCode, ReceiptSettings } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useBranding } from '@/contexts/BrandingContext';
import { supabase } from '@/lib/supabaseClient';
import {
  getReceiptSettingsSnapshot,
  saveReceiptSettings,
  subscribeReceiptSettings,
} from '@/lib/receiptSettingsService';

type CurrencyModel = {
  currencyCode: CurrencyCode;
  currencySymbol: string;
  setCurrencyCode: (code: CurrencyCode) => void;
  currencySyncState: 'idle' | 'saving' | 'saved' | 'error';
  currencySyncMessage?: string;
  formatMoney: (amount: number) => string;
  formatMoneyPrecise: (amount: number, decimals: number) => string;
  formatNumber: (amount: number, opts?: Intl.NumberFormatOptions) => string;
};

const CurrencyContext = createContext<CurrencyModel | null>(null);

function formatZmwK(amount: number, decimals: number) {
  const n = Number.isFinite(amount) ? amount : 0;
  const d = Number.isFinite(decimals) ? Math.max(0, Math.min(6, Math.floor(decimals))) : 2;
  return `K ${n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

function currencySymbolFromCode(currency: string) {
  const c = String(currency || '').toUpperCase();
  if (c === 'ZMW') return 'K';
  if (c === 'USD') return '$';
  if (c === 'ZAR') return 'R';
  if (c === 'EUR') return '€';
  if (c === 'GBP') return '£';
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: c,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? c;
  } catch {
    return c;
  }
}

function formatCurrencyIntl(amount: number, currency: string, decimals = 2) {
  const n = Number.isFinite(amount) ? amount : 0;
  const d = Number.isFinite(decimals) ? Math.max(0, Math.min(6, Math.floor(decimals))) : 2;
  const c = String(currency || '').toUpperCase();
  if (c === 'ZMW') return formatZmwK(n, d);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: c,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }).format(n);
  } catch {
    const sym = currencySymbolFromCode(c);
    return `${sym} ${n.toFixed(d)}`;
  }
}

export function CurrencyProvider(props: { children: React.ReactNode }) {
  const { brand, user } = useAuth();
  const { settings: brandingSettings, updateSettings, saveToServer } = useBranding();
  const brandId = String((brand as any)?.id ?? (user as any)?.brand_id ?? '');
  const brandCurrencyCode = (brand as any)?.brand_currency_code as CurrencyCode | undefined;
  const overrideStorageKey = brandId ? `pmx.currency.pending.v1.${brandId}` : 'pmx.currency.pending.v1.none';

  const receiptSettings = useSyncExternalStore(
    subscribeReceiptSettings,
    getReceiptSettingsSnapshot,
    getReceiptSettingsSnapshot
  );

  const [overrideCode, setOverrideCode] = useState<CurrencyCode | null>(() => {
    try {
      const raw = localStorage.getItem(overrideStorageKey);
      return raw ? (String(raw).toUpperCase() as CurrencyCode) : null;
    } catch {
      return null;
    }
  });
  const [currencySyncState, setCurrencySyncState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [currencySyncMessage, setCurrencySyncMessage] = useState<string | undefined>(undefined);

  // Reset any local override when switching brands.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(overrideStorageKey);
      setOverrideCode(raw ? (String(raw).toUpperCase() as CurrencyCode) : null);
    } catch {
      setOverrideCode(null);
    }
  }, [overrideStorageKey]);

  const receiptCurrencyCode = (receiptSettings as ReceiptSettings).currencyCode;
  const brandingCurrencyCode = (brandingSettings as any)?.currencyCode as CurrencyCode | undefined;
  const effectiveCurrencyCode = (overrideCode ?? brandCurrencyCode ?? brandingCurrencyCode ?? receiptCurrencyCode ?? 'ZMW') as CurrencyCode;

  // Keep receipt settings aligned with the effective code (override > brand > local),
  // which avoids stale-hydration resets while still converging to the persisted brand currency.
  useEffect(() => {
    if (!brandId) return;
    const current = (receiptSettings as ReceiptSettings)?.currencyCode ?? 'ZMW';
    if (current === effectiveCurrencyCode) return;
    saveReceiptSettings({ ...(receiptSettings as ReceiptSettings), currencyCode: effectiveCurrencyCode });
  }, [brandId, effectiveCurrencyCode, receiptSettings]);

  // Once server brand currency catches up to local override, clear pending override.
  useEffect(() => {
    if (!brandId) return;
    if (!overrideCode) return;
    if (!brandCurrencyCode) return;
    if (String(brandCurrencyCode).toUpperCase() !== String(overrideCode).toUpperCase()) return;
    try {
      localStorage.removeItem(overrideStorageKey);
    } catch {
      // ignore
    }
    setOverrideCode(null);
  }, [brandId, brandCurrencyCode, overrideCode, overrideStorageKey]);

  if (!receiptSettings) {
    throw new Error("CurrencyProvider: receiptSettings is null or undefined.");
  }

  const model = useMemo<CurrencyModel>(() => {
    const currencyCode = effectiveCurrencyCode;
    const currencySymbol = currencySymbolFromCode(currencyCode);

    return {
      currencyCode,
      currencySymbol,
      currencySyncState,
      currencySyncMessage,
      setCurrencyCode: (code) => {
        setOverrideCode(code);
        setCurrencySyncState('saving');
        setCurrencySyncMessage('Saving currency...');
        updateSettings({ currencyCode: code });
        try {
          localStorage.setItem(overrideStorageKey, String(code).toUpperCase());
        } catch {
          // ignore
        }
        const cur = getReceiptSettingsSnapshot();
        saveReceiptSettings({ ...cur, currencyCode: code });

        // Persist to the brand row when available.
        if (supabase && brandId) {
          const directUpdate = supabase
            .from('brands')
            .update({ brand_currency_code: code })
            .eq('id', brandId)
            .then((res) => {
              if ((res as any)?.error) {
                throw (res as any).error;
              }
              return true;
            });
          const viaBranding = saveToServer({ currencyCode: code });
          void Promise.allSettled([directUpdate, viaBranding]).then((results) => {
            const ok = results.some((r) => r.status === 'fulfilled' && r.value);
            if (ok) {
              setCurrencySyncState('saved');
              setCurrencySyncMessage('Saved to brand');
            } else {
              setCurrencySyncState('error');
              setCurrencySyncMessage('Saved locally only; brand save failed');
            }
          });
        } else {
          setCurrencySyncState('saved');
          setCurrencySyncMessage('Saved locally');
        }
      },
      formatNumber: (amount, opts) => {
        const n = Number.isFinite(amount) ? amount : 0;
        return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, ...(opts ?? {}) }).format(n);
      },
      formatMoney: (amount) => {
        return formatCurrencyIntl(amount, currencyCode, 2);
      },
      formatMoneyPrecise: (amount, decimals) => {
        return formatCurrencyIntl(amount, currencyCode, decimals);
      },
    };
  }, [brandId, effectiveCurrencyCode, overrideStorageKey, updateSettings, saveToServer, currencySyncState, currencySyncMessage]);

  return <CurrencyContext.Provider value={model}>{props.children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency must be used within CurrencyProvider');
  return ctx;
}
