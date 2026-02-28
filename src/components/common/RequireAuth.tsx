import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { useBranding } from '@/contexts/BrandingContext';

export default function RequireAuth({ children }: { children?: React.ReactNode }) {
  const { user } = useAuth();
  const { brandExists } = useBranding();
  const navigate = useNavigate();
  const location = useLocation();

  React.useEffect(() => {
    // If brand exists but user not authenticated, redirect to landing
    if (brandExists && !user && location.pathname !== '/landing' && location.pathname !== '/company-settings') {
      navigate('/landing', { replace: true });
    }
  }, [brandExists, user, navigate, location]);

  // While redirecting, avoid rendering children; simple guard allows page to render when conditions satisfied
  if (!brandExists) return null;
  if (!user) return null;

  return <>{children}</>;
}
