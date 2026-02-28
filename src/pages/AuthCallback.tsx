import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';

export default function AuthCallback() {
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // parse & set session if present in fragment
        try {
          if (supabase && window.location.hash && window.location.hash.includes('access_token')) {
            const params = new URLSearchParams(window.location.hash.substring(1));
            const access_token = params.get('access_token');
            const refresh_token = params.get('refresh_token');
            if (access_token) {
              // @ts-ignore
              await supabase.auth.setSession({ access_token, refresh_token });
              console.debug('AuthCallback: setSession from hash');
            }
          } else if (supabase && (supabase.auth as any).getSessionFromUrl) {
            // fallback helper
            // @ts-ignore
            await supabase.auth.getSessionFromUrl();
            console.debug('AuthCallback: getSessionFromUrl used');
          }
        } catch (err) {
          console.error('AuthCallback: session parse error', err);
        }

        // refresh auth context state
        try {
          await refreshProfile();
        } catch {}

        // now query staff to decide where to send user
        const { data: sess } = await supabase.auth.getSession();
        const supaUser = sess?.user;
        if (!supaUser) {
          if (mounted) navigate('/', { replace: true });
          return;
        }

        const { data: staffRow, error: staffErr } = await supabase
          .from('staff')
          .select('user_id,brand_id,role')
          .eq('user_id', supaUser.id)
          .maybeSingle();

        let target = '/app';
        if (staffErr || !staffRow) {
          target = '/app';
        } else if ((staffRow.role === 'owner' || staffRow.role === 'owner') && !staffRow.brand_id) {
          target = '/app/company-settings';
        } else if (staffRow.brand_id) {
          target = '/app';
        }

        if (mounted) navigate(target, { replace: true });
      } catch (err) {
        if (mounted) navigate('/', { replace: true });
      }
    })();

    return () => { mounted = false; };
  }, [navigate, refreshProfile]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-primary/60 border-opacity-30 mx-auto" />
        <p className="mt-4">Completing sign in…</p>
      </div>
    </div>
  );
}
