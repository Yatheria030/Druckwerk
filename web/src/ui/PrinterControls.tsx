import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  ChevronsDown,
  ChevronsUp,
  Crosshair,
  DoorOpen,
  Download,
  Droplet,
  Fan,
  Gauge,
  Home,
  Layers,
  type LucideIcon,
  MoveHorizontal,
  Nfc,
  Printer,
  QrCode,
  Repeat,
  RotateCcw,
  ScanEye,
  Shuffle,
  SlidersHorizontal,
  Thermometer,
  Trash2,
  Volume2,
  Waves,
  Wind,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { AIRDUCT_LABEL, fmtSize, OPTION_LEVEL, type PrintOption, type ControlAction, type ModelFile, type PrinterLive, type StorageFile } from "../../../shared/types.ts";
import { href } from "../lib/router.ts";
import { PrintDialog } from "./PrintDialog.tsx";
import { api } from "../api.ts";
import { Button, Dialog, fmtDate, Label, useToast } from "./controls.tsx";

/** Befehl an den Drucker; nach Erfolg den Live-Stand neu holen */
export function useControl(printerId: number) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (a: { action: ControlAction; value?: number; index?: number; objects?: number[] }) => api.control(printerId, a.action, a.value, a.index, a.objects),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["live"] }),
    onError: (e) => toast((e as Error).message, "fehler"),
  });
}

const PRESETS: Record<"nozzle" | "bed", [string, number][]> = {
  nozzle: [
    ["PLA", 220],
    ["PETG", 250],
    ["ABS/ASA", 260],
  ],
  bed: [
    ["PLA", 55],
    ["PETG", 70],
    ["ABS/ASA", 90],
  ],
};

