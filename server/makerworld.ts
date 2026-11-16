// MakerWorld: Suche und Modellseiten über die öffentliche API (ohne Anmeldung), Dateien (3MF je Druckprofil) nur mit
// Bambu-Konto (`bambucloud.ts`). Import legt ein Modell mit Angaben und Bildern an, mit Konto samt 3MF des gewählten Profils.
import { BambuError, rejected, token } from "./bambucloud.ts";
import { db } from "./db.ts";
import { FileError, saveUpload } from "./files.ts";
import { htmlText, type ImportEvent } from "./modelimport.ts";
import { ScrapeError } from "./scrape.ts";
import * as store from "./store.ts";

const API = "https://api.bambulab.com/v1";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAX_FILE = 500 * 1024 ** 2;

/** Sortierung der Suche (`orderBy`), leer = Relevanz */
export const MW_ORDER = ["", "hotScore", "downloadCount", "likeCount"] as const;
export type MwOrder = (typeof MW_ORDER)[number];

export const makerworldId = (u: string) => u.match(/makerworld\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?models\/(\d+)/i)?.[1] ?? null;
export const mwUrl = (id: string | number) => `https://makerworld.com/models/${id}`;

/** Verkleinertes Bild vom MakerWorld-CDN (OSS-Bildverarbeitung) */
const img = (u: string | null | undefined, w: number) => (u ? `${u}${u.includes("?") ? "&" : "?"}x-oss-process=image/resize,w_${w}/format,webp` : null);

async function get<T>(path: string, signal?: AbortSignal, auth?: string): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    headers: { "user-agent": UA, accept: "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]),
  });
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  if (r.status === 404) throw new ScrapeError("Das Modell gibt es bei MakerWorld nicht (oder es ist privat).", 404);
  if (!r.ok || !j) throw Object.assign(new ScrapeError(`MakerWorld: ${j?.error ?? `HTTP ${r.status}`}`, 502), { http: r.status });
  return j;
}

/** MakerWorld-IDs, die schon als Modell in der Bibliothek liegen (ID → Modell) */
function imported(): Map<string, number> {
  const rows = db.prepare("SELECT id, source_url FROM models WHERE source_url LIKE '%makerworld.com%'").all() as { id: number; source_url: string }[];
  return new Map(rows.flatMap((r) => (makerworldId(r.source_url) ? [[makerworldId(r.source_url)!, r.id] as const] : [])));
}

type Creator = { name?: string; handle?: string } | null;
type Hit = {
  id: number;
  title: string;
  cover: string;
  likeCount: number;
  downloadCount: number;
  printCount: number;
  createTime: string;
  designCreator: Creator;
  is_point_redeemable?: boolean;
  isPointRedeemable?: boolean;
  nsfw?: boolean;
};
/** Nur gegen Punkte oder bezahlt (`isExclusive` heißt nur: erschienen nur auf MakerWorld, ist frei) */
const paidOf = (h: Hit & { paidSetting?: { isPaid?: boolean } | null }) => !!(h.is_point_redeemable || h.isPointRedeemable || h.paidSetting?.isPaid);

export async function mwSearch(query: string, order: MwOrder, offset: number, signal?: AbortSignal) {
  const q = new URLSearchParams({ keyword: query, limit: "24", offset: String(offset) });
  if (order) q.set("orderBy", order);
  const r = await get<{ total: number; hits: Hit[] | null }>(`/search-service/select/design2?${q}`, signal);
  const have = imported();
  return {
    total: r.total ?? 0,
    items: (r.hits ?? [])
      .filter((h) => !h.nsfw)
      .map((h) => ({
        id: String(h.id),
        name: h.title,
        image: img(h.cover, 480),
        likes: h.likeCount ?? 0,
        downloads: h.downloadCount ?? 0,
        makes: h.printCount ?? 0,
        creator: h.designCreator?.name ?? "",
        paid: paidOf(h),
        published: h.createTime || null,
        category: "",
        model_id: have.get(String(h.id)) ?? null,
      })),
  };
}

