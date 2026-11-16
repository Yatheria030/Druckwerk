import type { CatalogBrand } from "../../shared/catalog.ts";
import type { MaintPrinter, MaintTaskInput } from "../../shared/maintenance.ts";
import type { StockRule, StockRuleInput } from "../../shared/stock.ts";
import type { SectionId, SectionPatch, SettingsState } from "../../shared/settings.ts";
import type { Collection, ModelDetail, ModelFile, ModelListItem, Model, Printer, PrinterInput, PrinterLive, ControlAction, DeviceInfo, PrintParts, StorageFile, Plate, PlateFilament, PrintJob, PrintRequest, QueueEntry, Spool, StatsMonth, SpoolDraft, SpoolInput, SpoolUsage } from "../../shared/types.ts";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export type CatalogBrandInput = { name: string; match?: string; url?: string; source?: string };
export type CatalogLineInput = { material: string; name: string; profile_id?: string | null };
export type CatalogColorInput = { name: string; hex?: string | null; code?: string | null };

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api" + url, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Server nicht erreichbar", 0);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(String(data.error ?? `Fehler ${res.status}`), res.status);
  return data as T;
}

/** Upload mit Fortschritt (fetch kann keinen Upload-Fortschritt) */
export function uploadFile(modelId: number, file: File, onProgress?: (p: number) => void): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", `/api/models/${modelId}/files?name=${encodeURIComponent(file.name)}`);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => {
      let data: { ids?: number[]; error?: string } = {};
      try {
        data = JSON.parse(x.responseText);
      } catch {}
      x.status < 300 ? resolve(data.ids ?? []) : reject(new ApiError(data.error ?? `Fehler ${x.status}`, x.status));
    };
    x.onerror = () => reject(new ApiError("Upload abgebrochen", 0));
    x.send(file);
  });
}

