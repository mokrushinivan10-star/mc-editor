import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";

export const supabase =
  url.startsWith("https://") && anonKey.length > 0
    ? createClient(url, anonKey)
    : null;
