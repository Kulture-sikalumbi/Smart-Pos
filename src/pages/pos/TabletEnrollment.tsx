import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabaseClient';
import { RefreshCw, Smartphone, Link as LinkIcon } from 'lucide-react';
import { useInstallPrompt } from '@/components/common/InstallPrompt';

type AssignmentRow = {
  table_id: string;
  table_no: number;
  table_name: string | null;
  seats: number;
  is_active: boolean;
  is_assigned: boolean;
  assigned_device_id: string | null;
  assigned_name: string | null;
  assigned_at: string | null;
  last_seen_at: string | null;
};

const TABLET_DEVICE_ID_KEY = 'pmx.tablet.deviceId.v1';
const ENROLLMENT_SESSION_KEY = 'pmx.tablet.enrollment.session.v1';
const TABLET_KIOSK_ENABLED_KEY = 'pmx.tablet.kiosk.enabled.v1';

function getOrCreateTabletDeviceId() {
  try {
    const existing = localStorage.getItem(TABLET_DEVICE_ID_KEY);
    if (existing && existing.trim()) return existing.trim();
    const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `tablet-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(TABLET_DEVICE_ID_KEY, uuid);
    return uuid;
  } catch {
    return `tablet-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

export default function TabletEnrollment() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [deviceId] = useState(() => getOrCreateTabletDeviceId());
  const [consuming, setConsuming] = useState(true);
  const [loadingTables, setLoadingTables] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string>('');
  const [brandName, setBrandName] = useState<string>('Brand');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [issuedTableNo, setIssuedTableNo] = useState<number | null>(null);
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [replaceTarget, setReplaceTarget] = useState<AssignmentRow | null>(null);
  const [autoAssignAttempted, setAutoAssignAttempted] = useState(false);
  const { canPrompt, isInstalled, fallbackHint, promptInstall } = useInstallPrompt();

  const tokenFromUrl = useMemo(
    () => String(searchParams.get('token') ?? searchParams.get('tabletEnrollToken') ?? '').trim(),
    [searchParams]
  );
  const sessionFromUrl = useMemo(() => String(searchParams.get('session') ?? '').trim(), [searchParams]);

  const loadTables = async (session: string) => {
    if (!supabase) return;
    setLoadingTables(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('list_brand_tablet_assignment_status', {
        p_session_token: session,
      });
      if (rpcError) throw rpcError;
      setRows((Array.isArray(data) ? data : []) as AssignmentRow[]);
    } catch (e: any) {
      setError(e?.message ?? 'Unable to load tables for setup.');
      setRows([]);
    } finally {
      setLoadingTables(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      if (!supabase) {
        setError('Service unavailable.');
        setConsuming(false);
        return;
      }
      try {
        const existingSession = sessionFromUrl || localStorage.getItem(ENROLLMENT_SESSION_KEY) || '';
        if (existingSession && !tokenFromUrl) {
          setSessionToken(existingSession);
          setConsuming(false);
          await loadTables(existingSession);
          return;
        }
        if (!tokenFromUrl) {
          setError('Setup link is missing or expired. Ask staff to generate a new QR.');
          setConsuming(false);
          return;
        }
        const { data, error: rpcError } = await supabase.rpc('consume_tablet_enrollment_token', {
          p_token: tokenFromUrl,
          p_device_id: deviceId,
        });
        if (rpcError) throw rpcError;
        const ok = Boolean((data as any)?.ok ?? false);
        if (!ok) {
          const reason = String((data as any)?.error ?? 'token_invalid_or_expired');
          if (reason === 'token_invalid_or_expired') {
            setError('This setup QR has expired or was already used. Ask staff for a fresh QR.');
          } else {
            setError(reason);
          }
          setConsuming(false);
          return;
        }
        const nextSession = String((data as any)?.session_token ?? '').trim();
        if (!nextSession) {
          setError('Enrollment session could not be created.');
          setConsuming(false);
          return;
        }
        setSessionToken(nextSession);
        localStorage.setItem(ENROLLMENT_SESSION_KEY, nextSession);
        setBrandName(String((data as any)?.brand_name ?? 'Brand'));
        const rawExpiry = String((data as any)?.expires_at ?? '').trim();
        setExpiresAt(rawExpiry || null);
        const rawIssuedTableNo = Number((data as any)?.issued_table_no ?? 0);
        setIssuedTableNo(Number.isFinite(rawIssuedTableNo) && rawIssuedTableNo > 0 ? rawIssuedTableNo : null);
        await loadTables(nextSession);
      } catch (e: any) {
        setError(e?.message ?? 'Unable to start tablet enrollment.');
      } finally {
        setConsuming(false);
      }
    };
    void init();
  }, [deviceId, sessionFromUrl, tokenFromUrl]);

  useEffect(() => {
    if (autoAssignAttempted) return;
    if (!issuedTableNo) return;
    if (!rows.length) return;
    const target = rows.find((r) => Number(r.table_no) === Number(issuedTableNo));
    if (!target) {
      setAutoAssignAttempted(true);
      return;
    }
    const isAssignedToThisDevice =
      target.is_assigned && String(target.assigned_device_id ?? '').toLowerCase() === String(deviceId).toLowerCase();
    const isAssignedToOtherDevice = target.is_assigned && !isAssignedToThisDevice;
    setAutoAssignAttempted(true);
    if (isAssignedToOtherDevice) {
      setReplaceTarget(target);
      return;
    }
    void assignTable(target, false);
  }, [autoAssignAttempted, issuedTableNo, rows, deviceId]);

  const assignTable = async (row: AssignmentRow, replaceExisting: boolean) => {
    if (!supabase || !sessionToken) return;
    setSaving(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('assign_customer_tablet_device_from_enrollment', {
        p_session_token: sessionToken,
        p_table_no: row.table_no,
        p_name: row.table_name ?? null,
        p_replace_existing: replaceExisting,
      });
      if (rpcError) throw rpcError;
      const ok = Boolean((data as any)?.ok ?? false);
      if (!ok) {
        const reason = String((data as any)?.error ?? 'assign_failed');
        if (reason === 'table_already_assigned') {
          setError('Table already has a tablet connected. Confirm replacement to continue.');
        } else if (reason === 'session_invalid_or_expired') {
          setError('Setup session expired. Scan a fresh QR to continue.');
        } else {
          setError(reason);
        }
        return;
      }
      try {
        localStorage.setItem(TABLET_KIOSK_ENABLED_KEY, '1');
      } catch {
        // ignore local storage write issues
      }
      navigate('/tablet-lock?kiosk=1');
    } catch (e: any) {
      setError(e?.message ?? 'Unable to complete tablet setup.');
    } finally {
      setSaving(false);
      setReplaceTarget(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/20 p-3 sm:p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Smartphone className="h-4 w-4" />
              Tablet Enrollment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Connect this tablet to a table for <span className="font-medium text-foreground">{brandName}</span>.
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className="font-mono">{deviceId}</Badge>
              {expiresAt ? <Badge variant="secondary">Session expires {new Date(expiresAt).toLocaleTimeString()}</Badge> : null}
            </div>
          </CardContent>
        </Card>
        {!isInstalled ? (
          <Card className="border-sky-500/30 bg-sky-500/5">
            <CardContent className="py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="secondary">Install status: Not installed</Badge>
                {canPrompt ? (
                  <Button size="sm" onClick={() => void promptInstall()}>
                    Install App
                  </Button>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground">
                For best kiosk behavior, install this app on the tablet home screen.
              </div>
              {!canPrompt ? (
                <div className="text-xs text-muted-foreground">{fallbackHint}</div>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-emerald-500/30 bg-emerald-500/10">
            <CardContent className="py-2">
              <Badge className="bg-emerald-600 text-white">Install status: Installed</Badge>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <LinkIcon className="h-4 w-4" />
              Select Table
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadTables(sessionToken)}
                disabled={consuming || loadingTables || !sessionToken}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loadingTables ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            {consuming ? (
              <div className="text-sm text-muted-foreground">Validating setup link...</div>
            ) : null}
            {!consuming && loadingTables ? (
              <div className="text-sm text-muted-foreground">Loading table assignments...</div>
            ) : null}

            {!consuming && !loadingTables && rows.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No active tables were found. Ask staff to configure tables first.
              </div>
            ) : null}

            {!consuming && !loadingTables && rows.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {rows.map((row) => {
                  const isAssignedToThisDevice =
                    row.is_assigned && String(row.assigned_device_id ?? '').toLowerCase() === String(deviceId).toLowerCase();
                  const isAssignedToOtherDevice = row.is_assigned && !isAssignedToThisDevice;
                  return (
                    <button
                      type="button"
                      key={row.table_id}
                      className="rounded-md border p-3 text-left hover:bg-muted/40 transition-colors"
                      onClick={() => {
                        if (saving) return;
                        if (isAssignedToOtherDevice) {
                          setReplaceTarget(row);
                          return;
                        }
                        void assignTable(row, false);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">
                          {row.table_name?.trim() ? row.table_name : `Table ${row.table_no}`}
                        </div>
                        <Badge variant={isAssignedToOtherDevice ? 'destructive' : 'secondary'}>
                          {isAssignedToOtherDevice ? 'Connected' : isAssignedToThisDevice ? 'This tablet' : 'Available'}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Table #{row.table_no} • {Number(row.seats ?? 0)} seats
                      </div>
                      {isAssignedToOtherDevice ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Tap to replace the currently connected tablet.
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {error ? <div className="text-sm text-destructive">{error}</div> : null}
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(replaceTarget)} onOpenChange={(open) => { if (!open) setReplaceTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace tablet assignment?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              This table already has a tablet connected. Do you want to replace it with this new tablet?
            </p>
            <div className="rounded-md border p-2 text-xs text-muted-foreground">
              {replaceTarget?.table_name?.trim() ? replaceTarget.table_name : `Table ${replaceTarget?.table_no ?? ''}`}
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setReplaceTarget(null)} disabled={saving}>
                Cancel
              </Button>
              <Button
                onClick={() => { if (replaceTarget) void assignTable(replaceTarget, true); }}
                disabled={saving}
              >
                {saving ? 'Replacing...' : 'Replace with this tablet'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