export const api = {
  models: () => req<ModelListItem[]>("GET", "/models"),
  tags: () => req<{ tag: string; count: number }[]>("GET", "/tags"),
  collections: () => req<Collection[]>("GET", "/collections"),
  addCollection: (b: { name: string; description?: string; models?: number[] }) => req<{ id: number }>("POST", "/collections", b),
  updateCollection: (id: number, b: { name?: string; description?: string }) => req<{ ok: true }>("PATCH", `/collections/${id}`, b),
  deleteCollection: (id: number) => req<{ ok: true }>("DELETE", `/collections/${id}`),
  setModelCollections: (id: number, ids: number[]) => req<{ ok: true }>("PUT", `/models/${id}/collections`, { ids }),
  model: (id: number) => req<ModelDetail>("GET", `/models/${id}`),
  createModel: (b: Partial<Model> & { name: string }) => req<{ id: number }>("POST", "/models", b),
  updateModel: (id: number, b: Partial<Model>) => req<ModelDetail>("PATCH", `/models/${id}`, b),
  deleteModel: (id: number) => req("DELETE", `/models/${id}`),
  deleteFile: (id: number) => req("DELETE", `/files/${id}`),
  putThumb: async (id: number, png: Blob) => {
    const r = await fetch(`/api/files/${id}/thumb`, { method: "PUT", body: png });
    if (!r.ok) throw new ApiError("Vorschau nicht gespeichert", r.status);
  },
  prints: () => req<PrintJob[]>("GET", "/prints"),
  stats: () => req<StatsMonth[]>("GET", "/stats"),
  notifyTest: () => req<{ channel: string; ok: boolean; error?: string }[]>("POST", "/notify/test"),
  updatePrint: (id: number, b: { rating?: number | null; note?: string; model_id?: number | null }) => req<PrintJob>("PATCH", `/prints/${id}`, b),
  deletePrint: (id: number) => req("DELETE", `/prints/${id}`),
  setPrintUsage: (id: number, items: { spool_id: number; grams: number }[]) => req<PrintJob>("PUT", `/prints/${id}/usage`, { items }),
  printUsageFile: async (id: number, file: File) => {
    const r = await fetch(`/api/prints/${id}/usage/file`, { method: "POST", body: file });
    const d = (await r.json().catch(() => ({}))) as { error?: string; plate?: number; filaments?: PlateFilament[] };
    if (!r.ok) throw new ApiError(d.error ?? `Fehler ${r.status}`, r.status);
    return d as { plate: number; filaments: PlateFilament[] };
  },
  printers: () => req<Printer[]>("GET", "/printers"),
  live: () => req<PrinterLive[]>("GET", "/printers/live"),
  addPrinter: (b: PrinterInput) => req<{ id: number }>("POST", "/printers", b),
  updatePrinter: (id: number, b: PrinterInput) => req("PUT", `/printers/${id}`, b),
  deletePrinter: (id: number) => req("DELETE", `/printers/${id}`),
  control: (id: number, action: ControlAction, value?: number, index?: number, objects?: number[]) =>
    req("POST", `/printers/${id}/control`, { action, value, index, objects }),
  move: (id: number, axis: "X" | "Y" | "Z" | "E" | "home", dist?: number) => req("POST", `/printers/${id}/move`, { axis, dist }),
  deviceInfo: (id: number) => req<DeviceInfo>("GET", `/printers/${id}/info`),
  calibrate: (id: number, o: { bed: boolean; vibration: boolean; motor: boolean }) => req("POST", `/printers/${id}/calibrate`, o),
  dismissAlert: (id: number, kind: "error" | "hms", code: string) => req("POST", `/printers/${id}/dismiss`, { kind, code }),
  parts: (id: number) => req<PrintParts | null>("GET", `/printers/${id}/parts`),
  loadFilament: (id: number, tray: number | null) => req("POST", `/printers/${id}/ams/load`, { tray }),
  readRfid: (id: number, tray: number) => req("POST", `/printers/${id}/ams/rfid`, { tray }),
  dryAms: (id: number, b: { ams: number; stop?: boolean; temp?: number; hours?: number; filament?: string; rotate?: boolean }) =>
    req("POST", `/printers/${id}/ams/dry`, b),
  option: (id: number, key: string, o: { on: boolean; level?: string; choice?: number }) => req("POST", `/printers/${id}/options`, { key, ...o }),
  storage: (id: number) => req<StorageFile[]>("GET", `/printers/${id}/storage`),
  storageImport: (id: number, path: string) => req<{ id: number; model_id: number; existed: boolean }>("POST", `/printers/${id}/storage/import`, { path }),
  storageDelete: (id: number, path: string) => req("DELETE", `/printers/${id}/storage?path=${encodeURIComponent(path)}`),
  print: (id: number, b: PrintRequest) => req("POST", `/printers/${id}/print`, b),
  queue: () => req<QueueEntry[]>("GET", "/queue"),
  enqueue: (b: { file_id: number; plate: number; printer_id: number | null }) => req<{ id: number }>("POST", "/queue", b),
  orderQueue: (ids: number[]) => req("PUT", "/queue/order", { ids }),
  dequeue: (id: number) => req("DELETE", `/queue/${id}`),
  spools: () => req<Spool[]>("GET", "/spools"),
  addSpool: (b: SpoolInput & { count?: number }) => req<{ id: number; ids: number[] }>("POST", "/spools", b),
  updateSpool: (id: number, b: Partial<SpoolInput>) => req<Spool & { pushed?: Pushed[] }>("PATCH", `/spools/${id}`, b),
  deleteSpool: (id: number) => req("DELETE", `/spools/${id}`),
  spoolUsage: (id: number) => req<SpoolUsage[]>("GET", `/spools/${id}/usage`),
  bookUsage: (id: number, b: { grams: number; note?: string } | { gross_g: number }) => req<Spool>("POST", `/spools/${id}/usage`, b),
  setSlot: (id: number, b: { printer_id: number; tray: number; swap?: boolean } | null) => req<Spool & { pushed: Pushed[] }>("PUT", `/spools/${id}/slot`, b),
  scrapeSpool,
  importModel,
  sliceFile,
  slicePreview,
  slicer: (q: { printer_id?: number | null; file_id?: number; nozzle?: string }) =>
    req<SlicerInfo>("GET", `/slicer?${new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (v == null || v === "" ? [] : [[k, String(v)]])))}`),
  printablesSearch: (q: string, order: string, offset: number) =>
    req<{ total: number; items: PrintablesItem[] }>("GET", `/printables/search?${new URLSearchParams({ q, order, offset: String(offset) })}`),
  printables: (id: string) => req<PrintablesModel>("GET", `/printables/${id}`),
  printablesLink: (id: string, f: PrintablesFile) => req<{ link: string }>("GET", `/printables/${id}/files/${f.id}?type=${f.type}`),
  makerworldSearch: (q: string, order: string, offset: number) =>
    req<{ total: number; items: PrintablesItem[] }>("GET", `/makerworld/search?${new URLSearchParams({ q, order, offset: String(offset) })}`),
  makerworld: (id: string) => req<MakerWorldModel>("GET", `/makerworld/${id}`),
  makerworldImport: (id: string, profile: string | null, onStatus: (text: string) => void, signal?: AbortSignal) =>
    ndjson<ModelImport & { file_id: number | null }>(`/api/makerworld/${id}/import`, { profile }, onStatus, signal, "Übernehmen fehlgeschlagen"),
  bambuAccount: () => req<BambuAccount>("GET", "/bambu/account"),
  bambuLogin: (email: string, password: string) => req<{ step: "done"; account: BambuAccount } | { step: "code" | "tfa" }>("POST", "/bambu/login", { email, password }),
  bambuCode: (code: string) => req<BambuAccount>("POST", "/bambu/code", { code }),
  bambuLogout: () => req<BambuAccount>("DELETE", "/bambu/account"),
  catalog: () => req<CatalogBrand[]>("GET", "/catalog"),
  addBrand: (b: CatalogBrandInput) => req<{ id: number }>("POST", "/catalog/brands", b),
  updateBrand: (id: number, b: Partial<CatalogBrandInput>) => req<{ ok: true }>("PATCH", `/catalog/brands/${id}`, b),
  deleteBrand: (id: number) => req<{ ok: true }>("DELETE", `/catalog/brands/${id}`),
  addLine: (brandId: number, b: CatalogLineInput) => req<{ id: number }>("POST", `/catalog/brands/${brandId}/lines`, b),
  updateLine: (id: number, b: Partial<CatalogLineInput>) => req<{ ok: true }>("PATCH", `/catalog/lines/${id}`, b),
  deleteLine: (id: number) => req<{ ok: true }>("DELETE", `/catalog/lines/${id}`),
  addColor: (lineId: number, b: CatalogColorInput) => req<{ id: number }>("POST", `/catalog/lines/${lineId}/colors`, b),
  updateColor: (id: number, b: Partial<CatalogColorInput>) => req<{ ok: true }>("PATCH", `/catalog/colors/${id}`, b),
  deleteColor: (id: number) => req<{ ok: true }>("DELETE", `/catalog/colors/${id}`),
  maintenance: () => req<MaintPrinter[]>("GET", "/maintenance"),
  addMaint: (printerId: number, b: MaintTaskInput & { done_hours_ago?: number }) => req<{ id: number }>("POST", `/printers/${printerId}/maintenance`, b),
  updateMaint: (id: number, b: Partial<MaintTaskInput>) => req<{ ok: true }>("PATCH", `/maintenance/${id}`, b),
  doneMaint: (id: number) => req<{ ok: true }>("POST", `/maintenance/${id}/done`),
  deleteMaint: (id: number) => req<{ ok: true }>("DELETE", `/maintenance/${id}`),
  setPrinterHours: (printerId: number, hours_base: number) => req<{ ok: true }>("PUT", `/printers/${printerId}/hours`, { hours_base }),
  stockRules: () => req<StockRule[]>("GET", "/stock"),
  addStockRule: (b: StockRuleInput) => req<{ id: number }>("POST", "/stock", b),
  updateStockRule: (id: number, b: Partial<StockRuleInput>) => req<StockRule>("PATCH", `/stock/${id}`, b),
  deleteStockRule: (id: number) => req<{ ok: true }>("DELETE", `/stock/${id}`),
  settings: () => req<SettingsState>("GET", "/settings"),
  saveSection: (id: SectionId, b: SectionPatch) => req<SettingsState>("PUT", `/settings/${id}`, b),
  setupDone: (done: boolean) => req<SettingsState>("PUT", "/setup", { done }),
};

