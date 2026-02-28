import type { User } from '@/types/auth';

const STORAGE_KEY = 'pmx.staffUsers.v1';

// No hardcoded staff users — prefer server-side staff table.
export const getStaffUsers = (): User[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as User[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveStaffUsers = (users: User[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
  } catch {
    // ignore
  }
};

export const ensureStaffUsersSeeded = () => {
  // intentionally no-op: staff should come from the server
};
