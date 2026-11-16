// Mindestbestand je Sorte oder Farbe, Marke, Sorte und Material optional: Bestand = Rest aller passenden Spulen im Regal (auch eingeschweißte).
// Fällt er unter den Schwellwert, steht die Sorte bzw. Farbe auf der Einkaufsliste, mit Link zum Shop.
import { catalogBrand } from "./catalog.ts";
import { inColorFamily, isGenericColor } from "./colors.ts";
import { baseMaterial, colorDist, paidPrice, pricePerG, type Spool } from "./types.ts";

export type StockRule = {
  id: number;
  brand: string; // leer = alle Marken
  line: string; // Sorte („PLA Matte“), leer = jede Sorte des Materials
  material: string; // leer (und keine Sorte) = alle Materialien
  color: string; // #RRGGBB, leer = alle Farben
  color_name: string; // Grundfarbe („Rot“) = die ganze Farbfamilie, sonst ein bestimmter Farbton
  min_g: number;
  url: string; // eigener Shop-Link, steht bei den Bezugsquellen zuerst
  created_at: string;
};
export type StockRuleInput = Omit<StockRule, "id" | "created_at">;

/** Bezugsquelle aus den passenden Spulen (auch archivierten), je Shop die letzte Spule */
export type StockSource = {
  host: string;
  url: string;
  price: number | null; // zuletzt gezahlter Preis (reduziert, falls eingetragen)
  net_g: number | null;
  per_g: number | null;
  date: string | null; // Kaufdatum (angelegt) der Spule mit diesem Preis
  label: string; // „Bambu Lab PLA Matte · Rot“
  count: number; // so oft dort gekauft
  cheapest: boolean;
  kind: "spule" | "eigen" | "katalog";
};

export type StockStatus = {
  rule: StockRule;
  stock_g: number;
  spools: number; // Spulen mit Rest
  low: boolean;
  shop: string | null;
  sources: StockSource[];
  last: Spool | null; // jüngste passende Spule (auch archiviert), Vorlage fürs Nachkaufen
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
export const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/** Gehört die Spule zur Regel? Leere Marke, Sorte oder Material passen auf alles; Grundfarben („Rot“) über die Farbfamilie,
 *  sonst Farbe über Namen oder ähnlichen Farbwert */
export function ruleMatches(r: Pick<StockRule, "brand" | "line" | "material" | "color" | "color_name">, s: Spool) {
  if (r.brand.trim() && norm(r.brand) !== norm(s.brand)) return false;
  if (r.line.trim()) {
    if (norm(r.line) !== norm(s.name)) return false;
  } else if (r.material.trim() && baseMaterial(r.material) !== baseMaterial(s.material)) return false;
  if (!r.color && !r.color_name) return true;
  if (r.color_name && s.color_name && norm(r.color_name) === norm(s.color_name)) return true;
  if (r.color_name && isGenericColor(r.color_name)) return /^#[0-9a-f]{6}/i.test(s.color) && inColorFamily(r.color_name, s.color);
  return !!r.color && /^#[0-9a-f]{6}$/i.test(s.color) && colorDist(r.color, s.color) <= 30;
}

export const ruleTitle = (r: Pick<StockRule, "brand" | "line" | "material" | "color_name">) =>
  r.color_name || r.line || r.material || r.brand || "Alle Filamente";
/** Zweite Zeile, z. B. „PLA · alle Marken“ unter „Rot“ */
export const ruleSub = (r: Pick<StockRule, "brand" | "line" | "material" | "color" | "color_name">) => {
  if (r.color_name || r.color) return [r.line || r.material || "alle Materialien", r.brand || "alle Marken"].join(" · ");
  if (r.line || r.material) return `${r.brand || "alle Marken"} · alle Farben`;
  return r.brand ? "alle Materialien · alle Farben" : "alle Marken · alle Farben";
};

const newest = (a: Spool, b: Spool) => b.created_at.localeCompare(a.created_at);

const productKey = (u: string) => u.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();

/** Alle Bezugsquellen passender Spulen: je Produkt-Link Datum der letzten Spule und Preis der letzten mit Preis,
 *  nach Shop gruppiert (Shop mit dem günstigsten Preis je kg zuerst) */
export function stockSources(rule: StockRule, all: Spool[]): StockSource[] {
  const by = new Map<string, Spool[]>();
  for (const s of [...all].sort(newest)) {
    if (!/^https?:\/\//i.test(s.url)) continue;
    const k = productKey(s.url);
    by.set(k, [...(by.get(k) ?? []), s]);
  }
  const list: StockSource[] = [...by.values()].map((l) => {
    const last = l[0]!;
    const priced = l.find((s) => paidPrice(s) != null) ?? last;
    return {
      host: host(last.url), url: last.url, price: paidPrice(priced), net_g: priced.net_g || null, per_g: pricePerG(priced), date: priced.created_at,
      label: [priced.brand, priced.name && priced.name !== priced.material ? priced.name : priced.material, priced.color_name].filter(Boolean).join(" · "),
      count: l.length, cheapest: false, kind: "spule",
    };
  });
  const best = new Map<string, number>();
  for (const x of list) best.set(x.host, Math.min(best.get(x.host) ?? Infinity, x.per_g ?? Infinity));
  list.sort((a, b) => best.get(a.host)! - best.get(b.host)! || a.host.localeCompare(b.host) || (a.per_g ?? Infinity) - (b.per_g ?? Infinity));
  const priced = list.filter((x) => x.per_g != null).sort((a, b) => a.per_g! - b.per_g!);
  if (priced.length > 1) priced[0]!.cheapest = true;
  const blank = (url: string, kind: StockSource["kind"]): StockSource =>
    ({ host: host(url), url, price: null, net_g: null, per_g: null, date: null, label: "", count: 0, cheapest: false, kind });
  if (rule.url && !list.some((x) => productKey(x.url) === productKey(rule.url))) list.unshift(blank(rule.url, "eigen"));
  const cat = rule.brand ? catalogBrand(rule.brand)?.url : undefined;
  if (!list.length && cat) list.push(blank(cat, "katalog"));
  return list;
}

export function stockStatus(rules: StockRule[], spools: Spool[]): StockStatus[] {
  return rules.map((rule) => {
    const all = spools.filter((s) => ruleMatches(rule, s));
    const shelf = all.filter((s) => !s.archived && s.remaining_g > 0);
    const stock = shelf.reduce((a, s) => a + s.remaining_g, 0);
    const last = [...all].sort(newest)[0] ?? null;
    const sources = stockSources(rule, all);
    const shop = rule.url || [...all].sort(newest).find((s) => s.url)?.url || sources[0]?.url || null;
    return { rule, stock_g: Math.round(stock), spools: shelf.length, low: stock < rule.min_g, shop, sources, last };
  });
}
