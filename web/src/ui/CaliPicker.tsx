// Kalibrierungen beim Druckstart (Slice- und Druckdialog): je Option Zeichnung, Erklärung, Dauer und Empfehlung.
// P2S/H2 kennen wie Bambu Studio „Automatisch“ (Drucker prüft kurz und überspringt, wenn nicht nötig) und kalibrieren
// Vibration nicht beim Druckstart; ältere Drucker nur an/aus. Die Wahl bleibt im Browser gespeichert.
import { useState } from "react";
import type { Cali } from "../../../shared/types.ts";

export type CaliOpts = { bed_leveling: Cali; flow_cali: Cali; vibration_cali: boolean; timelapse: boolean };

const KEY = "druckwerk.cali";
const DEFAULTS: CaliOpts = { bed_leveling: "auto", flow_cali: "auto", vibration_cali: false, timelapse: false };

function load(): CaliOpts {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<CaliOpts> | null;
    return { ...DEFAULTS, ...(v ?? {}) };
  } catch {
    return DEFAULTS;
  }
}

/** Gespeicherte Wahl (gilt für beide Dialoge) */
export function useCaliOpts(): [CaliOpts, (o: CaliOpts) => void] {
  const [o, setO] = useState(load);
  return [
    o,
    (n) => {
      setO(n);
      try {
        localStorage.setItem(KEY, JSON.stringify(n));
      } catch {
        // privates Fenster: Wahl gilt nur bis zum Schließen
      }
    },
  ];
}

/** Was tatsächlich gilt: ältere Drucker kennen kein „Automatisch“ (Bett dann an, Flussrate aus), P2S/H2 keine Vibration beim Start */
export function effectiveCali(o: CaliOpts, auto: boolean): CaliOpts {
  if (auto) return { ...o, vibration_cali: false };
  return {
    ...o,
    bed_leveling: o.bed_leveling === "off" ? "off" : "on",
    flow_cali: o.flow_cali === "on" ? "on" : "off",
  };
}

const ON = "var(--c-accent)";
const OFF = "var(--c-ink3)";

function BedFigure({ v }: { v: Cali }) {
  const c = v === "off" ? OFF : ON;
  const pts = [10, 19, 28, 37].flatMap((x) => [26, 32].map((y) => [x + (y === 32 ? 2 : 0), y] as const));
  return (
    <svg viewBox="0 0 48 48" className="size-full" aria-hidden>
      <path d="M4 36L8 24H44L40 36Z" fill="var(--c-ink3)" opacity="0.35" />
      {pts.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r="1.6"
          fill={c}
          opacity={v === "auto" && i > 2 ? 0.3 : 1}
          className={v !== "off" && i === 2 ? "motion-safe:animate-pulse" : undefined}
        />
      ))}
      <path d="M26 8h8v6l-4 6l-4-6Z" fill="var(--c-ink2)" />
      {v !== "off" && <line x1="30" y1="20" x2="30" y2="24" stroke={c} strokeWidth="1.4" strokeDasharray="1.5 1.5" />}
    </svg>
  );
}

function FlowFigure({ v }: { v: Cali }) {
  const c = v === "off" ? OFF : ON;
  return (
    <svg viewBox="0 0 48 48" className="size-full" aria-hidden>
      <rect x="4" y="34" width="40" height="4" rx="1.5" fill="var(--c-ink3)" opacity="0.35" />
      {[1.2, 1.8, 2.6, 3.4].map((w, i) => (
        <line key={i} x1="8" y1={14 + i * 5.5} x2="40" y2={14 + i * 5.5} stroke={c} strokeWidth={w} strokeLinecap="round" opacity={0.45 + i * 0.15} />
      ))}
      <path d="M36 2h8v6l-4 5l-4-5Z" fill="var(--c-ink2)" />
    </svg>
  );
}

