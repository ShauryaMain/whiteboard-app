// Where a teacher's settings and graph presets are kept with their account.
//
// They used to live inside the sign-in itself (the account's "metadata"),
// which travels with every single request the app makes. Now they have a
// table of their own (user_settings, see supabase/2026-10-18-speed-and-
// privacy.sql). The first time something is saved there, the old copy is
// cleared from the sign-in. Until the table exists, the old place is used.
//
//   readAccount(client, user)  -> { settings, graphPresets } or null (couldn't ask)
//   writeAccount(client, user, { settings } | { graphPresets })  -> true / false

const TABLE = "user_settings";
let noTable = false;

function isMissingTable(error) {
  const code = String((error && error.code) || "");
  return code === "42P01" || code === "PGRST205" || code === "PGRST204" || /relation .* does not exist|could not find the table/i.test((error && error.message) || "");
}

const metaOf = (user) => (user && user.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {});

export async function readAccount(client, user) {
  if (!client || !user) return null;
  const meta = metaOf(user);
  if (!noTable && typeof client.from === "function") {
    try {
      const { data, error } = await client.from(TABLE).select("settings, graph_presets").eq("user_id", user.id).maybeSingle();
      if (!error) {
        // (anything not moved over yet is still in the old place)
        return {
          settings: (data && data.settings) || meta.settings || null,
          graphPresets: (data && data.graph_presets) || meta.graphPresets || null,
        };
      }
      if (isMissingTable(error)) noTable = true;
      else return null;
    } catch (err) {
      return null;
    }
  }
  return { settings: meta.settings || null, graphPresets: meta.graphPresets || null };
}

export async function writeAccount(client, user, patch) {
  if (!client || !user || !patch) return false;
  if (!noTable && typeof client.from === "function") {
    const row = { user_id: user.id };
    if ("settings" in patch) row.settings = patch.settings;
    if ("graphPresets" in patch) row.graph_presets = patch.graphPresets;
    try {
      const { error } = await client.from(TABLE).upsert(row);
      if (!error) {
        // The copy in the sign-in isn't needed any more: dropping it makes
        // every request the app sends a little smaller.
        const meta = metaOf(user);
        const clear = {};
        if ("settings" in patch && meta.settings) clear.settings = null;
        if ("graphPresets" in patch && meta.graphPresets) clear.graphPresets = null;
        if (Object.keys(clear).length && typeof client.auth.updateUser === "function") {
          client.auth.updateUser({ data: clear }).catch(() => {});
        }
        return true;
      }
      if (isMissingTable(error)) noTable = true;
      else return false;
    } catch (err) {
      return false;
    }
  }
  if (typeof client.auth.updateUser !== "function") return false;
  try {
    const data = "settings" in patch ? { settings: patch.settings } : { graphPresets: patch.graphPresets };
    const { error } = await client.auth.updateUser({ data });
    return !error;
  } catch (err) {
    return false;
  }
}

// The display name stays with the sign-in (it is shown from there).
export async function writeDisplayName(client, user, name) {
  const meta = metaOf(user);
  if ((meta.display_name || null) === (name || null) || typeof client.auth.updateUser !== "function") return true;
  try {
    const { error } = await client.auth.updateUser({ data: { display_name: name || null } });
    return !error;
  } catch (err) {
    return false;
  }
}
