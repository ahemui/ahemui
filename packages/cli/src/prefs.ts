import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Prefs, PrefsSchema } from "@ahemui/core";

/** One file per person, shared by every project on this machine. AHEMUI_HOME overrides the folder (tests). */
export const prefsFile = () => join(process.env.AHEMUI_HOME ?? join(homedir(), ".ahemui"), "prefs.json");

export async function readPrefs(): Promise<Prefs> {
  try {
    // Unknown or invalid keys (from a newer or older AhemUI) are dropped rather than failing the whole file.
    const raw = JSON.parse(await readFile(prefsFile(), "utf8"));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw ?? {})) {
      const one = PrefsSchema.safeParse({ [k]: v });
      if (one.success && k in one.data) out[k] = (one.data as Record<string, unknown>)[k];
    }
    return out as Prefs;
  } catch {
    return {};
  }
}

/** Merges a change into the file; a null value removes that setting (back to the project or built-in default). */
export async function updatePrefs(patch: Record<string, unknown>): Promise<Prefs> {
  const next: Record<string, unknown> = { ...(await readPrefs()) };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in PrefsSchema.shape)) continue;
    if (v === null || v === "") delete next[k];
    else next[k] = v;
  }
  const prefs = PrefsSchema.parse(next);
  await mkdir(dirname(prefsFile()), { recursive: true });
  await writeFile(prefsFile(), JSON.stringify(prefs, null, 2) + "\n");
  return prefs;
}
