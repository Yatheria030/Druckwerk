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
export type SectionId = "filament" | "kosten" | "archiv" | "notify" | "import";

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
      {
        key: "auto_dry",
        label: "AMS automatisch trocknen",
        type: "bool",
        default: false,
        help: "Schaltet die Trocknung von AMS 2 Pro bzw. AMS HT selbst ein, wenn die Feuchte über der Schwelle unten liegt, nie während eines Drucks (ein trocknendes AMS liefert kein Filament). Temperatur nach dem Chip der Spulen (die empfindlichste zählt). Das AMS 2 Pro trocknet nur mit eigenem Netzteil.",
      },
      {
        key: "auto_dry_humidity",
        label: "Trocknen ab Feuchte über",
        type: "number",
        unit: "%",
        default: 30,
        help: "Steigt die relative Feuchte eines AMS darüber, startet die Trocknung einmal (läuft gerade ein Druck, erst danach); erneut erst, wenn sie zwischendurch 5 % darunter war. Leer = aus.",
        min: 5,
        max: 95,
        integer: true,
      },
      {
        key: "auto_dry_hours",
        label: "Dauer der automatischen Trocknung",
        type: "number",
        unit: "h",
        default: 8,
        help: "Wie lange das AMS jeweils trocknet.",
        min: 1,
        max: 72,
        integer: true,
      },
    ],
  },
  {
    id: "kosten",
    title: "Kosten",
    does: "Rechnet zu jedem Druck die Kosten aus: Filament aus dem Preis der Spule, Strom aus einer messenden Steckdose (am Drucker eintragen) oder geschätzt.",
    fields: [
      {
        key: "kwh_price",
        label: "Strompreis",
        type: "number",
        unit: "je kWh",
        default: null,
        help: "Arbeitspreis deines Stromtarifs in der Währung oben, z. B. 0,32. Leer = keine Stromkosten.",
        find: "Stromrechnung oder Vertrag, „Arbeitspreis“.",
        min: 0,
        max: 10,
      },
      {
        key: "watts",
        label: "Leistung ohne Steckdose",
        type: "number",
        unit: "W",
        default: null,
        help: "Mittlere Leistung des Druckers während eines Drucks. Gilt nur für Drucker ohne messende Steckdose und ergibt eine Schätzung. Leer = ohne Steckdose keine Stromkosten.",
        find: "Einmal mit einer Messsteckdose über einen ganzen Druck messen.",
        min: 1,
        max: 5000,
        integer: true,
      },
    ],
  },
  {
    id: "archiv",
    title: "Archiv",
    does: "Hebt Drucke auf, die nicht aus der App kamen, und holt Zeitraffer vom Drucker. Beides läuft per FTPS über die SD-Karte des Druckers.",
    fields: [
      {
        key: "auto",
        label: "Drucke aus Bambu Studio archivieren",
        type: "bool",
        default: true,
        help: "Startet ein Druck aus Bambu Studio oder Handy-App, holt Druckwerk die .gcode.3mf von der SD-Karte und legt sie als Modell in die Bibliothek (gleiche Datei nur einmal). Danach geht „Nochmal drucken“ im Verlauf.",
      },
      {
        key: "timelapse",
        label: "Zeitraffer holen",
        type: "bool",
        default: true,
        help: "Nach dem Druck das Zeitraffer-Video von der SD-Karte holen und im Verlauf neben dem Foto zeigen. Den Zeitraffer schaltest du im Druckdialog bzw. in Bambu Studio ein.",
      },
    ],
  },
  {
    id: "notify",
    title: "Benachrichtigungen",
    does: "Meldet Druck fertig oder fehlgeschlagen (mit Foto), Druckerfehler (HMS), fast leere Spulen und zu feuchte AMS. Kanäle: ntfy, Gotify, Webhook (z. B. Home Assistant). Jeder eingetragene Kanal bekommt alle Meldungen.",
    fields: [
      {
        key: "ntfy_url",
        label: "ntfy-Thema",
        type: "text",
        default: null,
        help: "Adresse samt Thema, z. B. http://192.168.1.20:8090/druckwerk. Die ntfy-App auf dem iPhone abonniert dasselbe Thema. Das Foto kommt als Anhang mit.",
        maxLength: 300,
        pattern: /^https?:\/\/[^\s/]+\/[\w-]+$/i,
        patternMsg: "Adresse mit Thema am Ende, z. B. http://192.168.1.20:8090/druckwerk",
      },
      {
        key: "ntfy_token",
        label: "ntfy-Token",
        type: "secret",
        default: null,
        help: "Nur nötig, wenn das Thema geschützt ist.",
        find: "ntfy: Konto → Zugangs-Tokens (tk_…)",
        maxLength: 200,
        pattern: /^\S+$/,
        patternMsg: "Token ohne Leerzeichen",
      },
      {
        key: "gotify_url",
        label: "Gotify-Server",
        type: "text",
        default: null,
        help: "Adresse des Gotify-Servers, z. B. http://192.168.1.21:8080.",
        maxLength: 300,
        pattern: /^https?:\/\/\S+$/i,
        patternMsg: "Adresse mit http:// oder https://",
      },
      {
        key: "gotify_token",
        label: "Gotify-App-Token",
        type: "secret",
        default: null,
        help: "Token einer Anwendung in Gotify. Ohne Token geht nichts an Gotify.",
        find: "Gotify: Apps → Anwendung anlegen → Token",
        maxLength: 200,
        pattern: /^\S+$/,
        patternMsg: "Token ohne Leerzeichen",
      },
      {
        key: "webhook_url",
        label: "Webhook",
        type: "text",
        default: null,
        help: "Bekommt jede Meldung als JSON per POST (event, title, message, link, photo_url, …). Für Home Assistant: Automation mit Webhook-Auslöser, Adresse http://<home-assistant>:8123/api/webhook/<id>.",
        maxLength: 500,
        pattern: /^https?:\/\/\S+$/i,
        patternMsg: "Adresse mit http:// oder https://",
      },
      {
        key: "app_url",
        label: "Adresse von Druckwerk",
        type: "text",
        default: null,
        help: "Unter dieser Adresse öffnen Meldungen die App (Tippen auf die Meldung) und Gotify bzw. der Webhook finden das Foto. Leer = Meldungen ohne Link.",
        maxLength: 300,
        pattern: /^https?:\/\/\S+$/i,
        patternMsg: "Adresse mit http:// oder https://",
      },
      { key: "on_finish", label: "Druck fertig", type: "bool", default: true, help: "Meldung mit Foto, Dauer und Kosten, wenn ein Druck fertig ist." },
      { key: "on_fail", label: "Druck fehlgeschlagen", type: "bool", default: true, help: "Meldung mit Fehlertext, wenn ein Druck mit Fehler endet oder abgebrochen wird." },
      { key: "on_hms", label: "Druckerfehler (HMS)", type: "bool", default: true, help: "Neue Fehlermeldungen des Druckers (Stufe Fatal und Fehler), z. B. Filament verheddert." },
      { key: "on_drying", label: "Automatische Trocknung", type: "bool", default: true, help: "Meldet, wenn Druckwerk ein AMS selbst trocknen lässt oder das AMS es gerade nicht kann." },
      { key: "on_queue", label: "Warteschlange", type: "bool", default: true, help: "Meldet nach Druckende den nächsten Druck aus der Warteschlange: Bett räumen und in Druckwerk starten." },
      { key: "on_maintenance", label: "Wartung fällig", type: "bool", default: true, help: "Meldet einmal, wenn ein Wartungspunkt eines Druckers fällig wird." },
      {
        key: "low_g",
        label: "Spule fast leer unter",
        type: "number",
        unit: "g",
        default: 100,
        help: "Meldet einmal, wenn der Rest einer Spule darunter fällt. 0 = aus.",
        min: 0,
        max: 5000,
        integer: true,
      },
      {
        key: "humidity_max",
        label: "AMS-Feuchte über",
        type: "number",
        unit: "%",
        default: null,
        help: "Meldet einmal, wenn die relative Feuchte in einem AMS darüber steigt (nur AMS mit Feuchtesensor in %, z. B. AMS 2 Pro). Leer = aus.",
        min: 5,
        max: 95,
        integer: true,
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
