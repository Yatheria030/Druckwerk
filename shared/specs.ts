// Datenblatt-Kennwerte je Katalogsorte (aus den technischen Datenblättern der Hersteller, server/specs/*.json).
// Nur Werte an gedruckten Probekörpern (spritzgegossene liegen 20–50 % höher und taugen nicht zum Vergleich, Datenblätter ohne
// Angabe zur Probe werden nicht aufgenommen). Normen (ISO/ASTM) unterscheiden sich in Geschwindigkeit und Probengeometrie, siehe `std`.

export type SpecKey =
  | "density" | "tg" | "melt" | "hdt_045" | "hdt_18" | "vicat"
  | "tensile_strength" | "tensile_modulus" | "elongation" | "flexural_strength" | "flexural_modulus"
  | "impact" | "impact_notched" | "izod_jm" | "hardness" | "mfi"
  | "nozzle_min" | "nozzle_max" | "bed_min" | "bed_max" | "dry_temp" | "dry_hours";

/** Ein Wert: `v` (bei gedruckten Proben XY), `z` = in Aufbaurichtung, `std` = Norm bzw. Bedingung laut Datenblatt */
export type SpecValue = { v: number; std?: string | null; z?: number | null };
export type LineSpecs = {
  source: string | null;
  specimen: "printed" | "injection" | null;
  values: Partial<Record<SpecKey, SpecValue>>;
  note: string | null;
};

export type SpecGroup = "waerme" | "mechanik" | "verarbeitung";
export type SpecMeta = {
  key: SpecKey;
  label: string;
  short: string;
  unit: string;
  group: SpecGroup;
  /** true = mehr ist besser (Rangfolge absteigend); null = keine Wertung (Dichte, Temperaturen zum Drucken) */
  better: "high" | "low" | null;
  info: string;
  digits?: number;
};

export const SPEC_GROUPS: { id: SpecGroup; label: string }[] = [
  { id: "waerme", label: "Wärme" },
  { id: "mechanik", label: "Mechanik" },
  { id: "verarbeitung", label: "Verarbeitung" },
];

