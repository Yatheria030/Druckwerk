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

/** Druckfehler: erste Stelle des zweiten Worts sagt, was der Drucker tut (4 bricht ab, 8 pausiert, C weist hin) */
export const ERROR_LEVEL: Record<string, string> = { "4": "Abbruch", "8": "Pause", C: "Hinweis" };
