// Typed Vite env variables (vite/client is loaded through tsconfig "types").
interface ImportMetaEnv {
  /** Supabase project URL, e.g. https://<project-ref>.supabase.co. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase PUBLISHABLE key (sb_publishable_...). Never a secret or service-role key. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Saved-library API base URL, e.g. https://api.example.com (http only for localhost). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