/** Ergebnis der Übertragung ans AMS-Fach: Profilname bzw. Fehlermeldung des Druckers */
export type Pushed = { tray: number; label: string; ok: boolean; text: string };

/** Link-Import über die Anthropic-API: Antwort kommt als NDJSON (ping, dann done oder error), damit der Proxy die Verbindung offen hält */
async function scrapeSpool(url: string, signal?: AbortSignal): Promise<SpoolDraft> {
  let res: Response;
  try {
    res = await fetch("/api/spools/scrape", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }), signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError("Server nicht erreichbar", 0);
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(data.error ?? `Fehler ${res.status}`, res.status);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += value;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const e = JSON.parse(line) as { t: string; draft?: SpoolDraft; message?: string; status?: number };
      if (e.t === "done" && e.draft) return e.draft;
      if (e.t === "error") throw new ApiError(e.message ?? "Auslesen fehlgeschlagen", e.status ?? 500);
    }
    if (done) throw new ApiError("Verbindung abgebrochen", 0);
  }
}

export type PrintablesItem = {
  id: string;
  name: string;
  image: string | null;
  likes: number;
  downloads: number;
  makes: number;
  creator: string;
  paid: boolean;
  published: string | null;
  category: string;
  model_id: number | null;
};
export type PrintablesFile = { id: string; name: string; size: number | null; type: "stl" | "gcode" | "other"; preview: string | null };
export type PrintablesModel = Omit<PrintablesItem, "image"> & {
  url: string;
  summary: string;
  description: string;
  license: string;
  tags: string[];
  images: { large: string; small: string }[];
  files: PrintablesFile[];
};

