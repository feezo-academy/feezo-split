// Supabase client setup + auth helpers (was an inline <script type="module">)
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

  // ── YOUR SUPABASE CONFIG (anon key is public — RLS protects the data) ──
  const SUPABASE_URL = 'https://bwrvhrxfacoiheetistl.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_3FY3aWZ4mScvAsThTGOzlA_PQNzOWeB';
  

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'sac_supabase_auth'
    }
  });

  // Expose to global scope so non-module scripts can use it
  window._sb = supabase;

  // Auth helpers — mirror the old Firebase function names so the rest of the app keeps working
  window._sbSignIn = (email, password, captchaToken) =>
    supabase.auth.signInWithPassword({ email, password, options: captchaToken ? { captchaToken } : {} });
  window._sbSignOut = () => supabase.auth.signOut();
  window._onAuthStateChanged = (cb) => {
    supabase.auth.getSession().then(({ data }) => cb(data.session ? data.session.user : null));
    supabase.auth.onAuthStateChange((_event, session) => cb(session ? session.user : null));
  };
  window._sbCurrentUser = async () => {
    const { data } = await supabase.auth.getUser();
    return data ? data.user : null;
  };
