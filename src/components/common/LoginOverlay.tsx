import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useBranding } from '@/contexts/BrandingContext';

interface LoginOverlayProps {
  onClose?: () => void;
}

export default function LoginOverlay({ onClose }: LoginOverlayProps) {
  const auth = useAuth();
  const navigate = useNavigate();
  const { brandExists } = useBranding();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSignup, setIsSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);

  const googleSignIn = async () => {
    setError(null);
    setBusy(true);
    try {
      await auth.signInWithGoogle();
    } catch (err: any) {
      setError(err?.message || 'Google sign in failed');
      setBusy(false);
    }
  };

  const submitLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isSignup) {
        // validate password before calling signup
        const errs = validatePassword(password);
        setPasswordErrors(errs);
        if (errs.length > 0) {
          setError('Please fix password requirements');
          setBusy(false);
          return;
        }
        const res = await auth.signUp({ email: email.trim(), password, displayName: displayName || undefined });
        setBusy(false);
        if (res.ok) {
          if (!brandExists) navigate('/app/company-settings');
          else navigate('/app');
        } else if (res.needsConfirmation) {
          setError(res.message || 'Please check your email to confirm your account.');
        } else {
          setError(res.message || 'Sign up failed');
        }
      } else {
        const ok = await auth.login(email.trim(), password);
      setBusy(false);
      if (ok) {
        if (!brandExists) navigate('/app/company-settings');
        else navigate('/app');
      } else {
        setError('Invalid credentials');
      }
      }
    } catch (err: any) {
      setError(err?.message || 'Login failed');
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
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white text-black rounded-lg shadow-lg p-6">
        {onClose && (
          <button
            className="absolute top-4 right-4 text-gray-500 hover:text-gray-800"
            onClick={onClose}
          >
            ✕
          </button>
        )}
        <form onSubmit={submitLogin} className="space-y-4">
            <button
              type="button"
              onClick={googleSignIn}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 border rounded hover:bg-gray-100"
            >
              <svg className="w-5 h-5" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M43.6 20.4H42V20H24v8h11.3C33.6 32.1 29.2 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.8 3.1l5.5-5.5C34.9 6.1 29.8 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 20-8.9 20-20 0-1.3-.1-2.6-.4-3.6z" fill="#EA4335"/>
                <path d="M6.3 14.7l6.6 4.8C14.6 16.1 18.9 13 24 13c3.1 0 5.8 1.2 7.8 3.1l5.5-5.5C34.9 6.1 29.8 4 24 4 16 4 9.2 8.7 6.3 14.7z" fill="#FBBC05"/>
                <path d="M24 44c5.2 0 9.6-1.9 13-5.1l-6.2-5c-2 1.9-4.7 3.1-7.8 3.1-5.2 0-9.6-3-11.1-7.2l-6.7 5.1C8.9 38.9 16 44 24 44z" fill="#34A853"/>
                <path d="M43.6 20.4H42V20H24v8h11.3c-1.1 3.2-3.4 5.8-6.3 7.4l-.1.1 6.2 5C39.8 36.8 44 30.9 44 24c0-1.3-.1-2.6-.4-3.6z" fill="#4285F4"/>
              </svg>
              Continue with Google
            </button>
            <div className="text-center text-sm text-gray-500">or continue with email</div>
            <div>
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
            {error && <div className="text-sm text-red-600">{error}</div>}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busy || (isSignup && passwordErrors.length > 0)}
                className="px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark disabled:opacity-50"
              >
                {busy ? (isSignup ? 'Creating…' : 'Signing…') : (isSignup ? 'Create account' : 'Sign in')}
              </button>
            </div>
            <div className="mt-3 text-sm text-center">
              {isSignup ? (
                <>
                  <span>Already have an account? </span>
                  <button onClick={() => setIsSignup(false)} className="text-primary underline">Sign in</button>
                </>
              ) : (
                <>
                  <span>Need an account? </span>
                  <button onClick={() => setIsSignup(true)} className="text-primary underline">Create one</button>
                </>
              )}
            </div>
          </form>
      </div>
    </div>
  );
}
