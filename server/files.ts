import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { unzip, type UnzipFileInfo } from "fflate";
import type { FileKind, FileMeta, Plate, PlateFilament } from "../shared/types.ts";
import { db, FILE_DIR, THUMB_DIR } from "./db.ts";

export class FileError extends Error {}

const EXT: [RegExp, FileKind][] = [
  [/\.gcode\.3mf$/i, "gcode3mf"],
  [/\.3mf$/i, "3mf"],
  [/\.stl$/i, "stl"],
  [/\.obj$/i, "obj"],
  [/\.(step|stp)$/i, "step"],
  [/\.(png|jpe?g|webp|gif)$/i, "image"],
  [/\.(scad|f3d|fcstd|blend|skp|iges?|txt|md|pdf|gcode)$/i, "other"],
];

export const kindOf = (name: string): FileKind | null => EXT.find(([re]) => re.test(name))?.[1] ?? null;
const extOf = (name: string) => (/\.gcode\.3mf$/i.test(name) ? ".gcode.3mf" : path.extname(name).toLowerCase());

/** Dateiname ohne Pfad und Steuerzeichen */
export const cleanName = (name: string) =>
  path.basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200) || "datei";

export const baseName = (name: string) => cleanName(name).replace(/\.gcode\.3mf$/i, "").replace(/\.[a-z0-9]+$/i, "");

type FileRow = { id: number; model_id: number; name: string; kind: FileKind; path: string; meta: string; has_thumb: number };
export const fileRow = (id: number) => db.prepare("SELECT * FROM files WHERE id = ?").get(id) as FileRow | undefined;
export const absPath = (row: { path: string }) => path.join(FILE_DIR, row.path);
export const thumbPath = (id: number, plate?: number) => path.join(THUMB_DIR, plate ? `${id}-p${plate}.png` : `${id}.png`);

const MAX_UPLOAD = 2 * 1024 ** 3;

