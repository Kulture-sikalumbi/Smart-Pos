import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useBranding } from '@/contexts/BrandingContext';

export default function AuthPage() {
  const { login, signUp } = useAuth();
  const { brandExists } = useBranding();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'login' | 'signup'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onLogin = async () => {
    setBusy(true);
    setError(null);
    const ok = await login(email, password);
    setBusy(false);
    if (ok) {
      if (!brandExists) navigate('/app/company-settings');
      else navigate('/app');
    } else setError('Invalid credentials');
  };

  const onSignUp = async () => {
    setBusy(true);
    setError(null);
    const ok = await signUp({ email, password, displayName });
    setBusy(false);
    if (ok) {
      // After signup, always direct user to create brand first
      navigate('/app/company-settings');
    } else {
      setError('Signup failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow">
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold">Welcome to Profit Maker</h2>
          <p className="text-sm text-muted-foreground">Create an account and set up your brand.</p>
        </div>

        <div className="flex gap-2 mb-4">
          <button className={`flex-1 py-2 rounded ${mode === 'signup' ? 'bg-primary text-white' : 'bg-transparent'}`} onClick={() => setMode('signup')}>Sign up</button>
          <button className={`flex-1 py-2 rounded ${mode === 'login' ? 'bg-primary text-white' : 'bg-transparent'}`} onClick={() => setMode('login')}>Login</button>
        </div>

        {mode === 'signup' && (
          <div className="space-y-3">
            <Input placeholder="Full name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="flex items-center justify-end">
              <Button onClick={onSignUp} disabled={busy}>Create account</Button>
            </div>
          </div>
        )}

        {mode === 'login' && (
          <div className="space-y-3">
            <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="flex items-center justify-end">
              <Button onClick={onLogin} disabled={busy}>Login</Button>
            </div>
          </div>
        )}

        {error && <div className="text-sm text-red-600 mt-3">{error}</div>}
      </div>
    </div>
  );
}