export type MakerWorldProfile = {
  id: string;
  title: string;
  image: string | null;
  minutes: number | null;
  grams: number | null;
  plates: number | null;
  plate_list: { index: number; name: string; image: string | null; minutes: number | null; grams: number | null; filaments: { id: number; type: string; color: string; grams: number | null }[] }[];
  ams: boolean;
  default: boolean;
  printer: string;
  nozzle: number | null;
  others: string[];
  filaments: { type: string; color: string; grams: number | null }[];
  downloads: number;
  prints: number;
};
export type MakerWorldModel = Omit<PrintablesModel, "files"> & { profiles: MakerWorldProfile[] };
export type BambuAccount = { logged_in: boolean; expired: boolean; email: string; name: string; avatar: string; expires: number | null };

export type ModelImport = { id: number; existed: boolean; files: number; note: string };

/** POST mit NDJSON-Antwort: Statuszeilen, Pings, am Ende done (Rest der Zeile) oder error */
async function ndjson<T>(url: string, payload: unknown, onStatus: (text: string) => void, signal?: AbortSignal, failText = "Fehlgeschlagen"): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError("Server nicht erreichbar", 0);
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(data.error ?? `Fehler ${res.status}`, res.status);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += value;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const e = JSON.parse(line) as ({ t: "done" } & T) | { t: "status"; text: string } | { t: "error"; message?: string; status?: number } | { t: "ping" };
      if (e.t === "status") onStatus(e.text);
      if (e.t === "done") {
        const { t: _t, ...rest } = e as { t: "done" } & T;
        return rest as T;
      }
      if (e.t === "error") throw new ApiError(e.message ?? failText, e.status ?? 500);
    }
    if (done) throw new ApiError("Verbindung abgebrochen", 0);
  }
}

