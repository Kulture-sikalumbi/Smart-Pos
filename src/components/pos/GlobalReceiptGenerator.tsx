import { useEffect, useMemo, useState } from 'react';
import type { ReceiptData, ReceiptSettings } from '@/types';
import { getUsdRateForCurrency, convertToUsd } from '@/lib/exchangeRateService';
import { generateSmartReceiptQr } from '@/lib/smartReceiptQr';
import { getReceiptSettings } from '@/lib/receiptSettingsService';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatMoney(amount: number, currencyCode: string) {
  // Use Intl where possible; fall back to plain formatting
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}

function formatZmwK(amount: number) {
  // Your UI uses K for Zambia
  return `K ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function GlobalReceiptGenerator(props: {
  receipt: Omit<ReceiptData, 'usdEquivalent' | 'legalFooter'>;
  settings?: ReceiptSettings;
}) {
  const settings = props.settings ?? getReceiptSettings();

  const [usdRate, setUsdRate] = useState<number | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const receipt: ReceiptData = useMemo(() => {
    const base: ReceiptData = {
      ...props.receipt,
      legalFooter: settings.legalFooter,
    };
    return base;
  }, [props.receipt, settings.legalFooter]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const rate = await getUsdRateForCurrency(receipt.currencyCode);
      if (cancelled) return;
      setUsdRate(rate);
    })();

    return () => {
      cancelled = true;
    };
  }, [receipt.currencyCode]);

  const usdEquivalent = useMemo(() => convertToUsd(receipt.total, usdRate), [receipt.total, usdRate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const qr = await generateSmartReceiptQr(
        {
          ...receipt,
          usdEquivalent: usdEquivalent ?? undefined,
        },
        settings
      );
      if (cancelled) return;
      setQrDataUrl(qr);
    })();

    return () => {
      cancelled = true;
    };
  }, [receipt, settings, usdEquivalent]);

  const totalLine = (() => {
    if (receipt.currencyCode === 'ZMW') {
      const local = formatZmwK(receipt.total);
      if (usdEquivalent == null) return local;
      const usd = formatMoney(usdEquivalent, 'USD');
      return `${local} (≈ ${usd})`;
    }

    const local = formatMoney(receipt.total, receipt.currencyCode);
    if (usdEquivalent == null) return local;
    const usd = formatMoney(usdEquivalent, 'USD');
    return `${local} (≈ ${usd})`;
  })();

  return (
    <Card className="mthunzi-card max-w-md mx-auto bg-white text-black border-black/20">
      <CardHeader>
        <CardTitle className="text-base">Receipt</CardTitle>
        {settings.logoUrl ? (
          <div className="pt-1">
            <img src={settings.logoUrl} alt="Receipt logo" className="h-10 w-10 rounded object-cover border border-border" />
          </div>
        ) : null}
        <div className="text-xs text-black/70">
          <div>Receipt: {receipt.receiptId}</div>
          <div>{new Date(receipt.issuedAt).toLocaleString()}</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between text-sm">
          <span>Subtotal</span>
          <span>{receipt.currencyCode === 'ZMW' ? formatZmwK(receipt.subtotal) : formatMoney(receipt.subtotal, receipt.currencyCode)}</span>
        </div>

        {receipt.taxes.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Tax breakdown</div>
            {receipt.taxes.map((t) => (
              <div key={t.name} className="flex justify-between text-sm">
                <span>{t.name}</span>
                <span>{receipt.currencyCode === 'ZMW' ? formatZmwK(t.amount) : formatMoney(t.amount, receipt.currencyCode)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-between pt-2 border-t border-black/10 font-semibold">
          <span>Total</span>
          <span>{totalLine}</span>
        </div>

        {receipt.legalFooter && (
          <div className="pt-3 text-xs text-black/70 whitespace-pre-wrap border-t border-black/10">
            {receipt.legalFooter}
          </div>
        )}

        <div className="pt-3 flex flex-col items-center gap-2 border-t border-black/10">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="Receipt QR" className="w-28 h-28" />
          ) : (
            <div className="text-xs text-black/70">QR not configured</div>
          )}
          <div className="text-[10px] text-black/70 text-center">
            {receipt.countryCode === 'ZM' ? 'Scan to verify / view receipt' : 'Scan for review / view receipt'}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
