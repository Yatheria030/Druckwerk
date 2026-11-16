// Shoppreise je Katalogsorte (server/prices.json, einmal recherchiert): Preis der Standardspule im offiziellen Shop für Deutschland,
// in EUR inkl. MwSt. ohne Versand. Für Preis je kg und die Rangliste „Preis-Leistung“ auf der Filament-Seite.
import type { CatalogLine } from "./catalog.ts";

export type LinePrice = {
  price: number; // heute zu zahlen (bei Aktion der Aktionspreis)
  regular: number | null; // durchgestrichener Normalpreis
  refill: number | null; // ohne Spule (Bambu)
  net_g: number;
  url: string;
  note: string;
  date: string; // Stand der Recherche, YYYY-MM-DD
};

export const perKg = (p: Pick<LinePrice, "price" | "net_g">) => (p.price / p.net_g) * 1000;

/** Vergleichsgruppen: gleiche Art Filament, damit Silk nicht gegen Basic-PLA antritt */
export const PRICE_GROUPS = [
  { id: "pla", label: "PLA", info: "Standard-PLA (Basic)" },
  { id: "pla-plus", label: "PLA+ / Pro", info: "Zäheres PLA: PLA+, Pro, Meta" },
  { id: "pla-matte", label: "PLA Matte", info: "Mattes PLA" },
  { id: "pla-silk", label: "PLA Silk", info: "Seidenglanz-PLA" },
  { id: "pla-hs", label: "PLA High Speed", info: "PLA für hohe Druckgeschwindigkeit" },
  { id: "petg", label: "PETG", info: "PETG, auch Matte und HS" },
] as const;
export type PriceGroup = (typeof PRICE_GROUPS)[number]["id"];

export function priceGroup(l: Pick<CatalogLine, "material" | "name">): PriceGroup | null {
  const n = l.name;
  if (/PETG/i.test(n) || /PETG/i.test(l.material)) return "petg";
  if (!/PLA|Panchroma|PolyTerra|PolyLite/i.test(n) && l.material !== "PLA") return null;
  if (/silk/i.test(n)) return "pla-silk";
  if (/matte/i.test(n)) return "pla-matte";
  if (/\bHS\b|high speed/i.test(n)) return "pla-hs";
  if (/PLA\s*\+|\bPro\b|Meta|Plus/i.test(n)) return "pla-plus";
  return "pla";
}
