import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageComponents';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useBranding } from '@/contexts/BrandingContext';
import { useAuth } from '@/contexts/AuthContext';

export default function CompanySettings() {
  const { hasPermission, user, refreshProfile } = useAuth();
  const { settings, updateSettings, reset, saveToServer, brandExists } = useBranding();
  const navigate = useNavigate();

  const [localName, setLocalName] = useState(settings.appName);
  const [localTagline, setLocalTagline] = useState(settings.tagline ?? '');
  const [localPrimary, setLocalPrimary] = useState(settings.primaryColorHex);
  const [localLogo, setLocalLogo] = useState<string | undefined>(settings.logoDataUrl);
  const [localBrandType, setLocalBrandType] = useState<'restaurant' | 'retail'>(settings.brandType ?? 'restaurant');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showStaffPrompt, setShowStaffPrompt] = useState(false);
  const [retailBlockedOpen, setRetailBlockedOpen] = useState(false);

  const canManage = hasPermission('manageSettings');

  const preview = useMemo(
    () => ({
      appName: localName.trim() || 'Mthunzi-Smart',
      tagline: localTagline.trim() || undefined,
      primaryColorHex: localPrimary,
      logoDataUrl: localLogo,
      brandType: localBrandType,
    }),
    [localName, localTagline, localPrimary, localLogo, localBrandType]
  );

  const apply = async () => {
    if (!canManage || saving) return;
    setSaving(true);
    const wasBrandPresent = brandExists;
    // Prevent creating a retail brand until retail features are implemented
    if (!wasBrandPresent && preview.brandType === 'retail') {
      setRetailBlockedOpen(true);
      setSaving(false);
      return;
    }

    try {
      const ok = await saveToServer(preview, selectedFile, user?.id);
      if (ok) {
        updateSettings(preview);
        // Ensure the auth profile (and local auth snapshot) picks up the new brand_id immediately.
        try {
          await refreshProfile();
        } catch {
          // ignore
        }
        // Show a non-blocking modal instead of browser alert. If brand was just created,
        // prompt the admin to add staff before links are activated.
        if (!wasBrandPresent) {
          setSuccessMessage('Brand created successfully. You can now add team members.');
          setShowStaffPrompt(true);
        } else {
          setSuccessMessage('Brand updated successfully.');
        }
      } else {
        // surface a simple error so the user isn't left waiting
        alert('Failed to save brand. Check network or server logs.');
      }
    } finally {
      setSaving(false);
    }
  };

  const onLogoFile = async (file: File | null) => {
    if (!file) {
      setSelectedFile(null);
      setLocalLogo(undefined);
      return;
    }
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : undefined;
      setLocalLogo(result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div>
      <PageHeader
        title="Company Settings"
        description="White-label branding: app name, logo, and primary color."
      />

      {!canManage && (
        <Card className="mb-6">
          <CardContent className="p-4 text-sm text-muted-foreground">
            You don’t have permission to manage settings.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Branding</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <div className="text-sm font-medium">Brand name</div>
              <Input value={localName} onChange={(e) => setLocalName(e.target.value)} disabled={!canManage} />
              <div className="text-xs text-muted-foreground">
                The public brand name displayed to customers and staff — used in emails, receipts, and the app header.
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Tagline</div>
              <Input value={localTagline} onChange={(e) => setLocalTagline(e.target.value)} disabled={!canManage} placeholder="Optional: short description or slogan" />
              <div className="text-xs text-muted-foreground">
                Optional short description or slogan. Appears under the brand name in headers and some printed receipts.
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Primary color</div>
              <div className="flex items-center gap-3">
                <Input
                  type="color"
                  value={localPrimary}
                  onChange={(e) => setLocalPrimary(e.target.value)}
                  disabled={!canManage}
                  className="h-10 w-16 p-1"
                />
                <Input
                  value={localPrimary}
                  onChange={(e) => setLocalPrimary(e.target.value)}
                  disabled={!canManage}
                  placeholder="#2563eb"
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Logo</div>
              <Input
                type="file"
                accept="image/*"
                disabled={!canManage}
                onChange={(e) => onLogoFile(e.target.files?.[0] ?? null)}
              />
              <div className="text-xs text-muted-foreground">
                Upload a logo from your device. It will be stored in Supabase storage and used across the app and receipts.
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Brand type</div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input type="radio" name="brandType" value="restaurant" checked={localBrandType === 'restaurant'} onChange={() => setLocalBrandType('restaurant')} disabled={!canManage} />
                  <span className="text-sm">Restaurant</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="brandType" value="retail" checked={localBrandType === 'retail'} onChange={() => setLocalBrandType('retail')} disabled={!canManage} />
                  <span className="text-sm">Retail</span>
                </label>
              </div>
              <div className="text-xs text-muted-foreground">
                Choose the business type; retail currently shows a limited POS experience.
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={apply} disabled={!canManage || saving}>
                {saving ? (
                  <>
                    <span className="inline-block mr-2 h-4 w-4 animate-spin rounded-full border-t-2 border-b-2 border-white/80" />
                    Saving...
                  </>
                ) : (
                  'Apply'
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (!canManage) return;
                  reset();
                  setLocalName('Mthunzi-Smart');
                  setLocalTagline('Back Office + POS');
                  setLocalPrimary('#2563eb');
                  setLocalLogo(undefined);
                }}
                disabled={!canManage}
              >
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              {preview.logoDataUrl ? (
                <img src={preview.logoDataUrl} alt="Logo" className="h-12 w-12 rounded-md object-cover border" />
              ) : (
                <div className="h-12 w-12 rounded-md border bg-muted" />
              )}
              <div>
                <div className="font-bold">{preview.appName}</div>
                {preview.tagline && <div className="text-xs text-muted-foreground">{preview.tagline}</div>}
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-md" style={{ backgroundColor: preview.primaryColorHex }} />
              <div className="text-sm text-muted-foreground">Primary color used for buttons and highlights.</div>
            </div>
          </CardContent>
        </Card>
      </div>
      {/* Success / staff prompt dialog */}
      <Dialog open={!!successMessage} onOpenChange={(open) => { if (!open) { setSuccessMessage(null); setShowStaffPrompt(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{successMessage}</DialogTitle>
            <DialogDescription>
              {showStaffPrompt ? (
                <div>Add staff members to continue. You can add team members now or remind yourself later.</div>
              ) : (
                <div>Changes saved.</div>
              )}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            {showStaffPrompt ? (
              <div className="flex gap-2">
                <Button onClick={() => { setSuccessMessage(null); setShowStaffPrompt(false); navigate('/app/staff'); }}>
                  Add staff now
                </Button>
                <Button variant="outline" onClick={() => { setSuccessMessage(null); setShowStaffPrompt(false); }}>
                  Remind me later
                </Button>
              </div>
            ) : (
              <Button onClick={() => setSuccessMessage(null)}>Close</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Retail blocked dialog */}
      <Dialog open={retailBlockedOpen} onOpenChange={(open) => { if (!open) setRetailBlockedOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retail coming soon</DialogTitle>
            <DialogDescription>
              Retail feature coming soon — only Restaurant is available right now. Please choose "Restaurant" to continue.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setRetailBlockedOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
