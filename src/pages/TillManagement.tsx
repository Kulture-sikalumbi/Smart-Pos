import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/common/PageComponents';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/hooks/use-toast';

type TillRow = {
  id: string;
  brand_id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type DeviceRow = {
  id: string;
  brand_id: string;
  device_id: string;
  till_id: string;
  last_seen_at: string;
};

type TabletDeviceRow = {
  id: string;
  brand_id: string;
  device_id: string;
  table_no: number;
  name: string | null;
  is_locked: boolean;
  is_active: boolean;
  last_seen_at: string;
};

export default function TillManagement() {
  const { user, brand, hasPermission } = useAuth();
  const brandId = String((brand as any)?.id ?? (user as any)?.brand_id ?? '');
  const canManage = hasPermission('manageSettings');

  const [busy, setBusy] = useState(false);
  const [tills, setTills] = useState<TillRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [tabletDevices, setTabletDevices] = useState<TabletDeviceRow[]>([]);
  const [deviceTillDraft, setDeviceTillDraft] = useState<Record<string, string>>({});

  const [newCode, setNewCode] = useState('1');
  const [newName, setNewName] = useState('Till 1');
  const [newTabletDeviceId, setNewTabletDeviceId] = useState('');
  const [newTabletTableNo, setNewTabletTableNo] = useState('');
  const [newTabletName, setNewTabletName] = useState('');

  const load = async () => {
    if (!supabase || !brandId || !canManage) return;
    setBusy(true);
    try {
      const [tillRes, deviceRes, tabletRes] = await Promise.all([
        supabase.from('tills').select('id, brand_id, code, name, is_active').eq('brand_id', brandId).order('code', { ascending: true }),
        supabase.from('pos_devices').select('id, brand_id, device_id, till_id, last_seen_at').eq('brand_id', brandId).order('last_seen_at', { ascending: false }),
        supabase
          .from('customer_tablet_devices')
          .select('id, brand_id, device_id, table_no, name, is_locked, is_active, last_seen_at')
          .eq('brand_id', brandId)
          .order('table_no', { ascending: true }),
      ]);

      if (tillRes.error) throw tillRes.error;
      if (deviceRes.error) throw deviceRes.error;
      if (tabletRes.error) throw tabletRes.error;

      setTills((Array.isArray(tillRes.data) ? tillRes.data : []) as any);
      setDevices((Array.isArray(deviceRes.data) ? deviceRes.data : []) as any);
      setTabletDevices((Array.isArray(tabletRes.data) ? tabletRes.data : []) as any);
      const nextDraft: Record<string, string> = {};
      for (const d of (Array.isArray(deviceRes.data) ? deviceRes.data : []) as any[]) {
        nextDraft[String(d.id)] = String(d.till_id ?? '');
      }
      setDeviceTillDraft(nextDraft);
    } catch (e: any) {
      toast({ title: 'Unable to load tills', description: e?.message ?? String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, canManage]);

  const addTill = async () => {
    if (!supabase || !brandId || !canManage) return;
    const code = newCode.trim();
    const name = newName.trim();
    if (!code || !name) {
      toast({ title: 'Missing fields', description: 'Enter till code and name.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.from('tills').insert({ brand_id: brandId, code, name, is_active: true });
      if (error) throw error;
      toast({ title: 'Till added', description: `${code} • ${name}` });
      await load();
    } catch (e: any) {
      toast({ title: 'Unable to add till', description: e?.message ?? String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const updateTill = async (id: string, patch: Partial<TillRow>) => {
    if (!supabase || !canManage) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('tills').update(patch).eq('id', id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      toast({ title: 'Unable to update till', description: e?.message ?? String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const reassignDeviceTill = async (deviceRowId: string) => {
    if (!supabase || !canManage) return;
    const tillId = String(deviceTillDraft[deviceRowId] ?? '');
    if (!tillId) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('pos_devices').update({ till_id: tillId }).eq('id', deviceRowId);
      if (error) throw error;
      toast({ title: 'Terminal reassigned', description: 'Device till assignment updated.' });
      await load();
    } catch (e: any) {
      toast({ title: 'Unable to reassign terminal', description: e?.message ?? String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const assignTabletDevice = async () => {
    if (!supabase || !brandId || !canManage) return;
    const deviceId = newTabletDeviceId.trim();
    const tableNo = Number(newTabletTableNo);
    if (!deviceId || !Number.isFinite(tableNo) || tableNo <= 0) {
      toast({ title: 'Missing fields', description: 'Enter tablet device id and a valid table number.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('assign_customer_tablet_device', {
        p_brand_id: brandId,
        p_device_id: deviceId,
        p_table_no: tableNo,
        p_name: newTabletName.trim() || null,
        p_is_locked: true,
      });
      if (error) throw error;
      const ok = Boolean((data as any)?.ok ?? false);
      if (!ok) {
        const reason = String((data as any)?.error ?? 'assignment_failed');
        if (reason === 'table_already_assigned') {
          toast({
            title: 'Table already assigned',
            description: 'This table already has a tablet mapped. Reassign or remove the existing mapping first.',
            variant: 'destructive',
          });
        } else {
          toast({ title: 'Unable to assign tablet', description: reason, variant: 'destructive' });
        }
        return;
      }
      toast({ title: 'Tablet assigned', description: `Device mapped to table ${tableNo}.` });
      setNewTabletDeviceId('');
      setNewTabletTableNo('');
      setNewTabletName('');
      await load();
    } catch (e: any) {
      toast({ title: 'Unable to assign tablet', description: e?.message ?? String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const removeTabletDevice = async (rowId: string) => {
    if (!supabase || !canManage) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('customer_tablet_devices').delete().eq('id', rowId);
      if (error) throw error;
      toast({ title: 'Tablet removed', description: 'Tablet assignment deleted.' });
      await load();
    } catch (e: any) {
      toast({ title: 'Unable to remove tablet', description: e?.message ?? String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  if (!canManage) {
    return (
      <div className="p-6">
        <div className="text-sm text-muted-foreground">You don’t have permission to manage tills.</div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Till Management"
        description="Create tills, rename them, and see which POS terminals are assigned to each till."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Tills</CardTitle>
            <CardDescription>Deactivate a till instead of deleting it (keeps audit history clean).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr_auto] gap-2 items-end">
              <div className="grid gap-1">
                <div className="text-xs text-muted-foreground">Code</div>
                <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="e.g. 1" />
              </div>
              <div className="grid gap-1">
                <div className="text-xs text-muted-foreground">Name</div>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Front Counter" />
              </div>
              <Button onClick={addTill} disabled={busy}>Add</Button>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Active</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!tills.length ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-sm text-muted-foreground">
                        No tills yet. Add one, or let the POS assign flow seed defaults (Till 1–3).
                      </TableCell>
                    </TableRow>
                  ) : (
                    tills.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono text-xs">{t.code}</TableCell>
                        <TableCell>
                          <Input
                            value={t.name}
                            onChange={(e) => setTills((prev) => prev.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)))}
                            onBlur={() => updateTill(t.id, { name: t.name })}
                            disabled={busy}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Switch checked={Boolean(t.is_active)} disabled={busy} onCheckedChange={(v) => updateTill(t.id, { is_active: Boolean(v) })} />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">POS Terminals</CardTitle>
            <CardDescription>Device IDs are generated per terminal and stored locally.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Device</TableHead>
                    <TableHead>Till</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!devices.length ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-sm text-muted-foreground">
                        No terminals assigned yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    devices.slice(0, 20).map((d) => {
                      const selected = String(deviceTillDraft[d.id] ?? d.till_id ?? '');
                      return (
                        <TableRow key={d.id}>
                          <TableCell className="font-mono text-xs">{String(d.device_id).slice(0, 10)}…</TableCell>
                          <TableCell className="text-xs">
                            <Select
                              value={selected}
                              onValueChange={(v) => setDeviceTillDraft((prev) => ({ ...prev, [d.id]: v }))}
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Select till" />
                              </SelectTrigger>
                              <SelectContent>
                                {tills.filter((t) => t.is_active).map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.code} • {t.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy || !selected || selected === String(d.till_id ?? '')}
                              onClick={() => reassignDeviceTill(d.id)}
                            >
                              Save
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="mt-3 flex justify-end">
              <Button variant="outline" onClick={load} disabled={busy}>Refresh</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Customer Table Tablets</CardTitle>
          <CardDescription>
            Register locked customer tablets per table. This keeps ordering traceable by table and device.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[1.2fr_120px_1fr_auto] gap-2 items-end">
            <div className="grid gap-1">
              <div className="text-xs text-muted-foreground">Tablet Device ID</div>
              <Input
                value={newTabletDeviceId}
                onChange={(e) => setNewTabletDeviceId(e.target.value)}
                placeholder="e.g. tablet-4f20..."
              />
            </div>
            <div className="grid gap-1">
              <div className="text-xs text-muted-foreground">Table No</div>
              <Input
                value={newTabletTableNo}
                onChange={(e) => setNewTabletTableNo(e.target.value)}
                placeholder="e.g. 12"
                inputMode="numeric"
              />
            </div>
            <div className="grid gap-1">
              <div className="text-xs text-muted-foreground">Name (optional)</div>
              <Input
                value={newTabletName}
                onChange={(e) => setNewTabletName(e.target.value)}
                placeholder="e.g. Patio Tablet A"
              />
            </div>
            <Button onClick={assignTabletDevice} disabled={busy}>Assign Tablet</Button>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Last Seen</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!tabletDevices.length ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-muted-foreground">
                      No customer tablets registered yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  tabletDevices.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-semibold">Table {t.table_no}</TableCell>
                      <TableCell className="font-mono text-xs">{t.device_id}</TableCell>
                      <TableCell>{t.name ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.last_seen_at ? new Date(t.last_seen_at).toLocaleString() : 'Never'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => removeTabletDevice(t.id)} disabled={busy}>
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

