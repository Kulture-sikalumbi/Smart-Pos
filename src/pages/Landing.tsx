import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import LoginOverlay from '@/components/common/LoginOverlay';

export default function Landing() {
  const { user, brand, loading } = useAuth();
  const navigate = useNavigate();
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (user) {
        if (!brand) {
          navigate('/app/company-settings');
        } else {
          navigate('/app/pos');
        }
      }
    }
  }, [user, brand, loading, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 via-gray-900 to-black text-white">
        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-primary/60 border-opacity-30" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-gray-900 to-black text-white px-4">
      <div className="text-center max-w-2xl">
        <h1 className="text-6xl font-extrabold mb-6 leading-tight">
          Profit Maker
        </h1>
        <p className="mb-8 text-xl text-gray-300">
          Powerful, modern point‑of‑sale built on a database-first platform. Get up and
          running in minutes, manage inventory, staff and sales with confidence.
        </p>
        <button
          className="inline-block px-10 py-4 bg-primary hover:bg-primary-dark rounded-lg text-white font-semibold shadow-lg transition-colors duration-200"
          onClick={() => setShowLogin(true)}
        >
          Get Started
        </button>
      </div>

      {showLogin && <LoginOverlay onClose={() => setShowLogin(false)} />}
    </div>
  );
}