/** Speichert einen hochgeladenen Strom. ZIP-Archive werden ausgepackt; Rückgabe: angelegte Datei-IDs */
export async function saveUpload(modelId: number, rawName: string, body: ReadableStream<Uint8Array>): Promise<number[]> {
  const name = cleanName(rawName);
  const isZip = /\.zip$/i.test(name);
  const kind = kindOf(name);
  if (!isZip && !kind) throw new FileError(`Dateityp nicht unterstützt: ${name}`);

  const tmp = path.join(FILE_DIR, `.upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const hash = createHash("sha256");
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > MAX_UPLOAD) return cb(new FileError("Datei größer als 2 GB"));
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as never), counter, createWriteStream(tmp));
    if (isZip) return await importZip(modelId, tmp);
    return [await addFile(modelId, name, kind!, tmp, size, hash.digest("hex"))];
  } finally {
    await rm(tmp, { force: true });
  }
}

/** Lokale Datei (z. B. vom Drucker geholt) übernehmen; gleiche Datei (sha256) wird nicht doppelt angelegt. Verschiebt src. */
export async function importLocal(modelId: number | (() => number), rawName: string, src: string): Promise<{ id: number; model_id: number; existed: boolean }> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(src), hash);
  const sha = hash.digest("hex");
  const known = db.prepare("SELECT id, model_id FROM files WHERE sha256 = ? ORDER BY id LIMIT 1").get(sha) as { id: number; model_id: number } | undefined;
  if (known) return { ...known, existed: true };
  const name = cleanName(rawName);
  const kind = kindOf(name);
  if (!kind) throw new FileError(`Dateityp nicht unterstützt: ${name}`);
  const mid = typeof modelId === "function" ? modelId() : modelId;
  return { id: await addFile(mid, name, kind, src, (await stat(src)).size, sha), model_id: mid, existed: false };
}

/** Legt die Zeile an und verschiebt die Datei an ihren Platz (files/<model>/<id><ext>) */
async function addFile(modelId: number, name: string, kind: FileKind, src: string, size: number, sha: string): Promise<number> {
  const r = db.prepare("INSERT INTO files (model_id, name, kind, size, sha256) VALUES (?, ?, ?, ?, ?)").run(modelId, name, kind, size, sha);
  const id = Number(r.lastInsertRowid);
  const rel = path.join(String(modelId), `${id}${extOf(name)}`);
  await mkdir(path.join(FILE_DIR, String(modelId)), { recursive: true });
  await rename(src, path.join(FILE_DIR, rel));
  db.prepare("UPDATE files SET path = ? WHERE id = ?").run(rel, id);
  await analyze(id).catch((e) => console.warn(`Analyse von Datei ${id} fehlgeschlagen:`, e));
  touchModel(modelId);
  return id;
}

export const touchModel = (id: number) => db.prepare("UPDATE models SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);

const unzipAsync = (buf: Uint8Array, filter: (f: UnzipFileInfo) => boolean) =>
  new Promise<Record<string, Uint8Array>>((res, rej) => unzip(buf, { filter }, (err, out) => (err ? rej(err) : res(out))));

/** ZIP von Printables, Thingiverse, MakerWorld: alle bekannten Dateitypen übernehmen, Ordner und macOS-Reste weg */
async function importZip(modelId: number, zipPath: string): Promise<number[]> {
  const buf = await readFile(zipPath);
  let entries: Record<string, Uint8Array>;
  try {
    entries = await unzipAsync(buf, (f) => !/(^|\/)(__MACOSX|\.)/.test(f.name) && !f.name.endsWith("/") && kindOf(f.name) !== null);
  } catch {
    throw new FileError("ZIP-Archiv lässt sich nicht lesen");
  }
  const ids: number[] = [];
  for (const [entry, data] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
    const name = cleanName(entry);
    const tmp = `${zipPath}.${ids.length}`;
    await writeFile(tmp, data);
    ids.push(await addFile(modelId, name, kindOf(name)!, tmp, data.length, createHash("sha256").update(data).digest("hex")));
  }
  if (!ids.length) throw new FileError("Im ZIP-Archiv sind keine 3D-Dateien");
  return ids;
}

const PRINTER_IDS: Record<string, string> = {
  C11: "P1P", C12: "P1S", N1: "A1 mini", N2S: "A1", "BL-P001": "X1 Carbon", "BL-P002": "X1", C13: "X1E", O1D: "H2D", O1S: "H2S", N7: "P2S",
};
export const printerLabel = (id: string | null) => (id ? (PRINTER_IDS[id] ?? id) : null);

const attr = (s: string, k: string) => s.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1] ?? "";
const num = (s: string) => (s === "" || !Number.isFinite(Number(s)) ? null : Number(s));

/** Platten aus Metadata/slice_info.config (Bambu Studio / OrcaSlicer) */
export function parseSliceInfo(xml: string): Plate[] {
  const plates: Plate[] = [];
  for (const block of xml.match(/<plate>[\s\S]*?<\/plate>/g) ?? []) {
    const meta: Record<string, string> = {};
    for (const m of block.matchAll(/<metadata\s+key="([^"]+)"\s+value="([^"]*)"/g)) meta[m[1]!] = m[2]!;
    const filaments: PlateFilament[] = [...block.matchAll(/<filament\b[^>]*\/?>/g)].map(([tag]) => ({
      id: Number(attr(tag, "id")) || 1,
      type: attr(tag, "type"),
      color: attr(tag, "color").slice(0, 7),
      used_g: num(attr(tag, "used_g")),
      used_m: num(attr(tag, "used_m")),
    }));
    plates.push({
      index: Number(meta.index) || plates.length + 1,
      prediction_s: num(meta.prediction ?? ""),
      weight_g: num(meta.weight ?? ""),
      printer_model: printerLabel(meta.printer_model_id || null),
      nozzle: meta.nozzle_diameters || null,
      filaments,
      has_image: false,
      objects: [...block.matchAll(/<object\b[^>]*>/g)].filter(([tag]) => attr(tag, "skipped") !== "true").length,
    });
  }
  return plates;
}

const xmlAttr = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Lage der Teile auf dem Bett aus Metadata/plate_N.json (`bbox_objects`: [minX, minY, maxX, maxY] in mm), für den Viewer */
export function plateBoxes(raw: Uint8Array | undefined): [number, number, number, number][] | undefined {
  if (!raw) return undefined;
  try {
    const j = JSON.parse(new TextDecoder().decode(raw)) as { bbox_objects?: { bbox?: number[] }[] };
    const out = (j.bbox_objects ?? []).map((o) => o.bbox ?? []).filter((b) => b.length === 4 && b.every(Number.isFinite));
    return out.length ? out.map((b) => b.map((v) => Math.round(v * 100) / 100) as [number, number, number, number]) : undefined;
  } catch {
    return undefined;
  }
}

/** Platten aus Metadata/model_settings.config: Nummer, Name und Teilezahl (Bambu Studio, Orca) */
function modelPlates(xml: Uint8Array | undefined): { index: number; name: string; objects: number }[] {
  if (!xml) return [];
  const text = new TextDecoder().decode(xml);
  return (text.match(/<plate>[\s\S]*?<\/plate>/g) ?? []).map((b, i) => ({
    index: Number(b.match(/key="plater_id"\s+value="(\d+)"/)?.[1]) || i + 1,
    name: xmlAttr(b.match(/key="plater_name"\s+value="([^"]*)"/)?.[1] ?? "").trim(),
    objects: (b.match(/<model_instance>/g) ?? []).length,
  }));
}

function nameP(plates: Plate[], xml: Uint8Array | undefined) {
  const names = modelPlates(xml);
  for (const p of plates) {
    const n = names.find((x) => x.index === p.index)?.name;
    if (n) p.name = n;
  }
}

/** Platten einer unslicten Projekt-3MF; Zeit und Gramm, wenn der Autor die Datei geslict gespeichert hat (MakerWorld) */
function projectPlates(out: Record<string, Uint8Array>, images: number[]): Plate[] {
  const layout = modelPlates(out["Metadata/model_settings.config"]);
  const xml = out["Metadata/slice_info.config"];
  const sliced = xml ? parseSliceInfo(new TextDecoder().decode(xml)) : [];
  return layout.map((l) => {
    const s = sliced.find((p) => p.index === l.index);
    return {
      index: l.index,
      name: l.name || undefined,
      prediction_s: s?.prediction_s ?? null,
      weight_g: s?.weight_g ?? null,
      printer_model: s?.printer_model ?? null,
      nozzle: s?.nozzle ?? null,
      filaments: s?.filaments ?? [],
      has_image: images.includes(l.index),
      objects: l.objects,
    };
  });
}

/** Ältere Dateien ohne Teilezahl je Platte einmal neu auslesen (beim Start, im Hintergrund) */
export async function upgradeMeta() {
  const rows = db.prepare("SELECT id, kind, meta FROM files WHERE kind IN ('gcode3mf', '3mf')").all() as { id: number; kind: string; meta: string }[];
  for (const r of rows) {
    const m = JSON.parse(r.meta) as FileMeta;
    if (r.kind === "3mf" ? m.layout : m.plates?.length && m.plates.every((p) => p.objects !== undefined && p.boxes !== undefined)) continue;
    await analyze(r.id).catch((e) => console.warn(`Analyse von Datei ${r.id} fehlgeschlagen:`, (e as Error).message));
  }
}

/** Liest eine Datei nach dem Speichern aus: Vorschaubilder und Platten aus 3MF, Bild = eigenes Vorschaubild */
export async function analyze(id: number) {
  const row = fileRow(id);
  if (!row) return;
  if (row.kind === "image") {
    db.prepare("UPDATE files SET has_thumb = 1 WHERE id = ?").run(id);
    return;
  }
  if (row.kind !== "3mf" && row.kind !== "gcode3mf") return;
  const { size } = await stat(absPath(row));
  if (size > 400 * 1024 ** 2) return;
  const gcode: number[] = [];
  const out = await unzipAsync(await readFile(absPath(row)), (f) => {
    const g = f.name.match(/^Metadata\/plate_(\d+)\.gcode$/);
    if (g) gcode.push(Number(g[1]));
    // Kopf von 3D/3dmodel.model trägt Titel, Designer und Lizenz (MakerWorld, Bambu Studio); nur bei handlicher Größe auspacken
    if (f.name === "3D/3dmodel.model") return f.originalSize <= 64 * 1024 ** 2;
    return /^Metadata\/(slice_info\.config|model_settings\.config|plate_\d+\.(png|json)|thumbnail\.png)$/.test(f.name);
  });
  const head = out["3D/3dmodel.model"];
  if (head) fillModelMeta(row.model_id, row.name, new TextDecoder().decode(head.subarray(0, 256 * 1024)));
  const meta: FileMeta = {};
  const images: number[] = [];
  for (const [n, data] of Object.entries(out)) {
    const p = n.match(/^Metadata\/plate_(\d+)\.png$/);
    if (p) {
      images.push(Number(p[1]));
      await writeFile(thumbPath(id, Number(p[1])), data);
    }
  }
  images.sort((a, b) => a - b);
  const cover = images.length ? out[`Metadata/plate_${images[0]}.png`] : out["Metadata/thumbnail.png"];
  if (cover) await writeFile(thumbPath(id), cover);
  if (images.length) meta.images = images;

  let kind = row.kind;
  if (gcode.length) {
    kind = "gcode3mf";
    const xml = out["Metadata/slice_info.config"];
    let plates = xml ? parseSliceInfo(new TextDecoder().decode(xml)) : [];
    // Nur Platten mit G-Code sind druckbar; ohne slice_info wenigstens die Nummern
    plates = gcode.sort((a, b) => a - b).map(
      (i) => plates.find((p) => p.index === i) ?? { index: i, prediction_s: null, weight_g: null, printer_model: null, nozzle: null, filaments: [], has_image: false, objects: 0 },
    );
    for (const p of plates) {
      p.has_image = images.includes(p.index);
      p.boxes = plateBoxes(out[`Metadata/plate_${p.index}.json`]) ?? []; // Lage der Teile für die Plattenansicht im Druckdialog
    }
    nameP(plates, out["Metadata/model_settings.config"]);
    meta.plates = plates;
  } else if (kind === "3mf") meta.layout = projectPlates(out, images);
  db.prepare("UPDATE files SET kind = ?, meta = ?, has_thumb = ? WHERE id = ?").run(kind, JSON.stringify(meta), cover ? 1 : 0, id);
}

const xmlText = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/[ \t]+/g, " ")
    .trim();

/** Leere Felder des Modells aus den 3MF-Metadaten füllen; Name nur, wenn er noch der Dateiname ist */
/** Beschreibung aus der 3MF: MakerWorld legt sie als doppelt maskiertes HTML ab („&amp;lt;p&amp;gt;“); entmaskieren, bis keine Tags mehr übrig sind */
function descText(raw: string) {
  let s = raw;
  for (let i = 0; i < 3 && /&(lt|gt|amp|quot|#\d+);/.test(s); i++)
    s = s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  return s
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/commercial\w*)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function fillModelMeta(modelId: number, fileName: string, xml: string) {
  const md: Record<string, string> = {};
  for (const m of xml.matchAll(/<metadata\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/metadata>/g)) md[m[1]!] = m[1] === "Description" ? descText(m[2]!) : xmlText(m[2]!);
  const m = db.prepare("SELECT name, description, creator, license, source_url FROM models WHERE id = ?").get(modelId) as
    | { name: string; description: string; creator: string; license: string; source_url: string }
    | undefined;
  if (!m) return;
  const set: Record<string, string> = {};
  if (!m.creator && md.Designer) set.creator = md.Designer.slice(0, 200);
  if (!m.license && md.License) set.license = md.License.slice(0, 200);
  if (!m.description && md.Description) set.description = md.Description.slice(0, 8000);
  if (md.Title && m.name === baseName(fileName)) set.name = md.Title.slice(0, 200);
  if (!m.source_url && /^https?:\/\//.test(md.Origin ?? "")) set.source_url = md.Origin!.slice(0, 1000);
  const keys = Object.keys(set);
  if (keys.length) db.prepare(`UPDATE models SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => set[k]!), modelId);
}

