// Vela: delete my account.
// Called by a signed-in user from Settings. Deletes everything stored for that user (records, settings,
// profile, receipt photos, avatar) and then the login itself. Uses the service role key that Supabase
// provides to Edge Functions; the user is identified only from their own access token.
//
// Deploy:  npx supabase functions deploy delete-account --project-ref <your project ref>
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Removes every file under "<userId>/" in a bucket (folders are listed page by page).
async function emptyFolder(admin: ReturnType<typeof createClient>, bucket: string, userId: string) {
  for (let round = 0; round < 50; round++) {
    const { data, error } = await admin.storage.from(bucket).list(userId, { limit: 100 });
    if (error || !data || !data.length) return;
    const paths = data.map((f) => `${userId}/${f.name}`);
    const { error: rmErr } = await admin.storage.from(bucket).remove(paths);
    if (rmErr) return;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "not_configured" }, 500);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "not_signed_in" }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  const userId = who?.user?.id;
  if (whoErr || !userId) return json({ error: "not_signed_in" }, 401);

  // Data first, then the login (so a failure never leaves data without an owner who can delete it).
  const steps: Array<[string, () => Promise<unknown>]> = [
    ["records", () => admin.from("vela_records").delete().eq("user_id", userId)],
    ["settings", () => admin.from("vela_settings").delete().eq("user_id", userId)],
    ["profile", () => admin.from("profiles").delete().eq("id", userId)],
    ["receipts", () => emptyFolder(admin, "receipts", userId)],
    ["avatars", () => emptyFolder(admin, "avatars", userId)],
  ];
  for (const [name, run] of steps) {
    try {
      const res = (await run()) as { error?: { message?: string } } | undefined;
      if (res && res.error && !/does not exist|not found/i.test(res.error.message || "")) {
        return json({ error: "delete_failed", step: name }, 500);
      }
    } catch (_e) {
      // A missing table or bucket isn't a reason to stop.
    }
  }
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) return json({ error: "delete_failed", step: "login" }, 500);
  return json({ ok: true });
});
