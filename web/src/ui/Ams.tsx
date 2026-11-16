import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, CloudDrizzle, Droplets, ExternalLink, Flame, Loader2, Lock, Nfc, Plus, RefreshCw, Thermometer } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AMS_BUSY, baseMaterial, DRY_BLOCK, DRY_STATUS, type AmsUnit, type PrinterLive, type Spool, type Tray } from "../../../shared/types.ts";
import { api, type Pushed } from "../api.ts";
import { useCatalog } from "../lib/catalog.ts";
import { href } from "../lib/router.ts";
import { useSetting } from "../lib/settings.ts";
import { Button, Dialog, useToast } from "./controls.tsx";
import { CatalogColors, SorteField, carryColorName } from "./catalog.tsx";
import { useDrag } from "./drag.tsx";
import { fmtRemaining } from "./printer.tsx";
import { fmtG, luma, pct, RestChips, SpoolArt, spoolSub, spoolTitle, useTween } from "./spool.tsx";

/**
 * Farbe, die sicher stimmt: von der zugeordneten Spule oder vom Chip. Ohne beides ist die Fach-Einstellung im Drucker
 * nur der letzte Stand aus Bambu Studio und sagt nichts darüber, welche Spule wirklich steckt.
 */
export const trayColor = (t: Tray, s?: Spool) => (s ? s.color : t.rfid ? t.color : "");
const UNKNOWN = "#6b6f75";

/** Fach mit Bibliotheksdaten: Restmenge aus der Spule, sonst aus dem RFID-Wert; Spule ohne Chip und ohne Zuordnung = unbekannt */
function trayFill(t: Tray, s: Spool | undefined) {
  if (!t.loaded) return { fraction: 0, text: "leer", empty: true, unknown: false };
  // RFID-Modus: Rest ist die Schätzung des Druckers (≈), eigene Zählung ohne Zeichen
  if (s) return { fraction: pct(s), text: `${s.track === "rfid" ? "≈ " : ""}${fmtG(s.remaining_g)}`, empty: false, unknown: false };
  if (!t.rfid) return { fraction: 0.7, text: t.reading ? "liest RFID …" : "zuordnen", empty: false, unknown: true };
  if (t.remain != null) return { fraction: t.remain / 100, text: `${t.remain} %`, empty: false, unknown: false };
  return { fraction: 0.7, text: "?", empty: false, unknown: false };
}

/** Fragezeichen über einer unbekannten Spule */
const Unknown = ({ className = "text-2xl" }: { className?: string }) => (
  <span className={`pointer-events-none absolute inset-0 flex items-center justify-center font-black text-white/85 ${className}`} aria-hidden>
    ?
  </span>
);

/** Rückmeldung nach dem Übertragen ans AMS-Fach (nichts, wenn nichts übertragen wurde) */
export function pushedToast(toast: (m: string, k?: "ok" | "fehler") => void, pushed: Pushed[] | undefined, fallback?: string) {
  const list = (pushed ?? []).filter((p) => p.text);
  const bad = list.filter((p) => !p.ok);
  if (bad.length) return toast(bad.map((p) => `Fach ${p.label}: ${p.text}`).join(" · "), "fehler");
  if (list.length) return toast(`${fallback ? `${fallback} · ` : ""}${list.map((p) => `Fach ${p.label} → ${p.text}`).join(", ")}`);
  if (fallback) toast(fallback);
}

const humColor = (h: number) => (h < 25 ? "#6fdc9a" : h < 40 ? "#f2c75c" : "#ff7a6e");

/** Absolute Feuchte in g/m³ aus Temperatur (°C) und relativer Feuchte (%), Sättigungsdruck nach Magnus */
const satHpa = (t: number) => 6.112 * Math.exp((17.62 * t) / (243.12 + t));
const absHumidity = (t: number, rh: number) => (216.7 * (rh / 100) * satHpa(t)) / (273.15 + t);
/** Relative Feuchte, die dieselbe Wassermenge bei Temperatur t hätte */
const relAt = (t: number, ah: number) => (ah * (273.15 + t)) / (216.7 * satHpa(t)) * 100;

/** Skala der absoluten Feuchte, Grenzen entsprechen ≈ 20/30/45/65 % bei 22 °C */
const ABS_BANDS = [
  { max: 4, color: "#6fdc9a", label: "Sehr trocken", hint: "auch für PA, PC, TPU" },
  { max: 6, color: "#b5e07a", label: "Trocken", hint: "PLA, PETG, ABS problemlos" },
  { max: 9, color: "#f2c75c", label: "Mittel", hint: "PLA ok, PA und TPU trocknen" },
  { max: 13, color: "#ff9f5a", label: "Feucht", hint: "Trockenmittel tauschen" },
  { max: Infinity, color: "#ff7a6e", label: "Nass", hint: "Filament trocknen" },
];
const ABS_SCALE = 20;
const absBand = (ah: number) => ABS_BANDS.find((b) => ah < b.max)!;
const fmtAbs = (ah: number) => ah.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Wert der absoluten Feuchte mit Skala beim Überfahren bzw. Antippen. Die Skala hängt fest am Fenster (Portal), weil die
 * Druckerkarte überstehenden Inhalt abschneidet; sie öffnet nach unten, ohne Platz nach oben.
 */
