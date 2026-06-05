import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, { auth: { persistSession: false } })
    : null;

export type SettingKey =
  | "facebook_token"
  | "facebook_ad_account_id"
  | "facebook_ad_account_name"
  | "app_name"
  | "timezone"
  | "currency"
  | "fx_mode"
  | "fx_manual_rate"
  | "last_fb_sync";

const memoryStore = new Map<string, string>();

export async function getSetting(key: SettingKey): Promise<string | null> {
  if (!supabase) {
    if (typeof window !== "undefined") {
      return window.localStorage.getItem(`settings:${key}`);
    }
    return memoryStore.get(key) ?? null;
  }
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) return null;
  return (data?.value as string) ?? null;
}

export async function setSetting(key: SettingKey, value: string | null): Promise<void> {
  if (!supabase) {
    if (typeof window !== "undefined") {
      if (value === null) window.localStorage.removeItem(`settings:${key}`);
      else window.localStorage.setItem(`settings:${key}`, value);
    } else {
      if (value === null) memoryStore.delete(key);
      else memoryStore.set(key, value);
    }
    return;
  }
  if (value === null) {
    await supabase.from("settings").delete().eq("key", key);
    return;
  }
  await supabase.from("settings").upsert({ key, value }, { onConflict: "key" });
}
