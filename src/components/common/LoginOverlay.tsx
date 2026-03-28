import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { UserCog, UserCircle2 } from 'lucide-react';

interface LoginOverlayProps {
  onClose?: () => void;
}

export default function LoginOverlay({ onClose }: LoginOverlayProps) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'admin' | 'staff'>('admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSignup, setIsSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);

  const withTimeout = async <T,>(p: Promise<T>, ms = 15000): Promise<T> => {
    let timer: any;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error('Request timed out. Please try again.')), ms);
    });
    try {
      return (await Promise.race([p, timeout])) as T;
    } finally {
      clearTimeout(timer);
    }
  };

  const submitLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Staff login is separate from Supabase Auth (admins)
      if (mode === 'staff') {
        const cleanEmail = email.trim();
        const cleanPin = pin.trim();

        if (!cleanEmail) {
          setError('Enter your staff email.');
          return;
        }
        if (!/^\d{4}$/.test(cleanPin)) {
          setError('Enter your 4-digit PIN.');
          return;
        }

        const res = await withTimeout(auth.staffLogin(cleanEmail, cleanPin), 20000);
        if (!res.ok) {
          setError(
            res.message ||
              'Your details did not match any brand staff. Ensure you belong to a brand and your admin has added you.'
          );
          return;
        }

        const role = res.role;
        if (role === 'kitchen_staff') {
          navigate('/app/pos/kitchen');
          return;
        }

        if (role === 'cashier') {
          navigate('/app/pos');
          return;
        }

        navigate('/app/pos/terminal');
        return;
      }

      if (isSignup) {
        // validate password before calling signup
        const errs = validatePassword(password);
        setPasswordErrors(errs);
        if (errs.length > 0) {
          setError('Please fix password requirements');
          return;
        }
        const res = await withTimeout(
          auth.signUp({ email: email.trim(), password, displayName: displayName || undefined }),
          20000
        );
        if (res.ok) {
          // If we were able to auto-sign-in on the backend, proceed into the app.
          if ((res as any).autoSignedIn) {
            navigate('/app');
            return;
          }

          // Show success feedback and switch to login form so user can sign in.
          setShowSuccess(true);
          setIsSignup(false);
          setError(null);
        } else if (res.needsConfirmation) {
          setError(res.message || 'Please check your email to confirm your account.');
        } else {
          setError(res.message || 'Sign up failed');
        }
      } else {
        const ok = await withTimeout(auth.login(email.trim(), password), 20000);
        if (ok) {
          navigate('/app');
        } else {
          setError('Invalid credentials');
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setBusy(false);
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

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50">
      <div className="absolute inset-0 bg-slate-900/70" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white text-black rounded-2xl shadow-2xl p-6 border border-slate-200">
        {onClose && (
          <button
            className="absolute top-4 right-4 text-gray-500 hover:text-gray-800"
            onClick={onClose}
          >
            ✕
          </button>
        )}
        <form onSubmit={submitLogin} className="space-y-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Smart POS Login</h2>
                <p className="text-xs text-slate-500">
                  {mode === 'admin'
                    ? 'Sign in as an owner or manager to access the back office.'
                    : 'Staff use email and PIN to jump straight into the till.'}
                </p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-700">
                {mode === 'admin' ? <UserCog className="h-3.5 w-3.5" /> : <UserCircle2 className="h-3.5 w-3.5" />}
                {mode === 'admin' ? 'Admin mode' : 'Staff mode'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <button
                type="button"
                onClick={() => {
                  setMode('admin');
                  setError(null);
                }}
                disabled={busy}
                className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 font-medium transition-colors ${
                  mode === 'admin'
                    ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                    : 'bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <UserCog className="h-4 w-4" />
                Admin Login
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('staff');
                  setIsSignup(false);
                  setPassword('');
                  setPasswordErrors([]);
                  setDisplayName('');
                  setError(null);
                }}
                disabled={busy}
                className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 font-medium transition-colors ${
                  mode === 'staff'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                    : 'bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <UserCircle2 className="h-4 w-4" />
                Staff POS Login
              </button>
            </div>

            {mode === 'staff' && (
              <div className="rounded-lg border bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                Use the staff email and 4-digit PIN set by your admin. If your details don’t match, ask the admin to add you to their brand.
              </div>
            )}
            <div className="pt-1 text-xs font-medium tracking-wide text-slate-500 uppercase">
              {mode === 'admin' ? 'Admin email & password' : 'Staff email & 4‑digit PIN'}
            </div>
            <div>
            {/* Simple success modal shown when account is created but not auto-logged-in */}
            {showSuccess && (
              <div className="fixed inset-0 flex items-center justify-center z-[60]">
                <div className="absolute inset-0 bg-black/40" onClick={() => setShowSuccess(false)} />
                <div className="relative bg-white rounded-lg p-6 shadow-lg max-w-sm text-center">
                  <h3 className="text-lg font-semibold mb-2">Account created</h3>
                  <p className="mb-4">Your account was created successfully. Please sign in.</p>
                  <div className="flex justify-center">
                    <button type="button" className="px-4 py-2 bg-primary text-white rounded" onClick={() => setShowSuccess(false)}>OK</button>
                  </div>
                </div>
              </div>
            )}
              {isSignup && (
                <div>
                  <label className="block text-sm font-medium mb-1">Full name</label>
                  <input
                    type="text"
                    required
                    className="w-full border rounded px-3 py-2"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
              )}
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                required
                className="w-full border rounded px-3 py-2"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {mode === 'admin' ? (
              <div>
                <label className="block text-sm font-medium mb-1 text-black">Password</label>
                <input
                  type="password"
                  required
                  className="w-full border rounded px-3 py-2 text-black"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (isSignup) setPasswordErrors(validatePassword(e.target.value));
                  }}
                />
                {isSignup && password && (
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
            ) : (
              <div>
                <label className="block text-sm font-medium mb-1 text-black">PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  required
                  className="w-full border rounded px-3 py-2 text-black"
                  value={pin}
                  onChange={(e) => {
                    const next = (e.target.value ?? '').replace(/\D/g, '').slice(0, 4);
                    setPin(next);
                  }}
                  placeholder="4 digits"
                />
              </div>
            )}
            {error && <div className="text-sm text-red-600">{error}</div>}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busy || (isSignup && passwordErrors.length > 0)}
                className="px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark disabled:opacity-50"
              >
                {busy
                  ? (mode === 'admin' ? (isSignup ? 'Creating…' : 'Signing…') : 'Signing…')
                  : (mode === 'admin' ? (isSignup ? 'Create account' : 'Sign in') : 'Sign in')}
              </button>
            </div>
            <div className="mt-3 text-sm text-center">
              {mode === 'admin' && isSignup ? (
                <>
                  <span>Already have an account? </span>
                  <button type="button" onClick={() => setIsSignup(false)} className="text-primary underline">Sign in</button>
                </>
              ) : mode === 'admin' ? (
                <>
                  <span>Need an account? </span>
                  <button type="button" onClick={() => setIsSignup(true)} className="text-primary underline">Create one</button>
                </>
              ) : (
                <>
                  <span className="text-gray-600">Staff can’t create accounts here. </span>
                  <span className="text-gray-600">Ask your admin to add you.</span>
                </>
              )}
            </div>
          </form>
      </div>
    </div>
  );
}
