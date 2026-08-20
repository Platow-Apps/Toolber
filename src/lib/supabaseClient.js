import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** True when the app has no Supabase configuration to talk to. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const MISSING_CONFIG_MESSAGE =
  'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your Supabase project values, then restart the dev server.'

// createClient throws "supabaseUrl is required" on undefined input, which used
// to blank the whole app with the real explanation buried in a console.warn.
// Hand back a client-shaped object that rejects every call with the actionable
// message instead, so ConfigError can render it and nothing crashes on import.
function unconfiguredClient() {
  const fail = () => Promise.reject(new Error(MISSING_CONFIG_MESSAGE))
  const builder = {
    select: () => builder,
    insert: () => builder,
    update: () => builder,
    delete: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    textSearch: () => builder,
    single: fail,
    maybeSingle: fail,
    // biome-ignore lint/suspicious/noThenProperty: the supabase-js query builder is a thenable, and this stub has to match it
    then: (resolve) => Promise.resolve({ data: null, error: { message: MISSING_CONFIG_MESSAGE } }).then(resolve),
  }
  return {
    from: () => builder,
    rpc: () => Promise.resolve({ data: null, error: { message: MISSING_CONFIG_MESSAGE } }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signUp: fail,
      signInWithPassword: fail,
      signOut: () => Promise.resolve({ error: null }),
    },
  }
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : unconfiguredClient()