function AbsHumidity({ temp, rh, drying }: { temp: number; rh: number; drying: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const leave = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pointer = useRef("");
  const hover = (on: boolean) => {
    clearTimeout(leave.current);
    if (on) setOpen(true);
    else leave.current = setTimeout(() => setOpen(false), 120);
  };
  useEffect(() => () => clearTimeout(leave.current), []);
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const p = pop.current?.getBoundingClientRect();
      if (!a || !p) return;
      const gap = 6;
      const below = a.bottom + gap + p.height <= innerHeight - 8 || a.top - gap - p.height < 8;
      setPos({
        top: below ? a.bottom + gap : a.top - gap - p.height,
        left: Math.max(8, Math.min(a.right - p.width, innerWidth - 8 - p.width)),
      });
    };
    place();
    const off = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    addEventListener("scroll", place, true);
    addEventListener("resize", place);
    document.addEventListener("pointerdown", off);
    return () => {
      removeEventListener("scroll", place, true);
      removeEventListener("resize", place);
      document.removeEventListener("pointerdown", off);
    };
  }, [open]);
  const ah = absHumidity(temp, rh);
  const band = absBand(ah);
  let from = 0;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onPointerDown={(e) => (pointer.current = e.pointerType)}
        onClick={() => setOpen(pointer.current === "mouse" || !open)}
        onPointerEnter={(e) => e.pointerType === "mouse" && hover(true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && hover(false)}
        aria-expanded={open}
        aria-label={`Absolute Feuchte ${fmtAbs(ah)} Gramm pro Kubikmeter, ${band.label}`}
        className="flex shrink-0 items-center gap-1 rounded-full bg-white/8 px-2 py-1 text-white/80 hover:bg-white/14"
      >
        <CloudDrizzle size={13} style={{ color: band.color }} /> {fmtAbs(ah)} g/m³
      </button>
      {open &&
        createPortal(
          <span
            ref={pop}
            role="tooltip"
            onPointerEnter={(e) => e.pointerType === "mouse" && hover(true)}
            onPointerLeave={(e) => e.pointerType === "mouse" && hover(false)}
            className="fixed z-50 block w-64 rounded-xl border border-white/10 bg-[#1d1f23] p-3 text-left text-xs font-semibold whitespace-normal text-white/80 shadow-xl shadow-black/40"
            style={pos ?? { top: 0, left: 0, visibility: "hidden" }}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-bold tracking-wider text-white/50 uppercase">Absolute Feuchte</span>
              <span className="tnum font-extrabold" style={{ color: band.color }}>
                {fmtAbs(ah)} g/m³
              </span>
            </span>
            <span className="relative mt-2.5 mb-1 flex h-2 overflow-hidden rounded-full">
              {ABS_BANDS.map((b) => {
                const w = ((Math.min(b.max, ABS_SCALE) - from) / ABS_SCALE) * 100;
                from = Math.min(b.max, ABS_SCALE);
                return <span key={b.label} style={{ width: `${w}%`, background: b.color, opacity: b === band ? 1 : 0.45 }} />;
              })}
            </span>
            <span className="relative block h-2">
              <span
                className="absolute -top-0.5 size-0 -translate-x-1/2 border-x-[5px] border-b-[6px] border-x-transparent border-b-white"
                style={{ left: `${Math.min(100, (ah / ABS_SCALE) * 100)}%` }}
              />
            </span>
            <span className="tnum flex justify-between text-[10px] text-white/40">
              {[0, 4, 6, 9, 13, 20].map((v) => (
                <span key={v}>{v === 20 ? "20+" : v}</span>
              ))}
            </span>
            <span className="mt-2.5 flex flex-col gap-1 text-[11px]">
              {ABS_BANDS.map((b) => (
                <span key={b.label} className={`flex items-center gap-1.5 ${b === band ? "text-white" : "text-white/45"}`}>
                  <span className="size-2 shrink-0 rounded-full" style={{ background: b.color }} />
                  <span className="font-bold">{b.label}</span>
                  <span className="truncate">{b.hint}</span>
                </span>
              ))}
            </span>
            <span className="mt-2.5 block border-t border-white/10 pt-2 text-[11px] leading-snug text-white/55">
              Wasser in der Luft, unabhängig von der Temperatur. {`${Math.round(rh)}\u00a0% bei ${Math.round(temp)}\u00a0°C`} entsprechen{" "}
              {`${Math.round(relAt(22, ah))}\u00a0% bei 22\u00a0°C`}.
              {drying && " Beim Trocknen steigt der Wert zuerst, weil das Filament Wasser abgibt. Sinkt er nicht mehr, ist es trocken."}
            </span>
          </span>,
          document.body,
        )}
    </>
  );
}

export const CHIP_LOCKED = "Bambu-Spule mit Chip: Fach, Profil und Farbe stellt der Drucker selbst ein, sie lässt sich nicht verschieben.";

/** Ziehen-Zustand eines Fachs (nur auf der Filament-Seite): Ziel, Quelle, gesperrt bei Chip-Spulen */
function useBay(printerId: number, t: Tray, s: Spool | undefined, on: boolean) {
  const d = useDrag();
  const key = `tray:${printerId}:${t.id}`;
  if (!on) return { props: {}, cls: "" };
  const self = d.item?.from?.printer_id === printerId && d.item.from.tray === t.id;
  const cls = !d.item || self ? "" : t.rfid ? "drop-locked" : d.over === key ? "drop-over" : "drop-ok";
  const item =
    t.rfid || s?.rfid
      ? CHIP_LOCKED
      : s
        ? { spoolId: s.id, color: s.color, fraction: pct(s), from: { printer_id: printerId, tray: t.id } }
        : null;
  return { props: { "data-drop": key, ...d.bind(item) }, cls };
}

