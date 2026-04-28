import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { UserCog } from 'lucide-react';

interface LoginOverlayProps {
  onClose?: () => void;
}

export default function LoginOverlay({ onClose }: LoginOverlayProps) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [secret, setSecret] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSignup, setIsSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);

  const withTimeout = async <T,>(p: Promise<T>, ms = 15000): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error('Request timed out. Please try again.')), ms);
    });
    try {
      return (await Promise.race([p, timeout])) as T;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const validatePassword = (pwd: string) => {
    const problems: string[] = [];
    if (pwd.length < 8) problems.push('At least 8 characters');
    if (!/[a-z]/.test(pwd)) problems.push('At least one lowercase letter');
    if (!/[A-Z]/.test(pwd)) problems.push('At least one uppercase letter');
    if (!/[0-9]/.test(pwd)) problems.push('At least one number');
    if (!/[!@#$%^&*(),.?"':{}|<>]/.test(pwd)) problems.push('At least one special character');
    return problems;
  };

  const submitLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isSignup) {
        const errs = validatePassword(secret);
        setPasswordErrors(errs);
        if (errs.length > 0) {
          setError('Please fix password requirements');
          return;
        }
        const res = await withTimeout(
          auth.signUp({ email: email.trim(), password: secret, displayName: displayName || undefined }),
          20000
        );
        if (res.ok) {
          if ((res as any).autoSignedIn) {
            navigate('/hub');
            return;
          }
          setShowSuccess(true);
          setIsSignup(false);
          setError(null);
        } else if ((res as any).needsConfirmation) {
          setError((res as any).message || 'Please check your email to confirm your account.');
        } else {
          setError((res as any).message || 'Sign up failed');
        }
        return;
      }

      const cleanEmail = email.trim();
      const cleanSecret = secret.trim();
      const adminOk = await withTimeout(auth.login(cleanEmail, cleanSecret), 20000);
      if (adminOk) {
        navigate('/hub');
        return;
      }

      // Same login entry for staff: 4-digit PIN in the same secret field.
      if (/^\d{4}$/.test(cleanSecret)) {
        const staffRes = await withTimeout(auth.staffLogin(cleanEmail, cleanSecret), 20000);
        if (!staffRes.ok) {
          setError(staffRes.message || 'Invalid credentials');
          return;
        }
        if (staffRes.role === 'kitchen_staff') {
          navigate('/app/pos/kitchen');
          return;
        }
        if (staffRes.role === 'cashier') {
          navigate('/app/pos');
          return;
        }
        navigate('/hub');
        return;
      }

      setError('Invalid credentials');
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md neon-snake-border">
        <svg className="neon-snake-svg absolute inset-0 h-full w-full pointer-events-none" viewBox="0 0 400 420" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="neon-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(255,180,0,0.95)" />
              <stop offset="45%" stopColor="rgba(255,90,10,0.95)" />
              <stop offset="100%" stopColor="rgba(255,170,60,0.95)" />
            </linearGradient>
          </defs>
          <rect x="4" y="4" width="392" height="412" rx="24" ry="24" fill="none" stroke="url(#neon-gradient)" strokeWidth="4" className="neon-snake-rect" />
        </svg>

        <div className="relative z-10 rounded-3xl border border-orange-600/40 bg-black/80 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.75)]">
          {onClose && (
            <button className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-gray-100 transition hover:bg-white/20" onClick={onClose} aria-label="Close login">
              ✕
            </button>
          )}

          <form onSubmit={submitLogin} className="space-y-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white">Smart POS Access</h2>
                <p className="text-xs text-orange-200">One login entry for admin and under-brand staff.</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-3 py-1 text-[11px] font-medium text-orange-100">
                <UserCog className="h-3.5 w-3.5" />
                Unified mode
              </span>
            </div>

            <div className="pt-1 text-xs font-medium tracking-wide text-slate-500 uppercase">
              Email + password (admin) or email + 4-digit PIN (staff)
            </div>

            {showSuccess && (
              <div className="fixed inset-0 flex items-center justify-center z-[60]">
                <div className="absolute inset-0 bg-black/40" onClick={() => setShowSuccess(false)} />
                <div className="relative bg-white rounded-lg p-6 shadow-lg max-w-sm text-center">
                  <h3 className="text-lg font-semibold mb-2">Account created</h3>
                  <p className="mb-4">Your account was created successfully. Please sign in.</p>
                  <div className="flex justify-center">
                    <button type="button" className="px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-700 text-black font-semibold rounded-md shadow-lg" onClick={() => setShowSuccess(false)}>OK</button>
                  </div>
                </div>
              </div>
            )}

            {isSignup && (
              <div>
                <label className="block text-sm font-medium mb-1 text-orange-200">Full name</label>
                <input type="text" required className="w-full border border-orange-500/40 bg-[#111] text-white placeholder:text-orange-200/50 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1 text-orange-200">Email</label>
              <input type="email" required className="w-full border border-orange-500/40 bg-[#111] text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-orange-200">{isSignup ? 'Password' : 'Password or PIN'}</label>
              <input
                type="password"
                required
                className="w-full border border-orange-500/40 bg-[#111] text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500"
                value={secret}
                onChange={(e) => {
                  setSecret(e.target.value);
                  if (isSignup) setPasswordErrors(validatePassword(e.target.value));
                }}
                placeholder={isSignup ? 'Choose a strong password' : 'Password or 4-digit PIN'}
              />
              {isSignup && secret && (
                <div className="mt-2 text-sm">
                  {passwordErrors.length === 0 ? (
                    <div className="text-green-600">Password looks good</div>
                  ) : (
                    <ul className="text-red-600 list-disc list-inside">
                      {passwordErrors.map((p) => <li key={p}>{p}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}
            <div className="flex justify-end">
              <button type="submit" disabled={busy || (isSignup && passwordErrors.length > 0)} className="px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-700 text-black font-semibold rounded-md shadow-lg hover:brightness-110 disabled:opacity-50">
                {busy ? (isSignup ? 'Creating...' : 'Signing...') : (isSignup ? 'Create account' : 'Sign in')}
              </button>
            </div>

            <div className="mt-3 text-sm text-center">
              {isSignup ? (
                <>
                  <span>Already have an account? </span>
                  <button type="button" onClick={() => setIsSignup(false)} className="text-orange-300 underline">Sign in</button>
                </>
              ) : (
                <>
                  <span>Need an account? </span>
                  <button type="button" onClick={() => setIsSignup(true)} className="text-orange-300 underline">Create one</button>
                </>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

