import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  analyzeSuspiciousActivity,
  logSensitiveAction,
  subscribeAuditLogs,
  getAuditLogsSnapshot,
  clearAuditLogs,
} from '@/lib/systemAuditLog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { downloadTextFile } from '@/lib/download';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabaseClient';
import { getActiveBrandId } from '@/lib/activeBrand';

type GodEvent = {
  id: string;
  timestamp: string;
  actionType: string;
  userName: string;
  userId?: string;
  reference?: string;
  notes?: string;
  source: 'audit_log' | 'cashier_shifts' | 'batch_productions' | 'stock_issues' | 'manufacturing_recipes' | 'pos_orders';
};

export default function AuditDashboard() {
  const { user, hasPermission } = useAuth();
  const logs = useSyncExternalStore(subscribeAuditLogs, getAuditLogsSnapshot, getAuditLogsSnapshot);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [godEvents, setGodEvents] = useState<GodEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!supabase) return;
      const brandId = String(getActiveBrandId() ?? '').trim();
      if (!brandId) return;
      setLoadingEvents(true);
      try {
        const processedSinceIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
        const [shiftsRes, batchesRes, issuesRes, recipesRes, processedOrdersRes] = await Promise.all([
          supabase.from('cashier_shifts').select('id, opened_at, closed_at, staff_id, till_id').eq('brand_id', brandId).order('opened_at', { ascending: false }).limit(200),
          supabase.from('batch_productions').select('id, created_at, batch_date, recipe_name, produced_by').eq('brand_id', brandId).order('created_at', { ascending: false }).limit(200),
          supabase.from('stock_issues').select('id, created_at, issue_type, qty_issued, recorded_by_name, source_module, location_scope, stock_item_id').eq('brand_id', brandId).order('created_at', { ascending: false }).limit(300),
          supabase.from('manufacturing_recipes').select('*').eq('brand_id', brandId).order('created_at', { ascending: false }).limit(200),
          supabase
            .from('pos_orders')
            .select('id, order_no, staff_id, staff_name, total, table_no, payment_method, paid_at, status')
            .eq('brand_id', brandId)
            .eq('status', 'paid')
            .gte('paid_at', processedSinceIso)
            .order('paid_at', { ascending: false })
            .limit(300),
        ]);

        const shifts = Array.isArray(shiftsRes.data) ? shiftsRes.data : [];
        const staffIds = Array.from(new Set(shifts.map((s: any) => String(s.staff_id ?? '')).filter(Boolean)));
        const tillIds = Array.from(new Set(shifts.map((s: any) => String(s.till_id ?? '')).filter(Boolean)));
        const [staffRes, tillsRes] = await Promise.all([
          staffIds.length ? supabase.from('under_brand_staff').select('id, name, email').in('id', staffIds) : Promise.resolve({ data: [] as any[] }),
          tillIds.length ? supabase.from('tills').select('id, code, name').in('id', tillIds) : Promise.resolve({ data: [] as any[] }),
        ]);
        const staffById = new Map((Array.isArray((staffRes as any).data) ? (staffRes as any).data : []).map((r: any) => [String(r.id), { name: String(r.name ?? 'Staff'), email: String(r.email ?? '') }] as const));
        const tillById = new Map((Array.isArray((tillsRes as any).data) ? (tillsRes as any).data : []).map((r: any) => [String(r.id), `${String(r.code ?? '')} ${String(r.name ?? '')}`.trim()] as const));

        const derived: GodEvent[] = [];

        for (const s of shifts) {
          const sid = String((s as any).staff_id ?? '');
          const staff = staffById.get(sid);
          const till = tillById.get(String((s as any).till_id ?? '')) ?? 'Unknown till';
          derived.push({
            id: `shift-open-${String((s as any).id)}`,
            timestamp: String((s as any).opened_at ?? ''),
            actionType: 'system_login',
            userName: staff ? `${staff.name}${staff.email ? ` (${staff.email})` : ''}` : sid || 'Unknown staff',
            userId: sid || undefined,
            reference: String((s as any).id ?? ''),
            notes: `Staff login / opened shift on ${till}`,
            source: 'cashier_shifts',
          });
          if ((s as any).closed_at) {
            derived.push({
              id: `shift-close-${String((s as any).id)}`,
              timestamp: String((s as any).closed_at),
              actionType: 'shift_closed',
              userName: staff ? `${staff.name}${staff.email ? ` (${staff.email})` : ''}` : sid || 'Unknown staff',
              userId: sid || undefined,
              reference: String((s as any).id ?? ''),
              notes: `Closed shift on ${till}`,
              source: 'cashier_shifts',
            });
          }
        }

        for (const b of Array.isArray(batchesRes.data) ? batchesRes.data : []) {
          derived.push({
            id: `batch-${String((b as any).id)}`,
            timestamp: String((b as any).created_at ?? (b as any).batch_date ?? ''),
            actionType: 'batch_production_created',
            userName: String((b as any).produced_by ?? 'Kitchen staff'),
            reference: String((b as any).id ?? ''),
            notes: `Batch: ${String((b as any).recipe_name ?? 'Recipe')}`,
            source: 'batch_productions',
          });
        }

        for (const i of Array.isArray(issuesRes.data) ? issuesRes.data : []) {
          derived.push({
            id: `issue-${String((i as any).id)}`,
            timestamp: String((i as any).created_at ?? ''),
            actionType: 'stock_issue_recorded',
            userName: String((i as any).recorded_by_name ?? 'Staff'),
            reference: String((i as any).stock_item_id ?? ''),
            notes: `${String((i as any).issue_type ?? 'Issue')} ${Number((i as any).qty_issued ?? 0)} • ${String((i as any).location_scope ?? (i as any).source_module ?? 'GENERAL')}`,
            source: 'stock_issues',
          });
        }

        for (const r of Array.isArray(recipesRes.data) ? recipesRes.data : []) {
          derived.push({
            id: `recipe-${String((r as any).id)}`,
            timestamp: String((r as any).created_at ?? (r as any).updated_at ?? ''),
            actionType: 'recipe_created_or_updated',
            userName: 'Back office',
            reference: String((r as any).id ?? ''),
            notes: `Recipe: ${String((r as any).product_name ?? (r as any).name ?? (r as any).recipe_name ?? (r as any).product_code ?? 'Unnamed')}`,
            source: 'manufacturing_recipes',
          });
        }

        for (const o of Array.isArray(processedOrdersRes.data) ? processedOrdersRes.data : []) {
          const staffLabel = String((o as any).staff_name ?? '').trim() || 'Cashier';
          const orderNo = String((o as any).order_no ?? '').trim();
          const orderRef = orderNo ? `#${orderNo}` : String((o as any).id ?? '');
          derived.push({
            id: `processed-${String((o as any).id)}`,
            timestamp: String((o as any).paid_at ?? ''),
            actionType: 'order_processed',
            userName: staffLabel,
            userId: String((o as any).staff_id ?? '') || undefined,
            reference: String((o as any).id ?? ''),
            notes: `Cashier processed order ${orderRef} • total ${Number((o as any).total ?? 0)} • ${String((o as any).payment_method ?? 'payment')}${(o as any).table_no ? ` • table ${(o as any).table_no}` : ''}`,
            source: 'pos_orders',
          });
        }

        const localAudit: GodEvent[] = logs.map((l) => ({
          id: `audit-${l.id}`,
          timestamp: l.timestamp,
          actionType: String(l.actionType),
          userName: l.userName,
          userId: l.userId,
          reference: l.reference,
          notes: l.notes,
          source: 'audit_log',
        }));

        const merged = [...derived, ...localAudit].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        if (!cancelled) setGodEvents(merged);
      } finally {
        if (!cancelled) setLoadingEvents(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [logs]);

  const suspiciousLogs = useMemo(() => analyzeSuspiciousActivity(logs), [logs]);
  const suspiciousIds = useMemo(() => new Set(suspiciousLogs.map((x) => x.id)), [suspiciousLogs]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromMs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const toMs = toDate ? new Date(`${toDate}T23:59:59`).getTime() : null;
    return godEvents.filter((log) => {
      const ts = new Date(log.timestamp ?? '').getTime();
      if (fromMs != null && Number.isFinite(fromMs) && ts < fromMs) return false;
      if (toMs != null && Number.isFinite(toMs) && ts > toMs) return false;
      if (actionFilter !== 'all' && String(log.actionType) !== actionFilter) return false;
      if (sourceFilter !== 'all' && String(log.source) !== sourceFilter) return false;
      if (!q) return true;
      const hay = `${log.userName} ${log.userId ?? ''} ${log.actionType} ${log.source} ${log.reference ?? ''} ${log.notes ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [godEvents, fromDate, toDate, search, actionFilter, sourceFilter]);

  const actionTypes = useMemo(() => {
    const vals = Array.from(new Set(godEvents.map((l) => String(l.actionType)))).sort();
    return ['all', ...vals];
  }, [godEvents]);
  const sourceTypes = useMemo(() => ['all', ...Array.from(new Set(godEvents.map((l) => String(l.source)))).sort()], [godEvents]);

  const handleExport = () => {
    downloadTextFile({
      filename: `audit-logs-${new Date().toISOString().slice(0, 10)}.json`,
      content: JSON.stringify(filteredLogs, null, 2),
      mimeType: 'application/json',
    });
  };

  const handleClear = () => {
    clearAuditLogs();
  };

  const handleManualLog = async () => {
    await logSensitiveAction({
      userId: user?.id ?? 'system',
      userName: user?.name ?? 'System',
      actionType: 'cash_drawer_open',
      notes: 'Manual test entry',
      captureGeo: false,
    });
  };

  if (!(hasPermission('viewReports') || user?.role === 'owner' || user?.role === 'manager' || user?.role === 'front_supervisor')) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Restricted</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Audit trail is available to owner, manager, or supervisor.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Audit Trail</h1>
          <div className="text-sm text-muted-foreground">God-view timeline across shifts, batches, stock issues, recipes, and sensitive actions.</div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}>Export JSON</Button>
          <Button variant="outline" onClick={handleClear}>Clear</Button>
          <Button onClick={() => void handleManualLog()}>Log Test Action</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <div className="text-xs text-muted-foreground mb-1">From</div>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">To</div>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Action</div>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
            >
              {actionTypes.map((a) => (
                <option key={a} value={a}>{a === 'all' ? 'All actions' : a}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Search</div>
            <Input placeholder="user/action/reference..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Source</div>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            >
              {sourceTypes.map((a) => (
                <option key={a} value={a}>{a === 'all' ? 'All sources' : a}</option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Logs</CardTitle>
          <div className="text-sm text-muted-foreground">{loadingEvents ? 'Refreshing...' : `${filteredLogs.length} entries`}</div>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredLogs.length === 0 ? (
            <div className="text-sm text-muted-foreground">No logs for selected filters.</div>
          ) : (
            filteredLogs.map((log) => (
              <div key={log.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={suspiciousIds.has(String(log.id).replace(/^audit-/, '')) ? 'destructive' : 'secondary'}>
                    {String(log.actionType).replaceAll('_', ' ')}
                  </Badge>
                  {suspiciousIds.has(String(log.id).replace(/^audit-/, '')) ? <Badge variant="destructive">Flagged</Badge> : null}
                  <Badge variant="outline">{log.source}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(log.timestamp).toLocaleString()}</span>
                </div>
                <div className="mt-2 text-sm font-medium">{log.userName}{log.userId ? ` (${log.userId})` : ''}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {log.notes ?? 'No additional notes'}
                </div>
                {log.reference ? <div className="mt-1 text-xs text-muted-foreground">Reference: {log.reference}</div> : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
