import type { PrinterLive, Tray } from "../../../shared/types.ts";
import { Swatch } from "./controls.tsx";

export const STATE_LABEL: Record<string, string> = {
  IDLE: "Bereit",
  PREPARE: "Bereitet vor",
  SLICING: "Bereitet vor",
  RUNNING: "Druckt",
  PAUSE: "Pausiert",
  FINISH: "Fertig",
  FAILED: "Fehler",
  OFFLINE: "Offline",
};

export const stateLabel = (s: string) => STATE_LABEL[s] ?? s;

export const stateColor = (s: string) =>
  s === "RUNNING" || s === "PREPARE" || s === "SLICING" ? "var(--c-accent)" : s === "PAUSE" ? "var(--c-orange)" : s === "FAILED" ? "var(--c-red)" : s === "OFFLINE" ? "var(--c-ink4)" : "var(--c-green)";

export function StateDot({ live }: { live: PrinterLive }) {
  const busy = live.state === "RUNNING" || live.state === "PREPARE";
  return (
    <span className="relative inline-flex size-2.5">
      {busy && <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: stateColor(live.state) }} />}
      <span className="relative size-2.5 rounded-full" style={{ background: stateColor(live.state) }} />
    </span>
  );
}

export function TrayChip({ t, compact }: { t: Tray; compact?: boolean }) {
  const empty = !t.type && !t.color;
  return (
    <div className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${t.active ? "bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--c-accent)]" : "bg-fill"}`}>
      <Swatch color={empty ? "" : t.color} size={compact ? 12 : 16} />
      <div className="min-w-0 leading-tight">
        <div className="text-[11px] font-bold whitespace-nowrap text-ink3">
          {t.label}
          {t.remain != null && !compact && <span className="font-medium tnum"> · {t.remain} %</span>}
        </div>
        <div className="truncate text-xs font-semibold">{empty ? (t.reading ? "liest RFID" : t.loaded ? "belegt" : "leer") : t.type || "?"}</div>
      </div>
    </div>
  );
}

export const fmtTemp = (v: number | null, target?: number | null) =>
  v == null ? "–" : `${Math.round(v)}${target ? ` / ${Math.round(target)}` : ""} °C`;

export const fmtRemaining = (min: number | null) => {
  if (min == null) return "–";
  min = Math.round(min);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
};

export const finishAt = (min: number | null) =>
  !min ? null : new Date(Date.now() + min * 60_000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
