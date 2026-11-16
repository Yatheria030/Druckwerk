// Farbkatalog je Hersteller in der Datenbank: Sorten mit Farben (Name, Hex, Bambu-Farbcode). Beim ersten Start aus server/seed/*.json
// gefüllt, danach pflegt die App ihn selbst (Katalogseiten unter Filament). Server und UI rechnen mit demselben Stand (setCatalog).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { setCatalog, type CatalogBrand } from "../shared/catalog.ts";
import type { LinePrice } from "../shared/prices.ts";
import type { LineSpecs } from "../shared/specs.ts";
import { db, nowIso } from "./db.ts";

type Seed = Omit<CatalogBrand, "id" | "lines"> & { lines: { material: string; name: string; profile_id: string | null; colors: { name: string; hex: string | null; code: string | null }[] }[] };

const SEED_DIR = path.join(import.meta.dirname, "seed");
const SPECS_DIR = path.join(import.meta.dirname, "specs");

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();
/** Datenblatt-Kennwerte aus server/specs/*.json je Marke und Sorte (Namen ohne Groß-/Kleinschreibung und Satzzeichen) */
const SPECS = (() => {
  const m = new Map<string, Map<string, LineSpecs>>();
  for (const f of readdirSync(SPECS_DIR).filter((f) => f.endsWith(".json"))) {
    const s = JSON.parse(readFileSync(path.join(SPECS_DIR, f), "utf8")) as { brand: string; lines: Record<string, LineSpecs> };
    m.set(key(s.brand), new Map(Object.entries(s.lines).filter(([, l]) => l.source || Object.keys(l.values).length).map(([n, l]) => [key(n), l])));
  }
  return m;
})();
const specsFor = (brand: string, match: string, line: string) =>
  (SPECS.get(key(brand)) ?? [...SPECS].find(([b]) => match && b.includes(key(match)))?.[1])?.get(key(line)) ?? null;

/** Shoppreise aus server/prices.json je Marke und Sorte (gleiche Namensregel wie die Kennwerte) */
const PRICES = (() => {
  const s = JSON.parse(readFileSync(path.join(import.meta.dirname, "prices.json"), "utf8")) as {
    date: string; brands: Record<string, Record<string, Omit<LinePrice, "date"> & { price: number | null }>>;
  };
  const m = new Map<string, Map<string, LinePrice>>();
  for (const [b, lines] of Object.entries(s.brands))
    m.set(key(b), new Map(Object.entries(lines).filter(([, p]) => p.price != null && p.net_g > 0).map(([n, p]) => [key(n), { ...p, price: p.price!, date: s.date }])));
  return m;
})();
const priceFor = (brand: string, match: string, line: string) =>
  (PRICES.get(key(brand)) ?? [...PRICES].find(([b]) => match && b.includes(key(match)))?.[1])?.get(key(line)) ?? null;

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
  dropUnknownHex();
  loadCatalog();
}

/** Farben ohne Hex gehören nicht in den Katalog: ältere Bestände bekommen den Hex aus dem Seed, falls er inzwischen recherchiert ist,
 *  der Rest fliegt raus */
function dropUnknownHex() {
  const open = db.prepare(
    "SELECT c.id, c.name, l.name AS line, b.name AS brand FROM catalog_colors c JOIN catalog_lines l ON l.id = c.line_id JOIN catalog_brands b ON b.id = l.brand_id WHERE c.hex IS NULL",
  ).all() as { id: number; name: string; line: string; brand: string }[];
  if (!open.length) return;
  const known = new Map<string, string>();
  for (const f of readdirSync(SEED_DIR).filter((f) => f.endsWith(".json"))) {
    const s = JSON.parse(readFileSync(path.join(SEED_DIR, f), "utf8")) as Seed;
    for (const l of s.lines) for (const c of l.colors) if (c.hex) known.set(`${s.brand}|${l.name}|${c.name}`, c.hex);
  }
  let filled = 0;
  db.exec("BEGIN");
  for (const c of open) {
    const h = known.get(`${c.brand}|${c.line}|${c.name}`);
    if (h) db.prepare("UPDATE catalog_colors SET hex = ? WHERE id = ?").run(h, c.id), filled++;
  }
  const lines = (db.prepare("SELECT DISTINCT line_id FROM catalog_colors WHERE hex IS NULL").all() as { line_id: number }[]).map((r) => r.line_id);
  const gone = Number(db.prepare("DELETE FROM catalog_colors WHERE hex IS NULL").run().changes);
  const empty = db.prepare("DELETE FROM catalog_lines WHERE id = ? AND NOT EXISTS (SELECT 1 FROM catalog_colors WHERE line_id = ?)");
  const emptied = lines.reduce((n, id) => n + Number(empty.run(id, id).changes), 0);
  db.prepare("UPDATE catalog_brands SET source = REPLACE(source, '; null = unbekannt', '; Farben ohne belegten Hex fehlen') WHERE source LIKE '%null = unbekannt%'").run();
  db.exec("COMMIT");
  console.log(`Katalog: ${filled} Farben mit recherchiertem Hex ergänzt, ${gone} ohne Hex entfernt, ${emptied} leere Sorten entfernt`);
}

function importBrand(s: Seed) {
  const b = db.prepare("INSERT INTO catalog_brands (name, match, url, source, created_at) VALUES (?, ?, ?, ?, ?)").run(s.brand, s.match, s.url, s.source, nowIso());
  const line = db.prepare("INSERT INTO catalog_lines (brand_id, material, name, profile_id, sort) VALUES (?, ?, ?, ?, ?)");
  const color = db.prepare("INSERT INTO catalog_colors (line_id, name, hex, code, sort) VALUES (?, ?, ?, ?, ?)");
  s.lines.forEach((l, i) => {
    const lid = line.run(b.lastInsertRowid, l.material, l.name, l.profile_id, i).lastInsertRowid;
    l.colors.filter((c) => c.hex).forEach((c, j) => color.run(lid, c.name, c.hex, c.code, j));
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
    id: number; line_id: number; name: string; hex: string; code: string | null;
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
      .map((l) => ({ id: l.id, material: l.material, name: l.name, profile_id: l.profile_id, colors: byLine.get(l.id) ?? [], specs: specsFor(b.name, b.match, l.name), price: priceFor(b.name, b.match, l.name) })),
  }));
}

export const loadCatalog = () => setCatalog(readCatalog());

const hex = (h: string | null | undefined) => {
  const v = (h ?? "").replace(/^#/, "").toUpperCase();
  if (!v) throw new CatalogError("Farben brauchen einen Farbcode (RRGGBB)");
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
export type ColorInput = { name: string; hex?: string | null; code?: string | null }; // hex ist Pflicht, hex() prüft

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
    db.prepare("UPDATE catalog_colors SET name = COALESCE(?, name), hex = COALESCE(?, hex), code = CASE WHEN ? THEN ? ELSE code END WHERE id = ?")
      .run(c.name ?? null, h ?? null, c.code !== undefined ? 1 : 0, c.code || null, id);
  }, `Die Farbe ${c.name} gibt es in dieser Sorte schon`);
}
export const deleteColor = (id: number) => run(() => db.prepare("DELETE FROM catalog_colors WHERE id = ?").run(id), "");
