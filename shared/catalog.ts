// Farbkatalog je Hersteller und Sorte. Die Daten liegen in der Datenbank (server/catalog.ts, Seed in server/seed/*.json),
// Server und UI setzen den aktuellen Stand hier per setCatalog und rechnen damit (Farbnamen, Sortenauswahl).

export type CatalogColor = { id: number; name: string; hex: string | null; code: string | null }; // hex ohne #, null = unbekannt
export type CatalogLine = { id: number; material: string; name: string; profile_id: string | null; colors: CatalogColor[] };
export type CatalogBrand = { id: number; brand: string; match: string; url: string; source: string; lines: CatalogLine[] };

let CATALOG: CatalogBrand[] = [];
export const setCatalog = (c: CatalogBrand[]) => void (CATALOG = c);
export const getCatalog = () => CATALOG;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** Marke über ihr Stichwort (`match`, ohne Groß-/Kleinschreibung im Markennamen der Spule enthalten) */
export const catalogBrand = (brand: string) => {
  const b = norm(brand);
  return b ? CATALOG.find((c) => c.match && b.includes(c.match.toLowerCase())) : undefined;
};
export const catalogLine = (brand: string, name: string) => catalogBrand(brand)?.lines.find((l) => norm(l.name) === norm(name));

/** Offizieller Farbname aus dem Katalog: erst in der Sorte, dann in allen Sorten der Marke (nur mit bekanntem Farbcode) */
export function catalogColorName(brand: string, name: string, hex: string): string | null {
  const h = hex.replace(/^#/, "").slice(0, 6).toUpperCase();
  const hit = (l?: CatalogLine) => l?.colors.find((c) => c.hex === h)?.name;
  return hit(catalogLine(brand, name)) ?? catalogBrand(brand)?.lines.map(hit).find(Boolean) ?? null;
}

/** Bambu-Name über das Druckprofil der Sorte: erst Farbcode vom Chip, dann Hex in der Sorte, dann Hex über alle Bambu-Sorten */
export function profileColorName(brand: string, hex: string, profile?: string | null, code?: string | null): string | null {
  const b = catalogBrand(brand);
  if (!b) return null;
  const h = hex.replace(/^#/, "").slice(0, 6).toUpperCase();
  const own = profile ? b.lines.filter((l) => l.profile_id === profile) : [];
  const find = (ls: CatalogLine[], f: (c: CatalogColor) => boolean) => ls.flatMap((l) => l.colors).find(f)?.name;
  return (code ? find(own, (c) => c.code === code) : undefined) ?? find(own, (c) => c.hex === h) ?? find(b.lines, (c) => c.hex === h) ?? null;
}

/** Farbname beim Sortenwechsel: Katalogname, den die neue Sorte nicht hat, fällt weg; eigene Namen bleiben */
export function carryColorName(line: CatalogLine, colorName: string): string {
  const n = colorName.trim();
  if (!n || line.colors.some((c) => c.name === n)) return colorName;
  return CATALOG.some((b) => b.lines.some((l) => l.colors.some((c) => c.name === n))) ? "" : colorName; // auch nach Markenwechsel
}
