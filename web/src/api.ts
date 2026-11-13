import type { CatalogBrand } from "../../shared/catalog.ts";
import type { SectionId, SectionPatch, SettingsState } from "../../shared/settings.ts";
import type { ModelDetail, ModelListItem, Model, Printer, PrinterInput, PrinterLive, PrintJob, PrintRequest, Spool, SpoolDraft, SpoolInput, SpoolUsage } from "../../shared/types.ts";

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
  updatePrint: (id: number, b: { rating?: number | null; note?: string; model_id?: number | null }) => req<PrintJob>("PATCH", `/prints/${id}`, b),
  deletePrint: (id: number) => req("DELETE", `/prints/${id}`),
  printers: () => req<Printer[]>("GET", "/printers"),
  live: () => req<PrinterLive[]>("GET", "/printers/live"),
  addPrinter: (b: PrinterInput) => req<{ id: number }>("POST", "/printers", b),
  updatePrinter: (id: number, b: PrinterInput) => req("PUT", `/printers/${id}`, b),
  deletePrinter: (id: number) => req("DELETE", `/printers/${id}`),
  control: (id: number, action: string, value?: number) => req("POST", `/printers/${id}/control`, { action, value }),
  print: (id: number, b: PrintRequest) => req("POST", `/printers/${id}/print`, b),
  spools: () => req<Spool[]>("GET", "/spools"),
  addSpool: (b: SpoolInput & { count?: number }) => req<{ id: number; ids: number[] }>("POST", "/spools", b),
  updateSpool: (id: number, b: Partial<SpoolInput>) => req<Spool & { pushed?: Pushed[] }>("PATCH", `/spools/${id}`, b),
  deleteSpool: (id: number) => req("DELETE", `/spools/${id}`),
  spoolUsage: (id: number) => req<SpoolUsage[]>("GET", `/spools/${id}/usage`),
  bookUsage: (id: number, b: { grams: number; note?: string } | { gross_g: number }) => req<Spool>("POST", `/spools/${id}/usage`, b),
  setSlot: (id: number, b: { printer_id: number; tray: number; swap?: boolean } | null) => req<Spool & { pushed: Pushed[] }>("PUT", `/spools/${id}/slot`, b),
  scrapeSpool,
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

export const fileUrl = {
  raw: (id: number) => `/api/files/${id}/raw`,
  download: (id: number, name: string) => `/api/files/${id}/download/${encodeURIComponent(name)}`,
  thumb: (id: number, v?: string) => `/api/files/${id}/thumb${v ? `?v=${encodeURIComponent(v)}` : ""}`,
  plate: (id: number, n: number) => `/api/files/${id}/plate/${n}`,
  /** Bambu Studio öffnet Dateien über sein URL-Schema, die Datei lädt es selbst vom Server */
  studio: (id: number, name: string) => `bambustudio://open?file=${encodeURIComponent(location.origin + fileUrl.download(id, name))}`,
};
