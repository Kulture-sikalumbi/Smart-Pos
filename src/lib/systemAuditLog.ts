import { SystemAuditLogEntry, SensitiveActionType, GeoLocation } from '@/types';
import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEY = 'mthunzi.auditLogs.v1';
const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

type AuditLogStateV1 = {
  version: 1;
  entries: SystemAuditLogEntry[];
};

type Listener = () => void;

const listeners = new Set<Listener>();
let cached: AuditLogStateV1 | null = null;

function emit() {
  for (const l of listeners) l();
}

function seedState(): AuditLogStateV1 {
  return {
    version: 1,
    entries: [],
  };
}

function pruneEntries(entries: SystemAuditLogEntry[]): SystemAuditLogEntry[] {
  const cutoff = Date.now() - MAX_AGE_MS;
  return (entries ?? []).filter((e) => {
    const ts = new Date(String(e.timestamp ?? '')).getTime();
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

function load(): AuditLogStateV1 {
  if (cached) return cached;

  if (typeof window === 'undefined') {
    cached = seedState();
    return cached;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AuditLogStateV1>;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
        cached = { version: 1, entries: pruneEntries(parsed.entries as SystemAuditLogEntry[]) };
        return cached;
      }
    }
  } catch {
    // ignore
  }

  cached = seedState();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // ignore
  }
  return cached;
}

function save(state: AuditLogStateV1) {
  cached = { version: 1, entries: pruneEntries(state.entries) };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // ignore
  }
  emit();
}

export function subscribeAuditLogs(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAuditLogsSnapshot(): SystemAuditLogEntry[] {
  return load().entries;
}

export function clearAuditLogs() {
  save({ version: 1, entries: [] });
}

/**
 * Retrieves the user's current geolocation.
 * @returns A promise that resolves to a GeoLocation object or null if it fails.
 */
const getCurrentLocation = (): Promise<GeoLocation | null> => {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined') {
      resolve(null);
      return;
    }
    if (!navigator.geolocation) {
      console.warn('Geolocation is not supported by this browser.');
      resolve(null);
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        console.error('Error getting location:', error);
        resolve(null); // Failed to get location
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  });
};

/**
 * Logs a sensitive action to the audit trail.
 * This function will automatically capture the timestamp and user's geolocation.
 * @param entry - A partial audit log entry containing the core details of the action.
 */
export const logSensitiveAction = async (
  entry: Omit<SystemAuditLogEntry, 'id' | 'timestamp' | 'geoLocation'> & {
    /** If true, attempts to capture geolocation (may prompt user). Default false. */
    captureGeo?: boolean;
  }
): Promise<SystemAuditLogEntry> => {
  const captureGeo = entry.captureGeo === true;
  const location = captureGeo ? await getCurrentLocation() : null;

  const { captureGeo: _captureGeo, ...base } = entry;

  const newLogEntry: SystemAuditLogEntry = {
    ...base,
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    geoLocation: location ?? undefined,
  };

  const state = load();
  save({ ...state, entries: [newLogEntry, ...state.entries] });
  
  return newLogEntry;
};

/**
 * Retrieves all audit log entries.
 * In a real app, this would fetch from the backend.
 * @returns A promise that resolves to an array of all audit log entries.
 */
export const getAuditLogs = async (): Promise<SystemAuditLogEntry[]> => {
  return Promise.resolve(getAuditLogsSnapshot());
};

/**
 * Analyzes audit logs to identify suspicious activities.
 * @param logs - An array of audit log entries to analyze.
 * @returns An array of log entries that have been flagged as suspicious.
 */
export const analyzeSuspiciousActivity = (logs: SystemAuditLogEntry[]): SystemAuditLogEntry[] => {
  const suspiciousLogs: SystemAuditLogEntry[] = [];
  const voidCounts: Record<string, number> = {};

  for (const log of logs) {
    let isSuspicious = false;
    let suspicionReason = '';

    // Rule 1: More than 3 voids by the same user in a shift (approximated as 24h)
    if (log.actionType === 'void') {
      voidCounts[log.userId] = (voidCounts[log.userId] || 0) + 1;
      if (voidCounts[log.userId] > 3) {
        isSuspicious = true;
        suspicionReason = 'Excessive voids by user';
      }
    }

    // Rule 1b: Very high discounts
    if (!isSuspicious && log.actionType === 'discount') {
      const raw = String(log.newValue ?? '');
      const m = raw.match(/(\d+(?:\.\d+)?)\s*%/);
      const pct = m ? Number(m[1]) : NaN;
      if (Number.isFinite(pct) && pct >= 25) {
        isSuspicious = true;
        suspicionReason = 'Very high discount applied';
      }
    }

    // Rule 2: Geolocation is suspiciously far away (e.g., > 1km accuracy or known far distance)
    if (log.geoLocation && log.geoLocation.accuracy > 1000) {
        isSuspicious = true;
        suspicionReason = 'Suspiciously large location accuracy radius.';
    }
    
    // Example of a hardcoded check for a manager being too far from the business premises
    if (String(log.userName).toLowerCase().includes('manager') && log.geoLocation) {
        // Business location: -12.45, 28.11
        const latDistance = Math.abs(log.geoLocation.latitude - (-12.45));
        const lonDistance = Math.abs(log.geoLocation.longitude - (28.11));
        if(latDistance > 0.1 || lonDistance > 0.1) { // Rough check for distance
            isSuspicious = true;
            suspicionReason = 'Manager authorized action from a remote location.';
        }
    }


    if (isSuspicious) {
      suspiciousLogs.push({ ...log, notes: suspicionReason });
    }
  }

  return suspiciousLogs;
};
