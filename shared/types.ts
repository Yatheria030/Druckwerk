export type FileKind = "stl" | "3mf" | "gcode3mf" | "obj" | "step" | "image" | "other";

/** Druckbare Platte aus einer geslicten .gcode.3mf (Metadata/slice_info.config) */
export type Plate = {
  index: number;
  prediction_s: number | null;
  weight_g: number | null;
  printer_model: string | null;
  nozzle: string | null;
  filaments: PlateFilament[];
  has_image: boolean;
  objects?: number; // Teile auf der Platte (für Kosten pro Stück)
  name?: string; // Plattenname aus dem Projekt (model_settings.config), z. B. „Battery Mount x 3“
  boxes?: [number, number, number, number][]; // Lage der Teile auf dem Bett (minX, minY, maxX, maxY in mm) aus plate_N.json, leer = unbekannt
};
export type PlateFilament = { id: number; type: string; color: string; used_g: number | null; used_m: number | null };

/** `plates` = druckbare Platten (nur .gcode.3mf); `layout` = Platten einer unslicten Projekt-3MF (Bambu Studio, MakerWorld) mit
 *  Name, Bild und den Werten des letzten Slicens des Autors, falls in der Datei. Leer = keine Plattenangaben. */
export type FileMeta = { plates?: Plate[]; images?: number[]; layout?: Plate[] };

export type ModelFile = {
  id: number;
  model_id: number;
  name: string;
  kind: FileKind;
  size: number;
  has_thumb: boolean;
  meta: FileMeta;
  created_at: string;
};

export type ModelListItem = {
  id: number;
  name: string;
  tags: string[];
  favorite: boolean;
  cover: string | null;
  file_count: number;
  printable: boolean;
  print_count: number;
  last_print: string | null;
  collections: number[];
  created_at: string;
  updated_at: string;
};

export type Model = {
  id: number;
  name: string;
  description: string;
  tags: string[];
  source_url: string;
  creator: string;
  license: string;
  favorite: boolean;
  cover_file_id: number | null;
  created_at: string;
  updated_at: string;
};

export type ModelDetail = { model: Model; files: ModelFile[]; prints: PrintJob[]; collections: number[] };

/** Sammlung (Projekt) von Modellen; covers = bis zu vier Vorschaubilder */
export type Collection = { id: number; name: string; description: string; count: number; covers: string[]; created_at: string };

export type PrintStatus = "laeuft" | "fertig" | "fehler" | "abgebrochen";

export type PrintJob = {
  id: number;
  printer_id: number;
  printer_name: string;
  model_id: number | null;
  model_name: string | null;
  file_id: number | null;
  name: string;
  plate: number | null;
  status: PrintStatus;
  progress: number;
  started_at: string;
  ended_at: string | null;
  duration_s: number | null;
  filaments: { type: string; color: string }[];
  error_code: number | null;
  rating: number | null;
  note: string;
  has_photo: boolean;
  timelapse: string | null; // Endung des Zeitraffers (mp4, avi), null = keiner
  filament_g: number | null; // gebuchter Verbrauch
  usage: { spool_id: number; grams: number }[]; // Druckbuchungen je Spule
  seen_spools: number[]; // Spulen, deren Fach während des Drucks aktiv war (Vorschlag beim Nachtragen)
  usage_missing: boolean; // beendet, aber nichts gebucht (Druck aus Bambu Studio ohne lesbare Datei)
  cost_filament: number | null; // gebuchte Gramm × Preis je Gramm der Spule
  energy_wh: number | null; // gemessen (Steckdose) oder geschätzt (Leistung × Dauer)
  energy_measured: boolean;
  cost_energy: number | null;
};

export type CameraKind = "tcp" | "rtsp" | "none";

/** Bambu-Modelle: Kamera über TLS-Port 6000 (A1, P1) oder RTSPS 322 (X1, H2, P2) */
export const PRINTER_MODELS: { id: string; label: string; camera: CameraKind }[] = [
  { id: "A1M", label: "A1 mini", camera: "tcp" },
  { id: "A1", label: "A1", camera: "tcp" },
  { id: "P1P", label: "P1P", camera: "tcp" },
  { id: "P1S", label: "P1S", camera: "tcp" },
  { id: "P2S", label: "P2S", camera: "rtsp" },
  { id: "X1C", label: "X1 Carbon", camera: "rtsp" },
  { id: "X1E", label: "X1E", camera: "rtsp" },
  { id: "H2D", label: "H2D", camera: "rtsp" },
  { id: "H2S", label: "H2S", camera: "rtsp" },
];
export const cameraOf = (model: string): CameraKind => PRINTER_MODELS.find((m) => m.id === model)?.camera ?? "none";