export function AmsPanel({ l, printerId, drag = false }: { l: PrinterLive; printerId: number; drag?: boolean }) {
  const spools = useQuery({ queryKey: ["spools"], queryFn: api.spools, refetchInterval: 30_000 });
  const [pick, setPick] = useState<Tray | null>(null);
  const [dry, setDry] = useState<number | null>(null);
  const dryUnit = l.ams.find((u) => u.id === dry);
  const byId = new Map((spools.data ?? []).map((s) => [s.id, s]));
  const printing = l.state === "RUNNING";
  const showExternal = useSetting<boolean>("filament", "show_external");
  // Externe Spule nur mit Einstellung (oder wenn gerade aus ihr gedruckt wird); auf der Filament-Seite dann auch leer als Ziehziel
  const ext = l.external && (showExternal || l.external.active) && (drag || l.external.type || l.external.color) ? l.external : null;
  const extSpool = ext ? byId.get(ext.spool_id ?? 0) : undefined;
  const extBay = useBay(printerId, ext ?? ({ id: 254, rfid: false } as Tray), extSpool, drag && !!ext);
  const extFill = ext ? trayFill(ext, extSpool) : { fraction: 0, text: "leer", empty: true, unknown: false };

  if (!l.ams.length && !ext) return null;
  return (
    <div className="space-y-3">
      {!!l.ams_busy && (
        <div className="flex items-center gap-2 rounded-xl bg-fill px-3 py-2 text-sm font-semibold">
          <Loader2 size={15} className="shrink-0 animate-spin text-accent" /> {AMS_BUSY[l.ams_busy] ?? "AMS arbeitet"} …
        </div>
      )}
      <div className={`grid gap-3 ${l.ams.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {l.ams.map((u, i) => (
          <AmsBox key={u.id} u={u} byId={byId} printing={printing} onPick={setPick} onDry={() => setDry(u.id)} delay={i * 120} printerId={printerId} drag={drag} />
        ))}
      </div>
      {ext && (
        <button
          onClick={() => setPick(ext)}
          {...extBay.props}
          className={`ams-shell flex w-full items-center gap-3 rounded-2xl p-2.5 text-left text-white transition-transform sm:w-auto sm:pr-5 ${extBay.cls}`}
        >
          <span className="relative size-12 shrink-0">
            <SpoolArt color={extFill.unknown ? UNKNOWN : trayColor(ext, extSpool)} {...extFill} spinning={printing && ext.active} glow={ext.active} className="size-12" />
            {extFill.unknown && <Unknown className="text-lg" />}
          </span>
          <div className="min-w-0">
            <div className="text-[11px] font-bold tracking-[0.08em] text-white/55 uppercase">Externe Spule</div>
            <div className="truncate text-sm font-bold">
              {extSpool ? spoolTitle(extSpool) : extFill.empty ? "leer" : extFill.unknown ? "Unbekannt" : ext.name || ext.type}
              {!extFill.empty && <span className="ml-1.5 font-medium text-white/60 tnum">{extFill.text}</span>}
            </div>
          </div>
        </button>
      )}
      {pick && <SlotDialog tray={pick} l={l} printerId={printerId} spools={spools.data ?? []} onClose={() => setPick(null)} />}
      {dryUnit && <DryDialog u={dryUnit} printerId={printerId} onClose={() => setDry(null)} />}
    </div>
  );
}

function AmsBox({
  u,
  byId,
  printing,
  onPick,
  onDry,
  delay,
  printerId,
  drag,
}: {
  u: AmsUnit;
  byId: Map<number, Spool>;
  printing: boolean;
  onPick: (t: Tray) => void;
  onDry: () => void;
  delay: number;
  printerId: number;
  drag: boolean;
}) {
  const active = u.trays.findIndex((t) => t.active);
  const colorOf = (t: Tray) => trayColor(t, t.spool_id ? byId.get(t.spool_id) : undefined) || "#fff";
  const cols = Math.max(u.trays.length, 1);
  const hum = useTween(u.humidity ?? 0, 1400, delay);
  return (
    <div className="ams-shell rise-in rounded-2xl p-2.5 text-white sm:p-3" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-1 pb-2.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-extrabold tracking-tight">{u.label}</span>
          <span className="text-xs font-semibold text-white/50">{u.kind}</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs font-bold whitespace-nowrap tnum">
          {u.dry_pending && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#ff8a3d]/20 px-2 py-1 text-[#ffb27a]" title="Drucker setzt den Befehl um">
              <Loader2 size={13} className="animate-spin" /> {u.dry_pending === "start" ? "Startet" : "Beendet"} …
            </span>
          )}
          {!u.dry_pending && u.drying_min != null && (
            <button
              onClick={onDry}
              disabled={!u.can_dry}
              className="flex shrink-0 items-center gap-1 rounded-full bg-[#ff8a3d]/20 px-2 py-1 text-[#ffb27a] enabled:hover:bg-[#ff8a3d]/30"
              title="AMS trocknet"
            >
              <svg viewBox="0 0 16 14" className="heat size-3.5" aria-hidden>
                {[3, 8, 13].map((x) => (
                  <path key={x} d={`M${x} 13 q -2 -3 0 -6 q 2 -3 0 -6`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                ))}
              </svg>
              <span className="hidden min-[420px]:inline">{DRY_STATUS[u.dry_status ?? 2] ?? "Trocknet"} ·</span> {fmtRemaining(u.drying_min)}
            </button>
          )}
          {!u.dry_pending && u.drying_min == null && u.can_dry && (
            <button onClick={onDry} className="flex shrink-0 items-center gap-1 rounded-full bg-white/8 px-2 py-1 text-white/80 hover:bg-white/14" title="AMS trocknen">
              <Flame size={13} /> Trocknen
            </button>
          )}
          {u.temp != null && (
            <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-white/8 px-2 py-1 text-white/80">
              <Thermometer size={13} /> {Math.round(u.temp)} °C
            </span>
          )}
          {u.humidity != null && (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/8 py-1 pr-2 pl-1.5" title="Luftfeuchte im AMS">
              <Droplets size={13} style={{ color: humColor(u.humidity) }} />
              <span className="relative h-1.5 w-9 overflow-hidden rounded-full bg-white/12">
                <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, hum)}%`, background: humColor(u.humidity) }} />
              </span>
              {Math.round(hum)} %
            </span>
          )}
          {u.humidity != null && u.temp != null && (
            <AbsHumidity temp={u.temp} rh={u.humidity} drying={u.drying_min != null} />
          )}
        </div>
      </div>

      <div className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {u.trays.map((t, i) => (
          <Bay key={t.id} t={t} s={t.spool_id ? byId.get(t.spool_id) : undefined} i={i} delay={delay} printing={printing} onPick={onPick} printerId={printerId} drag={drag} />
        ))}
      </div>

      {/* Zuführung: Faden vom aktiven Fach zum Ausgang */}
      <svg viewBox="0 0 400 34" preserveAspectRatio="none" className="mt-1 block h-7 w-full" aria-hidden>
        {u.trays.map((t, i) => {
          const x = ((i + 0.5) / cols) * 400;
          const d = `M ${x} 0 C ${x} 20, 200 12, 200 34`;
          const on = i === active;
          return (
            <g key={t.id}>
              <path d={d} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
              {on && <path d={d} fill="none" stroke={colorOf(t)} strokeWidth="3" vectorEffect="non-scaling-stroke" className={printing ? "flow" : ""} />}
            </g>
          );
        })}
      </svg>
      <div className="-mt-0.5 flex justify-center">
        <span className={`h-1.5 w-10 rounded-full ${active >= 0 ? "" : "bg-white/15"}`} style={active >= 0 ? { background: colorOf(u.trays[active]!), boxShadow: `0 0 10px ${colorOf(u.trays[active]!)}` } : undefined} />
      </div>
    </div>
  );
}

