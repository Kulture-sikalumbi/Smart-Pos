import { useEffect, useMemo, useState } from 'react';
import GlobalReceiptGenerator from '@/components/pos/GlobalReceiptGenerator';
import { getReceiptSettings } from '@/lib/receiptSettingsService';
import { useDashboardDateRange } from '@/hooks/useDashboardDateRange';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import type { ReceiptData } from '@/types';

type ReceiptRow = {
  id: string;
  order_id: string;
  order_no?: number | null;
  subtotal?: number | null;
  tax?: number | null;
  total?: number | null;
  currency_code?: string | null;
  issued_at?: string | null;
  payload?: any;
  staff_name?: string | null;
  till_code?: string | null;
  till_name?: string | null;
};

export default function GlobalReceiptDemo() {
  const { user, brand, operatorPin } = useAuth();
  const settings = getReceiptSettings();
  const { safeRange, startDate, endDate, setStartDate, setEndDate, preset, applyPreset } = useDashboardDateRange();
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(false);

  const brandId = String((brand as any)?.id ?? (user as any)?.brand_id ?? '');

  useEffect(() => {
    let cancelled = false;
    if (!supabase) return;
    if (!brandId && !(user?.email && operatorPin)) return;

    setLoading(true);
    (async () => {
      try {
        // Staff mode (email + pin) uses SECURITY DEFINER RPC.
        if (user?.email && operatorPin) {
          const { data, error } = await supabase.rpc('get_staff_receipts_report', {
            p_email: user.email,
            p_pin: operatorPin,
            p_from: safeRange.startDate,
            p_to: safeRange.endDate,
            p_limit: 400,
          });
          if (!cancelled) {
            if (error) {
              console.warn('[GlobalReceiptDemo] get_staff_receipts_report failed', error);
              setRows([]);
            } else {
              setRows((Array.isArray(data) ? data : []) as ReceiptRow[]);
            }
          }
          return;
        }

        // Authenticated owner/admin path.
        const { data, error } = await supabase
          .from('pos_receipts')
          .select('*')
          .eq('brand_id', brandId)
          .gte('issued_at', `${safeRange.startDate}T00:00:00`)
          .lte('issued_at', `${safeRange.endDate}T23:59:59`)
          .order('issued_at', { ascending: false })
          .limit(400);

        if (!cancelled) {
          if (error) {
            console.warn('[GlobalReceiptDemo] pos_receipts query failed', error);
            setRows([]);
          } else {
            setRows((Array.isArray(data) ? data : []) as ReceiptRow[]);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [brandId, user?.email, operatorPin, safeRange.startDate, safeRange.endDate]);

  const [selectedReceiptId, setSelectedReceiptId] = useState<string>('');
  useEffect(() => {
    if (!rows.length) {
      setSelectedReceiptId('');
      return;
    }
    if (!rows.find((r) => r.id === selectedReceiptId)) {
      setSelectedReceiptId(String(rows[0].id));
    }
  }, [rows, selectedReceiptId]);

  const selectedRow = useMemo(() => rows.find((r) => String(r.id) === selectedReceiptId) ?? rows[0] ?? null, [rows, selectedReceiptId]);

  const receipt: Omit<ReceiptData, 'usdEquivalent' | 'legalFooter'> = {
    receiptId: selectedRow ? `R-${selectedRow.order_no ?? selectedRow.order_id ?? selectedRow.id}` : `R-${Date.now()}`,
    issuedAt: String(selectedRow?.issued_at ?? new Date().toISOString()),
    countryCode: settings.countryCode,
    currencyCode: (selectedRow?.currency_code as any) ?? settings.currencyCode,
    subtotal: Number(selectedRow?.subtotal ?? 0),
    taxes: [{ name: 'VAT', amount: Number(selectedRow?.tax ?? 0) }],
    total: Number(selectedRow?.total ?? 0),
    qrUrl: settings.digitalReceiptBaseUrl
      ? `${settings.digitalReceiptBaseUrl}${encodeURIComponent(String(selectedRow?.order_id ?? selectedRow?.id ?? ''))}`
      : undefined,
  };

  return (
    <div className="p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Global Receipt Generator</h1>
            <p className="text-sm text-muted-foreground">Shows real receipts from `pos_receipts` with date filters.</p>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">From</div>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[170px]" />
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">To</div>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[170px]" />
              </div>
              <Button size="sm" variant={preset === 'today' ? 'default' : 'outline'} onClick={() => applyPreset('today')}>Today</Button>
              <Button size="sm" variant={preset === 'last7' ? 'default' : 'outline'} onClick={() => applyPreset('last7')}>Last 7d</Button>
              <Button size="sm" variant={preset === 'last30' ? 'default' : 'outline'} onClick={() => applyPreset('last30')}>Last 30d</Button>
            </div>
          </CardContent>
        </Card>

        <div className="min-w-[260px]">
          <div className="text-xs text-muted-foreground mb-1">Receipts in selected range</div>
          <select
            value={selectedRow?.id ?? ''}
            onChange={(e) => setSelectedReceiptId(e.target.value)}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            disabled={rows.length === 0 || loading}
          >
            {rows.length === 0 ? <option value="">{loading ? 'Loading receipts...' : 'No receipts in range'}</option> : null}
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                #{r.order_no ?? '-'} • {String(r.staff_name ?? 'Staff')} • {r.issued_at ? new Date(r.issued_at).toLocaleString() : 'Unknown'}
              </option>
            ))}
          </select>
          {selectedRow ? (
            <div className="text-xs text-muted-foreground mt-1">
              Till: {selectedRow.till_code || selectedRow.till_name ? `${selectedRow.till_code ?? '?'} • ${selectedRow.till_name ?? 'Unnamed'}` : 'Unassigned'}
            </div>
          ) : null}
        </div>

        {rows.length === 0 && !loading ? (
          <div className="text-sm text-muted-foreground">
            No receipt records found for {safeRange.startDate} to {safeRange.endDate}. Complete paid sales to populate this view.
          </div>
        ) : null}

        {selectedRow ? <GlobalReceiptGenerator receipt={receipt} settings={settings} /> : null}
      </div>
    </div>
  );
}