/** Drucker ohne Zugangscode: der geht nie an die Oberfläche */
export type Printer = { id: number; name: string; host: string; serial: string; model: string; has_code: boolean; plug: string };

export type PrinterInput = { name: string; host: string; serial: string; model: string; access_code?: string; plug?: string };

export type Tray = {
  id: number; // globale Fach-Nummer für ams_mapping (AMS-Index × 4 + Fach), 254 = externe Spule
  label: string; // "A1" … "D4", "Extern"
  type: string;
  color: string; // #RRGGBB oder ""
  remain: number | null; // Prozent, -1/unbekannt = null
  active: boolean;
  name: string; // Sorte laut RFID, z. B. „PLA Basic“
  rfid: boolean; // Bambu-Spule mit Chip
  spool_id: number | null; // zugeordnete Spule aus der Filament-Bibliothek
  loaded: boolean; // Spule steckt (tray_exist_bits), auch wenn Material/RFID noch fehlen
  reading: boolean; // AMS liest gerade den RFID-Chip
  profile: string; // Profil-ID, die das Fach gerade hat (tray_info_idx), "" = keins
  dry_temp: number | null; // Trocknungsvorschlag vom Chip bzw. Profil (°C)
  dry_hours: number | null;
};

/** AMS-Einheit (AMS, AMS lite, AMS 2 Pro, AMS HT) */
export type AmsUnit = {
  id: number;
  label: string; // „AMS A“
  kind: string; // „AMS 2 Pro“, „AMS HT“, „AMS“
  humidity: number | null; // Prozent (AMS 2 Pro, HT)
  humidity_level: number | null; // 1 feucht … 5 trocken
  temp: number | null;
  drying_min: number | null; // Restzeit Trocknung, sonst null
  trays: Tray[];
  /** Trocknen per Befehl (AMS 2 Pro, AMS HT; fun2 Bit 5) */
  can_dry: boolean;
  dry_max: number; // höchste Trocknungstemperatur (AMS 2 Pro 65 °C, HT 85 °C)
  dry_status: number | null; // 0 aus, 1 prüft, 2 trocknet, 3 kühlt ab, 4 hält an, 5 Fehler
  dry_pending: "start" | "stop" | null; // Befehl gesendet, Drucker hat ihn noch nicht umgesetzt
  dry_blocked: number[]; // Gründe, warum gerade nicht getrocknet werden kann (DRY_BLOCK)
};

export const DRY_BLOCK: Record<number, string> = {
  0: "Der Drucker ist gerade beschäftigt.",
  1: "Das AMS hat zu wenig Strom.",
  2: "Das AMS ist gerade beschäftigt.",
  3: "Im Ausgang des AMS steckt Filament, erst entladen.",
  4: "Die Trocknung startet gerade.",
  5: "Im 2D-Modus nicht möglich.",
  6: "Das AMS trocknet bereits.",
  7: "Es läuft ein Firmware-Update.",
  8: "Das AMS braucht für die Trocknung sein eigenes Netzteil.",
  9: "Die Trocknung wird gerade beendet.",
  10: "Im Ausgang des AMS steckt Filament, bitte von Hand herausziehen.",
};
export const DRY_STATUS: Record<number, string> = { 1: "Prüft", 2: "Trocknet", 3: "Kühlt ab", 4: "Hält an", 5: "Fehler" };
/** Hauptzustand des AMS (ams_status >> 8), nur die Zustände, in denen es arbeitet. 3 (Assist) ist kein Arbeitsschritt:
 *  die P2S meldet ihn dauerhaft, solange Filament in der Düse steckt; 0x20 Debug und 0xFF unbekannt zählen auch als frei */