function Bay({
  t,
  s,
  i,
  delay,
  printing,
  onPick,
  printerId,
  drag,
}: {
  t: Tray;
  s: Spool | undefined;
  i: number;
  delay: number;
  printing: boolean;
  onPick: (t: Tray) => void;
  printerId: number;
  drag: boolean;
}) {
  const f = trayFill(t, s);
  const bay = useBay(printerId, t, s, drag);
  const d = useDrag();
  return (
    <button
      onClick={() => onPick(t)}
      {...bay.props}
      className={`ams-bay group relative rounded-xl px-1.5 pt-2 pb-2 text-center transition-transform active:scale-[0.97] ${t.active ? "ring-2" : ""} ${bay.cls}`}
      style={{ ...(bay.props as { style?: React.CSSProperties }).style, ...(t.active ? ({ "--tw-ring-color": trayColor(t, s) || "#fff" } as React.CSSProperties) : {}) }}
      aria-label={`Fach ${t.label}`}
    >
      <span className="absolute top-1.5 left-2 text-[10px] font-extrabold text-white/45">{t.label}</span>
      {t.rfid && (drag && d.item ? <Lock size={11} className="absolute top-1.5 right-1.5 text-white/60" aria-label="gesperrt" /> : <Nfc size={11} className="absolute top-1.5 right-1.5 text-white/35" aria-label="RFID" />)}
      <div className="relative mx-auto mt-1.5 aspect-square w-[82%] max-w-28">
        <SpoolArt color={f.unknown ? UNKNOWN : trayColor(t, s)} fraction={f.fraction} empty={f.empty} spinning={printing && t.active} glow={t.active} delay={delay + i * 90} className={`spool-hover size-full ${t.reading ? "animate-pulse" : ""}`} />
        {f.unknown && !t.reading && <Unknown className="text-[clamp(1.1rem,4vw,1.6rem)]" />}
      </div>
      <div className="mt-1.5 truncate text-[11.5px] leading-tight font-bold sm:text-xs">{f.empty ? "leer" : s ? spoolTitle(s) : f.unknown ? "Unbekannt" : t.name || t.type || "?"}</div>
      <div className="truncate text-[10.5px] leading-tight font-semibold text-white/55 tnum sm:text-[11px]">
        {f.empty ? "–" : f.unknown ? f.text : `${s?.material || t.type} · ${f.text}`}
      </div>
    </button>
  );
}

