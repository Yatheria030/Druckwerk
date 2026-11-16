import type { Collection, Model, ModelDetail, ModelFile, ModelListItem, Printer, PrintJob, StatsMonth } from "../shared/types.ts";
import { db, nowIso } from "./db.ts";
import { setting } from "./settings.ts";

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
  (SELECT ROUND(SUM(u.grams), 1) FROM spool_usage u WHERE u.print_id = p.id) AS filament_g,
  (SELECT json_group_array(json_object('spool_id', u.spool_id, 'grams', u.grams)) FROM spool_usage u WHERE u.print_id = p.id AND u.source = 'druck') AS usage_json,
  (SELECT json_group_array(s.id) FROM json_each(p.trays_seen) t JOIN spools s ON s.printer_id = p.printer_id AND s.tray = t.value AND s.archived = 0) AS seen_json,
  (SELECT SUM(u.grams * COALESCE(s.price_sale, s.price) / s.net_g) FROM spool_usage u JOIN spools s ON s.id = u.spool_id
    WHERE u.print_id = p.id AND COALESCE(s.price_sale, s.price) IS NOT NULL AND s.net_g > 0) AS cost_filament
  FROM prints p JOIN printers pr ON pr.id = p.printer_id LEFT JOIN models m ON m.id = p.model_id`;

/** Strom je Druck: gemessen über die Steckdose, sonst geschätzt aus der eingestellten Leistung × Dauer (nur beendete Drucke) */
function energyOf(r: Row, kwh: number | null, watts: number | null) {
  const measured = r.energy_wh as number | null;
  const est = measured == null && watts && r.status !== "laeuft" && r.duration_s != null ? (watts * (r.duration_s as number)) / 3600 : null;
  const wh = measured ?? est;
  return { energy_wh: wh == null ? null : Math.round(wh), energy_measured: measured != null, cost_energy: wh != null && kwh != null ? Math.round((wh / 1000) * kwh * 100) / 100 : null };
}

const toPrint = (r: Row, kwh = setting<number | null>("kosten", "kwh_price"), watts = setting<number | null>("kosten", "watts")): PrintJob => ({
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
  timelapse: (r.timelapse as string | null) ?? null,
  filament_g: (r.filament_g as number | null) ?? null,
  usage: json(r.usage_json, []),
  seen_spools: json(r.seen_json, []),
  // Kalibrierdrucke verbrauchen kaum etwas und haben nie eine Datei
  usage_missing: r.status !== "laeuft" && (r.progress as number) > 0 && r.filament_g == null && !/^auto_cali/i.test(r.name as string),
  cost_filament: r.cost_filament == null ? null : Math.round((r.cost_filament as number) * 100) / 100,
  ...energyOf(r, kwh, watts),
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
        (SELECT MAX(started_at) FROM prints p WHERE p.model_id = m.id) AS last_print,
        (SELECT json_group_array(collection_id) FROM collection_models cm WHERE cm.model_id = m.id) AS collections
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
    collections: json<number[]>(r.collections, []),
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }));
}

export function getModel(id: number): ModelDetail | null {
  const r = db.prepare("SELECT * FROM models WHERE id = ?").get(id) as Row | undefined;
  if (!r) return null;
  const files = (db.prepare("SELECT * FROM files WHERE model_id = ? ORDER BY kind = 'image', id").all(id) as Row[]).map(toFile);
  return { model: toModel(r), files, prints: listPrints({ modelId: id }), collections: modelCollections(id) };
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

// ---------- Sammlungen ----------

const modelCollections = (id: number) =>
  (db.prepare("SELECT collection_id FROM collection_models WHERE model_id = ? ORDER BY collection_id").all(id) as { collection_id: number }[]).map((r) => r.collection_id);

export function listCollections(): Collection[] {
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM collection_models cm WHERE cm.collection_id = c.id) AS count
       FROM collections c ORDER BY c.name COLLATE NOCASE`,
    )
    .all() as Row[];
  const covers = db.prepare(
    `SELECT ${COVER} AS cover_id, m.updated_at FROM collection_models cm JOIN models m ON m.id = cm.model_id
     WHERE cm.collection_id = ? ORDER BY cm.added_at DESC LIMIT 8`,
  );
  return rows.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    description: r.description as string,
    count: r.count as number,
    covers: (covers.all(r.id as number) as Row[])
      .filter((c) => c.cover_id)
      .slice(0, 4)
      .map((c) => `/api/files/${c.cover_id}/thumb?v=${encodeURIComponent(String(c.updated_at))}`),
    created_at: r.created_at as string,
  }));
}

