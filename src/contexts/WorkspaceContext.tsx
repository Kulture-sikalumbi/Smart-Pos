import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export type WorkspaceMode = 'back' | 'front';

type WorkspaceContextType = {
  workspace: WorkspaceMode;
  setWorkspace: (mode: WorkspaceMode) => void;
  canUseBackOffice: boolean;
  canUseFrontOffice: boolean;
};

const STORAGE_KEY = 'pmx.workspace.mode.v1';

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

function isFrontRoute(pathname: string) {
  return (
    pathname.startsWith('/app/pos') ||
    pathname.startsWith('/app/manufacturing') ||
    pathname.startsWith('/app/inventory/front-office-stock')
  );
}

function isBackRoute(pathname: string) {
  return (
    pathname === '/app' ||
    pathname.startsWith('/app/dashboard') ||
    pathname.startsWith('/app/back-office') ||
    pathname.startsWith('/app/inventory/stock') ||
    pathname.startsWith('/app/purchases') ||
    pathname.startsWith('/app/staff') ||
    pathname.startsWith('/app/reports') ||
    pathname.startsWith('/app/zra') ||
    pathname.startsWith('/app/audit') ||
    pathname.startsWith('/app/tax')
  );
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  const role = String((user as any)?.role ?? '').toLowerCase();
  const isSuperAdmin = Boolean((user as any)?.is_super_admin);
  const canUseBackOffice = isSuperAdmin || role === 'owner' || role === 'admin';
  const canUseFrontOffice =
    isSuperAdmin || role === 'owner' || role === 'manager' || role === 'front_supervisor' || role === 'cashier' || role === 'kitchen_staff' || role === 'chef';

  const [workspace, setWorkspaceState] = useState<WorkspaceMode>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === 'front' || raw === 'back') return raw;
    } catch {
      // ignore
    }
    return canUseBackOffice ? 'back' : 'front';
  });

  const setWorkspace = (mode: WorkspaceMode) => {
    setWorkspaceState(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  };

  // Keep workspace in sync when a route clearly belongs to one side.
  useEffect(() => {
    if (isFrontRoute(location.pathname)) setWorkspaceState('front');
    if (isBackRoute(location.pathname) && canUseBackOffice) setWorkspaceState('back');
  }, [location.pathname, canUseBackOffice]);

  // Clamp workspace if role cannot access one side.
  useEffect(() => {
    if (workspace === 'back' && !canUseBackOffice) setWorkspace('front');
  }, [workspace, canUseBackOffice]);

  const value = useMemo(
    () => ({ workspace, setWorkspace, canUseBackOffice, canUseFrontOffice }),
    [workspace, canUseBackOffice, canUseFrontOffice]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}