/**
 * Fachwahl wie auf dem Dashboard (Slicen): AMS-Kästen mit denselben Spulen, das gewählte Fach leuchtet in seiner Farbe und dreht.
 * `marks` = Fächer, die schon ein anderes Filament der Datei bekommt (Nummer am Fach), `want` = Material aus der Datei.
 */
export function TrayPicker({
  l,
  value,
  onPick,
  marks,
  want,
}: {
  l: PrinterLive;
  value: number | null;
  onPick: (id: number) => void;
  marks?: Map<number, number>;
  want?: string;
}) {
  const spools = useQuery({ queryKey: ["spools"], queryFn: api.spools, refetchInterval: 30_000 });
  const byId = new Map((spools.data ?? []).map((s) => [s.id, s]));
  const ext = l.external?.type ? l.external : null;
  const odd = (t: Tray) => !!want && baseMaterial(t.type) !== baseMaterial(want);

  const bay = (t: Tray, i: number, delay: number, compact = false) => {
    const s = t.spool_id ? byId.get(t.spool_id) : undefined;
    const f = trayFill(t, s);
    const on = t.id === value;
    const color = trayColor(t, s);
    const mark = marks?.get(t.id);
    return (
      <button
        key={t.id}
        type="button"
        disabled={!t.type}
        onClick={() => onPick(t.id)}
        aria-pressed={on}
        aria-label={`Fach ${t.label}`}
        className={`ams-bay relative rounded-xl text-center transition-transform enabled:active:scale-[0.97] disabled:opacity-45 ${
          compact ? "flex items-center gap-2.5 px-2 py-1.5 text-left" : "px-1 pt-1.5 pb-1.5"
        }`}
        style={on ? { outline: `2px solid ${!color || luma(color) < 0.3 ? "rgba(255,255,255,0.8)" : color}`, outlineOffset: 1 } : undefined}
      >
        {!compact && <span className="absolute top-1 left-1.5 text-[10px] font-extrabold text-white/45">{t.label}</span>}
        {mark != null && (
          <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-white/85 text-[10px] font-extrabold text-black" title={`Filament ${mark}`}>
            {mark}
          </span>
        )}
        <div className={`relative ${compact ? "size-10 shrink-0" : "mx-auto mt-2 aspect-square w-[78%] max-w-20"}`}>
          <SpoolArt
            color={f.unknown ? UNKNOWN : color}
            fraction={f.fraction}
            empty={f.empty}
            spinning={on}
            glow={on}
            delay={delay + i * 90}
            className={`spool-hover size-full ${t.reading ? "animate-pulse" : ""}`}
          />
          {f.unknown && !t.reading && <Unknown className={compact ? "text-base" : "text-[clamp(1rem,3.5vw,1.4rem)]"} />}
        </div>
        <div className="min-w-0">
          {compact && <div className="text-[11px] font-bold tracking-[0.08em] text-white/55 uppercase">Externe Spule</div>}
          <div className="mt-1 truncate text-[11px] leading-tight font-bold sm:text-xs">{f.empty ? "leer" : s ? spoolTitle(s) : t.name || t.type || "?"}</div>
          <div className={`truncate text-[10px] leading-tight font-semibold tnum sm:text-[11px] ${t.type && odd(t) ? "text-[#ffb27a]" : "text-white/55"}`}>
            {!t.type ? "–" : odd(t) ? `${s?.material || t.type} · anders` : `${s?.material || t.type} · ${f.unknown ? "?" : f.text}`}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-2">
      {l.ams.map((u, k) => (
        <div key={u.id} className="ams-shell rise-in rounded-2xl p-2 text-white" style={{ animationDelay: `${k * 120}ms` }}>
          <div className="flex items-baseline gap-2 px-1 pb-1.5">
            <span className="text-[13px] font-extrabold tracking-tight">{u.label}</span>
            <span className="text-[11px] font-semibold text-white/50">{u.kind}</span>
          </div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(u.trays.length, 1)}, minmax(0, 1fr))` }}>
            {u.trays.map((t, i) => bay(t, i, k * 120))}
          </div>
        </div>
      ))}
      {ext && <div className="ams-shell rounded-2xl p-1.5 text-white [&>button]:w-full">{bay(ext, 0, l.ams.length * 120, true)}</div>}
    </div>
  );
}

/** Spule aus der Bibliothek in ein Fach legen */
function SlotDialog({ tray, l, printerId, spools, onClose }: { tray: Tray; l: PrinterLive; printerId: number; spools: Spool[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const current = spools.find((s) => s.id === tray.spool_id);
  const set = useMutation({
    mutationFn: (v: { id: number; slot: { printer_id: number; tray: number } | null }) => api.setSlot(v.id, v.slot),
    onSuccess: (r) => {
      pushedToast(toast, r.pushed);
      void qc.invalidateQueries({ queryKey: ["spools"] });
      void qc.invalidateQueries({ queryKey: ["live"] });
      onClose();
    },
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["spools"] });
    void qc.invalidateQueries({ queryKey: ["live"] });
    void qc.invalidateQueries({ queryKey: ["spool-usage"] });
  };
  // Rest einer Spule ohne Chip setzen (angebrochen eingelegt): Korrektur, danach zählt die App selbst
  const [rest, setRest] = useState("");
  const setRestM = useMutation({
    mutationFn: (s: Spool) => api.bookUsage(s.id, { grams: Math.round((s.remaining_g - Number(rest.replace(",", "."))) * 10) / 10, note: "Rest gesetzt" }),
    onSuccess: () => (toast("Rest gesetzt"), setRest(""), refresh()),
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const mat = (tray.type || "").toUpperCase().split(/[\s-]/)[0];
  const list = spools
    .filter((s) => !s.archived && !s.rfid && s.id !== current?.id)
    .sort((a, b) => Number(b.material.toUpperCase().startsWith(mat ?? "")) - Number(a.material.toUpperCase().startsWith(mat ?? "")) || Number(!!a.slot) - Number(!!b.slot));

  return (
    <Dialog title={`Fach ${tray.label}`} onClose={onClose}>
      <div className="space-y-4">
        <TrayActions tray={tray} l={l} printerId={printerId} onDone={onClose} />
        {current ? (
          <div className="flex items-center gap-3 rounded-xl bg-card p-3 shadow-card">
            <SpoolArt color={current.color} fraction={pct(current)} className="size-14" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold">{spoolTitle(current)}</div>
              <div className="truncate text-xs text-ink3">
                {spoolSub(current)} · noch {fmtG(current.remaining_g)}
              </div>
            </div>
            <a href={href({ page: "filament", spool: current.id })} className="grid size-9 place-items-center rounded-lg text-ink2 hover:bg-hover" aria-label="Spule öffnen">
              <ExternalLink size={16} />
            </a>
          </div>
        ) : null}
        {current && !current.rfid && (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (rest.trim() && !Number.isNaN(Number(rest.replace(",", ".")))) setRestM.mutate(current);
            }}
          >
            <div className="flex gap-2">
              <input
                className="h-9 min-w-0 flex-1 rounded-lg bg-bg px-2.5 text-sm shadow-seg tnum"
                inputMode="decimal"
                placeholder={`Rest in g (jetzt ${Math.round(current.remaining_g)})`}
                value={rest}
                onChange={(e) => setRest(e.target.value)}
                aria-label="Rest in Gramm"
              />
              <Button busy={setRestM.isPending} disabled={!rest.trim()}>
                Rest setzen
              </Button>
            </div>
            <RestChips net={current.net_g} onPick={(r) => setRest(String(r))} />
          </form>
        )}
        {current ? null : (
          <p className="text-sm text-ink2">
            {tray.reading
              ? "Das AMS liest gerade den RFID-Chip."
              : tray.rfid
                ? `Im Fach liegt ${tray.name || tray.type}, aber keine Spule aus der Bibliothek.`
                : tray.loaded
                  ? "Im Fach steckt eine Spule ohne Chip. Welche, weiß die App erst, wenn du sie zuordnest."
                  : "Das Fach ist leer."}{" "}
            Wähle die Spule, damit der
            Verbrauch der Drucke von ihr abgezogen wird.
          </p>
        )}
        {tray.rfid ? (
          <p className="flex items-start gap-2 rounded-lg bg-fill p-3 text-xs text-ink2">
            <Nfc size={15} className="mt-px shrink-0" /> Bambu-Spule mit RFID-Chip: wird automatisch erkannt und zugeordnet.
          </p>
        ) : (
          <>
            {!!list.length && (
              <div className="max-h-[46dvh] divide-y divide-sep overflow-y-auto rounded-xl bg-card shadow-card">
                {list.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => set.mutate({ id: s.id, slot: { printer_id: printerId, tray: tray.id } })}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-hover"
                  >
                    <SpoolArt color={s.color} fraction={pct(s)} className="size-10 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{spoolTitle(s)}</div>
                      <div className="truncate text-xs text-ink3">
                        {spoolSub(s)} · {fmtG(s.remaining_g)}
                        {s.slot ? ` · liegt in ${s.slot}` : ""}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {!list.length && !current && <p className="text-sm text-ink3">Keine freie Spule in der Bibliothek.</p>}
            {!current && <NewSpoolForm tray={tray} printerId={printerId} onDone={onClose} />}
            <div className="flex flex-wrap justify-between gap-2">
              {current ? (
                <Button kind="danger" busy={set.isPending} onClick={() => set.mutate({ id: current.id, slot: null })}>
                  Aus dem Fach nehmen
                </Button>
              ) : (
                <span />
              )}
              <a href={href({ page: "filament" })} className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-accent hover:bg-hover">
                Zur Filament-Bibliothek
              </a>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** Filament laden/entladen und RFID neu lesen (wie die Knöpfe unter dem AMS in Bambu Studio) */
function TrayActions({ tray, l, printerId, onDone }: { tray: Tray; l: PrinterLive; printerId: number; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const run = useMutation({
    mutationFn: (a: "load" | "unload" | "rfid") =>
      a === "rfid" ? api.readRfid(printerId, tray.id) : api.loadFilament(printerId, a === "load" ? tray.id : null),
    onSuccess: (_r, a) => {
      toast(a === "rfid" ? "Chip wird gelesen" : a === "load" ? "Filament wird geladen" : "Filament wird entladen");
      void qc.invalidateQueries({ queryKey: ["live"] });
      onDone();
    },
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  if (!l.connected) return null;
  const busy = !!l.ams_busy || ["PREPARE", "RUNNING", "SLICING"].includes(l.state);
  const loaded = l.loaded_tray === tray.id;
  const canLoad = tray.loaded && !loaded;
  const canRfid = tray.id !== 254 && tray.loaded && l.state !== "PAUSE";
  if (!canLoad && !loaded && !canRfid) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2">
        {canLoad && (
          <Button disabled={busy} busy={run.isPending && run.variables === "load"} onClick={() => run.mutate("load")}>
            <ArrowDownToLine size={15} /> Laden
          </Button>
        )}
        {loaded && (
          <Button disabled={busy} busy={run.isPending && run.variables === "unload"} onClick={() => run.mutate("unload")}>
            <ArrowUpFromLine size={15} /> Entladen
          </Button>
        )}
        {canRfid && (
          <Button disabled={busy} busy={run.isPending && run.variables === "rfid"} onClick={() => run.mutate("rfid")}>
            <RefreshCw size={15} /> Chip neu lesen
          </Button>
        )}
      </div>
      <p className="text-xs text-ink3">
        {busy
          ? "Während eines Drucks bzw. solange das AMS arbeitet, geht das nicht."
          : loaded
            ? "Dieses Filament steckt gerade in der Düse. Zum Laden und Entladen heizt der Drucker die Düse."
            : "Zum Laden heizt der Drucker die Düse und zieht ein geladenes Filament vorher zurück."}
      </p>
    </div>
  );
}

/** AMS trocknen: Temperatur und Dauer, Vorschlag vom Chip der Spulen; läuft die Trocknung, nur „Beenden“ */
function DryDialog({ u, printerId, onClose }: { u: AmsUnit; printerId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const types = [...new Set(u.trays.filter((t) => t.type).map((t) => t.type))];
  const first = u.trays.find((t) => t.dry_temp && t.type);
  const [filament, setFilament] = useState(first?.type ?? types[0] ?? "PLA");
  const preset = (type: string) => {
    const t = u.trays.find((x) => x.type === type && x.dry_temp);
    return { temp: String(Math.min(u.dry_max, Math.max(45, t?.dry_temp ?? (type.toUpperCase().startsWith("PLA") ? 55 : 65)))), hours: String(t?.dry_hours ?? 8) };
  };
  const [v, setV] = useState(() => preset(first?.type ?? types[0] ?? "PLA"));
  const running = u.drying_min != null || (u.dry_status != null && u.dry_status > 0 && u.dry_status < 5);
  const blocked = u.dry_blocked.filter((r) => r !== 6);
  const go = useMutation({
    mutationFn: (stop: boolean) =>
      api.dryAms(printerId, stop ? { ams: u.id, stop: true } : { ams: u.id, temp: Number(v.temp), hours: Number(v.hours), filament }),
    onSuccess: (_r, stop) => {
      toast(stop ? "Trocknung wird beendet" : "Trocknung startet");
      void qc.invalidateQueries({ queryKey: ["live"] });
      onClose();
    },
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const temp = Number(v.temp);
  const hours = Number(v.hours);
  const valid = temp >= 45 && temp <= u.dry_max && hours >= 1 && hours <= 72;
  return (
    <Dialog title={`${u.label} trocknen`} onClose={onClose}>
      {u.dry_pending ? (
        <p className="flex items-center gap-2 text-sm text-ink2">
          <Loader2 size={15} className="shrink-0 animate-spin text-accent" />
          {u.dry_pending === "start" ? "Trocknung startet" : "Trocknung wird beendet"}, der Drucker braucht dafür einige Sekunden.
        </p>
      ) : running ? (
        <div className="space-y-4">
          <p className="text-sm text-ink2">
            {DRY_STATUS[u.dry_status ?? 2] ?? "Trocknet"}
            {u.drying_min != null && <>, noch {fmtRemaining(u.drying_min)}</>}.
          </p>
          <Button kind="danger" busy={go.isPending} onClick={() => go.mutate(true)}>
            Trocknung beenden
          </Button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) go.mutate(false);
          }}
        >
          {types.length > 1 && (
            <div>
              <div className="mb-1.5 text-xs font-bold tracking-[0.08em] text-ink3 uppercase">Filament</div>
              <div className="flex flex-wrap gap-1.5">
                {types.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => (setFilament(t), setV(preset(t)))}
                    className={`h-8 rounded-lg px-3 text-sm font-semibold ${t === filament ? "bg-ink text-bg" : "bg-card shadow-seg"}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold tracking-[0.08em] text-ink3 uppercase">Temperatur</span>
              <span className="flex items-center gap-1.5">
                <input
                  className={INPUT + " tnum"}
                  inputMode="numeric"
                  value={v.temp}
                  onChange={(e) => setV({ ...v, temp: e.target.value.replace(/\D/g, "") })}
                  aria-label="Temperatur in Grad"
                />
                <span className="text-sm text-ink2">°C</span>
              </span>
              <span className="mt-1 block text-xs text-ink3">45–{u.dry_max} °C</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold tracking-[0.08em] text-ink3 uppercase">Dauer</span>
              <span className="flex items-center gap-1.5">
                <input
                  className={INPUT + " tnum"}
                  inputMode="numeric"
                  value={v.hours}
                  onChange={(e) => setV({ ...v, hours: e.target.value.replace(/\D/g, "") })}
                  aria-label="Dauer in Stunden"
                />
                <span className="text-sm text-ink2">h</span>
              </span>
              <span className="mt-1 block text-xs text-ink3">1–72 Stunden</span>
            </label>
          </div>
          {blocked.length > 0 ? (
            <p className="rounded-lg bg-bad-soft p-3 text-sm">{blocked.map((r) => DRY_BLOCK[r] ?? `Grund ${r}`).join(" ")}</p>
          ) : (
            <p className="text-xs text-ink3">
              Vorschlag vom Chip der Spule. Fadenenden, die noch im Einlass stecken, können bei hoher Temperatur weich werden: besser vorher herausziehen.
            </p>
          )}
          <Button kind="primary" type="submit" disabled={!valid || blocked.length > 0} busy={go.isPending}>
            <Flame size={15} /> Trocknung starten
          </Button>
        </form>
      )}
    </Dialog>
  );
}

