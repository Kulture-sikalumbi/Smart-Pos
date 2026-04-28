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

export default function TillManagement() {
  const { user, brand, hasPermission } = useAuth();
  const brandId = String((brand as any)?.id ?? (user as any)?.brand_id ?? '');
  const canManage = hasPermission('manageSettings');

  const [busy, setBusy] = useState(false);
  const [tills, setTills] = useState<TillRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [deviceTillDraft, setDeviceTillDraft] = useState<Record<string, string>>({});

  const [newCode, setNewCode] = useState('1');
  const [newName, setNewName] = useState('Till 1');

  const load = async () => {
    if (!supabase || !brandId || !canManage) return;
    setBusy(true);
    try {
      const [tillRes, deviceRes] = await Promise.all([
        supabase.from('tills').select('id, brand_id, code, name, is_active').eq('brand_id', brandId).order('code', { ascending: true }),
        supabase.from('pos_devices').select('id, brand_id, device_id, till_id, last_seen_at').eq('brand_id', brandId).order('last_seen_at', { ascending: false }),
      ]);

      if (tillRes.error) throw tillRes.error;
      if (deviceRes.error) throw deviceRes.error;

      setTills((Array.isArray(tillRes.data) ? tillRes.data : []) as any);
      setDevices((Array.isArray(deviceRes.data) ? deviceRes.data : []) as any);
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
    </div>
  );
}