export const AMS_BUSY: Record<number, string> = {
  1: "Filament wird gewechselt",
  2: "RFID wird gelesen",
  4: "AMS kalibriert",
  7: "Kaltzug läuft",
  16: "AMS prüft sich selbst",
};
/** Arbeitender Hauptzustand aus `ams_status`, 0 = frei */
export const amsBusy = (status: unknown) => {
  const main = (Number(status ?? 0) >> 8) & 0xff;
  return main in AMS_BUSY ? main : 0;
};

export type GcodeState = "IDLE" | "PREPARE" | "RUNNING" | "PAUSE" | "FINISH" | "FAILED" | "SLICING" | "OFFLINE" | string;

export type PrinterLive = {
  id: number;
  connected: boolean;
  error: string | null;
  last_seen: string | null;
  state: GcodeState;
  stage: string | null;
  job: string | null;
  percent: number | null;
  remaining_min: number | null;
  layer: number | null;
  total_layers: number | null;
  nozzle: number | null;
  nozzle_target: number | null;
  bed: number | null;
  bed_target: number | null;
  chamber: number | null;
  speed: number | null; // 1 leise, 2 normal, 3 sport, 4 wahnsinnig
  light: boolean | null;
  wifi: string | null;
  trays: Tray[]; // alle Fächer flach (für ams_mapping), Extern zuletzt
  ams: AmsUnit[];
  external: Tray | null;
  print_error: number | null;
  hms: { code: string; severity: number; at: string | null }[]; // severity 1 fatal, 2 schwer, 3 Hinweis, 4 Info; at = echte Zeit (ISO)
  clock_offset: number | null; // Zone der Druckeruhr in Minuten zu UTC (gelernt), null = unbekannt
  liveview: boolean | null; // false: LAN-Liveview am Drucker aus (RTSPS-Kamera)
  current_print_id: number | null;
  power_w: number | null; // Leistung laut Steckdose
  plug_error: string | null;
  /** Lüfter in % (P2S/H2: device.airduct.parts, ältere: cooling/big_fan in Stufen 0–15) */
  fans: { id: number; label: string; speed: number; target: number }[]; // speed = Ist, target = Soll (Lüfter fahren langsam hoch)
  /** Luftstrom-Modus (P2S/H2): aktueller Modus und wählbare (0 Kühlen, 1 Heizen, 3 Volle Kühlung) */
  airduct: { mode: number; modes: number[] } | null;
  /** SD-Karte bzw. Speicher im Drucker (nötig für Druckstart und Dateien) */
  sdcard: boolean | null;
  /** übersprungene Objekte des laufenden Drucks (`s_obj`) */
  skipped: number[];
  /** Hauptzustand des AMS (AMS_BUSY), 0 = frei */
  ams_busy: number;
  /** Fach, aus dem das Filament gerade in der Düse steckt; null = keins */
  loaded_tray: number | null;
  /** Druckoptionen und KI-Erkennung, nur die, die der Drucker kennt */
  options: PrintOption[];
  /** Neuerer Startbefehl (P2S/H2): Nivellieren und Flussrate kennen „Automatisch“, Vibration läuft nicht beim Druckstart */
  cali_auto: boolean;
};

export type PrintOption = {
  key: string;
  group: "ki" | "druck" | "ams";
  label: string;
  help: string;
  on: boolean;
  /** Empfindlichkeit (KI): never_halt, low, medium, high */
  level?: string | null;
  levels?: string[];
  /** Auswahl statt An/Aus (z. B. Luftreinigung) */
  choice?: number;
  choices?: { value: number; label: string }[];
};
export const OPTION_LEVEL: Record<string, string> = { never_halt: "Nur melden", low: "Niedrig", medium: "Mittel", high: "Hoch" };

/** Objekte der Platte des laufenden Drucks (zum Überspringen); Auswahlbild unter /api/printers/:id/parts/:druck/pick.png */
export type PrintParts = {
  print_id: number;
  plate: number;
  objects: { id: number; name: string }[];
  /** G-Code mit Objekt-Beschriftung (sonst geht Überspringen nicht) */
  labeled: boolean;
  pick: boolean;
  /** übersprungene IDs laut Drucker (`s_obj`) */
  skipped: number[];
};