/** Modell per Link: NDJSON mit Statuszeilen, am Ende done oder error */
function importModel(url: string, onStatus: (text: string) => void, signal?: AbortSignal) {
  return ndjson<ModelImport>("/api/models/import", { url }, onStatus, signal, "Import fehlgeschlagen");
}

export type SlicerInfo =
  | { available: false }
  | { available: true; printer: null }
  | {
      available: true;
      /** Slicer im Server, z. B. „Bambu Studio (Profile 02.09.00.74)“ */
      engine: string | null;
      printer: number;
      machine: string;
      nozzle: string;
      nozzles: string[];
      processes: { name: string; layer: number | null; infill: number | null; pattern: string; walls: number | null }[];
      /** verbaute Düse laut Drucker, null = nicht verbunden */
      installed: { diameter: string | null; type: string | null; highFlow: boolean } | null;
      default: string;
      beds: { value: string; label: string }[];
      bed: string;
      /** Bettgröße [Breite, Tiefe] in mm und Sperrbereich („XxY“-Punkte, je vier ein Viereck) für die Plattenzeichnung */
      bed_size: [number, number] | null;
      bed_exclude: string[];
      /** Filamente der Quelldatei (3MF: aus den Projekteinstellungen), sonst eins ohne Angaben */
      slots: { color: string; type: string }[];
    };
export type SliceOptions = {
  printer_id: number;
  nozzle: string;
  process: string;
  trays: (number | null)[];
  support: "aus" | "normal" | "baum";
  brim: boolean;
  infill: number | null;
  pattern?: string | null;
  walls?: number | null;
  orient: boolean;
  bed: string;
  plate?: number | null; // nur diese Platte einer Projekt-3MF, null = alle
  flush?: number; // Spülmenge beim Farbwechsel (1 = wie Bambu Studio), nur bei mehreren Filamenten
  copies?: number; // Anzahl Exemplare, die CLI ordnet sie aufs Bett (nur ohne Platten-Layout)
};
function sliceFile(id: number, o: SliceOptions, onStatus: (text: string) => void, signal?: AbortSignal) {
  return ndjson<{ file: ModelFile }>(`/api/files/${id}/slice`, o, onStatus, signal, "Slicen fehlgeschlagen").then((r) => r.file);
}

/** Vorschau-Slice: echte Werte aus dem Slicer (Gramm je Filament, Druckzeit), ohne Datei anzulegen; `compare` = Vergleich mit dem Standard */
export function slicePreview(id: number, o: SliceOptions, onStatus: (text: string) => void, signal?: AbortSignal, compare = false) {
  return ndjson<{ plate: Plate }>(`/api/files/${id}/slice`, { ...o, preview: true, compare }, onStatus, signal, "Vorschau fehlgeschlagen").then((r) => r.plate);
}

export const fileUrl = {
  raw: (id: number) => `/api/files/${id}/raw`,
  download: (id: number, name: string) => `/api/files/${id}/download/${encodeURIComponent(name)}`,
  thumb: (id: number, v?: string) => `/api/files/${id}/thumb${v ? `?v=${encodeURIComponent(v)}` : ""}`,
  plate: (id: number, n: number) => `/api/files/${id}/plate/${n}`,
  /** OrcaSlicer öffnet Dateien über sein URL-Schema und lädt sie selbst vom Server (Name am Ende für den Dateityp) */
  orca: (id: number, name: string) => `orcaslicer://open?file=${encodeURIComponent(location.origin + fileUrl.download(id, name))}`,
  /** Bambu Studio öffnet Dateien über sein URL-Schema, die Datei lädt es selbst vom Server */
  studio: (id: number, name: string) => `bambustudio://open?file=${encodeURIComponent(location.origin + fileUrl.download(id, name))}`,
};
