// Einstellungen je Bereich (eine Zeile in `settings`, Wert JSON). Gelesen wird bei jedem Zugriff aus der Datenbank,
// Änderungen wirken also sofort, ohne Neustart und ohne Cache.
import { field, parseValue, SECTIONS, type FieldState, type SectionId, type SectionPatch, type SettingsState, type SettingValue } from "../shared/settings.ts";
import { db } from "./db.ts";

type Row = Record<string, SettingValue>;

const read = (k: string): Row => {
  const v = (db.prepare("SELECT value FROM settings WHERE key = ?").get(k) as { value: string } | undefined)?.value;
  try {
    return v ? (JSON.parse(v) as Row) : {};
  } catch {
    return {};
  }
};
const write = (k: string, row: Row) => {
  if (Object.keys(row).length) db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, JSON.stringify(row));
  else db.prepare("DELETE FROM settings WHERE key = ?").run(k);
};

function resolve(id: SectionId, key: string, row = read(id)): { value: SettingValue | null; source: FieldState["source"]; stored: SettingValue | null } {
  const f = field(id, key);
  if (!f) throw new Error(`Unbekannte Einstellung ${id}.${key}`);
  const stored = row[key] ?? null;
  if (stored !== null) return { value: stored, source: "db", stored };
  const env = f.env ? process.env[f.env]?.trim() : undefined;
  if (env) {
    try {
      const v = parseValue(f, f.type === "number" ? Number(env) : f.type === "bool" ? env === "1" || env === "true" : env);
      if (v !== null) return { value: v, source: "env", stored };
    } catch (e) {
      console.warn(`${f.env} ignoriert: ${(e as Error).message}`);
    }
  }
  return { value: f.default, source: "default", stored };
}

/** Wirksamer Wert einer Einstellung */
export function setting<T extends SettingValue>(id: SectionId, key: string): T {
  return resolve(id, key).value as T;
}
/** Wirksamer Wert samt Herkunft (Secrets intern) */
export const settingWithSource = (id: SectionId, key: string) => resolve(id, key);

/** Bereich ändern: null oder "" setzt auf Standard zurück. Wirft Error mit Meldung je Feld. */
export function saveSection(id: SectionId, patch: SectionPatch) {
  const sec = SECTIONS.find((s) => s.id === id);
  if (!sec) throw new Error("Unbekannter Bereich");
  const row = read(id);
  const errors: string[] = [];
  for (const [k, raw] of Object.entries(patch)) {
    const f = field(id, k);
    if (!f) {
      errors.push(`Unbekanntes Feld ${k}`);
      continue;
    }
    try {
      const v = parseValue(f, raw);
      if (v === null) delete row[k];
      else row[k] = v;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (errors.length) throw new Error(errors.join("; "));
  write(id, row);
}

const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

export const setupDone = () => read("setup").done === true;
export function setSetupDone(done: boolean) {
  write("setup", done ? { done: true } : {});
}

/** Alles für die Oberfläche: je Feld gespeichert, wirksam, Standard und Herkunft; Secrets nur als Hinweis */
export function settingsState(): SettingsState {
  const sections = {} as SettingsState["sections"];
  for (const s of SECTIONS) {
    const row = read(s.id);
    sections[s.id] = {};
    for (const f of s.fields) {
      const r = resolve(s.id, f.key, row);
      sections[s.id][f.key] =
        f.type === "secret"
          ? { stored: null, effective: null, default: null, source: r.source, set: r.stored !== null, hint: r.value ? `…${String(r.value).slice(-4)}` : null }
          : { stored: r.stored, effective: r.value, default: f.default, source: r.source };
    }
  }
  const printers = count("printers"), models = count("models"), spools = count("spools");
  const done = setupDone();
  return { sections, setup: { done, needed: !done && !printers && !models && !spools, printers, models, spools } };
}
