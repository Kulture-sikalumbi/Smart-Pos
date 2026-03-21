import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { CompanySettings } from '@/types/company';
import { defaultCompanySettings, getCompanySettings, saveCompanySettings } from '@/lib/companySettingsStore';
import { hexToHslVar } from '@/lib/color';
import {
  getCompanySettingsFromServer,
  uploadLogo,
  createCompanySettingsOnServer,
  updateCompanySettingsOnServer,
  getFirstCompanyRowId,
} from '@/lib/brandService';

type BrandingContextValue = {
  settings: CompanySettings;
  updateSettings: (next: Partial<CompanySettings>) => void;
  reset: () => void;
  brandExists: boolean;
  saveToServer: (next: Partial<CompanySettings>, logoFile?: File | null, createdBy?: string | null) => Promise<boolean>;
};

const BrandingContext = createContext<BrandingContextValue | null>(null);

const applyBrandingToDocument = (settings: CompanySettings) => {
  if (!settings) {
    throw new Error("BrandingProvider: settings is null or undefined.");
  }
  document.title = settings.appName || defaultCompanySettings.appName;

  const hsl = hexToHslVar(settings.primaryColorHex);
  if (hsl) {
    const root = document.documentElement;
    root.style.setProperty('--primary', hsl);
    root.style.setProperty('--ring', hsl);
    root.style.setProperty('--sidebar-primary', hsl);
    root.style.setProperty('--accent-foreground', hsl);
  }

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute('content', settings.primaryColorHex);
  }
};

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<CompanySettings>(() => getCompanySettings());
  const [brandExists, setBrandExists] = useState<boolean>(false);

  // Fetch server settings once on mount with branding fallback and cleanup
  useEffect(() => {
    let cancelled = false;
    const withTimeout = async <T,>(p: Promise<T>, ms = 3000): Promise<T> => {
      let timer: any;
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error('timeout')), ms);
      });
      try {
        return (await Promise.race([p, timeout])) as T;
      } finally {
        clearTimeout(timer);
      }
    };

    (async () => {
      try {
        const server = await withTimeout(getCompanySettingsFromServer(), 3000);
        if (cancelled) return;

        if (server) {
          setSettings((prev) => ({ ...prev, ...server }));
          setBrandExists(true);
        } else {
          setBrandExists(false);
        }
      } catch {
        if (cancelled) return;
        setBrandExists(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    applyBrandingToDocument(settings);
    saveCompanySettings(settings);
  }, [settings]);

  const saveToServer = async (next: Partial<CompanySettings>, logoFile?: File | null, createdBy?: string | null) => {
    try {
      let logoUrl: string | undefined = undefined;
      if (logoFile) {
        // Protect against hanging network calls by timing out long requests
        const withTimeout = async <T,>(p: Promise<T>, ms = 15000): Promise<T> => {
          let timer: any;
          const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms); });
          try {
            return await Promise.race([p, timeout]) as T;
          } finally {
            clearTimeout(timer);
          }
        };

        try {
          const uploaded = await withTimeout(uploadLogo(logoFile), 15000);
          if (uploaded) {
            logoUrl = uploaded;
          } else {
            // Upload returned null (likely denied). Fallback to data URL.
            try {
              logoUrl = await new Promise<string | undefined>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => {
                  const result = typeof reader.result === 'string' ? reader.result : undefined;
                  resolve(result);
                };
                reader.onerror = () => resolve(undefined);
                reader.readAsDataURL(logoFile as Blob);
              });
            } catch (e) {
              console.warn('Failed to create data URL fallback for logo', e);
            }
          }
        } catch (e: any) {
          console.error('uploadLogo timed out or failed', e);
          // Attempt data URL fallback
          try {
            logoUrl = await new Promise<string | undefined>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = typeof reader.result === 'string' ? reader.result : undefined;
                resolve(result);
              };
              reader.onerror = () => resolve(undefined);
              reader.readAsDataURL(logoFile as Blob);
            });
          } catch (e2) {
            console.warn('Failed to create data URL fallback after upload failure', e2);
          }
        }
      }

      const payload: Partial<CompanySettings> = {
        ...next,
        logoDataUrl: logoUrl ?? next.logoDataUrl,
      };

      const existingId = await getFirstCompanyRowId();
      let result = null;
      const withTimeout = async <T,>(p: Promise<T>, ms = 15000): Promise<T> => {
        let timer: any;
        const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms); });
        try {
          return await Promise.race([p, timeout]) as T;
        } finally {
          clearTimeout(timer);
        }
      };

      try {
        if (existingId) {
          result = await withTimeout(updateCompanySettingsOnServer(existingId, payload), 15000);
        } else {
          result = await withTimeout(createCompanySettingsOnServer({ ...(payload as Partial<CompanySettings>), created_by: createdBy }), 15000);
        }
      } catch (e: any) {
        console.error('create/update brand timed out or failed', e);
        return false;
      }

      if (result) {
        const merged = { ...settings, ...payload } as CompanySettings;
        setSettings(merged);
        setBrandExists(true);
        return true;
      }
      return false;
    } catch (err) {
      console.error('saveToServer error', err);
      return false;
    }
  };

  const value = useMemo<BrandingContextValue>(
    () => ({
      settings,
      updateSettings: (next) => setSettings((prev) => ({ ...prev, ...next })),
      reset: () => setSettings(defaultCompanySettings),
      brandExists,
      saveToServer,
    }),
    [settings, brandExists]
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export const useBranding = () => {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error('useBranding must be used within BrandingProvider');
  return ctx;
};
