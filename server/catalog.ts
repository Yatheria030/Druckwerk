// Farbkatalog je Hersteller in der Datenbank: Sorten mit Farben (Name, Hex, Bambu-Farbcode). Beim ersten Start aus server/seed/*.json
// gefüllt, danach pflegt die App ihn selbst (Katalogseiten unter Filament). Server und UI rechnen mit demselben Stand (setCatalog).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { setCatalog, type CatalogBrand } from "../shared/catalog.ts";
import { db, nowIso } from "./db.ts";

type Seed = Omit<CatalogBrand, "id" | "lines"> & { lines: { material: string; name: string; profile_id: string | null; colors: { name: string; hex: string | null; code: string | null }[] }[] };

const SEED_DIR = path.join(import.meta.dirname, "seed");

export class CatalogError extends Error {}

/** Marken aus den Seed-Dateien anlegen, die noch fehlen (gelöschte Marken kommen nicht wieder: `catalog_seeded`) */
export function seedCatalog() {
  const seeded = new Set((db.prepare("SELECT name FROM catalog_seeded").all() as { name: string }[]).map((r) => r.name));
  for (const f of readdirSync(SEED_DIR).filter((f) => f.endsWith(".json")).sort()) {
    const s = JSON.parse(readFileSync(path.join(SEED_DIR, f), "utf8")) as Seed;
    if (seeded.has(s.brand)) continue;
    db.exec("BEGIN");
    try {
      if (!db.prepare("SELECT 1 FROM catalog_brands WHERE name = ?").get(s.brand)) importBrand(s);
      db.prepare("INSERT INTO catalog_seeded (name, at) VALUES (?, ?)").run(s.brand, nowIso());
      db.exec("COMMIT");
      console.log(`Katalog: ${s.brand} mit ${s.lines.length} Sorten aus ${f} übernommen`);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  loadCatalog();
}

function importBrand(s: Seed) {
  const b = db.prepare("INSERT INTO catalog_brands (name, match, url, source, created_at) VALUES (?, ?, ?, ?, ?)").run(s.brand, s.match, s.url, s.source, nowIso());
  const line = db.prepare("INSERT INTO catalog_lines (brand_id, material, name, profile_id, sort) VALUES (?, ?, ?, ?, ?)");
  const color = db.prepare("INSERT INTO catalog_colors (line_id, name, hex, code, sort) VALUES (?, ?, ?, ?, ?)");
  s.lines.forEach((l, i) => {
    const lid = line.run(b.lastInsertRowid, l.material, l.name, l.profile_id, i).lastInsertRowid;
    l.colors.forEach((c, j) => color.run(lid, c.name, c.hex, c.code, j));
  });
}

/** Ganzer Katalog, Sorten und Farben in gespeicherter Reihenfolge */
export function readCatalog(): CatalogBrand[] {
  const brands = db.prepare("SELECT id, name, match, url, source FROM catalog_brands ORDER BY name COLLATE NOCASE").all() as {
    id: number; name: string; match: string; url: string; source: string;
  }[];
  const lines = db.prepare("SELECT id, brand_id, material, name, profile_id FROM catalog_lines ORDER BY sort, id").all() as {
    id: number; brand_id: number; material: string; name: string; profile_id: string | null;
  }[];
  const colors = db.prepare("SELECT id, line_id, name, hex, code FROM catalog_colors ORDER BY sort, id").all() as {
    id: number; line_id: number; name: string; hex: string | null; code: string | null;
  }[];
  const byLine = new Map<number, CatalogBrand["lines"][number]["colors"]>();
  for (const c of colors) byLine.set(c.line_id, [...(byLine.get(c.line_id) ?? []), { id: c.id, name: c.name, hex: c.hex, code: c.code }]);
  return brands.map((b) => ({
    id: b.id,
    brand: b.name,
    match: b.match,
    url: b.url,
    source: b.source,
    lines: lines
      .filter((l) => l.brand_id === b.id)
      .map((l) => ({ id: l.id, material: l.material, name: l.name, profile_id: l.profile_id, colors: byLine.get(l.id) ?? [] })),
  }));
}

export const loadCatalog = () => setCatalog(readCatalog());

const hex = (h: string | null | undefined) => {
  if (h == null || h === "") return null;
  const v = h.replace(/^#/, "").toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(v)) throw new CatalogError("Farbcode als RRGGBB, z. B. 1E64C8");
  return v;
};

function run(fn: () => void, dup: string) {
  try {
    fn();
  } catch (e) {
    if (/UNIQUE/.test(String(e))) throw new CatalogError(dup);
    throw e;
  }
  loadCatalog();
}

export type BrandInput = { name: string; match?: string; url?: string; source?: string };
export type LineInput = { material: string; name: string; profile_id?: string | null };
export type ColorInput = { name: string; hex?: string | null; code?: string | null };

export function addBrand(b: BrandInput): number {
  let id = 0;
  run(() => {
    id = Number(
      db.prepare("INSERT INTO catalog_brands (name, match, url, source, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(b.name, (b.match || b.name.split(/\s+/)[0]!).toLowerCase(), b.url ?? "", b.source ?? "Von Hand", nowIso()).lastInsertRowid,
    );
  }, `${b.name} gibt es schon`);
  return id;
}
export function updateBrand(id: number, b: Partial<BrandInput>) {
  run(() => {
    db.prepare("UPDATE catalog_brands SET name = COALESCE(?, name), match = COALESCE(?, match), url = COALESCE(?, url), source = COALESCE(?, source) WHERE id = ?")
      .run(b.name ?? null, b.match ? b.match.toLowerCase() : null, b.url ?? null, b.source ?? null, id);
  }, `${b.name} gibt es schon`);
}
export const deleteBrand = (id: number) => run(() => db.prepare("DELETE FROM catalog_brands WHERE id = ?").run(id), "");

const nextSort = (table: string, col: string, id: number) =>
  ((db.prepare(`SELECT MAX(sort) AS m FROM ${table} WHERE ${col} = ?`).get(id) as { m: number | null }).m ?? -1) + 1;

export function addLine(brandId: number, l: LineInput): number {
  let id = 0;
  run(() => {
    id = Number(
      db.prepare("INSERT INTO catalog_lines (brand_id, material, name, profile_id, sort) VALUES (?, ?, ?, ?, ?)")
        .run(brandId, l.material, l.name, l.profile_id || null, nextSort("catalog_lines", "brand_id", brandId)).lastInsertRowid,
    );
  }, `Die Sorte ${l.name} gibt es schon`);
  return id;
}
export function updateLine(id: number, l: Partial<LineInput>) {
  run(() => {
    db.prepare("UPDATE catalog_lines SET material = COALESCE(?, material), name = COALESCE(?, name), profile_id = CASE WHEN ? THEN ? ELSE profile_id END WHERE id = ?")
      .run(l.material ?? null, l.name ?? null, l.profile_id !== undefined ? 1 : 0, l.profile_id || null, id);
  }, `Die Sorte ${l.name} gibt es schon`);
}
export const deleteLine = (id: number) => run(() => db.prepare("DELETE FROM catalog_lines WHERE id = ?").run(id), "");

export function addColor(lineId: number, c: ColorInput): number {
  const h = hex(c.hex);
  let id = 0;
  run(() => {
    id = Number(
      db.prepare("INSERT INTO catalog_colors (line_id, name, hex, code, sort) VALUES (?, ?, ?, ?, ?)")
        .run(lineId, c.name, h, c.code || null, nextSort("catalog_colors", "line_id", lineId)).lastInsertRowid,
    );
  }, `Die Farbe ${c.name} gibt es in dieser Sorte schon`);
  return id;
}
export function updateColor(id: number, c: Partial<ColorInput>) {
  const h = c.hex !== undefined ? hex(c.hex) : undefined;
  run(() => {
    db.prepare("UPDATE catalog_colors SET name = COALESCE(?, name), hex = CASE WHEN ? THEN ? ELSE hex END, code = CASE WHEN ? THEN ? ELSE code END WHERE id = ?")
      .run(c.name ?? null, h !== undefined ? 1 : 0, h ?? null, c.code !== undefined ? 1 : 0, c.code || null, id);
  }, `Die Farbe ${c.name} gibt es in dieser Sorte schon`);
}
export const deleteColor = (id: number) => run(() => db.prepare("DELETE FROM catalog_colors WHERE id = ?").run(id), "");
