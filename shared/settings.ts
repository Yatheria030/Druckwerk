// Einstellungen je Bereich: eine Zeile pro Bereich in der Tabelle `settings` (JSON), jeder Wert optional.
// Wirksam ist: gespeicherter Wert → Umgebungsvariable (bestehende Installationen) → eingebauter Standard.
// Server (Prüfung, Auflösung) und Oberfläche (Formulare, Assistent) lesen dieselbe Beschreibung.

export type SettingValue = string | number | boolean;
export type FieldType = "text" | "secret" | "number" | "bool";

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  default: SettingValue | null;
  env?: string;
  /** Wofür der Wert gebraucht wird */
  help: string;
  /** Wo man den Wert findet (nur wo es nicht offensichtlich ist) */
  find?: string;
  unit?: string;
  min?: number;
  max?: number;
  integer?: boolean;
  maxLength?: number;
  pattern?: RegExp;
  patternMsg?: string;
};

export type SectionDef = { id: SectionId; title: string; does: string; fields: FieldDef[] };
export type SectionId = "filament" | "import";

export const SECTIONS: SectionDef[] = [
  {
    id: "filament",
    title: "Filament",
    does: "Legt fest, wie Spulen gezählt, bewertet und angezeigt werden.",
    fields: [
      {
        key: "currency",
        label: "Währung",
        type: "text",
        default: "€",
        help: "Zeichen hinter Preisen und dem Lagerwert, z. B. €, CHF oder $.",
        maxLength: 4,
        pattern: /^\S{1,4}$/,
        patternMsg: "1 bis 4 Zeichen ohne Leerzeichen",
      },
      {
        key: "net_g",
        label: "Filament je Spule",
        type: "number",
        unit: "g",
        default: 1000,
        help: "Startwert für neue Spulen und für AMS-Fächer, die kein Gewicht melden.",
        find: "Steht auf dem Etikett der Spule (meist 1 kg).",
        min: 50,
        max: 10_000,
        integer: true,
      },
      {
        key: "claim_distance",
        label: "Farbtoleranz für vorbereitete Spulen",
        type: "number",
        default: 60,
        help: "Wie weit die Farbe einer vorab angelegten Bambu-Spule von der Chipfarbe abweichen darf, damit der Chip sie übernimmt (0 = exakt, 442 = jede).",
        min: 0,
        max: 442,
        integer: true,
      },
      {
        key: "show_external",
        label: "Externe Spule zeigen",
        type: "bool",
        default: false,
        help: "Spulenhalter hinten am Drucker neben den AMS-Fächern. Druckt der Drucker gerade von dort, erscheint er trotzdem.",
      },
    ],
  },
  {
    id: "import",
    title: "Link-Import (Anthropic-API)",
    does: "Liest beim Anlegen einer Spule eine Produktseite aus (Marke, Sorte, Farben, Preis, Temperaturen) und wählt das passende Druckprofil. Ohne Key bleibt der Import aus, alles andere geht.",
    fields: [
      {
        key: "api_key",
        label: "API-Key",
        type: "secret",
        default: null,
        env: "ANTHROPIC_API_KEY",
        help: "Schlüssel für die Anthropic-API. Er bleibt auf dem Server, die Oberfläche sieht nur die letzten vier Zeichen.",
        find: "console.anthropic.com → API Keys",
        maxLength: 400,
        pattern: /^sk-ant-[\w-]{20,}$/,
        patternMsg: "Das sieht nicht wie ein Anthropic-API-Key aus (sk-ant-…)",
      },
      {
        key: "model",
        label: "Modell",
        type: "text",
        default: "claude-opus-5-5",
        env: "SCRAPE_MODEL",
        help: "Modell-ID für den Import. Muss Web-Abruf und Websuche können.",
        find: "Liste der Modelle in der Doku der Anthropic-API",
        maxLength: 80,
        pattern: /^[a-z0-9][\w.:@-]{2,79}$/i,
        patternMsg: "Modell-ID aus Buchstaben, Ziffern, Punkt, Bindestrich",
      },
    ],
  },
];

export const section = (id: SectionId) => SECTIONS.find((s) => s.id === id)!;
export const field = (id: SectionId, key: string) => section(id).fields.find((f) => f.key === key);

export type Source = "db" | "env" | "default";
export type FieldState = {
  /** Gespeicherter Wert (Secrets: nie, nur `set`) */
  stored: SettingValue | null;
  /** Wirksamer Wert (Secrets: nie, nur `hint`) */
  effective: SettingValue | null;
  default: SettingValue | null;
  source: Source;
  /** Secrets: ob gespeichert bzw. wirksam, Hinweis „…abcd“ */
  set?: boolean;
  hint?: string | null;
};
export type SettingsState = {
  sections: Record<SectionId, Record<string, FieldState>>;
  setup: { done: boolean; needed: boolean; printers: number; models: number; spools: number };
};
export type SectionPatch = Record<string, SettingValue | null>;

/** Eingabe prüfen und umwandeln; null/"" heißt Standard. Wirft Error mit verständlicher Meldung. */
export function parseValue(f: FieldDef, raw: unknown): SettingValue | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const fail = (m: string) => {
    throw new Error(`${f.label}: ${m}`);
  };
  if (f.type === "bool") {
    if (typeof raw !== "boolean") fail("Ja oder Nein erwartet");
    return raw as boolean;
  }
  if (f.type === "number") {
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", ".").trim());
    if (!Number.isFinite(n)) fail("Zahl erwartet");
    if (f.integer && !Number.isInteger(n)) fail("ganze Zahl erwartet");
    if (f.min != null && n < f.min) fail(`mindestens ${f.min}${f.unit ? ` ${f.unit}` : ""}`);
    if (f.max != null && n > f.max) fail(`höchstens ${f.max}${f.unit ? ` ${f.unit}` : ""}`);
    return n;
  }
  if (typeof raw !== "string") fail("Text erwartet");
  const s = (raw as string).trim();
  if (!s) return null;
  if (f.maxLength && s.length > f.maxLength) fail(`höchstens ${f.maxLength} Zeichen`);
  if (f.pattern && !f.pattern.test(s)) fail(f.patternMsg ?? "ungültiger Wert");
  return s;
}
