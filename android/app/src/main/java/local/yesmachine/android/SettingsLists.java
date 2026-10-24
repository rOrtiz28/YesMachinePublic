package local.yesmachine.android;

import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * What the home screen's Settings lists show, which public/forget-lists.js draws: for each trusted certificate and
 * each computer always allowed, the name and system the computer had and the time, kept as a small JSON object. The
 * trusted certificates keep it in the "trusted-details" preferences, by "address:port" beside the fingerprint in
 * "approved-host-certificates"; the computers always allowed keep it as their value in "allowed-computers", by their
 * certificate's fingerprint. Earlier versions kept nothing for a certificate and a bare name for a computer; those
 * entries list without a time.
 */
final class SettingsLists {

    private SettingsLists() {}

    /** What is kept with an entry from now on: its name and system, and this moment, as JSON. */
    static String kept(String name, String system) {
        try {
            return new JSONObject()
                .put("name", name == null ? "" : name)
                .put("system", system == null ? "" : system)
                .put("since", System.currentTimeMillis())
                .toString();
        } catch (JSONException impossible) {
            return "";
        }
    }

    /**
     * One entry for the page: {key, name, system, since}, with since in milliseconds, or 0 when it isn't known.
     * stored is what kept() made, an earlier version's bare name, or null.
     */
    static JSONObject entry(String key, String stored) throws JSONException {
        JSONObject entry = new JSONObject()
            .put("key", key)
            .put("name", "")
            .put("system", "")
            .put("since", 0);
        if (stored == null || stored.isEmpty()) return entry;
        try {
            JSONObject details = new JSONObject(stored);
            return entry
                .put("name", details.optString("name"))
                .put("system", details.optString("system"))
                .put("since", details.optLong("since"));
        } catch (JSONException bareName) {
            return entry.put("name", stored);
        }
    }

    /**
     * The entries of a list: one for each key in keys, with what details keeps for it, or with the value in keys
     * itself when details is null (the computers always allowed).
     */
    static JSONArray list(SharedPreferences keys, SharedPreferences details) throws JSONException {
        JSONArray list = new JSONArray();
        for (Map.Entry<String, ?> each : keys.getAll().entrySet()) {
            Object stored = details == null ? each.getValue() : details.getAll().get(each.getKey());
            list.put(entry(each.getKey(), stored instanceof String ? (String) stored : null));
        }
        return list;
    }

    /** The keys the page asks to forget: the strings in args' "keys" array. */
    static List<String> keys(JSONObject args) {
        List<String> keys = new ArrayList<>();
        JSONArray array = args.optJSONArray("keys");
        for (int i = 0; array != null && i < array.length(); i++) {
            String key = array.optString(i, null);
            if (key != null) keys.add(key);
        }
        return keys;
    }

    /** Forgets those keys in each of the preferences. */
    static void forget(List<String> keys, SharedPreferences... preferences) {
        for (SharedPreferences each : preferences) {
            SharedPreferences.Editor editor = each.edit();
            for (String key : keys) editor.remove(key);
            editor.apply();
        }
    }
}
