import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { PageHeader, DataTableWrapper, StatusBadge } from '@/components/common/PageComponents';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import RequirePermission from '@/components/auth/RequirePermission';
import type { AssignableStaffRole, UserRole } from '@/types/auth';
import { ASSIGNABLE_STAFF_ROLES, ROLE_ACCESS_HELPERS, ROLE_NAMES } from '@/types/auth';

export default function Staff() {
  const { allUsers, createUser, updateUser, deleteUser, hasPermission } = useAuth();

  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<AssignableStaffRole>('cashier');
  const [editPin, setEditPin] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const canManage = hasPermission('manageStaff');

  const users = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allUsers;
    return allUsers.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [allUsers, search]);

  const openCreate = () => {
    setEditingId('new');
    setEditName('');
    setEditEmail('');
    setEditRole('cashier');
    setEditPin('');
    setEditActive(true);
  };

  const openEdit = (id: string) => {
    const u = allUsers.find(x => x.id === id);
    if (!u) return;
    setEditingId(id);
    setEditName(u.name);
    setEditEmail(u.email);
    setEditRole((ASSIGNABLE_STAFF_ROLES.includes(u.role as AssignableStaffRole) ? u.role : 'cashier') as AssignableStaffRole);
    setEditPin(u.pin ?? '');
    setEditActive(u.isActive);
  };

  const save = async () => {
    if (!canManage) return;
    setFormError(null);
    const name = editName.trim();
    const email = editEmail.trim();
    const pin = editPin.trim();
    if (!name || !email) return;

    // under_brand_staff requires a 4-digit PIN for POS login
    if (!/^\d{4}$/.test(pin)) {
      setFormError('PIN must be exactly 4 digits.');
      return;
    }

    if (editingId === 'new') {
      try {
        await createUser({
          name,
          email,
          role: editRole,
          pin,
          isActive: editActive,
        });
        setEditingId(null);
        return;
      } catch (e: any) {
        setFormError(e?.message ?? 'Failed to add staff.');
        return;
      }
    }

    if (editingId) {
      try {
        await updateUser(editingId, {
          name,
          email,
          role: editRole,
          pin,
          isActive: editActive,
        });
        setEditingId(null);
      } catch (e: any) {
        setFormError(e?.message ?? 'Failed to update staff.');
      }
    }
  };

  return (
    <div>
      <PageHeader
        title="Staff Management"
        description="Admin CRUD for users, roles, and PINs"
        actions={
          <RequirePermission permission="manageStaff">
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Staff</Button>
          </RequirePermission>
        }
      />

      <div className="mb-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search staff by name or email..."
        />
      </div>

      <Dialog open={!!editingId} onOpenChange={(o) => { if (!o) setEditingId(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId === 'new' ? 'Add Staff' : 'Edit Staff'}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">Name</div>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} disabled={!canManage} />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">Email</div>
              <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} disabled={!canManage} />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">Role</div>
              <Select value={editRole} onValueChange={(v) => setEditRole(v as AssignableStaffRole)} disabled={!canManage}>
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_STAFF_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>{ROLE_NAMES[role]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                <p className="font-medium text-foreground mb-1">Role access preview</p>
                {ROLE_ACCESS_HELPERS[editRole].map((hint) => (
                  <p key={hint}>- {hint}</p>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">PIN (POS login)</div>
              <Input value={editPin} onChange={(e) => setEditPin(e.target.value)} disabled={!canManage} placeholder="e.g. 1234" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <div className="text-sm font-medium">Status</div>
              <Select value={editActive ? 'active' : 'inactive'} onValueChange={(v) => setEditActive(v === 'active')} disabled={!canManage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {formError && (
            <div className="mt-2 text-sm text-red-600">{formError}</div>
          )}

          <div className="flex items-center justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
            <Button onClick={save} disabled={!canManage}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      <DataTableWrapper>
        <Table className="data-table">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell>{ROLE_NAMES[u.role]}</TableCell>
                <TableCell className="text-muted-foreground">{u.email}</TableCell>
                <TableCell>
                  <StatusBadge status={u.isActive ? 'positive' : 'neutral'}>
                    {u.isActive ? 'Active' : 'Inactive'}
                  </StatusBadge>
                </TableCell>
                <TableCell className="text-right">
                  <RequirePermission permission="manageStaff" fallback={<span className="text-xs text-muted-foreground">—</span>}>
                    <div className="inline-flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEdit(u.id)}>
                        <Pencil className="h-4 w-4 mr-1" /> Edit
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm">
                            <Trash2 className="h-4 w-4 mr-1" /> Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete staff member?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This removes {u.name} from the local staff list.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteUser(u.id)}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </RequirePermission>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTableWrapper>
    </div>
  );
}