type Instance = {
  id: number;
  title: string;
  cover: string;
  prediction: number;
  weight: number;
  materialCnt: number;
  needAms: boolean;
  isDefault: boolean;
  downloadCount: number;
  printCount: number;
  instanceFilaments: { type: string; color: string; usedG: string }[] | null;
  pictures: { url: string }[] | null;
  extention?: { modelInfo?: { plates?: MwPlate[]; compatibility?: { devProductName?: string; nozzleDiameter?: number }; otherCompatibility?: { devProductName?: string }[] } };
};
type MwPlate = {
  index: number;
  name?: string;
  thumbnail?: { url?: string };
  prediction?: number;
  weight?: number;
  objects?: unknown[];
  filaments?: { id: string; type: string; color: string; usedG: string }[];
};
type Design = Hit & {
  summary: string;
  license: string;
  tags: string[] | null;
  defaultInstanceId: number;
  isAlreadyRedeemed?: boolean;
  instances: Instance[] | null;
  designExtension?: { design_pictures?: { url: string }[]; model_files?: unknown[] };
};

async function design(id: string, signal?: AbortSignal) {
  return get<Design>(`/design-service/design/${id}`, signal);
}

export async function mwDetail(id: string, signal?: AbortSignal) {
  const d = await design(id, signal);
  const pics = d.designExtension?.design_pictures?.length ? d.designExtension.design_pictures : [{ url: d.cover }];
  return {
    id: String(d.id),
    name: d.title,
    url: mwUrl(d.id),
    summary: "",
    description: d.summary ? htmlText(d.summary).slice(0, 8000) : "",
    creator: d.designCreator?.name ?? "",
    license: d.license ?? "",
    category: "",
    tags: d.tags ?? [],
    images: pics.slice(0, 20).map((p) => ({ large: img(p.url, 1280)!, small: img(p.url, 240)! })),
    likes: d.likeCount ?? 0,
    downloads: d.downloadCount ?? 0,
    makes: d.printCount ?? 0,
    paid: paidOf(d) && !d.isAlreadyRedeemed,
    published: d.createTime || null,
    model_id: imported().get(String(d.id)) ?? null,
    profiles: (d.instances ?? []).map((i) => {
      const c = i.extention?.modelInfo?.compatibility;
      return {
        id: String(i.id),
        title: i.title,
        image: img(i.cover || i.pictures?.[0]?.url, 480),
        minutes: i.prediction ? Math.round(i.prediction / 60) : null,
        grams: i.weight || null,
        plates: i.extention?.modelInfo?.plates?.length || null,
        // Platten wie auf MakerWorld: Bild, Name, Zeit, Gramm, Filamente (Werte des Autors)
        plate_list: (i.extention?.modelInfo?.plates ?? []).map((p, k) => ({
          index: Number(p.index) || k + 1,
          name: (p.name ?? "").trim(),
          image: img(p.thumbnail?.url, 240),
          minutes: p.prediction ? Math.round(p.prediction / 60) : null,
          grams: p.weight || null,
          filaments: (p.filaments ?? []).map((f) => ({ id: Number(f.id) || 0, type: f.type, color: f.color, grams: Number(f.usedG) || null })),
        })),
        ams: !!i.needAms,
        default: i.id === d.defaultInstanceId,
        printer: c?.devProductName ?? "",
        nozzle: c?.nozzleDiameter ?? null,
        others: (i.extention?.modelInfo?.otherCompatibility ?? []).map((o) => o.devProductName ?? "").filter(Boolean),
        filaments: (i.instanceFilaments ?? []).map((f) => ({ type: f.type, color: f.color, grams: Number(f.usedG) || null })),
        downloads: i.downloadCount ?? 0,
        prints: i.printCount ?? 0,
      };
    }),
  };
}

/** Kurz gültiger Link zur 3MF eines Druckprofils; braucht das Bambu-Konto */
async function profileFile(instanceId: string, signal?: AbortSignal): Promise<{ name: string; url: string }> {
  const t = await token();
  if (!t) throw new BambuError("Für Dateien von MakerWorld bei Bambu anmelden: Einstellungen → MakerWorld.", 401);
  try {
    const r = await get<{ name?: string; url?: string }>(`/design-service/instance/${instanceId}/f3mf?type=download`, signal, t);
    if (!r.url) throw new ScrapeError("MakerWorld gibt die Datei nicht heraus.", 502);
    return { name: r.name || `${instanceId}.3mf`, url: r.url };
  } catch (e) {
    const http = (e as { http?: number }).http;
    // Ungültiges Token: MakerWorld antwortet 401 oder 403 „Please log in to download models.“
    if (http === 401 || (http === 403 && /log ?in/i.test((e as Error).message))) {
      rejected();
      throw new BambuError("Die Anmeldung bei Bambu ist abgelaufen: Einstellungen → MakerWorld → Neu anmelden.", 401);
    }
    throw e;
  }
}

