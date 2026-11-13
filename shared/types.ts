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
};
export type PlateFilament = { id: number; type: string; color: string; used_g: number | null; used_m: number | null };

export type FileMeta = { plates?: Plate[]; images?: number[] };

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

export type ModelDetail = { model: Model; files: ModelFile[]; prints: PrintJob[] };

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
  filament_g: number | null; // gebuchter Verbrauch
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
export type Printer = { id: number; name: string; host: string; serial: string; model: string; has_code: boolean };

export type PrinterInput = { name: string; host: string; serial: string; model: string; access_code?: string };

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
  hms: { code: string; severity: number; at: string | null }[]; // severity 1 fatal, 2 schwer, 3 Hinweis, 4 Info; at = Druckerzeit
  liveview: boolean | null; // false: LAN-Liveview am Drucker aus (RTSPS-Kamera)
  current_print_id: number | null;
};

export type PrintRequest = {
  file_id: number;
  plate: number;
  use_ams: boolean;
  ams_mapping: number[];
  bed_leveling: boolean;
  flow_cali: boolean;
  timelapse: boolean;
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

export const MATERIALS = ["PLA", "PETG", "ABS", "ASA", "TPU", "PA", "PC", "PVA", "PET", "PPS"];

export const fmtDuration = (s: number | null | undefined) => {
  if (s == null || !Number.isFinite(s)) return "–";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
};

export const fmtSize = (b: number) =>
  b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 ** 2).toFixed(1).replace(".", ",")} MB`;
