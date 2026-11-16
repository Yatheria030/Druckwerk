// Live-Verbrauch im Slice-Dialog: der Slicer rechnet im Hintergrund, hier je Filament die Spule mit dem Rest danach,
// Gramm und Restmenge zählen animiert mit, während der Rechnung dreht die Spule und die alten Werte bleiben gedimmt stehen.
// Darunter der Unterschied zum Standard des Druckers (eigener Vorschau-Slice), damit jede Wahl in Minuten und Gramm sichtbar wird.
import { Clock, Loader2, RotateCw } from "lucide-react";
import type { Plate, Spool, Tray } from "../../../shared/types.ts";
import { trayColor } from "./Ams.tsx";
import { fmtRemaining } from "./printer.tsx";
import { fmtG, SpoolArt, spoolTitle, useTween } from "./spool.tsx";
import { deltaText } from "./SliceHelp.tsx";

/** Bambu-Spulen ohne Bibliothekseintrag: Rest aus dem RFID-Prozentwert, bezogen auf 1 kg */
const RFID_NET = 1000;

type Row = { id: number; used: number; tray: Tray | undefined; spool: Spool | undefined; color: string; type: string };

export function SliceUsage({
  plate,
  computing,
  error,
  trays,
  slotTrays,
  spools,
  retry,
  compare,
}: {
  plate: Plate | null;
  computing: boolean;
  error: string;
  trays: Tray[];
  slotTrays: (number | null)[];
  spools: Map<number, Spool>;
  retry?: () => void;
  /** Vergleich mit dem Standard des Druckers; null = Einstellungen sind der Standard */
  compare?: { plate: Plate | null; busy: boolean; label: string } | null;
}) {
  const rows: Row[] = (plate?.filaments ?? [])
    .filter((f) => (f.used_g ?? 0) > 0)
    .map((f) => {
      const tray = trays.find((t) => t.id === slotTrays[f.id - 1]);
      const spool = tray?.spool_id ? spools.get(tray.spool_id) : undefined;
      return { id: f.id, used: f.used_g ?? 0, tray, spool, color: (tray && trayColor(tray, spool)) || f.color || "#9a9a9a", type: f.type };
    });
  const total = useTween(plate?.weight_g ?? rows.reduce((a, r) => a + r.used, 0), 900);
  const mins = plate?.prediction_s != null ? Math.round(plate.prediction_s / 60) : null;

  return (
    <div className="rounded-xl bg-card p-3 shadow-card" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-bold tracking-[0.08em] text-ink3 uppercase">Verbrauch</span>
        {computing ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-ink2">
            <Loader2 size={13} className="animate-spin text-accent" /> Slicer rechnet …
          </span>
        ) : plate && !error ? (
          <span className="flex items-center gap-3 text-sm font-bold tnum">
            {mins != null && (
              <span className="flex items-center gap-1 text-ink2">
                <Clock size={13} /> {fmtRemaining(mins)}
              </span>
            )}
            <span>{fmtG(total)}</span>
          </span>
        ) : null}
      </div>

      {compare && plate && !error && !computing && (
        <CompareLine plate={plate} compare={compare} />
      )}

      {error && !computing ? (
        // Alte Werte gehören zu anderen Einstellungen, deshalb nur der Fehler
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-warn">Vorschau fehlgeschlagen: {error}</p>
          {retry && (
            <button type="button" onClick={retry} className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-fill px-2.5 text-xs font-semibold text-ink2 hover:bg-hover">
              <RotateCw size={13} /> Neu rechnen
            </button>
          )}
        </div>
      ) : !plate ? (
        <div className="mt-2.5 flex items-center gap-3">
          <SpoolArt color="#9a9a9a" fraction={0.6} spinning={computing} className="size-12 shrink-0 opacity-50" />
          <p className="text-xs text-ink3">Gramm und Druckzeit kommen direkt aus dem Slicer, sobald die Vorschau gerechnet ist.</p>
        </div>
      ) : (
        <div className={`mt-2 space-y-2.5 transition-opacity ${computing ? "opacity-55" : ""}`}>
          {rows.map((r) => (
            <UsageRow key={r.id} r={r} computing={computing} />
          ))}
        </div>
      )}
    </div>
  );
}

