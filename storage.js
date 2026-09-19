import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    "Supabase env vars are missing. Copy .env.example to .env and fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (see README.md)."
  );
}

export const supabase = url && anonKey ? createClient(url, anonKey) : null;

const TABLE = "kv_store";

// Mirrors the window.storage API the component was originally built against:
// get/set/delete all take (key, shared) but `shared` is ignored here since
// every row in this table is globally shared by design (no per-user auth).
export const storage = {
  async get(key) {
    if (!supabase) return null;
    const { data, error } = await supabase.from(TABLE).select("value").eq("key", key).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { key, value: data.value, shared: true };
  },

  async set(key, value) {
    if (!supabase) return null;
    const { error } = await supabase.from(TABLE).upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
    return { key, value, shared: true };
  },

  async delete(key) {
    if (!supabase) return null;
    const { error } = await supabase.from(TABLE).delete().eq("key", key);
    if (error) throw error;
    return { key, deleted: true, shared: true };
  },
};

// Subscribes to live changes for a single key so every viewer's screen
// updates automatically when someone else scores a ball. Returns an
// unsubscribe function.
export function subscribeToKey(key, onChange) {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`kv-${key}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: TABLE, filter: `key=eq.${key}` },
      (payload) => {
        if (payload.eventType === "DELETE") {
          onChange(null, true);
          return;
        }
        const value = payload.new && payload.new.value ? payload.new.value : null;
        onChange(value, false);
      }
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}
