import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { CurrencyCode, ReceiptSettings } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
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
  const brandId = String((brand as any)?.id ?? (user as any)?.brand_id ?? '');
  const brandCurrencyCode = (brand as any)?.brand_currency_code as CurrencyCode | undefined;

  const receiptSettings = useSyncExternalStore(
    subscribeReceiptSettings,
    getReceiptSettingsSnapshot,
    getReceiptSettingsSnapshot
  );

  const [overrideCode, setOverrideCode] = useState<CurrencyCode | null>(null);

  // Reset any local override when switching brands.
  useEffect(() => {
    setOverrideCode(null);
  }, [brandId]);

  // Keep receipt settings aligned with the brand currency to prevent symbol flicker
  // between early (cached) renders and the async brand profile hydrate.
  useEffect(() => {
    if (!brandId) return;
    if (!brandCurrencyCode) return;
    if (overrideCode) return;
    const current = (receiptSettings as ReceiptSettings)?.currencyCode ?? 'ZMW';
    if (current === brandCurrencyCode) return;
    saveReceiptSettings({ ...(receiptSettings as ReceiptSettings), currencyCode: brandCurrencyCode });
  }, [brandId, brandCurrencyCode, overrideCode, receiptSettings]);

  if (!receiptSettings) {
    throw new Error("CurrencyProvider: receiptSettings is null or undefined.");
  }

  const model = useMemo<CurrencyModel>(() => {
    const receiptCurrencyCode = (receiptSettings as ReceiptSettings).currencyCode;
    const currencyCode = (overrideCode ?? brandCurrencyCode ?? receiptCurrencyCode ?? 'ZMW') as CurrencyCode;
    const currencySymbol = currencySymbolFromCode(currencyCode);

    return {
      currencyCode,
      currencySymbol,
      setCurrencyCode: (code) => {
        setOverrideCode(code);
        const cur = getReceiptSettingsSnapshot();
        saveReceiptSettings({ ...cur, currencyCode: code });

        // Persist to the brand row when available.
        if (supabase && brandId) {
          void supabase
            .from('brands')
            .update({ brand_currency_code: code })
            .eq('id', brandId);
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
  }, [receiptSettings, brand, brandId, overrideCode]);

  return <CurrencyContext.Provider value={model}>{props.children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency must be used within CurrencyProvider');
  return ctx;
}