/** Datei auf dem Speicher des Druckers (SD-Karte bzw. USB-Stick), aus / oder /cache */
export type StorageFile = {
  path: string;
  name: string;
  size: number;
  modified: string | null;
  /** geslicte .gcode.3mf */
  printable: boolean;
  /** Dateityp, den die Bibliothek kennt */
  importable: boolean;
  /** gleichnamige Datei in der Bibliothek */
  file_id: number | null;
  model_id: number | null;
};

export const FAN_LABEL: Record<number, string> = { 1: "Bauteil", 2: "Hilfslüfter", 3: "Kammer", 10: "Hilfslüfter 2" };
export const AIRDUCT_LABEL: Record<number, string> = { 0: "Kühlen", 1: "Heizen", 2: "Abluft", 3: "Volle Kühlung" };
export type ControlAction = "pause" | "resume" | "stop" | "light_on" | "light_off" | "speed" | "nozzle_temp" | "bed_temp" | "fan" | "airduct" | "skip";

/** Geräteinfo: Module mit Firmware (info.get_version), Düse, Speicher, verfügbares Update */
export type DeviceInfo = {
  serial: string;
  model: string;
  connected: boolean;
  modules: { name: string; product: string; sw: string; hw: string; sn: string }[];
  nozzle: { diameter: number | null; type: string | null } | null;
  wifi: string | null;
  storage: boolean | null; // SD-Karte bzw. USB-Stick steckt
  update: string | null;
};

/** Kalibrierung beim Druckstart wie Bambu Studio: aus, immer, oder „auto“ (Drucker prüft kurz und überspringt, wenn nicht nötig) */
export type Cali = "off" | "on" | "auto";

export type PrintRequest = {
  file_id: number;
  plate: number;
  use_ams: boolean;
  ams_mapping: number[];
  bed_leveling: boolean | Cali;
  flow_cali: boolean | Cali;
  vibration_cali?: boolean; // fehlt = an (wie bisher); P2S/H2 kalibrieren Vibration nicht beim Druckstart
  timelapse: boolean;
  queue_id?: number; // Start aus der Warteschlange: Eintrag fällt nach erfolgreichem Start weg
};

/** Eintrag der Druckwarteschlange */
export type QueueEntry = {
  id: number;
  plate: number;
  printer_id: number | null; // null = erster freier Drucker
  note: string;
  created_at: string;
  model_name: string;
  file: ModelFile;
};

/** Spule in der Filament-Bibliothek; Verbrauch kommt aus den Drucken (slice_info × Fortschritt) oder von Hand */
export type Spool = {
  id: number;
  brand: string;
  material: string;
  name: string;
  color: string;
  color_name: string;
  net_g: number;
  used_g: number;
  remaining_g: number;
  tare_g: number | null;
  price: number | null;
  price_sale: number | null; // reduziert gekauft, sonst null
  profile_id: string | null; // Bambu-Studio-Profil (GFA01 = Bambu PLA Matte), geht ans AMS-Fach
  nozzle_min: number | null; // Herstellerangaben, sonst gelten die Werte des Profils
  nozzle_max: number | null;
  bed_temp: number | null;
  dry_temp: number | null;
  dry_hours: number | null;
  url: string; // Produktseite
  location: string;
  rfid: boolean;
  track: "eigen" | "rfid"; // rfid: Füllstand folgt dem Restwert des Druckers, eigen: die App zählt selbst
  rfid_full: boolean; // eigen wegen 100 %: folgt wieder dem AMS, sobald es weniger meldet
  printer_id: number | null;
  tray: number | null;
  slot: string | null; // „P2S · B3“
  note: string;
  archived: boolean;
  created_at: string;
  last_used_at: string | null;
};

/** Bambu-Spule im Lager, die auf ihren Chip wartet: übernimmt ihn beim ersten Einlegen ins AMS (wie claimPrepared in server/spools.ts) */
export const awaitsChip = (s: Spool) => !s.rfid && !s.archived && s.printer_id == null && s.used_g === 0 && /bambu/i.test(s.brand);

