import type { CompanySettings } from '@/types/company';

const LEGACY_STORAGE_KEY = 'pmx.companySettings.v1';
const STORAGE_KEY_PREFIX = 'pmx.companySettings.v1.';

export const defaultCompanySettings: CompanySettings = {
  appName: 'Profit Maker POS',
  tagline: 'Back Office + POS',
  primaryColorHex: '#2563eb',
  brandType: 'restaurant',
  currencyCode: 'ZMW',
};

function getKey(brandId?: string | null) {
  return brandId ? `${STORAGE_KEY_PREFIX}${brandId}` : null;
}

export const getCompanySettings = (brandId?: string | null): CompanySettings => {
  try {
    const key = getKey(brandId);
    if (!key) return defaultCompanySettings;
    const raw = localStorage.getItem(key);

    if (!raw) return defaultCompanySettings;
    const parsed = JSON.parse(raw) as Partial<CompanySettings>;

    return {
      ...defaultCompanySettings,
      ...parsed,
    };
  } catch {
    return defaultCompanySettings;
  }
};

export const saveCompanySettings = (settings: CompanySettings, brandId?: string | null) => {
  const key = getKey(brandId);
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(settings));
};

export const clearLegacyCompanySettings = () => {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }
};
