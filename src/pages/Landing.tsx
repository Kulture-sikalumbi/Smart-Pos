import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import LoginOverlay from '@/components/common/LoginOverlay';

import landing3 from '../../assets/landing3.png';
import landing4 from '../../assets/landing4.png';
import landing6 from '../../assets/landing6.png';

const heroSlides = [
  landing3,
  landing4,
  landing6,
];

export default function Landing() {
  const { user, brand, loading } = useAuth();
  const navigate = useNavigate();
  const [showLogin, setShowLogin] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const isNativeApp = typeof window !== 'undefined' && Boolean((window as any).electron);

  const tipMessages = [
    "Pro Tip: Use quick categories to speed order entry during peak hours.",
    "Pro Tip: Shift reports are clearer if you close shifts before day end.",
    "Pro Tip: Inventory alerts prevent stockouts—review nightly.",
    "Pro Tip: Enable offline sync so orders continue even if connectivity drops.",
  ];
  const [tipIndex, setTipIndex] = useState(0);

  const getDefaultAppRouteForRole = (role: string | undefined) => {
    if (role === 'kitchen_staff') return '/app/pos/kitchen';
    if (role === 'waitron' || role === 'bar_staff') return '/app/pos/terminal';
    return '/app/pos';
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTipIndex((prev) => (prev + 1) % tipMessages.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!loading && user) {
      if (!brand) navigate('/app/company-settings');
      else navigate(getDefaultAppRouteForRole(user.role));
    }
  }, [user, brand, loading, navigate]);

  useEffect(() => {
    const timer = setInterval(() => setSlideIndex((s) => (s + 1) % heroSlides.length), 7000);
    return () => clearInterval(timer);
  }, []);

  const backgroundImage = useMemo(() => `url(${heroSlides[slideIndex]})`, [slideIndex]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white"> 
        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-primary/60" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center transition-all duration-1000"
        style={{ backgroundImage }}
      />
      <div className="absolute inset-0 bg-black/25 backdrop-blur-none" />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 py-16 text-white">
        <div className="w-full max-w-3xl rounded-3xl border border-white/10 bg-black/40 p-10 shadow-2xl backdrop-blur-lg">
          <div className="flex flex-col gap-6 text-center">
            <p className="text-xs tracking-widest text-amber-200 uppercase">Restaurant POS for modern kitchens</p>
            <h1 className="text-4xl sm:text-6xl font-black leading-tight">Profit Maker for Restaurants</h1>
            <p className="text-base sm:text-xl text-gray-200">Streamline orders, inventory and tables with one powerful terminal. Offline-capable, data-driven and built strong for fast service.</p>

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                className="rounded-lg bg-white px-8 py-3 text-sm font-semibold uppercase tracking-wide text-black shadow-2xl transition hover:bg-gray-100"
                onClick={() => setShowLogin(true)}
              >
                Get Started
              </button>

              {!isNativeApp && (
                <a
                  href="https://github.com/Kulture-sikalumbi/Smart-Pos/releases/latest/download/ProfitMakerPOS-0.0.3-win32-x64.exe"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-white px-8 py-3 text-sm font-semibold text-black shadow-lg transition hover:bg-gray-100"
                >
                  Download Desktop App
                </a>
              )}
            </div>

            <div className="mx-auto mt-5 max-w-xl rounded-xl border border-white/10 bg-white/10 p-4 text-sm text-gray-100">
              <div className="flex items-center justify-between gap-2">
                <strong className="font-semibold">Quick Tip</strong>
                <span className="text-xs uppercase tracking-wider text-amber-200">{tipIndex + 1}/{tipMessages.length}</span>
              </div>
              <p className="mt-1">{tipMessages[tipIndex]}</p>
            </div>
          </div>
        </div>
      </div>

      {showLogin && <LoginOverlay onClose={() => setShowLogin(false)} />}
    </div>
  );
}
