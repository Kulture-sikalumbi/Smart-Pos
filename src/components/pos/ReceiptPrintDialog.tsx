import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { Order } from '@/types/pos';
import { Printer } from 'lucide-react';
import { getReceiptSettings } from '@/lib/receiptSettingsService';
import { useBranding } from '@/contexts/BrandingContext';

function formatMoneyFallback(amount: number, currencyCode: string) {
  const value = Number.isFinite(amount) ? amount : 0;
  const code = String(currencyCode || 'ZMW').toUpperCase();
  if (code === 'ZMW') {
    return `K ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${code} ${value.toFixed(2)}`;
  }
}

export default function ReceiptPrintDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appName: string;
  brandName?: string | null;
  brandTagline?: string | null;
  logoUrl?: string | null;
  order: Order | null;
  formatMoney?: (amount: number) => string;
}) {
  const { open, onOpenChange, appName, brandName, brandTagline, logoUrl, order, formatMoney } = props;
  const { settings: brandingSettings } = useBranding();

  const settings = useMemo(() => getReceiptSettings(), []);
  const receiptBrandName =
    String(brandName ?? '').trim() ||
    String(brandingSettings.appName ?? '').trim() ||
    appName;
  const receiptTagline =
    String(brandTagline ?? '').trim() ||
    String(brandingSettings.tagline ?? '').trim();
  const receiptLogoUrl =
    String(logoUrl ?? '').trim() ||
    String((brandingSettings as any).logoDataUrl ?? '').trim() ||
    String(settings.logoUrl ?? '').trim();
  const [barcodeDataUrl, setBarcodeDataUrl] = useState<string | null>(null);

  const receiptCode = useMemo(() => {
    if (!order) return null;
    return String(order.orderNo ?? order.id);
  }, [order]);

  const barcodePayload = useMemo(() => {
    if (!receiptCode) return null;
    if (settings.digitalReceiptBaseUrl) {
      return `${settings.digitalReceiptBaseUrl}${encodeURIComponent(receiptCode)}`;
    }
    // Fallback: still scannable, even without a hosted digital receipt page.
    return `MTHUNZI:${receiptCode}`;
  }, [receiptCode, settings.digitalReceiptBaseUrl]);

  useEffect(() => {
    let cancelled = false;
    setBarcodeDataUrl(null);

    if (!barcodePayload) return;

    (async () => {
      try {
        const url = await QRCode.toDataURL(barcodePayload, {
          errorCorrectionLevel: 'M',
          margin: 1,
          scale: 4,
        });
        if (cancelled) return;
        setBarcodeDataUrl(url);
      } catch {
        if (cancelled) return;
        setBarcodeDataUrl(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [barcodePayload]);

  const handlePrint = async () => {
    if (window.electron?.printSilent) {
      try {
        await window.electron.printSilent();
        return;
      } catch {
        // fallback to browser print if silent fails
      }
    }
    window.print();
  };

  useEffect(() => {
    if (!open || !order || settings.autoPrint === false) return;
    // Delay slightly to ensure the dialog has rendered and CSS applied.
    const timer = window.setTimeout(async () => {
      if (window.electron?.printSilent) {
        try {
          await window.electron.printSilent();
          return;
        } catch {
          // fallback to browser print
        }
      }
      window.print();
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [open, order, settings.autoPrint]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Receipt</span>
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={!order}>
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
          </DialogTitle>
        </DialogHeader>

        {!order ? (
          <div className="text-sm text-muted-foreground">No receipt available yet.</div>
        ) : (
          <div className="print-area rounded-lg border border-black/20 bg-white p-4 text-black">
            <div className="text-center">
              {receiptLogoUrl ? (
                <div className="mb-2 flex justify-center">
                  <img src={receiptLogoUrl} alt="Receipt logo" className="h-16 w-16 rounded object-cover border border-border" />
                </div>
              ) : null}
              <div className="text-lg font-bold tracking-tight">{receiptBrandName}</div>
              <div className="text-xs text-black/70">{receiptTagline || 'Thank you for your purchase'}</div>
            </div>

            <div className="mt-3 text-xs text-black/70 flex items-start justify-between">
              <div>
                <div>Order: #{order.orderNo ?? order.id}</div>
                {order.tableNo ? <div>Table: {order.tableNo}</div> : null}
                {(order.tillCode || order.tillName) ? (
                  <div>Till: {order.tillCode ? `#${order.tillCode}` : ''}{order.tillName ? ` ${order.tillName}` : ''}</div>
                ) : null}
                <div>Cashier: {order.staffName}</div>
              </div>
              <div className="text-right">{new Date(order.createdAt).toLocaleString()}</div>
            </div>

            <div className="my-3 border-t border-b py-2">
              <div className="grid grid-cols-[1fr_3rem_5.5rem] gap-2 text-xs text-muted-foreground">
                <div>Item</div>
                <div className="text-right">Qty</div>
                <div className="text-right">Total</div>
              </div>

              <div className="mt-2 space-y-2">
                {order.items.map((it) => (
                  <div key={it.id} className="text-sm">
                    <div className="grid grid-cols-[1fr_3rem_5.5rem] gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{it.menuItemName}</div>
                        {(it.modifiers?.length ?? 0) > 0 ? (
                          <div className="text-[11px] text-black/70 truncate">{it.modifiers?.join(' · ')}</div>
                        ) : null}
                        {it.notes ? (
                          <div className="text-[11px] text-black/70 truncate">Note: {it.notes}</div>
                        ) : null}
                      </div>
                      <div className="text-right tabular-nums">{it.quantity}</div>
                      <div className="text-right tabular-nums">{formatMoney ? formatMoney(it.total) : formatMoneyFallback(it.total, settings.currencyCode)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatMoney ? formatMoney(order.subtotal) : formatMoneyFallback(order.subtotal, settings.currencyCode)}</span>
              </div>
              {order.discountAmount > 0 ? (
                <div className="flex justify-between text-black/70">
                  <span>Discount ({(order.discountPercent ?? 0).toFixed(0)}%)</span>
                  <span className="tabular-nums">− {formatMoney ? formatMoney(order.discountAmount) : formatMoneyFallback(order.discountAmount, settings.currencyCode)}</span>
                </div>
              ) : null}
              <div className="flex justify-between text-black/70">
                <span>VAT (16%)</span>
                <span className="tabular-nums">{formatMoney ? formatMoney(order.tax) : formatMoneyFallback(order.tax, settings.currencyCode)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t font-bold">
                <span>Total</span>
                <span className="tabular-nums">{formatMoney ? formatMoney(order.total) : formatMoneyFallback(order.total, settings.currencyCode)}</span>
              </div>
            </div>

            <div className="mt-3 text-[11px] text-black/70 text-center">
              Powered by {receiptBrandName}
            </div>

            <div className="mt-4 pt-3 border-t text-center">
              {barcodeDataUrl ? (
                <img
                  src={barcodeDataUrl}
                  alt="Receipt barcode"
                  className="mx-auto h-24 w-24"
                />
              ) : null}
              <div className="mt-1 text-[11px] text-black/70">Receipt Code</div>
              <div className="text-xs font-mono tabular-nums">{receiptCode}</div>
              {settings.digitalReceiptBaseUrl ? (
                <div className="mt-1 text-[10px] text-black/70">Scan to view digital receipt</div>
              ) : (
                <div className="mt-1 text-[10px] text-black/70">Scan for order reference</div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
