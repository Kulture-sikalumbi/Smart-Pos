import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ShieldCheck, Wifi, UtensilsCrossed } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getDefaultAppRouteForRole } from '@/types/auth';

export default function Landing() {
  const { user, brand, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const auth = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [secret, setSecret] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const isNativeApp = typeof window !== 'undefined' && Boolean((window as any).electron);

  const trustHighlights = [
    { icon: Wifi, text: 'Realtime + offline-safe workflows' },
    { icon: UtensilsCrossed, text: 'POS, kitchen, tables in one flow' },
    { icon: ShieldCheck, text: 'Role-based control and audit trails' },
  ];

  const validatePassword = (pwd: string) => {
    const errors: string[] = [];
    if (pwd.length < 8) errors.push('8+ chars');
    if (!/[a-z]/.test(pwd)) errors.push('lowercase');
    if (!/[A-Z]/.test(pwd)) errors.push('uppercase');
    if (!/[0-9]/.test(pwd)) errors.push('number');
    return errors;
  };

  const submitLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setLoginError(null);
    setBusy(true);
    try {
      const cleanEmail = email.trim();
      const cleanSecret = secret.trim();
      if (isRegister) {
        const issues = validatePassword(cleanSecret);
        if (issues.length > 0) {
          setLoginError(`Password must include: ${issues.join(', ')}`);
          return;
        }
        const signUpRes = await auth.signUp({
          email: cleanEmail,
          password: cleanSecret,
          displayName: displayName.trim() || undefined,
        });
        if (!signUpRes.ok) {
          setLoginError((signUpRes as any)?.message || 'Registration failed');
          return;
        }
        setIsRegister(false);
        setLoginError('Registration successful. Please sign in.');
        return;
      }
      const adminOk = await auth.login(cleanEmail, cleanSecret);
      if (adminOk) {
        navigate('/hub', { replace: true });
        return;
      }

      if (/^\d{4}$/.test(cleanSecret)) {
        const staffRes = await auth.staffLogin(cleanEmail, cleanSecret);
        if (!staffRes.ok) {
          setLoginError(staffRes.message || 'Invalid credentials');
          return;
        }
        navigate(getDefaultAppRouteForRole(staffRes.role), { replace: true });
        return;
      }

      setLoginError('Invalid credentials');
    } catch (err: any) {
      setLoginError(err?.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const token = String(searchParams.get('tabletEnrollToken') ?? '').trim();
    const session = String(searchParams.get('tabletEnrollSession') ?? '').trim();
    if (token) {
      navigate(`/tablet-enroll?token=${encodeURIComponent(token)}`, { replace: true });
      return;
    }
    if (session) {
      navigate(`/tablet-enroll?session=${encodeURIComponent(session)}`, { replace: true });
      return;
    }
  }, [searchParams, navigate]);

  useEffect(() => {
    if (!loading && user) {
      if (!brand) navigate('/app/company-settings');
      else navigate(getDefaultAppRouteForRole(user.role));
    }
  }, [user, brand, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-primary/60" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_18%_20%,#14213d_0%,#090f1d_42%,#04070f_100%)] text-white">
      <div className="pointer-events-none absolute inset-y-0 left-[42%] w-[60%] bg-gradient-to-r from-cyan-500/10 via-sky-500/8 to-transparent blur-3xl" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:38px_38px]" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-10 px-5 py-12 lg:flex-row lg:items-center lg:justify-between lg:px-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="w-full max-w-2xl"
        >
          <p className="text-xs tracking-[0.26em] text-cyan-200 uppercase">Modern restaurant POS</p>
          <p className="mt-2 text-sm font-semibold text-cyan-100">Profit-Maker POS</p>
          <h1 className="mt-4 text-4xl font-black leading-tight sm:text-6xl">
            Point of sale that feels built for service speed.
          </h1>
          <p className="mt-5 max-w-xl text-base text-slate-200 sm:text-lg">
            Run orders, kitchen tickets, table workflows, stock, and shifts from one clean system designed for real restaurant pressure.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button
              className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-7 py-3 text-sm font-bold uppercase tracking-wide text-slate-950 shadow-[0_0_30px_rgba(34,211,238,0.25)] transition hover:bg-cyan-300"
              onClick={() => setShowLogin(true)}
            >
              Get Started <ChevronRight className="h-4 w-4" />
            </button>
            {!isNativeApp ? (
              <a
                href="https://github.com/Kulture-sikalumbi/Smart-Pos/releases/latest/download/ProfitMakerPOS-0.0.5-win32-x64.exe"
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white/90 transition hover:bg-white/10"
              >
                Download Desktop App
              </a>
            ) : null}
          </div>

          <div className="mt-8 grid gap-2 sm:max-w-xl">
            {trustHighlights.map((item, idx) => (
              <motion.div
                key={item.text}
                initial={{ opacity: 0, x: -18 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + idx * 0.08, duration: 0.35 }}
                className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100"
              >
                <item.icon className="h-4 w-4 text-cyan-300" />
                <span>{item.text}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <div className="hidden lg:block w-full max-w-lg lg:max-w-xl">
          <AnimatePresence initial={false}>
            {showLogin ? (
              <motion.div
                key="login-panel"
                initial={{ opacity: 0, x: 60, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
                className="rounded-3xl border border-cyan-400/30 bg-slate-950/70 p-6 shadow-[0_18px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl"
              >
                <div className="mb-4">
                  <h2 className="text-lg font-bold">{isRegister ? 'Register Account' : 'POS Login'}</h2>
                  <p className="text-xs text-slate-300">
                    {isRegister ? 'Create owner/admin account to start setup.' : 'Admin: email + password | Staff: email + 4-digit PIN'}
                  </p>
                </div>
                <form onSubmit={submitLogin} className="space-y-4">
                  {isRegister ? (
                    <div>
                      <label className="mb-1 block text-xs text-slate-300">Name</label>
                      <input
                        type="text"
                        required
                        className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                      />
                    </div>
                  ) : null}
                  <div>
                    <label className="mb-1 block text-xs text-slate-300">Email</label>
                    <input
                      type="email"
                      required
                      className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="username"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-300">{isRegister ? 'Password' : 'Password or PIN'}</label>
                    <input
                      type="password"
                      required
                      className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      autoComplete={isRegister ? 'new-password' : 'current-password'}
                    />
                  </div>
                  {loginError ? <div className="text-sm text-rose-300">{loginError}</div> : null}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      className="text-xs text-slate-300 underline underline-offset-2 hover:text-white"
                      onClick={() => setShowLogin(false)}
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-full bg-cyan-400 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60"
                    >
                      {busy ? (isRegister ? 'Registering...' : 'Signing in...') : (isRegister ? 'Register' : 'Sign in')}
                    </button>
                  </div>
                  <div className="text-xs text-slate-300">
                    {isRegister ? (
                      <button type="button" className="underline" onClick={() => setIsRegister(false)}>Already have an account? Sign in</button>
                    ) : (
                      <button type="button" className="underline" onClick={() => setIsRegister(true)}>Need an account? Register</button>
                    )}
                  </div>
                </form>
              </motion.div>
            ) : (
              <motion.div
                key="teaser-panel"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                className="rounded-3xl border border-white/15 bg-white/5 p-6 backdrop-blur-md"
              >
                <div className="text-sm text-slate-100">
                  <div className="text-cyan-200 text-xs uppercase tracking-[0.2em]">Ready to operate</div>
                  <div className="mt-2 text-2xl font-bold">Tap Get Started</div>
                  <p className="mt-2 text-slate-300">
                    Your POS login will slide in here for quick shift access.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {showLogin ? (
          <motion.div
            className="lg:hidden fixed inset-0 z-50 flex items-start justify-center p-4 pt-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowLogin(false)} />
            <motion.div
              initial={{ y: -24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -12, opacity: 0 }}
              className="relative z-10 w-full max-w-md rounded-2xl border border-cyan-400/30 bg-slate-950/90 p-5"
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-bold">{isRegister ? 'Register Account' : 'POS Login'}</h2>
                <button className="text-sm text-slate-300" onClick={() => setShowLogin(false)}>Close</button>
              </div>
              <form onSubmit={submitLogin} className="space-y-3">
                {isRegister ? (
                  <input type="text" required placeholder="Name" className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                ) : null}
                <input type="email" required placeholder="Email" className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} />
                <input type="password" required placeholder={isRegister ? 'Password' : 'Password or PIN'} className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm" value={secret} onChange={(e) => setSecret(e.target.value)} />
                {loginError ? <div className="text-xs text-rose-300">{loginError}</div> : null}
                <div className="flex items-center justify-between">
                  <button type="button" className="text-xs underline text-slate-300" onClick={() => setIsRegister((v) => !v)}>
                    {isRegister ? 'Have account? Sign in' : 'Need account? Register'}
                  </button>
                  <button type="submit" disabled={busy} className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950">
                    {busy ? (isRegister ? 'Registering...' : 'Signing...') : (isRegister ? 'Register' : 'Sign in')}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