function UsageRow({ r, computing }: { r: Row; computing: boolean }) {
  // Vorher: Rest der Spule, sonst RFID-Prozent × 1 kg; ohne beides nur der Verbrauch
  const net = r.spool?.net_g || (r.tray?.remain != null ? RFID_NET : 0);
  const before = r.spool ? r.spool.remaining_g : r.tray?.remain != null ? (r.tray.remain / 100) * RFID_NET : null;
  const after = before != null ? before - r.used : null;
  const used = useTween(r.used, 900);
  const left = useTween(Math.max(0, after ?? 0), 900);
  const short = after != null && after < 0;
  const approx = !r.spool || r.spool.track === "rfid" ? "≈ " : "";
  const name = r.spool ? spoolTitle(r.spool) : r.tray ? r.tray.name || r.tray.type : r.type || `Filament ${r.id}`;

  return (
    <div className="flex items-center gap-3">
      <SpoolArt
        color={r.color}
        fraction={net && after != null ? Math.max(0, after) / net : 0.6}
        spinning={computing}
        glow={!computing}
        className="size-14 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-bold">
            {r.tray && <span className="mr-1.5 text-xs font-extrabold text-ink3">{r.tray.label}</span>}
            {name}
          </span>
          <span className="shrink-0 text-sm font-extrabold tnum">−{fmtG(used)}</span>
        </div>
        {before != null && net > 0 ? (
          <>
            <span className="relative mt-1.5 block h-2 overflow-hidden rounded-full bg-fill2">
              <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700" style={{ width: `${Math.min(100, (Math.max(0, after!) / net) * 100)}%`, background: r.color }} />
              <span
                className="slice-use absolute inset-y-0 rounded-full transition-[left,width] duration-700"
                style={{ left: `${Math.min(100, (Math.max(0, after!) / net) * 100)}%`, width: `${Math.min(100, (Math.min(r.used, before) / net) * 100)}%`, ["--use" as string]: r.color }}
              />
            </span>
            <div className={`mt-1 text-xs font-semibold tnum ${short ? "text-warn" : "text-ink3"}`}>
              {short ? `Reicht nicht: es fehlen ${fmtG(r.used - before)}` : `bleibt ${approx}${fmtG(left)} von ${approx}${fmtG(before)}`}
            </div>
          </>
        ) : (
          <div className="mt-1 text-xs text-ink3">{r.tray ? "Restmenge unbekannt" : "kein Fach gewählt"}</div>
        )}
      </div>
    </div>
  );
}

function CompareLine({ plate, compare }: { plate: Plate; compare: { plate: Plate | null; busy: boolean; label: string } }) {
  const b = compare.plate;
  const dt = b && plate.prediction_s != null && b.prediction_s != null ? deltaText({ s: plate.prediction_s, g: plate.weight_g ?? 0 }, { s: b.prediction_s, g: b.weight_g ?? 0 }) : null;
  const tone = (good: boolean) => (good ? "text-good" : "text-warn");
  return (
    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
      {compare.busy ? (
        <span className="flex items-center gap-1.5 text-ink3">
          <Loader2 size={11} className="animate-spin" /> Vergleich mit dem Standard …
        </span>
      ) : dt ? (
        <>
          <span className={`font-bold tnum ${tone(dt.faster)}`}>{dt.time}</span>
          <span className={`font-bold tnum ${tone(dt.lighter)}`}>{dt.grams}</span>
          <span className="text-ink3">gegenüber Standard ({compare.label})</span>
        </>
      ) : b ? (
        <span className="text-ink3">Gleich wie der Standard ({compare.label})</span>
      ) : null}
    </div>
  );
}
