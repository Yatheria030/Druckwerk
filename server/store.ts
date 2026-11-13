import type { Model, ModelDetail, ModelFile, ModelListItem, Printer, PrintJob } from "../shared/types.ts";
import { db, nowIso } from "./db.ts";

type Row = Record<string, unknown>;
const json = <T>(v: unknown, fallback: T): T => {
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
};

const toModel = (r: Row): Model => ({
  id: r.id as number,
  name: r.name as string,
  description: r.description as string,
  tags: json<string[]>(r.tags, []),
  source_url: r.source_url as string,
  creator: r.creator as string,
  license: r.license as string,
  favorite: !!r.favorite,
  cover_file_id: (r.cover_file_id as number | null) ?? null,
  created_at: r.created_at as string,
  updated_at: r.updated_at as string,
});

export const toFile = (r: Row): ModelFile => ({
  id: r.id as number,
  model_id: r.model_id as number,
  name: r.name as string,
  kind: r.kind as ModelFile["kind"],
  size: r.size as number,
  has_thumb: !!r.has_thumb,
  meta: json(r.meta, {}),
  created_at: r.created_at as string,
});

const PRINT_SELECT = `SELECT p.*, pr.name AS printer_name, m.name AS model_name,
  CAST((julianday(COALESCE(p.ended_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))) - julianday(p.started_at)) * 86400 AS INTEGER) AS duration_s,
  (SELECT ROUND(SUM(u.grams), 1) FROM spool_usage u WHERE u.print_id = p.id) AS filament_g
  FROM prints p JOIN printers pr ON pr.id = p.printer_id LEFT JOIN models m ON m.id = p.model_id`;

const toPrint = (r: Row): PrintJob => ({
  id: r.id as number,
  printer_id: r.printer_id as number,
  printer_name: r.printer_name as string,
  model_id: (r.model_id as number | null) ?? null,
  model_name: (r.model_name as string | null) ?? null,
  file_id: (r.file_id as number | null) ?? null,
  name: r.name as string,
  plate: (r.plate as number | null) ?? null,
  status: r.status as PrintJob["status"],
  progress: r.progress as number,
  started_at: r.started_at as string,
  ended_at: (r.ended_at as string | null) ?? null,
  duration_s: (r.duration_s as number | null) ?? null,
  filaments: json(r.filaments, []),
  error_code: (r.error_code as number | null) ?? null,
  rating: (r.rating as number | null) ?? null,
  note: r.note as string,
  has_photo: !!r.has_photo,
  filament_g: (r.filament_g as number | null) ?? null,
});

/** Titelbild: gewählte Datei, sonst erstes Bild, sonst erste Datei mit Vorschau */
const COVER = `COALESCE(
  (SELECT f.id FROM files f WHERE f.id = m.cover_file_id AND f.has_thumb = 1),
  (SELECT f.id FROM files f WHERE f.model_id = m.id AND f.kind = 'image' ORDER BY f.id LIMIT 1),
  (SELECT f.id FROM files f WHERE f.model_id = m.id AND f.has_thumb = 1 ORDER BY f.kind = 'gcode3mf', f.id LIMIT 1))`;

export function listModels(): ModelListItem[] {
  const rows = db
    .prepare(
      `SELECT m.*, ${COVER} AS cover_id,
        (SELECT COUNT(*) FROM files f WHERE f.model_id = m.id) AS file_count,
        EXISTS (SELECT 1 FROM files f WHERE f.model_id = m.id AND f.kind = 'gcode3mf') AS printable,
        (SELECT COUNT(*) FROM prints p WHERE p.model_id = m.id) AS print_count,
        (SELECT MAX(started_at) FROM prints p WHERE p.model_id = m.id) AS last_print
       FROM models m ORDER BY m.updated_at DESC`,
    )
    .all() as Row[];
  return rows.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    tags: json<string[]>(r.tags, []),
    favorite: !!r.favorite,
    cover: r.cover_id ? `/api/files/${r.cover_id}/thumb?v=${encodeURIComponent(String(r.updated_at))}` : null,
    file_count: r.file_count as number,
    printable: !!r.printable,
    print_count: r.print_count as number,
    last_print: (r.last_print as string | null) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }));
}