export const getCollection = (id: number) => db.prepare("SELECT * FROM collections WHERE id = ?").get(id) as Row | undefined;
export const createCollection = (name: string, description: string) =>
  Number(db.prepare("INSERT INTO collections (name, description, created_at) VALUES (?, ?, ?)").run(name, description, nowIso()).lastInsertRowid);
export function updateCollection(id: number, v: { name?: string; description?: string }) {
  if (v.name !== undefined) db.prepare("UPDATE collections SET name = ? WHERE id = ?").run(v.name, id);
  if (v.description !== undefined) db.prepare("UPDATE collections SET description = ? WHERE id = ?").run(v.description, id);
}
export const deleteCollection = (id: number) => db.prepare("DELETE FROM collections WHERE id = ?").run(id).changes > 0;

/** Sammlungen eines Modells setzen (unbekannte IDs fallen weg, Reihenfolge der Aufnahme bleibt) */
export function setModelCollections(modelId: number, ids: number[]) {
  const known = new Set((db.prepare("SELECT id FROM collections").all() as { id: number }[]).map((r) => r.id));
  const want = new Set(ids.filter((i) => known.has(i)));
  const have = new Set(modelCollections(modelId));
  for (const i of have) if (!want.has(i)) db.prepare("DELETE FROM collection_models WHERE collection_id = ? AND model_id = ?").run(i, modelId);
  for (const i of want) if (!have.has(i)) db.prepare("INSERT INTO collection_models (collection_id, model_id, added_at) VALUES (?, ?, ?)").run(i, modelId, nowIso());
}

export function allTags(): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of db.prepare("SELECT tags FROM models").all() as Row[])
    for (const t of json<string[]>(r.tags, [])) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function listPrints(f: { modelId?: number; limit?: number } = {}): PrintJob[] {
  const where = f.modelId ? "WHERE p.model_id = ?" : "";
  const args = f.modelId ? [f.modelId] : [];
  const kwh = setting<number | null>("kosten", "kwh_price");
  const watts = setting<number | null>("kosten", "watts");
  return (db.prepare(`${PRINT_SELECT} ${where} ORDER BY p.started_at DESC LIMIT ${f.limit ?? 500}`).all(...args) as Row[]).map((r) => toPrint(r, kwh, watts));
}

/** Monatswerte für die Statistik, ältester Monat zuerst, Lücken als leere Monate (höchstens 10 Jahre) */
export function stats(): StatsMonth[] {
  const prints = listPrints({ limit: 100_000 });
  const usage = db
    .prepare(`SELECT u.created_at, u.grams, s.material FROM spool_usage u JOIN spools s ON s.id = u.spool_id WHERE u.source = 'druck'`)
    .all() as { created_at: string; grams: number; material: string }[];
  const key = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const months = new Map<string, StatsMonth>();
  const at = (m: string) => {
    let r = months.get(m);
    if (!r) months.set(m, (r = { month: m, prints: 0, fertig: 0, abgebrochen: 0, fehler: 0, print_s: 0, grams: 0, cost_filament: 0, cost_energy: 0, materials: {} }));
    return r;
  };
  for (const p of prints) {
    const r = at(key(p.started_at));
    r.prints++;
    if (p.status !== "laeuft") {
      r[p.status]++;
      r.print_s += p.duration_s ?? 0;
    }
    r.cost_filament += p.cost_filament ?? 0;
    r.cost_energy += p.cost_energy ?? 0;
  }
  for (const u of usage) {
    const r = at(key(u.created_at));
    const mat = (u.material || "Sonstiges").toUpperCase();
    r.grams += u.grams;
    r.materials[mat] = (r.materials[mat] ?? 0) + u.grams;
  }
  // Durchgehende Reihe bis zum aktuellen Monat
  const keys = [...months.keys(), key(nowIso())].sort();
  const out: StatsMonth[] = [];
  const d = new Date(`${keys[0]}-01T12:00:00`);
  const last = keys.at(-1)!;
  for (let i = 0; i < 120; i++) {
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push(at(m));
    if (m === last) break;
    d.setMonth(d.getMonth() + 1);
  }
  return out.slice(-120);
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

type PrinterRow = { id: number; name: string; host: string; serial: string; access_code: string; model: string; plug: string; clock_offset: number | null };
export const printerRows = () => db.prepare("SELECT * FROM printers ORDER BY id").all() as PrinterRow[];
export const printerRow = (id: number) => db.prepare("SELECT * FROM printers WHERE id = ?").get(id) as PrinterRow | undefined;
export const toPrinter = (r: PrinterRow): Printer => ({ id: r.id, name: r.name, host: r.host, serial: r.serial, model: r.model, has_code: !!r.access_code, plug: r.plug });
export type { PrinterRow };