const imageName = (url: string, i: number) => `bild-${i + 1}.${url.match(/\.(jpe?g|png|webp|gif)(?:$|[?#])/i)?.[1]?.toLowerCase() ?? "jpg"}`;

async function download(modelId: number, url: string, name: string, signal?: AbortSignal): Promise<number[]> {
  const r = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.any([AbortSignal.timeout(10 * 60_000), ...(signal ? [signal] : [])]) });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  if (Number(r.headers.get("content-length")) > MAX_FILE) throw new Error("größer als 500 MB");
  return saveUpload(modelId, name, r.body as ReadableStream<Uint8Array>);
}

/** Dateiname der 3MF: Modellname + Profil, ASCII-freundlich gekürzt */
const fileName = (design: string, profile: string) =>
  `${`${design} – ${profile}`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150)}.3mf`;

/**
 * Modell übernehmen: Angaben und Bilder (falls neu), dazu die 3MF des Profils (mit Konto). `instance` leer = Standardprofil,
 * ohne Konto nur Angaben und Bilder. Liefert `file_id` der geladenen 3MF für „Drucken“.
 */
export async function mwImport(id: string, instance: string | null, emit: (e: ImportEvent | (Extract<ImportEvent, { t: "done" }> & { file_id: number | null })) => void, signal?: AbortSignal) {
  emit({ t: "status", text: "Lese das Modell bei MakerWorld …" });
  const d = await design(id, signal);
  const want = instance ?? String(d.defaultInstanceId || d.instances?.[0]?.id || "");
  // Standardprofil fehlt manchmal in der Liste (verborgen): dann das erste
  const prof = d.instances?.find((i) => String(i.id) === want) ?? (instance ? undefined : d.instances?.[0]);
  const loggedIn = !!(await token());
  if (instance && !prof) throw new ScrapeError("Dieses Druckprofil gibt es nicht mehr.", 404);
  if (instance && !loggedIn) throw new BambuError("Für Dateien von MakerWorld bei Bambu anmelden: Einstellungen → MakerWorld.", 401);

  let modelId = imported().get(String(d.id)) ?? null;
  const existed = modelId != null;
  if (!modelId) {
    modelId = store.createModel({
      name: d.title.trim().slice(0, 200) || `MakerWorld ${id}`,
      description: d.summary ? htmlText(d.summary).slice(0, 8000) : "",
      tags: [...new Set((d.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12),
      source_url: mwUrl(d.id),
      creator: d.designCreator?.name ?? "",
      license: d.license ?? "",
    });
    const pics = (d.designExtension?.design_pictures?.length ? d.designExtension.design_pictures : [{ url: d.cover }]).slice(0, 4);
    let cover: number | null = null;
    for (const [i, p] of pics.entries()) {
      emit({ t: "status", text: `Lade Bild ${i + 1} von ${pics.length} …` });
      try {
        const [fid] = await download(modelId, p.url, imageName(p.url, i), signal);
        cover ??= fid ?? null;
      } catch {
        /* Bild fehlt: egal */
      }
    }
    if (cover) store.updateModel(modelId, { cover_file_id: cover });
  }

  let fileId: number | null = null;
  let loaded = false;
  let note = "";
  if (prof && loggedIn) {
    const name = fileName(d.title, prof.title);
    const have = db.prepare("SELECT id FROM files WHERE model_id = ? AND name = ?").get(modelId, name) as { id: number } | undefined;
    if (have) fileId = have.id;
    else {
      emit({ t: "status", text: `Lade das Druckprofil „${prof.title}“ …` });
      try {
        const f = await profileFile(String(prof.id), signal);
        [fileId = null] = await download(modelId, f.url, name, signal);
        loaded = fileId != null;
      } catch (e) {
        if (e instanceof BambuError && e.status === 401) note = e.message;
        else note = `3MF nicht geladen: ${e instanceof FileError || e instanceof ScrapeError ? e.message : (e as Error).message}`;
      }
    }
  } else if (!loggedIn) note = "Ohne Bambu-Anmeldung nur Angaben und Bilder. Dateien: Einstellungen → MakerWorld.";
  emit({ t: "done", id: modelId, existed: existed && !loaded, files: loaded ? 1 : 0, note, file_id: fileId });
}