export function getModel(id: number): ModelDetail | null {
  const r = db.prepare("SELECT * FROM models WHERE id = ?").get(id) as Row | undefined;
  if (!r) return null;
  const files = (db.prepare("SELECT * FROM files WHERE model_id = ? ORDER BY kind = 'image', id").all(id) as Row[]).map(toFile);
  return { model: toModel(r), files, prints: listPrints({ modelId: id }) };
}

export type ModelInput = Partial<Omit<Model, "id" | "created_at" | "updated_at">>;

export function createModel(input: ModelInput & { name: string }): number {
  const r = db
    .prepare("INSERT INTO models (name, description, tags, source_url, creator, license) VALUES (?, ?, ?, ?, ?, ?)")
    .run(input.name, input.description ?? "", JSON.stringify(input.tags ?? []), input.source_url ?? "", input.creator ?? "", input.license ?? "");
  return Number(r.lastInsertRowid);
}

export function updateModel(id: number, input: ModelInput) {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  const put = (col: string, v: string | number | null) => (sets.push(`${col} = ?`), vals.push(v));
  if (input.name !== undefined) put("name", input.name);
  if (input.description !== undefined) put("description", input.description);
  if (input.tags !== undefined) put("tags", JSON.stringify(input.tags));
  if (input.source_url !== undefined) put("source_url", input.source_url);
  if (input.creator !== undefined) put("creator", input.creator);
  if (input.license !== undefined) put("license", input.license);
  if (input.favorite !== undefined) put("favorite", input.favorite ? 1 : 0);
  if (input.cover_file_id !== undefined) put("cover_file_id", input.cover_file_id);
  put("updated_at", nowIso());
  db.prepare(`UPDATE models SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

export const deleteModel = (id: number) => db.prepare("DELETE FROM models WHERE id = ?").run(id).changes > 0;

export function allTags(): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of db.prepare("SELECT tags FROM models").all() as Row[])
    for (const t of json<string[]>(r.tags, [])) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function listPrints(f: { modelId?: number; limit?: number } = {}): PrintJob[] {
  const where = f.modelId ? "WHERE p.model_id = ?" : "";
  const args = f.modelId ? [f.modelId] : [];
  return (db.prepare(`${PRINT_SELECT} ${where} ORDER BY p.started_at DESC LIMIT ${f.limit ?? 500}`).all(...args) as Row[]).map(toPrint);
}

export const getPrint = (id: number) => {
  const r = db.prepare(`${PRINT_SELECT} WHERE p.id = ?`).get(id) as Row | undefined;
  return r ? toPrint(r) : null;
};

export function updatePrint(id: number, input: { rating?: number | null; note?: string; model_id?: number | null }) {
  if (input.rating !== undefined) db.prepare("UPDATE prints SET rating = ? WHERE id = ?").run(input.rating, id);
  if (input.note !== undefined) db.prepare("UPDATE prints SET note = ? WHERE id = ?").run(input.note, id);
  if (input.model_id !== undefined) db.prepare("UPDATE prints SET model_id = ? WHERE id = ?").run(input.model_id, id);
}

export const deletePrint = (id: number) => db.prepare("DELETE FROM prints WHERE id = ?").run(id).changes > 0;

type PrinterRow = { id: number; name: string; host: string; serial: string; access_code: string; model: string };
export const printerRows = () => db.prepare("SELECT * FROM printers ORDER BY id").all() as PrinterRow[];
export const printerRow = (id: number) => db.prepare("SELECT * FROM printers WHERE id = ?").get(id) as PrinterRow | undefined;
export const toPrinter = (r: PrinterRow): Printer => ({ id: r.id, name: r.name, host: r.host, serial: r.serial, model: r.model, has_code: !!r.access_code });
export type { PrinterRow };