function VibrationFigure({ on }: { on: boolean }) {
  const c = on ? ON : OFF;
  return (
    <svg viewBox="0 0 48 48" className="size-full" aria-hidden>
      <rect x="16" y="8" width="16" height="14" rx="3" fill="var(--c-ink2)" />
      <path d="M4 34q4-8 8 0t8 0t8 0t8 0t8 0" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <path d="M10 15h3M35 15h3" stroke={c} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CameraFigure({ on }: { on: boolean }) {
  const c = on ? ON : OFF;
  return (
    <svg viewBox="0 0 48 48" className="size-full" aria-hidden>
      <rect x="6" y="14" width="28" height="20" rx="4" fill="var(--c-ink2)" />
      <path d="M34 20l9-5v18l-9-5Z" fill="var(--c-ink2)" />
      <circle cx="20" cy="24" r="5" fill={c} />
    </svg>
  );
}

function Seg<T extends string>({ items, value, onPick }: { items: [T, string][]; value: T; onPick: (v: T) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-lg bg-fill p-0.5">
      {items.map(([v, text]) => (
        <button
          key={v}
          type="button"
          onClick={() => onPick(v)}
          aria-pressed={v === value}
          className={`h-7 rounded-md px-2.5 text-xs font-semibold ${v === value ? "bg-card text-ink shadow-seg" : "text-ink3 hover:text-ink"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Row({
  figure,
  title,
  control,
  note,
  rec,
}: {
  figure: React.ReactNode;
  title: string;
  control: React.ReactNode;
  note: string;
  rec?: { text: string; apply: () => void } | null;
}) {
  return (
    <div className="flex gap-3 py-2.5">
      <div className="size-11 shrink-0 rounded-lg bg-fill p-1">{figure}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <span className="text-sm font-semibold">{title}</span>
          {control}
        </div>
        <p className="mt-1 text-xs leading-snug text-ink3">{note}</p>
        {rec && (
          <button type="button" onClick={rec.apply} className="mt-1 text-[11px] font-semibold text-accent hover:underline">
            {rec.text}
          </button>
        )}
      </div>
    </div>
  );
}

const TRI: [Cali, string][] = [
  ["off", "Aus"],
  ["auto", "Auto"],
  ["on", "Immer"],
];
const BI: [Cali, string][] = [
  ["off", "Aus"],
  ["on", "An"],
];

const BED_NOTE: Record<Cali, string> = {
  auto: "Kurzer Check (≈ 10 s), gemessen wird nur, wenn das Bett es braucht. Empfohlen.",
  on: "Misst das ganze Bett vor jedem Druck neu (einige Minuten). Sinnvoll nach Plattenwechsel oder bei großen Teilen.",
  off: "Nutzt die letzte Messung. Gut bei kleinen Teilen auf derselben Platte; nach Plattenwechsel lieber messen.",
};
const FLOW_NOTE: Record<Cali, string> = {
  auto: "Übersprungen, wenn dieses Filament vor Kurzem kalibriert wurde. Empfohlen.",
  on: "Druckt vor jedem Druck eine Testlinie (≈ 1–2 min, etwas Filament). Lohnt bei neuem oder fremdem Filament.",
  off: "Nutzt gespeicherte Werte. Reicht für Filament, das du oft druckst.",
};

/** Kalibrierungen und Zeitraffer für den Druckstart */
export function CaliPicker({ value, auto, onChange }: { value: CaliOpts; auto: boolean; onChange: (o: CaliOpts) => void }) {
  const v = effectiveCali(value, auto);
  const set = (p: Partial<CaliOpts>) => onChange({ ...value, ...p });
  const recBed: Cali = auto ? "auto" : "on";
  const recFlow: Cali = auto ? "auto" : "off";
  const label = (c: Cali) => (c === "auto" ? "Auto" : c === "on" ? (auto ? "Immer" : "An") : "Aus");
  return (
    <div className="divide-y divide-sep">
      <Row
        figure={<BedFigure v={v.bed_leveling} />}
        title="Bett nivellieren"
        control={<Seg items={auto ? TRI : BI} value={v.bed_leveling} onPick={(c) => set({ bed_leveling: c })} />}
        note={BED_NOTE[v.bed_leveling]}
        rec={v.bed_leveling !== recBed ? { text: `Empfehlung: ${label(recBed)}`, apply: () => set({ bed_leveling: recBed }) } : null}
      />
      <Row
        figure={<FlowFigure v={v.flow_cali} />}
        title="Flussrate kalibrieren"
        control={<Seg items={auto ? TRI : BI} value={v.flow_cali} onPick={(c) => set({ flow_cali: c })} />}
        note={FLOW_NOTE[v.flow_cali]}
        rec={v.flow_cali !== recFlow ? { text: `Empfehlung: ${label(recFlow)}`, apply: () => set({ flow_cali: recFlow }) } : null}
      />
      {!auto && (
        <Row
          figure={<VibrationFigure on={v.vibration_cali} />}
          title="Vibration kalibrieren"
          control={<Seg items={BI} value={v.vibration_cali ? "on" : "off"} onPick={(c) => set({ vibration_cali: c === "on" })} />}
          note={
            v.vibration_cali
              ? "Misst die Resonanzen der Achsen (≈ 3–5 min, laut). Nur nötig, wenn der Drucker umgestellt wurde."
              : "Der letzte Wert bleibt gültig, solange der Drucker am selben Platz steht."
          }
          rec={v.vibration_cali ? { text: "Empfehlung: Aus", apply: () => set({ vibration_cali: false }) } : null}
        />
      )}
      <Row
        figure={<CameraFigure on={v.timelapse} />}
        title="Zeitraffer aufnehmen"
        control={<Seg items={BI} value={v.timelapse ? "on" : "off"} onPick={(c) => set({ timelapse: c === "on" })} />}
        note={v.timelapse ? "Ein Bild je Schicht als Video auf dem Drucker; mit Archiv (Einstellungen) holt Druckwerk es in den Verlauf." : "Kein Video vom Druck."}
      />
      {auto && (
        <p className="pt-2.5 text-[11px] leading-snug text-ink3">
          Vibration misst dieser Drucker nicht beim Druckstart. Nach dem Umstellen: Drucker → Gerät → Kalibrieren.
        </p>
      )}
    </div>
  );
}