/** Neue Spule ohne Chip direkt fürs Fach anlegen: Material und Farbe vom Drucker, Rest bei angebrochenen Spulen schätzen */
const INPUT = "h-9 w-full min-w-0 rounded-lg bg-bg px-2.5 text-sm shadow-seg outline-none placeholder:text-ink3 focus:shadow-[0_0_0_2px_var(--c-accent)]";

function NewSpoolForm({ tray, printerId, onDone }: { tray: Tray; printerId: number; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const catalog = useCatalog();
  const [open, setOpen] = useState(false);
  const netDefault = useSetting<number>("filament", "net_g");
  const [v, setV] = useState({ brand: "", material: tray.type || "PLA", name: tray.name, color: "", color_name: "", net: "", rest: "" });
  const num = (x: string) => Number(x.replace(",", "."));
  const net = num(v.net) > 0 ? num(v.net) : netDefault;
  const rest = v.rest.trim() ? Math.min(net, Math.max(0, num(v.rest))) : net;
  const valid = /^#[0-9a-f]{6}$/i.test(v.color) && !!v.material.trim() && !Number.isNaN(rest);
  const add = useMutation({
    mutationFn: async () => {
      const { id } = await api.addSpool({
        brand: v.brand.trim(), material: v.material.trim(), name: v.name.trim(), color: v.color.toUpperCase(), color_name: v.color_name.trim(),
        net_g: net, used_g: Math.round((net - rest) * 10) / 10, tare_g: null, price: null, location: "", note: "",
      });
      return (await api.setSlot(id, { printer_id: printerId, tray: tray.id })).pushed;
    },
    onSuccess: (pushed) => {
      pushedToast(toast, pushed, "Spule angelegt und eingelegt");
      void qc.invalidateQueries({ queryKey: ["spools"] });
      void qc.invalidateQueries({ queryKey: ["live"] });
      onDone();
    },
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  if (!open)
    return (
      <Button type="button" onClick={() => setOpen(true)} className="w-full">
        <Plus size={15} /> Neue Spule für dieses Fach
      </Button>
    );
  return (
    <form
      className="space-y-3 rounded-xl bg-card p-3 shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) add.mutate();
      }}
    >
      <div className="flex items-center gap-3">
        <label
          className="relative flex size-9 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full text-sm font-black text-ink3 shadow-seg"
          style={{ background: v.color || "var(--c-fill)" }}
          title="Farbe wählen"
        >
          {!v.color && "?"}
          <input type="color" value={(v.color || "#888888").toLowerCase()} onChange={(e) => setV({ ...v, color: e.target.value.toUpperCase(), color_name: "" })} className="absolute inset-0 opacity-0" aria-label="Farbe wählen" />
        </label>
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
          <input className={INPUT} value={v.material} onChange={set("material")} placeholder="Material" aria-label="Material" required />
          <input className={INPUT} value={v.brand} onChange={set("brand")} placeholder="Marke" aria-label="Marke" list="tray-brands" />
        </div>
      </div>
      <datalist id="tray-brands">
        {(catalog.data?.map((b) => b.brand) ?? ["Bambu Lab"]).map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <SorteField
        className={INPUT}
        brand={v.brand}
        value={v.name}
        onText={(name) => setV({ ...v, name })}
        onLine={(l) => setV({ ...v, name: l.name, material: l.material, color_name: carryColorName(l, v.color_name) })}
        placeholder="Sorte (Basic, Matte …)"
      />
      <CatalogColors brand={v.brand} line={v.name} colorName={v.color_name} onPick={(color_name, hex) => setV({ ...v, color_name, color: `#${hex}` })} />
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] font-bold tracking-[0.08em] text-ink3 uppercase">Netto (g)</span>
          <input className={`${INPUT} mt-1 tnum`} inputMode="decimal" value={v.net} onChange={set("net")} placeholder={String(netDefault)} />
        </label>
        <label className="block">
          <span className="text-[11px] font-bold tracking-[0.08em] text-ink3 uppercase">Rest (g)</span>
          <input className={`${INPUT} mt-1 tnum`} inputMode="decimal" value={v.rest} onChange={set("rest")} placeholder={`${net} (neu)`} />
        </label>
      </div>
      <RestChips net={net} onPick={(r) => setV({ ...v, rest: String(r) })} />
      <p className="text-[11px] leading-snug text-ink3">Ab jetzt zieht die App den Verbrauch jedes Drucks aus diesem Fach ab.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" kind="ghost" onClick={() => setOpen(false)}>
          Abbrechen
        </Button>
        <Button kind="primary" busy={add.isPending} disabled={!valid}>
          Anlegen und einlegen
        </Button>
      </div>
    </form>
  );
}