export const SPECS: SpecMeta[] = [
  { key: "hdt_045", label: "Wärmeformbeständigkeit HDT/B", short: "HDT 0,45", unit: "°C", group: "waerme", better: "high",
    info: "Temperatur, bei der sich ein liegender Prüfstab unter 0,45 MPa Biegespannung um 0,25 mm durchbiegt (ISO 75 B, ASTM D648 66 psi). Bester Einzelwert dafür, ab wann ein Teil im warmen Auto oder neben dem Motor nachgibt." },
  { key: "hdt_18", label: "Wärmeformbeständigkeit HDT/A", short: "HDT 1,8", unit: "°C", group: "waerme", better: "high",
    info: "Wie HDT/B, aber mit 1,8 MPa Last (ISO 75 A, ASTM D648 264 psi). Für belastete Teile, liegt bei gefüllten Materialien nah an HDT/B, bei ungefüllten deutlich darunter." },
  { key: "vicat", label: "Vicat-Erweichungstemperatur", short: "Vicat", unit: "°C", group: "waerme", better: "high",
    info: "Temperatur, bei der eine Nadel mit 1 mm² Spitze unter 10 N (A50) oder 50 N (B50) 1 mm tief eindringt (ISO 306). Liegt meist über der HDT." },
  { key: "tg", label: "Glasübergang Tg", short: "Tg", unit: "°C", group: "waerme", better: "high",
    info: "Ab hier wird der amorphe Anteil vom glasartigen in den gummielastischen Zustand weich (DSC, ISO 11357). Bei amorphen Kunststoffen (PETG, ABS, PC) praktisch die Einsatzgrenze." },
  { key: "melt", label: "Schmelztemperatur", short: "Schmelze", unit: "°C", group: "waerme", better: null,
    info: "Schmelzpunkt der Kristallite (DSC). Nur teilkristalline Kunststoffe (PLA, PA, PP, PEEK) haben einen." },
  { key: "tensile_strength", label: "Zugfestigkeit", short: "Zug σ", unit: "MPa", group: "mechanik", better: "high",
    info: "Höchste Spannung, die ein Schulterstab beim Ziehen aushält, bevor er reißt oder fließt (ISO 527, ASTM D638). Gedruckte Proben in Z (quer zu den Schichten) liegen oft bei der Hälfte." },
  { key: "tensile_modulus", label: "Zug-E-Modul", short: "E-Modul", unit: "MPa", group: "mechanik", better: "high", digits: 0,
    info: "Steifigkeit: Spannung je Dehnung im elastischen Anfang der Zugkurve. Hoher Modul = biegt sich unter Last wenig (PLA ≈ 3000, PETG ≈ 2000, TPU ≈ 30)." },
  { key: "elongation", label: "Bruchdehnung", short: "Dehnung", unit: "%", group: "mechanik", better: "high",
    info: "Um wie viel Prozent sich der Stab bis zum Bruch längt. Klein = spröde, groß = zäh bzw. gummiartig." },
  { key: "flexural_strength", label: "Biegefestigkeit", short: "Biege σ", unit: "MPa", group: "mechanik", better: "high",
    info: "Höchste Randspannung im Drei-Punkt-Biegeversuch (ISO 178, ASTM D790)." },
  { key: "flexural_modulus", label: "Biege-E-Modul", short: "Biege-E", unit: "MPa", group: "mechanik", better: "high", digits: 0,
    info: "Steifigkeit im Biegeversuch; die häufigste Steifigkeitsangabe in Datenblättern." },
  { key: "impact", label: "Schlagzähigkeit ungekerbt", short: "Charpy", unit: "kJ/m²", group: "mechanik", better: "high",
    info: "Energie, die ein Pendel beim Durchschlagen eines ungekerbten Stabs verliert, je Querschnitt (ISO 179). Maß für Zähigkeit bei schlagartiger Last." },
  { key: "impact_notched", label: "Kerbschlagzähigkeit", short: "Kerbschlag", unit: "kJ/m²", group: "mechanik", better: "high",
    info: "Wie Charpy, aber mit Kerbe (ISO 179/1eA, Izod ISO 180). Zeigt, wie empfindlich das Material auf Kerben und Ecken reagiert." },
  { key: "izod_jm", label: "Izod gekerbt", short: "Izod", unit: "J/m", group: "mechanik", better: "high", digits: 0,
    info: "Kerbschlagarbeit je Probendicke nach ASTM D256, nicht in kJ/m² umrechenbar ohne Probendicke." },
  { key: "hardness", label: "Shore-Härte", short: "Härte", unit: "Shore", group: "mechanik", better: null, digits: 0,
    info: "Eindringhärte (ISO 868, ASTM D2240); Shore A für weiche (TPU 85A–95A), Shore D für harte Kunststoffe." },
  { key: "density", label: "Dichte", short: "Dichte", unit: "g/cm³", group: "verarbeitung", better: null, digits: 2,
    info: "Masse je Volumen (ISO 1183). Bestimmt, wie viele Meter auf einer 1-kg-Spule sind und wie schwer das Teil wird." },
  { key: "mfi", label: "Schmelzindex MFI", short: "MFI", unit: "g/10 min", group: "verarbeitung", better: null,
    info: "Wie viel Schmelze in 10 min durch eine Normdüse fließt (ISO 1133); hoch = dünnflüssig. Nur bei gleicher Temperatur/Last vergleichbar." },
  { key: "nozzle_min", label: "Düse min.", short: "Düse min", unit: "°C", group: "verarbeitung", better: null, info: "Empfohlene Düsentemperatur, untere Grenze." },
  { key: "nozzle_max", label: "Düse max.", short: "Düse max", unit: "°C", group: "verarbeitung", better: null, info: "Empfohlene Düsentemperatur, obere Grenze." },
  { key: "bed_min", label: "Bett min.", short: "Bett min", unit: "°C", group: "verarbeitung", better: null, info: "Empfohlene Betttemperatur, untere Grenze." },
  { key: "bed_max", label: "Bett max.", short: "Bett max", unit: "°C", group: "verarbeitung", better: null, info: "Empfohlene Betttemperatur, obere Grenze." },
  { key: "dry_temp", label: "Trocknen", short: "Trocknen", unit: "°C", group: "verarbeitung", better: null, info: "Trocknungstemperatur laut Hersteller." },
  { key: "dry_hours", label: "Trockenzeit", short: "Zeit", unit: "h", group: "verarbeitung", better: null, info: "Trocknungsdauer laut Hersteller." },
];

export const specMeta = (k: SpecKey) => SPECS.find((s) => s.key === k)!;
/** Kennwerte, nach denen sich ranken lässt */
export const RANKABLE = SPECS.filter((s) => s.better);

export function fmtSpec(k: SpecKey, v: number): string {
  const d = specMeta(k).digits ?? (Math.abs(v) >= 100 ? 0 : Number.isInteger(v) ? 0 : 1);
  return v.toLocaleString("de-DE", { minimumFractionDigits: d === 2 ? 2 : 0, maximumFractionDigits: d });
}

/** Grundmaterial für Gruppen: PA6-CF → PA, ASA-Aero → ASA, PLA+ → PLA, PETG bleibt */
export const baseMaterial = (m: string) => m.split(/[-+ ]/)[0]!.replace(/(?<=[A-Z])\d+$/, "") || m;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}
