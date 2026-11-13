// Farbnamen aus dem Hex-Wert: Spulen aus dem Farbkatalog (Datenbank) mit dem offiziellen Namen, sonst der nächste allgemeine Name.
import { catalogColorName, profileColorName } from "./catalog.ts";

const GENERIC: [string, string][] = [
  ["000000", "Schwarz"], ["FFFFFF", "Weiß"], ["C8C8C8", "Hellgrau"], ["8C8C8C", "Grau"], ["4A4A4A", "Dunkelgrau"],
  ["D02828", "Rot"], ["8B1A1A", "Dunkelrot"], ["FF7A1A", "Orange"], ["F5D90A", "Gelb"], ["D4AF37", "Gold"], ["E8D9B5", "Beige"],
  ["8B5A2B", "Braun"], ["4A2E1A", "Dunkelbraun"], ["9BE07A", "Hellgrün"], ["2EA043", "Grün"], ["1F5130", "Dunkelgrün"],
  ["1ABCB0", "Türkis"], ["7EC8F0", "Hellblau"], ["1E64C8", "Blau"], ["142A5C", "Dunkelblau"], ["7B3FB8", "Violett"],
  ["B9A0DC", "Flieder"], ["F06EAA", "Pink"], ["F5B8C8", "Rosa"], ["D0208A", "Magenta"],
];

const clean = (hex: string) => hex.replace(/^#/, "").slice(0, 6).toUpperCase();
const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0) as [number, number, number];
/** Farbabstand nach „redmean“, nah genug an der Wahrnehmung für die Namenswahl */
const dist = (a: string, b: string) => {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
};

/** Allgemeiner deutscher Name der nächsten Grundfarbe */
export function genericColorName(hex: string): string {
  const h = clean(hex);
  if (h.length !== 6) return "";
  let best = GENERIC[0]!;
  for (const g of GENERIC) if (dist(h, g[0]) < dist(h, best[0])) best = g;
  return best[1];
}

/** Farbname für eine Spule ohne eigenen Namen: Katalogmarken mit dem offiziellen Namen (Bambu über Profil und Chip-Farbcode),
 *  sonst die nächste Grundfarbe */
export function autoColorName(o: { color: string; brand?: string; name?: string; profile_id?: string | null; code?: string | null }): string {
  if (!/^#?[0-9a-f]{6}/i.test(o.color)) return "";
  const brand = o.brand ?? "";
  const official = /bambu/i.test(brand) ? profileColorName(brand, o.color, o.profile_id, o.code) : catalogColorName(brand, o.name ?? "", o.color);
  return official ?? genericColorName(o.color);
}
