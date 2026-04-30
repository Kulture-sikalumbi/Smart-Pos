import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { CompanySettings } from '@/types/company';
import { clearLegacyCompanySettings, defaultCompanySettings, getCompanySettings, saveCompanySettings } from '@/lib/companySettingsStore';
import { hexToHslVar } from '@/lib/color';
import { useAuth } from '@/contexts/AuthContext';
import {
  getCompanySettingsFromServerForBrand,
  uploadLogo,
  createCompanySettingsOnServer,
  updateCompanySettingsOnServer,
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
    const parts = String(hsl).split(' ');
    const hue = Number.parseFloat(parts[0] ?? '220');
    const sat = Number.parseFloat(String(parts[1] ?? '60').replace('%', ''));
    const safeHue = Number.isFinite(hue) ? hue : 220;
    const safeSat = Number.isFinite(sat) ? sat : 60;
    const isDark = root.classList.contains('dark');
    root.style.setProperty('--primary', hsl);
    root.style.setProperty('--ring', hsl);
    root.style.setProperty('--sidebar-primary', hsl);
    root.style.setProperty('--accent-foreground', hsl);

    // Apply brand hue to major surfaces so branding is visible across pages,
    // not only borders/buttons.
    if (isDark) {
      const surfaceSat = Math.max(30, Math.min(70, safeSat * 0.7));
      root.style.setProperty('--background', `${safeHue} ${surfaceSat}% 11%`);
      root.style.setProperty('--card', `${safeHue} ${Math.max(26, surfaceSat - 6)}% 16%`);
      root.style.setProperty('--popover', `${safeHue} ${Math.max(26, surfaceSat - 6)}% 16%`);
      root.style.setProperty('--secondary', `${safeHue} ${Math.max(24, surfaceSat - 8)}% 22%`);
      root.style.setProperty('--muted', `${safeHue} ${Math.max(22, surfaceSat - 10)}% 20%`);
      root.style.setProperty('--accent', `${safeHue} ${Math.max(24, surfaceSat - 8)}% 23%`);
      root.style.setProperty('--border', `${safeHue} ${Math.max(18, surfaceSat - 14)}% 30%`);
      root.style.setProperty('--input', `${safeHue} ${Math.max(18, surfaceSat - 14)}% 30%`);
      root.style.setProperty('--table-header', `${safeHue} ${Math.max(20, surfaceSat - 12)}% 20%`);
      root.style.setProperty('--table-row-hover', `${safeHue} ${Math.max(18, surfaceSat - 14)}% 24%`);
      root.style.setProperty('--table-row-selected', `${safeHue} ${Math.max(16, surfaceSat - 16)}% 28%`);
      root.style.setProperty('--sidebar-background', `${safeHue} ${Math.max(24, surfaceSat - 10)}% 17%`);
      root.style.setProperty('--sidebar-accent', `${safeHue} ${Math.max(22, surfaceSat - 12)}% 24%`);
      root.style.setProperty('--sidebar-border', `${safeHue} ${Math.max(20, surfaceSat - 14)}% 29%`);
    } else {
      const surfaceSat = Math.max(38, Math.min(80, safeSat * 0.85));
      root.style.setProperty('--background', `${safeHue} ${surfaceSat}% 92%`);
      root.style.setProperty('--card', `${safeHue} ${Math.max(34, surfaceSat - 8)}% 96%`);
      root.style.setProperty('--popover', `${safeHue} ${Math.max(34, surfaceSat - 8)}% 96%`);
      root.style.setProperty('--secondary', `${safeHue} ${Math.max(30, surfaceSat - 12)}% 88%`);
      root.style.setProperty('--muted', `${safeHue} ${Math.max(28, surfaceSat - 14)}% 89%`);
      root.style.setProperty('--accent', `${safeHue} ${Math.max(30, surfaceSat - 12)}% 86%`);
      root.style.setProperty('--border', `${safeHue} ${Math.max(24, surfaceSat - 18)}% 72%`);
      root.style.setProperty('--input', `${safeHue} ${Math.max(24, surfaceSat - 18)}% 72%`);
      root.style.setProperty('--table-header', `${safeHue} ${Math.max(28, surfaceSat - 14)}% 86%`);
      root.style.setProperty('--table-row-hover', `${safeHue} ${Math.max(26, surfaceSat - 16)}% 90%`);
      root.style.setProperty('--table-row-selected', `${safeHue} ${Math.max(24, surfaceSat - 18)}% 82%`);
      root.style.setProperty('--sidebar-background', `${safeHue} ${Math.max(24, surfaceSat - 16)}% 20%`);
      root.style.setProperty('--sidebar-accent', `${safeHue} ${Math.max(22, surfaceSat - 18)}% 30%`);
      root.style.setProperty('--sidebar-border', `${safeHue} ${Math.max(20, surfaceSat - 20)}% 35%`);
    }
  }

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute('content', settings.primaryColorHex);
  }
};

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { brand, user } = useAuth();
  const brandId = (brand as any)?.id ?? (user as any)?.brand_id ?? null;

  const [settings, setSettings] = useState<CompanySettings>(() => getCompanySettings(brandId));
  const [brandExists, setBrandExists] = useState<boolean>(false);

  // Load cached settings whenever the active brand changes.
  useEffect(() => {
    clearLegacyCompanySettings();
    setSettings(getCompanySettings(brandId));

    // Quick best-effort sync from the brand row (prevents placeholder flashes).
    if (brandId && brand) {
      setSettings((prev) => ({
        ...prev,
        appName: (brand as any).name ?? prev.appName,
        primaryColorHex: (brand as any).primary_color_hex ?? prev.primaryColorHex,
        currencyCode: (brand as any).brand_currency_code ?? prev.currencyCode,
      }));
    }
  }, [brandId, brand]);

  // Fetch server settings for the active brand (brand-aware) with fallback and cleanup
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
        if (!brandId) {
          setBrandExists(false);
          return;
        }

        const server = await withTimeout(getCompanySettingsFromServerForBrand(String(brandId)), 8000);
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
  }, [brandId]);

  useEffect(() => {
    applyBrandingToDocument(settings);
    if (brandId) saveCompanySettings(settings, brandId);
  }, [settings, brandId]);

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

      const existingId = brandId ? String(brandId) : null;
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
