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
    });
  }
  return plates;
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
    return /^Metadata\/(slice_info\.config|plate_\d+\.png|thumbnail\.png)$/.test(f.name);
  });
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
      (i) => plates.find((p) => p.index === i) ?? { index: i, prediction_s: null, weight_g: null, printer_model: null, nozzle: null, filaments: [], has_image: false },
    );
    for (const p of plates) p.has_image = images.includes(p.index);
    meta.plates = plates;
  }
  db.prepare("UPDATE files SET kind = ?, meta = ?, has_thumb = ? WHERE id = ?").run(kind, JSON.stringify(meta), cover ? 1 : 0, id);
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
