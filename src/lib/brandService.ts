import type { CompanySettings } from '@/types/company';
import { supabase } from '@/lib/supabaseClient';

const BUCKET = 'branding-logos';

function mapDbRowToSettings(row: any): CompanySettings {
  return {
    appName: row.name,
    tagline: row.tagline ?? undefined,
    primaryColorHex: row.primary_color_hex ?? '#2563eb',
    logoDataUrl: row.logo_path ?? row.logo_url ?? undefined,
    metadata: row.metadata ?? {},
  } as CompanySettings;
}

export async function getCompanySettingsFromServer(): Promise<CompanySettings | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('brands').select('*').limit(1).order('created_at', { ascending: true });
  if (error) {
    console.error('getCompanySettingsFromServer error', error);
    return null;
  }
  if (!data || data.length === 0) return null;
  return mapDbRowToSettings(data[0]);
}

export async function uploadLogo(file: File, companyId?: string): Promise<string | null> {
  if (!supabase) return null;
  try {
    const ext = file.name.split('.').pop() ?? 'png';
    const filename = `company_${companyId ?? 'anon'}_${Date.now()}.${ext}`;
    const path = `${filename}`;
    const { data, error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file as unknown as Blob, { cacheControl: '3600', upsert: true });
    if (uploadError) {
      console.error('uploadLogo upload error', uploadError);
      return null;
    }
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return urlData?.publicUrl ?? null;
  } catch (err) {
    console.error('uploadLogo caught', err);
    return null;
  }
}

export async function createCompanySettingsOnServer(payload: Partial<CompanySettings> & { created_by?: string } = {}) {
  if (!supabase) return null;
  const row = {
    name: payload.appName,
    tagline: payload.tagline,
    primary_color_hex: payload.primaryColorHex,
    logo_path: payload.logoDataUrl,
    metadata: payload.metadata ?? {},
    // Only set owner_id if created_by looks like a UUID to avoid SQL errors
    owner_id: payload.created_by && /^[0-9a-fA-F\-]{36}$/.test(payload.created_by) ? payload.created_by : null,
  };
  const { data, error } = await supabase.from('brands').insert(row).select().limit(1);
  if (error) {
    console.error('createCompanySettingsOnServer error', error);
    return null;
  }
  const created = data?.[0] ?? null;

  // If an owner was provided, ensure their staff row is linked to this brand and set to owner
  try {
    if (created && row.owner_id) {
      // Try updating an existing staff row for this user
      const { data: updated, error: updateErr } = await supabase
        .from('staff')
        .update({ brand_id: created.id, role: 'owner' })
        .eq('user_id', row.owner_id)
        .select();

      if (updateErr) {
        console.warn('createCompanySettingsOnServer: failed to update staff row', updateErr);
      }

      // If no existing staff row was updated, insert a new staff record linking the user and brand
      if (!updated || updated.length === 0) {
        const insertRow = {
          user_id: row.owner_id,
          brand_id: created.id,
          role: 'owner',
          display_name: null,
          email: null,
        };
        const { error: insertErr } = await supabase.from('staff').insert(insertRow);
        if (insertErr) {
          console.warn('createCompanySettingsOnServer: failed to insert staff row', insertErr);
        }
      }
    }
  } catch (e) {
    console.warn('createCompanySettingsOnServer: staff linking encountered error', e);
  }

  return created;
}

export async function updateCompanySettingsOnServer(id: string, payload: Partial<CompanySettings>) {
  if (!supabase) return null;
  const row = {
    name: payload.appName,
    tagline: payload.tagline,
    primary_color_hex: payload.primaryColorHex,
    logo_path: payload.logoDataUrl,
    metadata: payload.metadata ?? {},
  };
  const { data, error } = await supabase.from('brands').update(row).eq('id', id).select().limit(1);
  if (error) {
    console.error('updateCompanySettingsOnServer error', error);
    return null;
  }
  return data?.[0] ?? null;
}

export async function getFirstCompanyRowId(): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('brands').select('id').limit(1).order('created_at', { ascending: true });
  if (error) return null;
  return data?.[0]?.id ?? null;
}