/** Zieltemperatur für Düse oder Bett setzen */
export function TempDialog({ printerId, kind, l, onClose }: { printerId: number; kind: "nozzle" | "bed"; l: PrinterLive; onClose: () => void }) {
  const ctl = useControl(printerId);
  const target = kind === "nozzle" ? l.nozzle_target : l.bed_target;
  const now = kind === "nozzle" ? l.nozzle : l.bed;
  const max = kind === "nozzle" ? 300 : 110;
  const [v, setV] = useState(target ? String(Math.round(target)) : "");
  const n = Number(v);
  const ok = v !== "" && Number.isInteger(n) && n >= 0 && n <= max;
  const send = (t: number) => ctl.mutate({ action: kind === "nozzle" ? "nozzle_temp" : "bed_temp", value: t }, { onSuccess: onClose });

  return (
    <Dialog title={kind === "nozzle" ? "Düse heizen" : "Bett heizen"} onClose={onClose}>
      <div className="flex items-baseline justify-between text-sm text-ink2 tnum">
        <span>Jetzt {now != null ? `${Math.round(now)} °C` : "–"}</span>
        <span>Ziel {target ? `${Math.round(target)} °C` : "aus"}</span>
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) send(n);
        }}
      >
        <div className="flex h-9 min-w-0 flex-1 items-center rounded-lg bg-card px-3 shadow-seg focus-within:shadow-[0_0_0_2px_var(--c-accent)]">
          <input
            className="field tnum"
            type="number"
            inputMode="numeric"
            min={0}
            max={max}
            value={v}
            onChange={(e) => setV(e.target.value)}
            placeholder="Zieltemperatur"
            aria-label="Zieltemperatur in °C"
            autoFocus
          />
          <span className="pl-2 text-sm text-ink3">°C</span>
        </div>
        <Button kind="primary" type="submit" disabled={!ok} busy={ctl.isPending}>
          Setzen
        </Button>
      </form>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {([["Aus", 0], ...PRESETS[kind]] as [string, number][]).map(([name, t]) => (
          <button
            key={name}
            type="button"
            onClick={() => setV(String(t))}
            className={`rounded-lg px-1 py-1.5 text-center ${v === String(t) ? "bg-ink text-bg" : "bg-card shadow-seg"}`}
          >
            <div className="truncate text-[11px] font-semibold opacity-70">{name}</div>
            <div className="text-sm font-bold tnum">{t ? `${t} °` : "0 °"}</div>
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink3">Höchstens {max} °C, 0 schaltet die Heizung aus. Der Drucker heizt sofort, auch ohne Druck.</p>
    </Dialog>
  );
}

/** Lüfter in Zehnerschritten und Luftstrom-Modus (P2S/H2) */
export function FanDialog({ printerId, l, onClose }: { printerId: number; l: PrinterLive; onClose: () => void }) {
  const ctl = useControl(printerId);
  const [draft, setDraft] = useState<Record<number, number>>({});

  return (
    <Dialog title="Lüfter" onClose={onClose}>
      {l.airduct && (
        <div className="mb-4">
          <Label>Luftstrom</Label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {l.airduct.modes.map((m) => (
              <button
                key={m}
                disabled={ctl.isPending}
                onClick={() => m !== l.airduct?.mode && ctl.mutate({ action: "airduct", value: m })}
                className={`h-8 rounded-lg px-3 text-sm font-semibold ${m === l.airduct?.mode ? "bg-ink text-bg" : "bg-card shadow-seg"}`}
              >
                {AIRDUCT_LABEL[m] ?? `Modus ${m}`}
              </button>
            ))}
          </div>
        </div>
      )}
      {!l.fans.length ? (
        <p className="text-sm text-ink2">Der Drucker meldet keine Lüfter.</p>
      ) : (
        <div className="space-y-4">
          {l.fans.map((f) => {
            const val = draft[f.id] ?? f.target;
            const commit = () => {
              if (draft[f.id] == null) return;
              ctl.mutate({ action: "fan", index: f.id, value: draft[f.id] }, { onSettled: () => setDraft(({ [f.id]: _, ...rest }) => rest) });
            };
            return (
              <div key={f.id}>
                <div className="flex items-baseline justify-between">
                  <Label>{f.label}</Label>
                  <span className="text-sm font-bold tnum">
                    {draft[f.id] == null && f.speed !== f.target && <span className="font-medium text-ink3">{f.speed} % → </span>}
                    {val ? `${val} %` : "aus"}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={10}
                  value={val}
                  aria-label={`${f.label} in Prozent`}
                  className="range mt-1"
                  style={{ "--p": `${val}%` } as CSSProperties}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.id]: Number(e.target.value) }))}
                  onPointerUp={commit}
                  onKeyUp={commit}
                />
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-xs text-ink3">Beim nächsten Druck stellt der G-Code die Lüfter wieder selbst ein.</p>
    </Dialog>
  );
}

const OPTION_GROUPS: [PrintOption["group"], string, string][] = [
  ["ki", "KI-Erkennung", "Die Kamera schaut beim Drucken mit und hält an, bevor ein Fehler Filament und Zeit frisst."],
  ["druck", "Druck", "Verhalten des Druckers während und nach dem Druck."],
  ["ams", "AMS", "Chips, Restmenge und Ersatzspulen."],
];

/** Symbol je Option; aktiv in Akzentfarbe */
const OPTION_ICON: Record<string, LucideIcon> = {
  ai_monitor: ScanEye,
  spaghetti: Waves,
  pileup: Trash2,
  clump: Droplet,
  airprint: Wind,
  first_layer: Layers,
  plate_marker: QrCode,
  plate_align: Crosshair,
  foreign_object: Box,
  model_moved: MoveHorizontal,
  auto_recovery: RotateCcw,
  ams_insert_read: Nfc,
  ams_startup_read: Nfc,
  ams_remain: Gauge,
  auto_refill: Repeat,
  tangle: Shuffle,
  nozzle_blob: Droplet,
  nozzle_blob_v2: Droplet,
  air_printing: Wind,
  idle_heating: Thermometer,
  purify_air: Fan,
  door: DoorOpen,
  sound: Volume2,
};

function Switch({ on, disabled, label, onChange }: { on: boolean; disabled?: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:shadow-[0_0_0_2px_var(--c-accent)] disabled:opacity-60 ${on ? "bg-accent" : "bg-ink4"}`}
    >
      <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : ""}`} />
    </button>
  );
}

function Segments<T extends string | number>({ items, value, disabled, onPick }: { items: [T, string][]; value: T | null | undefined; disabled?: boolean; onPick: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(([v, text]) => (
        <button
          key={String(v)}
          disabled={disabled}
          onClick={() => v !== value && onPick(v)}
          className={`h-7 rounded-lg px-2.5 text-xs font-semibold disabled:opacity-60 ${v === value ? "bg-ink text-bg" : "bg-card shadow-seg"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Druckoptionen und KI-Erkennung (wie „Druckoptionen“ in Bambu Studio); gilt auch für den laufenden Druck */
export function OptionsDialog({ printerId, l, onClose }: { printerId: number; l: PrinterLive; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const set = useMutation({
    mutationFn: (a: { key: string; on: boolean; level?: string; choice?: number }) => api.option(printerId, a.key, a),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["live"] }),
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const busy = (key: string) => set.isPending && set.variables?.key === key;

  return (
    <Dialog title="Druckoptionen" onClose={onClose}>
      {!l.options.length ? (
        <p className="text-sm text-ink2">Der Drucker meldet keine Optionen.</p>
      ) : (
        <div className="space-y-5">
          {OPTION_GROUPS.map(([g, title, sub]) => {
            const opts = l.options.filter((o) => o.group === g);
            if (!opts.length) return null;
            return (
              <section key={g}>
                <div className="flex items-baseline justify-between gap-3">
                  <Label>{title}</Label>
                  <span className="text-[11px] text-ink3 tnum">
                    {opts.filter((o) => o.on).length} von {opts.length} an
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-ink3">{sub}</p>
                <div className="mt-1.5 divide-y divide-sep rounded-xl bg-fill">
                  {opts.map((o) => {
                    const Icon = OPTION_ICON[o.key] ?? SlidersHorizontal;
                    return (
                    <div key={o.key} className="px-3 py-2.5">
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors ${o.on ? "bg-accent-soft text-accent" : "bg-card text-ink3"}`}
                        >
                          <Icon size={17} strokeWidth={2} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold">{o.label}</div>
                          <p className="mt-0.5 text-xs text-ink3">{o.help}</p>
                        </div>
                        {!o.choices && (
                          <Switch on={o.on} label={o.label} disabled={set.isPending} onChange={(on) => set.mutate({ key: o.key, on, level: o.level ?? undefined })} />
                        )}
                      </div>
                      {o.choices && (
                        <div className="mt-2 pl-11">
                          <Segments
                            items={o.choices.map((c) => [c.value, c.label] as [number, string])}
                            value={o.choice}
                            disabled={busy(o.key)}
                            onPick={(choice) => set.mutate({ key: o.key, on: choice > 0, choice })}
                          />
                        </div>
                      )}
                      {o.levels && o.on && (
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 pl-11">
                          <span className="text-xs text-ink2">Empfindlichkeit</span>
                          <Segments
                            items={o.levels.map((v) => [v, OPTION_LEVEL[v] ?? v] as [string, string])}
                            value={o.level}
                            disabled={busy(o.key)}
                            onPick={(level) => set.mutate({ key: o.key, on: true, level })}
                          />
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-xs text-ink3">Die Einstellungen speichert der Drucker selbst, sie gelten auch für Drucke aus Bambu Studio.</p>
    </Dialog>
  );
}

/** Kurzanzeige der Lüfter für die Druckerkarte */
/** Farbe aus einer CSS-Variable als [r, g, b] (für das Auswahlbild) */
function cssRgb(name: string): [number, number, number] {
  const c = document.createElement("canvas").getContext("2d")!;
  c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
  const hex = c.fillStyle.startsWith("#") ? c.fillStyle : "#888888";
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * Objekte überspringen wie in Bambu Studio: Auswahlbild der Platte (jedes Objekt in eigener Farbe, ID = R + G·256 + B·65536)
 * zum Antippen, daneben die Liste. Übersprungene Objekte (`s_obj`) sind grau und nicht mehr wählbar.
 */
export function SkipDialog({ printerId, onClose }: { printerId: number; onClose: () => void }) {
  const parts = useQuery({ queryKey: ["parts", printerId], queryFn: () => api.parts(printerId), refetchInterval: 10_000 });
  const ctl = useControl(printerId);
  const toast = useToast();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [ids, setIds] = useState<{ w: number; h: number; px: Uint32Array } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const p = parts.data;
  const skipped = useMemo(() => new Set(p?.skipped ?? []), [p?.skipped]);

  // Auswahlbild einmal laden und in IDs je Pixel umrechnen
  useEffect(() => {
    if (!p?.pick) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const px = new Uint32Array(c.width * c.height);
      for (let i = 0; i < px.length; i++) px[i] = d[i * 4 + 3]! < 128 ? 0 : d[i * 4]! + (d[i * 4 + 1]! << 8) + (d[i * 4 + 2]! << 16);
      setIds({ w: c.width, h: c.height, px });
    };
    img.src = `/api/printers/${printerId}/parts/${p.print_id}/pick.png`;
  }, [p?.pick, p?.print_id, printerId]);

  // Objekte einfärben: offen, gewählt, übersprungen
  useEffect(() => {
    const c = canvas.current;
    if (!c || !ids || !p) return;
    c.width = ids.w;
    c.height = ids.h;
    const known = new Set(p.objects.map((o) => o.id));
    const [open, chosen, ink, fill] = [cssRgb("--c-green"), cssRgb("--c-red"), cssRgb("--c-ink3"), cssRgb("--c-fill")];
    // übersprungen: Grau, halb in den Hintergrund gemischt (hell wie dunkel zurückhaltend)
    const gone = ink.map((v, i) => Math.round(v * 0.3 + fill[i]! * 0.7)) as [number, number, number];
    const out = new ImageData(ids.w, ids.h);
    for (let i = 0; i < ids.px.length; i++) {
      const id = ids.px[i]!;
      if (!id || !known.has(id)) continue;
      const rgb = skipped.has(id) ? gone : sel.has(id) ? chosen : open;
      out.data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
    }
    c.getContext("2d")!.putImageData(out, 0, 0);
  }, [ids, p, sel, skipped]);

  const toggle = (id: number) =>
    !skipped.has(id) &&
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const pickAt = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!ids) return;
    const r = e.currentTarget.getBoundingClientRect();
    // Treffer großzügig: Umkreis von 6 Bildpunkten absuchen
    const x0 = Math.floor(((e.clientX - r.left) / r.width) * ids.w);
    const y0 = Math.floor(((e.clientY - r.top) / r.height) * ids.h);
    for (let d = 0; d <= 6; d++)
      for (let dy = -d; dy <= d; dy++)
        for (let dx = -d; dx <= d; dx++) {
          const x = x0 + dx;
          const y = y0 + dy;
          if (x < 0 || y < 0 || x >= ids.w || y >= ids.h) continue;
          const id = ids.px[y * ids.w + x]!;
          if (id && p?.objects.some((o) => o.id === id)) return toggle(id);
        }
  };
  const left = p ? p.objects.filter((o) => !skipped.has(o.id)).length : 0;
  const send = () => {
    if (sel.size >= left) return toast("Mindestens ein Objekt muss bleiben, sonst den Druck abbrechen", "fehler");
    if (!confirm(`${sel.size} ${sel.size === 1 ? "Objekt" : "Objekte"} überspringen? Das lässt sich nicht rückgängig machen.`)) return;
    ctl.mutate(
      { action: "skip", objects: [...sel] },
      { onSuccess: () => (toast("Wird übersprungen"), setSel(new Set()), parts.refetch()) },
    );
  };

  return (
    <Dialog title="Objekte überspringen" onClose={onClose} wide>
      {parts.isPending ? (
        <div className="skeleton h-64 rounded-xl" />
      ) : !p ? (
        <p className="text-sm text-ink2">
          Zu diesem Druck fehlen die Objektdaten. Druckwerk liest sie aus der Druckdatei: aus der Bibliothek gestartet, oder vom Speicher des Druckers
          (USB-Stick bzw. SD-Karte).
        </p>
      ) : (
        <>
          {!p.labeled && (
            <p className="mb-3 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
              Der Druck wurde ohne Objekt-Beschriftung geslict. Der Drucker kann deshalb nichts überspringen (Bambu Studio: „Objekte beschriften“).
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
            {p.pick ? (
              <div className="rounded-xl bg-fill p-2">
                <canvas ref={canvas} onClick={pickAt} className="mx-auto block aspect-square w-full max-w-[22rem] cursor-pointer [image-rendering:pixelated]" aria-label="Platte: Objekt antippen" />
              </div>
            ) : (
              <div className="grid place-items-center rounded-xl bg-fill p-6 text-sm text-ink3">Kein Auswahlbild in der Datei</div>
            )}
            <ul className="max-h-[22rem] space-y-1 overflow-y-auto">
              {p.objects.map((o) => {
                const gone = skipped.has(o.id);
                return (
                  <li key={o.id}>
                    <label className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${gone ? "text-ink3" : "cursor-pointer hover:bg-hover"}`}>
                      <input type="checkbox" className="accent-[var(--c-red)]" checked={gone || sel.has(o.id)} disabled={gone || !p.labeled} onChange={() => toggle(o.id)} />
                      <span className={`min-w-0 flex-1 truncate ${gone ? "line-through" : ""}`}>{o.name}</span>
                      {gone && <span className="shrink-0 text-xs">übersprungen</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-xs text-ink3">
              {p.objects.length} Objekte{skipped.size ? `, ${skipped.size} übersprungen` : ""}
            </span>
            <Button kind="danger" disabled={!sel.size || !p.labeled} busy={ctl.isPending} onClick={send}>
              {sel.size ? `${sel.size} überspringen` : "Überspringen"}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

/**
 * Speicher des Druckers (SD-Karte bzw. USB-Stick): Dateien aus / und /cache. „Drucken“ holt die Datei in die Bibliothek
 * (gleicher Inhalt nur einmal) und öffnet den Druckdialog, „Löschen“ entfernt sie vom Drucker.
 */
export function StorageDialog({ printerId, model, onClose }: { printerId: number; model: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["storage", printerId], queryFn: () => api.storage(printerId), retry: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [print, setPrint] = useState<ModelFile | null>(null);
  const medium = /^(P2|H2)/.test(model) ? "USB-Stick" : "SD-Karte";

  const fetchFile = async (f: StorageFile) => {
    const r = await api.storageImport(printerId, f.path);
    qc.invalidateQueries({ queryKey: ["models"] });
    qc.invalidateQueries({ queryKey: ["storage", printerId] });
    return r;
  };
  const run = (f: StorageFile, what: "print" | "import" | "delete") => async () => {
    if (what === "delete" && !confirm(`„${f.name}“ vom ${medium} löschen?`)) return;
    setBusy(f.path + what);
    try {
      if (what === "delete") {
        await api.storageDelete(printerId, f.path);
        toast("Gelöscht");
        qc.invalidateQueries({ queryKey: ["storage", printerId] });
      } else {
        const r = await fetchFile(f);
        if (what === "print") {
          const m = await api.model(r.model_id);
          const file = m.files.find((x) => x.id === r.id);
          if (file) setPrint(file);
        } else toast(r.existed ? "Schon in der Bibliothek" : "In die Bibliothek geholt");
      }
    } catch (e) {
      toast((e as Error).message, "fehler");
    } finally {
      setBusy(null);
    }
  };

  if (print) return <PrintDialog file={print} onClose={onClose} />;
  return (
    <Dialog title={`Dateien auf dem ${medium}`} onClose={onClose} wide>
      {list.isPending ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-12 rounded-lg" />
          ))}
        </div>
      ) : list.isError ? (
        <p className="text-sm text-ink2">{(list.error as Error).message}</p>
      ) : !list.data.length ? (
        <p className="text-sm text-ink2">Keine Dateien auf dem {medium}.</p>
      ) : (
        <ul className="-mx-2 divide-y divide-sep">
          {list.data.map((f) => (
            <li key={f.path} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-2.5">
              <div className="min-w-0 flex-1 basis-full sm:basis-48">
                <div className="truncate text-sm font-semibold" title={f.name}>
                  {f.name}
                </div>
                <div className="text-xs text-ink3 tnum">
                  {fmtSize(f.size)} · {fmtDate(f.modified)}
                  {f.path.startsWith("/cache/") ? " · Cache" : ""}
                  {f.model_id ? (
                    <>
                      {" · "}
                      <a href={href({ page: "model", id: f.model_id })} className="font-semibold text-accent" onClick={onClose}>
                        in der Bibliothek
                      </a>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                {f.printable && (
                  <Button kind="primary" className="h-8 px-3" busy={busy === f.path + "print"} disabled={!!busy} onClick={run(f, "print")}>
                    <Printer size={14} /> Drucken
                  </Button>
                )}
                {f.importable && !f.model_id && (
                  <Button className="h-8 px-3" busy={busy === f.path + "import"} disabled={!!busy} onClick={run(f, "import")} aria-label="In die Bibliothek holen">
                    <Download size={14} />
                  </Button>
                )}
                <Button kind="danger" className="h-8 px-3" busy={busy === f.path + "delete"} disabled={!!busy} onClick={run(f, "delete")} aria-label="Löschen">
                  <Trash2 size={14} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

const ACTIVE = new Set(["PREPARE", "RUNNING", "PAUSE", "SLICING"]);

/** Achsen bewegen, Referenzfahrt und Extruder (wie „Steuerung“ in der Handy-App); nur ohne laufenden Druck */
export function MoveDialog({ printerId, l, onClose }: { printerId: number; l: PrinterLive; onClose: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState(10);
  const m = useMutation({
    mutationFn: (a: { axis: "X" | "Y" | "Z" | "E" | "home"; dist?: number }) => api.move(printerId, a.axis, a.dist),
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const busy = !l.connected || m.isPending;
  const printing = ACTIVE.has(l.state);
  const hot = (l.nozzle ?? 0) >= 170;
  const go = (axis: "X" | "Y" | "Z", sign: 1 | -1) => m.mutate({ axis, dist: sign * step });
  const pad = "grid size-12 place-items-center rounded-xl bg-card font-bold shadow-seg hover:bg-fill disabled:opacity-50 disabled:hover:bg-card";

  return (
    <Dialog title="Bewegen" onClose={onClose}>
      {printing && <p className="mb-3 rounded-lg bg-fill px-3 py-2 text-sm text-ink2">Während eines Drucks lassen sich die Achsen nicht bewegen.</p>}
      <div className="flex items-center justify-between gap-3">
        <Label>Schrittweite</Label>
        <Segments items={[[1, "1 mm"], [10, "10 mm"]]} value={step} onPick={setStep} />
      </div>
      <div className="mt-4 flex flex-wrap items-start justify-center gap-6">
        <div>
          <div className="grid grid-cols-3 gap-2">
            <span />
            <button className={pad} disabled={busy || printing} onClick={() => go("Y", 1)} aria-label={`Y plus ${step} mm`}>
              <ArrowUp size={18} />
            </button>
            <span />
            <button className={pad} disabled={busy || printing} onClick={() => go("X", -1)} aria-label={`X minus ${step} mm`}>
              <ArrowLeft size={18} />
            </button>
            <button className={`${pad} text-accent`} disabled={busy || printing} onClick={() => m.mutate({ axis: "home" })} aria-label="Referenzfahrt aller Achsen" title="Referenzfahrt (G28)">
              <Home size={18} />
            </button>
            <button className={pad} disabled={busy || printing} onClick={() => go("X", 1)} aria-label={`X plus ${step} mm`}>
              <ArrowRight size={18} />
            </button>
            <span />
            <button className={pad} disabled={busy || printing} onClick={() => go("Y", -1)} aria-label={`Y minus ${step} mm`}>
              <ArrowDown size={18} />
            </button>
            <span />
          </div>
          <div className="mt-1.5 text-center text-[11px] text-ink3">Druckkopf X/Y · Mitte: Referenzfahrt</div>
        </div>
        <div>
          <div className="grid gap-2">
            <button className={pad} disabled={busy || printing} onClick={() => go("Z", -1)} aria-label={`Bett ${step} mm hoch`}>
              <ChevronsUp size={18} />
            </button>
            <button className={pad} disabled={busy || printing} onClick={() => go("Z", 1)} aria-label={`Bett ${step} mm runter`}>
              <ChevronsDown size={18} />
            </button>
          </div>
          <div className="mt-1.5 text-center text-[11px] text-ink3">Bett</div>
        </div>
      </div>
      <div className="mt-5 border-t border-sep pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <Label>Extruder</Label>
          <span className="text-xs text-ink3 tnum">Düse {l.nozzle != null ? `${Math.round(l.nozzle)} °C` : "–"}</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button disabled={busy || !hot || (printing && l.state !== "PAUSE")} onClick={() => m.mutate({ axis: "E", dist: -10 })}>
            <ArrowUp size={15} /> Zurückziehen
          </Button>
          <Button disabled={busy || !hot || (printing && l.state !== "PAUSE")} onClick={() => m.mutate({ axis: "E", dist: 10 })}>
            <ArrowDown size={15} /> Vorschieben
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink3">{hot ? "Je 10 mm Filament." : "Erst die Düse auf mindestens 170 °C heizen (Düse antippen)."}</p>
      </div>
      <p className="mt-4 text-xs text-ink3">Nach dem Einschalten zuerst die Referenzfahrt, sonst kennt der Drucker die Position nicht.</p>
    </Dialog>
  );
}

const MODULE: Record<string, string> = { ota: "Firmware", mc: "Bewegungssteuerung", ap: "Hauptsystem", ap2: "Hauptsystem", th: "Werkzeugkopf", ahb: "AMS-Hub", ext: "Zubehör", rv1126: "Kamera" };
const moduleName = (m: { name: string; product: string }) => m.product || MODULE[m.name.split("/")[0]!] || m.name;

/** Geräteinfo (Module mit Firmware, Düse, Speicher) und Kalibrierung, wie „Firmware“ und „Kalibrierung“ in der Handy-App */
export function DeviceDialog({ printerId, l, onClose }: { printerId: number; l: PrinterLive; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ["device-info", printerId], queryFn: () => api.deviceInfo(printerId), staleTime: 60_000 });
  const [cal, setCal] = useState({ bed: true, vibration: true, motor: false });
  const run = useMutation({
    mutationFn: () => api.calibrate(printerId, cal),
    onSuccess: () => (toast("Kalibrierung gestartet"), void qc.invalidateQueries({ queryKey: ["live"] }), onClose()),
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const d = info.data;
  const printing = ACTIVE.has(l.state);
  const row = (k: string, v: string) => (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <span className="text-ink2">{k}</span>
      <span className="min-w-0 truncate text-right font-semibold tnum">{v}</span>
    </div>
  );

  return (
    <Dialog title="Gerät" onClose={onClose}>
      {info.isPending ? (
        <div className="skeleton h-40 rounded-xl" />
      ) : info.isError ? (
        <p className="text-sm text-bad">{(info.error as Error).message}</p>
      ) : d ? (
        <div className="divide-y divide-sep">
          {row("Modell", d.model)}
          {row("Seriennummer", d.serial)}
          {d.nozzle && row("Düse", [d.nozzle.diameter ? `${d.nozzle.diameter.toLocaleString("de-DE")} mm` : "", d.nozzle.type ?? ""].filter(Boolean).join(" · "))}
          {d.wifi && row("WLAN", d.wifi)}
          {d.storage != null && row(/^(P2|H2)/.test(d.model) ? "USB-Stick" : "SD-Karte", d.storage ? "eingesteckt" : "fehlt")}
          {d.update && row("Update verfügbar", d.update)}
        </div>
      ) : null}
      {d && (
        <div className="mt-4">
          <Label>Firmware</Label>
          {d.modules.length ? (
            <div className="mt-1.5 divide-y divide-sep rounded-lg bg-fill px-3">
              {d.modules.map((m) => (
                <div key={m.name + m.sn} className="flex items-baseline justify-between gap-3 py-1.5 text-xs" title={[m.hw && `Hardware ${m.hw}`, m.sn && `SN ${m.sn}`].filter(Boolean).join(" · ")}>
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{moduleName(m)}</span>
                    {moduleName(m) !== m.name && <span className="text-ink3"> · {m.name}</span>}
                  </span>
                  <span className="shrink-0 font-semibold tnum">{m.sw}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1.5 text-sm text-ink3">Der Drucker hat keine Versionen gemeldet.</p>
          )}
          <p className="mt-1.5 text-xs text-ink3">Firmware-Updates lädt der Drucker aus der Bambu-Cloud, im LAN-Modus nur über die SD-Karte bzw. den USB-Stick.</p>
        </div>
      )}
      <div className="mt-5 border-t border-sep pt-4">
        <Label>Kalibrierung</Label>
        <div className="mt-2 space-y-2">
          {(
            [
              ["bed", "Bett nivellieren"],
              ["vibration", "Vibration (Resonanz) ausgleichen"],
              ["motor", "Motorgeräusch unterdrücken"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2.5 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--c-accent)]" checked={cal[k]} onChange={(e) => setCal({ ...cal, [k]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink3">Dauert je nach Auswahl 10 bis 30 Minuten. Die Druckplatte muss leer sein.</p>
        <Button
          kind="primary"
          className="mt-3 w-full"
          disabled={!l.connected || printing || (!cal.bed && !cal.vibration && !cal.motor)}
          busy={run.isPending}
          onClick={() => confirm("Kalibrierung jetzt starten? Die Druckplatte muss leer sein.") && run.mutate()}
        >
          Kalibrierung starten
        </Button>
        {printing && <p className="mt-2 text-xs text-ink3">Während eines Drucks nicht möglich.</p>}
      </div>
    </Dialog>
  );
}
