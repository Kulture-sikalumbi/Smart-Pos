import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/common/PageComponents';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useBranding } from '@/contexts/BrandingContext';
import { useAuth } from '@/contexts/AuthContext';

export default function CompanySettings() {
  const { hasPermission, user } = useAuth();
  const { settings, updateSettings, reset, saveToServer } = useBranding();

  const [localName, setLocalName] = useState(settings.appName);
  const [localTagline, setLocalTagline] = useState(settings.tagline ?? '');
  const [localPrimary, setLocalPrimary] = useState(settings.primaryColorHex);
  const [localLogo, setLocalLogo] = useState<string | undefined>(settings.logoDataUrl);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const canManage = hasPermission('manageSettings');

  const preview = useMemo(
    () => ({
      appName: localName.trim() || 'Mthunzi-Smart',
      tagline: localTagline.trim() || undefined,
      primaryColorHex: localPrimary,
      logoDataUrl: localLogo,
    }),
    [localName, localTagline, localPrimary, localLogo]
  );

  const apply = async () => {
    if (!canManage) return;
    const wasBrandPresent = brandExists;
    const ok = await saveToServer(preview, selectedFile, user?.id);
      if (ok) {
      updateSettings(preview);
      if (!wasBrandPresent) {
        // After creating a new brand, send user to staff page to add team members
        navigate('/app/staff');
      }
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
              <div className="text-sm font-medium">App name</div>
              <Input value={localName} onChange={(e) => setLocalName(e.target.value)} disabled={!canManage} />
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Tagline</div>
              <Input value={localTagline} onChange={(e) => setLocalTagline(e.target.value)} disabled={!canManage} />
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
                Upload a logo from your device. It will be stored in Supabase storage.
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={apply} disabled={!canManage}>Apply</Button>
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
    </div>
  );
}