export async function removeFile(id: number) {
  const row = fileRow(id);
  if (!row) return false;
  db.prepare("UPDATE models SET cover_file_id = NULL WHERE cover_file_id = ?").run(id);
  db.prepare("DELETE FROM files WHERE id = ?").run(id);
  await rm(absPath(row), { force: true });
  await removeThumbs(id, row.meta);
  touchModel(row.model_id);
  return true;
}

async function removeThumbs(id: number, metaJson: string) {
  const meta = JSON.parse(metaJson) as FileMeta;
  await rm(thumbPath(id), { force: true });
  for (const p of meta.images ?? []) await rm(thumbPath(id, p), { force: true });
  await rm(path.join(FILE_DIR, ".step", `${id}.stl`), { force: true }); // STL zum Slicen (server/step.ts), IDs werden neu vergeben
}

export async function removeModelFiles(modelId: number) {
  const rows = db.prepare("SELECT id, meta FROM files WHERE model_id = ?").all(modelId) as { id: number; meta: string }[];
  for (const r of rows) await removeThumbs(r.id, r.meta);
  await rm(path.join(FILE_DIR, String(modelId)), { recursive: true, force: true });
}

/** Vorschaubild, das der Browser für STL/OBJ gerendert hat */
export async function saveThumb(id: number, png: Uint8Array) {
  if (png.length < 8 || png[0] !== 0x89 || png[1] !== 0x50) throw new FileError("Kein PNG");
  await writeFile(thumbPath(id), png);
  db.prepare("UPDATE files SET has_thumb = 1 WHERE id = ?").run(id);
}

export const readStream = (p: string) => Readable.toWeb(createReadStream(p)) as ReadableStream;
export { existsSync };