export type SpoolInput = {
  brand: string;
  material: string;
  name: string;
  color: string;
  color_name: string;
  net_g: number;
  used_g?: number;
  tare_g: number | null;
  price: number | null;
  price_sale?: number | null;
  profile_id?: string | null;
  nozzle_min?: number | null;
  nozzle_max?: number | null;
  bed_temp?: number | null;
  dry_temp?: number | null;
  dry_hours?: number | null;
  url?: string;
  location: string;
  note: string;
  archived?: boolean;
  track?: "eigen" | "rfid";
};

export type SpoolUsage = { id: number; grams: number; source: "druck" | "manuell" | "waage" | "rfid"; print_id: number | null; print_name: string | null; note: string; created_at: string };

/** Vorschlag aus dem Link-Import: Felder fürs Formular, Farbe evtl. aus den Varianten zu wählen */
export type SpoolDraft = {
  brand: string;
  material: string;
  name: string;
  color_name: string;
  color: string | null;
  colors: { name: string; hex: string }[];
  net_g: number | null;
  tare_g: number | null;
  price: number | null;
  price_sale: number | null;
  nozzle_min: number | null;
  nozzle_max: number | null;
  bed_temp: number | null;
  dry_temp: number | null;
  dry_hours: number | null;
  profile_id: string | null;
  profile_reason: string;
  note: string;
  url: string;
};


/** Gezahlter Preis: reduziert, falls eingetragen */
export const paidPrice = (s: Pick<Spool, "price" | "price_sale">) => s.price_sale ?? s.price;

/** Preis je Gramm einer Spule, null ohne Preis */
export const pricePerG = (s: Pick<Spool, "price" | "price_sale" | "net_g">) => {
  const p = paidPrice(s);
  return p == null || !s.net_g ? null : p / s.net_g;
};

/** Abstand zweier Farben #RRGGBB im RGB-Raum (0 … 442) */
export const colorDist = (a: string, b: string) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
  const [x, y] = [p(a), p(b)];
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
};

/** Grundmaterial für Vergleiche: „PLA-CF“ → PLA, „PETG HF“ → PETG, „Support for PLA“ bleibt */
export const baseMaterial = (t: string) => t.trim().toUpperCase().split(/[\s-]/)[0] ?? "";

/**
 * Geschätzter Preis je Gramm für ein Filament der Platte: gezielte Spule, sonst die ähnlichste Spule gleichen Materials
 * (Farbabstand ≤ 60), sonst der Schnitt dieses Materials, sonst der Schnitt aller Spulen mit Preis
 */
export function estimatePerG(spools: Spool[], type: string, color: string, spoolId?: number | null): { perG: number; exact: boolean } | null {
  const own = spoolId != null ? spools.find((s) => s.id === spoolId) : undefined;
  const ownP = own && pricePerG(own);
  if (ownP != null) return { perG: ownP, exact: true };
  const priced = spools.filter((s) => !s.archived && pricePerG(s) != null);
  const same = priced.filter((s) => baseMaterial(s.material) === baseMaterial(type));
  const near = color ? same.map((s) => ({ s, d: colorDist(s.color, color) })).sort((a, b) => a.d - b.d)[0] : undefined;
  if (near && near.d <= 60) return { perG: pricePerG(near.s)!, exact: false };
  const avg = (l: Spool[]) => (l.length ? l.reduce((a, s) => a + pricePerG(s)!, 0) / l.length : null);
  const v = avg(same) ?? avg(priced);
  return v == null ? null : { perG: v, exact: false };
}

/** Betrag mit zwei Nachkommastellen und Währung */
export const fmtMoney = (v: number, currency: string) => `${v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

export const MATERIALS = ["PLA", "PETG", "ABS", "ASA", "TPU", "PA", "PC", "PVA", "PET", "PPS"];

export const fmtDuration = (s: number | null | undefined) => {
  if (s == null || !Number.isFinite(s)) return "–";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
};

export const fmtSize = (b: number) =>
  b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 ** 2).toFixed(1).replace(".", ",")} MB`;

/** Statistik je Kalendermonat (YYYY-MM), aus prints und spool_usage */
export type StatsMonth = {
  month: string;
  prints: number;
  fertig: number;
  abgebrochen: number;
  fehler: number;
  print_s: number; // Druckzeit beendeter Drucke
  grams: number; // gebuchter Verbrauch aus Drucken
  cost_filament: number;
  cost_energy: number;
  materials: Record<string, number>; // Gramm je Material
};
