import { useQuery } from "@tanstack/react-query";

/** Fehlertexte aller Bambu-Drucker, Schlüssel ohne Trenner: HMS 16 Hex (Attribut + Code), Druckfehler 8 Hex */
export type HmsTable = { ver: number; hms: Record<string, string>; error: Record<string, string> };
export type HmsKind = "hms" | "error";

export const useHms = () =>
  useQuery({
    queryKey: ["hms"],
    queryFn: async (): Promise<HmsTable> => {
      const r = await fetch("/api/hms");
      if (!r.ok) throw new Error("Fehlertexte nicht geladen");
      return r.json();
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

/** "0500_0500_0001_0007" oder 0x0300400C → Schlüssel der Tabelle */
export const hmsKey = (code: string) => code.replace(/[^0-9a-f]/gi, "").toUpperCase();
export const errorKey = (n: number) => (n >>> 0).toString(16).toUpperCase().padStart(8, "0");

/** Schlüssel in Vierergruppen wie am Drucker: 0500_0500_0001_0007 bzw. 0300_400C */
export const fmtCode = (key: string) => key.match(/.{1,4}/g)!.join("_");

/** Wiki-Seite über Bambus Weiterleitung (wie Bambu Studio): landet je Code auf dem passenden Modell, sonst auf der HMS-Übersicht */
export const wikiUrl = (key: string, kind: HmsKind) =>
  `https://e.bambulab.com/index.php?e=${key}&s=${kind === "hms" ? "device_hms" : "device_error"}&lang=en`;

/** HMS-Stufe steht im oberen Wort des Codes: 1 Fatal, 2 Fehler, 3 Hinweis, 4 Info */
export const HMS_LEVEL: Record<number, string> = { 1: "Fatal", 2: "Fehler", 3: "Hinweis", 4: "Info" };
export const hmsLevel = (key: string) => parseInt(key.slice(8, 12), 16);

/** Baugruppe aus dem ersten Byte; gleich für HMS und Druckfehler. Liste statt Objekt, damit die Reihenfolge hält */
export const MODULES: [string, string][] = [
  ["07", "AMS"],
  ["18", "AMS HT"],
  ["03", "Bewegung & Heizung"],
  ["05", "System & Netzwerk"],
  ["0C", "Kamera & Sensoren"],
  ["10", "Druckauftrag"],
  ["29", "Luftfilter"],
];
const MODULE_NAME = new Map(MODULES);
export const moduleOf = (key: string) => MODULE_NAME.get(key.slice(0, 2)) ?? "Sonstiges";

const UNIT = "ABCDEFGH";
/** Betroffenes Teil, so genau der Code es hergibt: AMS-Einheit aus dem zweiten Byte, beim Kameramodul die Untergruppe */
export function partOf(key: string): string | null {
  const m = key.slice(0, 2);
  const n = parseInt(key.slice(2, 4), 16);
  if (m === "07" || m === "18") {
    const name = m === "07" ? "AMS" : "AMS HT";
    if (n === 0xff) return "Externe Spule";
    return n < 8 ? `${name} ${UNIT[n]}` : name;
  }
  if (m === "0C" && key.length === 16) return { "01": "Kamera & Bilderkennung", "02": "Lasersensoren", "03": "Prüfung der ersten Schicht" }[key.slice(4, 6)] ?? moduleOf(key);
  const mod = moduleOf(key);
  return mod === "Sonstiges" ? null : mod;
}

/** Ersatz, wenn Bambus Liste keinen Text hat: Bambu führt viele Codes ohne Text, das Wiki hat dazu auch keine Seite */
export function noText(key: string) {
  const part = partOf(key);
  return `Bambu Lab nennt zu diesem Code keinen Text${part ? `. Betrifft: ${part}` : ""}`;
}

/** Zeit einer Meldung (ISO) in Ortszeit des Browsers: "16.11. 02:59" */
export const fmtAt = (iso: string) => {
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Zone der Druckeruhr als Text: 480 → "UTC+8", 330 → "UTC+5:30" */
export const zoneLabel = (m: number) => {
  const a = Math.abs(m);
  return `UTC${m < 0 ? "−" : "+"}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, "0")}` : ""}`;
};

/** Wurde die Zeit umgerechnet? Nur wenn die Druckeruhr in einer anderen Zone steht als der Browser zu dem Zeitpunkt */
export const clockFixed = (offset: number | null, iso: string) => offset != null && offset !== -new Date(iso).getTimezoneOffset();

/** Druckfehler: erste Stelle des zweiten Worts sagt, was der Drucker tut (4 bricht ab, 8 pausiert, C weist hin) */
export const ERROR_LEVEL: Record<string, string> = { "4": "Abbruch", "8": "Pause", C: "Hinweis" };
