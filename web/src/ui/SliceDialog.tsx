// Slicen in der App wie in Bambu Handy: Drucker, Qualität, Platte, Filament je Fach, Stützen und Füllung wählen, der Server
// slict mit Bambu Studio bzw. auf ARM OrcaSlicer (offizielle Bambu-Profile), legt die .gcode.3mf ins Modell und startet den Druck bzw. stellt ihn in die Warteschlange.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Layers, ListPlus, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { baseMaterial, colorDist, type ModelFile, type Plate, type Tray } from "../../../shared/types.ts";
import { api, fileUrl, type SliceOptions } from "../api.ts";
import { useLive } from "../App.tsx";
import { CaliPicker, effectiveCali, useCaliOpts } from "./CaliPicker.tsx";
import { go as nav } from "../lib/router.ts";
import { Button, Dialog, Label, LoadError, Swatch, useToast } from "./controls.tsx";
import { VIEWABLE } from "../lib/three.ts";
import { trayColor, TrayPicker } from "./Ams.tsx";
import { PlatePicker } from "./PlatePicker.tsx";
import { PrintDialog } from "./PrintDialog.tsx";
import { SliceUsage } from "./SliceUsage.tsx";
import { InfillPicker, PATTERNS, type InfillPattern } from "./InfillPicker.tsx";
import { CopiesPicker, FLUSH_STEPS, FlushPicker, NozzlePicker, PURPOSES, PurposePicker, purposeSet, QualityPicker, SUPPORT_NOTE, SupportFigure, WallsPicker, type Purpose } from "./SliceHelp.tsx";
import { Viewer } from "./Viewer.tsx";

const SUPPORT = [
  ["aus", "Aus"],
  ["normal", "Normal"],
  ["baum", "Baum"],
] as const;

/** Fach je Filament: gleiches Material und ähnlichste Farbe; ohne Angaben (STL) das aktive Fach, sonst PLA.
 *  `first` = Filamente, die zuerst ein Fach bekommen (die der gewählten Platte) */
function pickTrays(slots: { color: string; type: string }[], trays: Tray[], first: (i: number) => boolean = () => true): (number | null)[] {
  const usable = trays.filter((t) => t.type);
  const used = new Set<number>();
  const out: (number | null)[] = slots.map(() => null);
  const order = [...slots.keys()].sort((a, b) => Number(first(b)) - Number(first(a)));
  for (const i of order) out[i] = pick(slots[i]!);
  return out;
  function pick(s: { color: string; type: string }) {
    const free = usable.filter((t) => !used.has(t.id));
    const best = s.type || s.color
      ? free
          .map((t) => ({ t, score: (s.type && baseMaterial(t.type) === baseMaterial(s.type) ? 0 : 1000) + (s.color ? colorDist(t.color, s.color) : 0) }))
          .sort((a, b) => a.score - b.score)[0]?.t
      : (free.find((t) => t.active) ?? free.find((t) => baseMaterial(t.type) === "PLA") ?? free[0]);
    if (!best) return null;
    used.add(best.id);
    return best.id;
  }
}

/** Kann der Server slicen? (Bambu Studio oder OrcaSlicer installiert) */
export const useSlicer = () => {
  const q = useQuery({ queryKey: ["slicer-available"], queryFn: () => api.slicer({}), staleTime: 10 * 60_000 });
  return !!q.data?.available;
};

/** Slicen und drucken in einem Dialog; nur wenn das Ergebnis mehrere Platten hat, folgt der Druckdialog zur Plattenwahl.
 *  `plate` = vorgewählte Platte einer Projekt-3MF (z. B. aus dem MakerWorld-Dialog) */
export function SliceAndPrint({ file, plate, onClose, onSliced }: { file: ModelFile; plate?: number | null; onClose: () => void; onSliced?: (f: ModelFile) => void }) {
  const [done, setDone] = useState<ModelFile | null>(null);
  if (done) return <PrintDialog file={done} onClose={onClose} />;
  return <SliceDialog file={file} initPlate={plate} onClose={onClose} onSliced={(f) => onSliced?.(f)} onPrintDialog={setDone} />;
}

function SliceDialog({
  file,
  initPlate,
  onClose,
  onSliced,
  onPrintDialog,
}: {
  file: ModelFile;
  initPlate?: number | null;
  onClose: () => void;
  onSliced: (f: ModelFile) => void;
  onPrintDialog: (f: ModelFile) => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const printers = useQuery({ queryKey: ["printers"], queryFn: api.printers });
  const live = useLive(true);
  const spools = useQuery({ queryKey: ["spools"], queryFn: api.spools, refetchInterval: 30_000 });
  const [printerId, setPrinterId] = useState<number | null>(null);
  const [nozzle, setNozzle] = useState<string | undefined>();
  const info = useQuery({
    queryKey: ["slicer", printerId, file.id, nozzle],
    queryFn: () => api.slicer({ printer_id: printerId, file_id: file.id, nozzle }),
    staleTime: 60_000,
  });
  const d = info.data && info.data.available && info.data.printer != null ? info.data : null;

  // Projekt mit mehreren Platten: eine wählen (Standard die erste bzw. die vorgewählte), null = alle
  const layout = file.meta.layout ?? [];
  const multi = layout.length > 1;
  const [plate, setPlate] = useState<number | null>(multi ? (layout.find((p) => p.index === initPlate)?.index ?? layout[0]!.index) : null);
  const lp = multi && plate != null ? layout.find((p) => p.index === plate) : undefined;
  const plateOpt = multi ? { plate } : {};
  // Spülmenge zählt nur bei mehreren Filamenten (auf der gewählten Platte)
  const [proc, setProc] = useState("");
  const [bed, setBed] = useState("");
  const [trays, setTrays] = useState<(number | null)[]>([]);
  const [cur, setCur] = useState(0);
  const [support, setSupport] = useState<SliceOptions["support"]>("aus");
  const [infill, setInfill] = useState<number>(15);
  const [pattern, setPattern] = useState<InfillPattern>("grid");
  const [walls, setWalls] = useState(2);
  const [touched, setTouched] = useState(false);
  const [brim, setBrim] = useState(true);
  const [orient, setOrient] = useState(false);
  const [popts, setPopts] = useCaliOpts();
  // Anzahl Exemplare: nur für Dateien ohne Platten des Autors (dort legt das Projekt die Teile fest)
  const [copies, setCopies] = useState(1);
  const canCopy = !layout.length;
  const copiesOpt = canCopy && copies > 1 ? { copies } : {};
  const [flush, setFlushRaw] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("druckwerk.flush"));
      return FLUSH_STEPS.some((s) => s.value === v) ? v : 1;
    } catch {
      return 1;
    }
  });
  const setFlush = (v: number) => {
    setFlushRaw(v);
    try {
      localStorage.setItem("druckwerk.flush", String(v));
    } catch {
      /* ohne Speicher gilt die Wahl nur jetzt */
    }
  };
  const [busy, setBusy] = useState<false | "print" | "queue" | "slice">(false);
  const [status, setStatus] = useState("");
  const ac = useRef<AbortController | null>(null);
  useEffect(() => () => ac.current?.abort(), []);

  useEffect(() => {
    if (printerId == null && d) setPrinterId(d.printer);
  }, [d, printerId]);
  // Neue Profilliste (anderer Drucker, andere Düse): Standard übernehmen, wenn die Wahl nicht mehr passt
  useEffect(() => {
    if (!d) return;
    if (!d.processes.some((p) => p.name === proc)) setProc(d.default);
    if (!d.beds.some((b) => b.value === bed)) setBed(d.bed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.machine]);

  // Füllung wie im gewählten Profil, solange der Nutzer sie nicht selbst geändert hat
  const curProc = d?.processes.find((p) => p.name === (proc || d.default));
  useEffect(() => {
    if (touched || !curProc) return;
    if (curProc.infill != null) setInfill(Math.round(curProc.infill));
    if (PATTERNS.some((p) => p.id === curProc.pattern)) setPattern(curProc.pattern as InfillPattern);
    if (curProc.walls) setWalls(curProc.walls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curProc?.name, touched]);

  const l = live.data?.find((x) => x.id === (d?.printer ?? printerId));
  const allTrays = l?.trays ?? [];
  const trayKey = allTrays.map((t) => `${t.id}${t.type}${t.color}`).join();
  const slots = useMemo(() => d?.slots ?? [], [d?.slots]);
  const byId = new Map((spools.data ?? []).map((s) => [s.id, s]));
  useEffect(() => {
    if (slots.length) setTrays(pickTrays(slots, allTrays, (i) => !lp?.filaments.length || lp.filaments.some((f) => f.id === i + 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, trayKey, plate]);

  const colorSlots = slots.filter((_, i) => !lp?.filaments.length || lp.filaments.some((f) => f.id === i + 1)).length;
  const flushOpt = colorSlots > 1 ? { flush } : {};
  // Live-Vorschau: kurz nach der letzten Änderung slict der Server im Hintergrund (echte Werte aus dem Slicer)
  const opts: SliceOptions | null = d
    ? { printer_id: d.printer, nozzle: d.nozzle, process: proc || d.default, trays, support, brim, infill, pattern, walls, orient, bed: bed || d.bed, ...plateOpt, ...flushOpt, ...copiesOpt }
    : null;
  const optKey = opts && trays.length === slots.length ? JSON.stringify(opts) : "";
  const [pv, setPv] = useState<{ key: string; plate: Plate | null; error: string }>({ key: "", plate: null, error: "" });
  const [pvBusy, setPvBusy] = useState(false);
  const [pvTry, setPvTry] = useState(0);
  useEffect(() => {
    if (!optKey || busy) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      setPvBusy(true);
      api
        .slicePreview(file.id, JSON.parse(optKey) as SliceOptions, () => {}, c.signal)
        .then((plate) => setPv({ key: optKey, plate, error: "" }))
        .catch((e: Error) => !c.signal.aborted && setPv((p) => ({ key: optKey, plate: p.plate, error: e.message })))
        .finally(() => !c.signal.aborted && setPvBusy(false));
    }, 700);
    return () => (clearTimeout(t), c.abort());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optKey, file.id, pvTry]);
  const pvReady = !!pv.plate && pv.key === optKey && !pvBusy;

  // Vergleich mit dem Standard des Druckers (Standardprofil mit seinen Wänden und seiner Füllung), sonst gleiche Wahl;
  // erst wenn die eigene Vorschau steht, damit sie nicht wartet. Einmal je Fachwahl, danach aus dem Zwischenspeicher des Servers
  const defProc = d?.processes.find((p) => p.name === d.default);
  const baseOpts: SliceOptions | null =
    opts && defProc
      ? {
          ...opts,
          process: d!.default,
          infill: defProc.infill != null ? Math.round(defProc.infill) : opts.infill,
          pattern: PATTERNS.some((p) => p.id === defProc.pattern) ? defProc.pattern : opts.pattern,
          walls: defProc.walls ?? opts.walls,
        }
      : null;
  const baseKey = baseOpts && optKey ? JSON.stringify(baseOpts) : "";
  const [base, setBase] = useState<{ key: string; plate: Plate | null }>({ key: "", plate: null });
  useEffect(() => {
    if (!baseKey || baseKey === optKey || !pvReady || base.key === baseKey || busy) return;
    const c = new AbortController();
    api
      .slicePreview(file.id, JSON.parse(baseKey) as SliceOptions, () => {}, c.signal, true)
      .then((plate) => setBase({ key: baseKey, plate }))
      .catch(() => !c.signal.aborted && setBase({ key: baseKey, plate: null }));
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey, optKey, pvReady]);
  const compare =
    !baseKey || baseKey === optKey
      ? null
      : { plate: base.key === baseKey ? base.plate : null, busy: base.key !== baseKey, label: `${d!.default.replace(/ @BBL.*$/, "").replace(/^(\d)\.(\d+)mm/, "$1,$2 mm")}, ${defProc?.walls ?? 2} Wände, ${Math.round(defProc?.infill ?? 15)} %` };
  const usage = (
    <SliceUsage
      plate={pv.plate}
      computing={pvBusy || (!!optKey && pv.key !== optKey && !pv.error)}
      error={pv.key === optKey ? pv.error : ""}
      trays={allTrays}
      slotTrays={trays}
      spools={byId}
      retry={() => (setPv((p) => ({ ...p, key: "", error: "" })), setPvTry((n) => n + 1))}
      compare={compare}
    />
  );

  // Zuordnung wie im Druckdialog: Index = Filament-ID − 1, Wert = Fach, extern bzw. ohne Fach −1
  // Eine Platte mit bekannten Filamenten (Werte des Autors): nur deren Filamente brauchen ein Fach
  const usedSlot = (i: number) => !lp?.filaments.length || lp.filaments.some((f) => f.id === i + 1);
  const usedTrays = trays.filter((_, i) => usedSlot(i));
  const amsSlots = usedTrays.filter((t) => t != null && t !== 254).length;
  const useAms = amsSlots > 0;
  const mixed = useAms && usedTrays.some((t) => t === 254);
  const unmapped = useAms && usedTrays.some((t) => t == null);
  const printerBusy = !!l && ["RUNNING", "PREPARE", "PAUSE"].includes(l.state);
  const pname = printers.data?.find((p) => p.id === d?.printer)?.name ?? "Der Drucker";
  const canPrint = !!l?.connected && !printerBusy && !mixed && !unmapped;

  const go = async (mode: "print" | "queue" | "slice") => {
    if (!d) return;
    setBusy(mode);
    setStatus(pvReady ? "Übernehme Vorschau …" : "Starte …");
    ac.current = new AbortController();
    try {
      const f = await api.sliceFile(
        file.id,
        { printer_id: d.printer, nozzle: d.nozzle, process: proc || d.default, trays, support, brim, infill, pattern, walls, orient, bed: bed || d.bed, ...plateOpt, ...flushOpt, ...copiesOpt },
        setStatus,
        ac.current.signal,
      );
      onSliced(f);
      const plates = f.meta.plates ?? [];
      if (mode === "slice" || plates.length > 1) {
        toast("Geslict");
        if (plates.length > 1) return onPrintDialog(f);
        return onClose();
      }
      const plate = plates[0]?.index ?? 1;
      if (mode === "queue") {
        setStatus("Stelle in die Warteschlange …");
        await api.enqueue({ file_id: f.id, plate, printer_id: (printers.data?.length ?? 0) > 1 ? d.printer : null });
        void qc.invalidateQueries({ queryKey: ["queue"] });
        toast("Geslict und in die Warteschlange gestellt");
        return onClose();
      }
      setStatus("Wird übertragen …");
      const max = Math.max(trays.length, ...(plates[0]?.filaments.map((x) => x.id) ?? []));
      const ams_mapping = Array.from({ length: max }, (_, i) => (trays[i] == null || trays[i] === 254 || !usedSlot(i) ? -1 : trays[i]!));
      await api.print(d.printer, { file_id: f.id, plate, use_ams: useAms, ams_mapping, ...effectiveCali(popts, !!live.data?.find((x) => x.id === d.printer)?.cali_auto) });
      toast("Druck gestartet");
      onClose();
      nav({ page: "printer" });
    } catch (e) {
      if (!ac.current?.signal.aborted) toast((e as Error).message, "fehler");
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const shown = slots.map((_, i) => i).filter(usedSlot);
  const slot = shown.includes(cur) ? cur : (shown[0] ?? 0);
  // Farbe je Filament wie im AMS-Kasten: zugeordnete Spule, sonst Chip; Fach ohne beides grau, „Standard“ = Farbe aus der Datei
  const colorOf = (id: number | null, fallback: string) => {
    const t = allTrays.find((x) => x.id === id);
    if (!t) return fallback;
    return trayColor(t, t.spool_id ? byId.get(t.spool_id) : undefined) || "#9a9a9a";
  };
  const paint = {
    color: colorOf(trays[0] ?? null, slots[0]?.color ?? ""),
    paint: slots.filter((s) => s.color).map((s) => ({ from: s.color, to: colorOf(trays[slots.indexOf(s)] ?? null, s.color) })),
  };
  const pl = (n: number) => `Filament ${n + 1}`;
  // Zweck: aktiv, solange Qualität, Wände und Füllung genau seinen Werten entsprechen
  const nz = Number(d?.nozzle ?? 0.4);
  const sets = d ? PURPOSES.map((p) => [p.id, purposeSet(p.id, d.processes, nz, d.default)] as const) : [];
  const purpose = sets.find(([, v]) => v && v.process === (proc || d?.default) && v.walls === walls && v.infill === infill && v.pattern === pattern)?.[0] ?? null;
  const applyPurpose = (id: Purpose) => {
    const v = sets.find(([k]) => k === id)?.[1];
    if (!v) return;
    setProc(v.process);
    setWalls(v.walls);
    setInfill(v.infill);
    if (PATTERNS.some((p) => p.id === v.pattern)) setPattern(v.pattern as InfillPattern);
    setTouched(true);
  };
  const abrasive = trays.map((t) => allTrays.find((x) => x.id === t)).find((t) => t && /CF|GF/i.test(`${t.type} ${t.name ?? ""}`));
  const chip = (on: boolean) => `h-8 rounded-lg px-3 text-sm font-semibold ${on ? "bg-ink text-bg" : "bg-card shadow-seg hover:bg-hover"}`;

  return (
    <Dialog title="Slicen und drucken" onClose={() => (ac.current?.abort(), onClose())} wide="xl">
      {info.isError ? (
        <LoadError error={info.error} retry={() => info.refetch()} />
      ) : info.data && !info.data.available ? (
        <p className="text-sm leading-relaxed text-ink2">
          Auf dem Server ist kein Slicer installiert. Im Container mit dem Build-Argument <b>SLICER=1</b> bauen, dann slict Druckwerk mit Bambu Studio (auf ARM mit OrcaSlicer).
        </p>
      ) : info.data && info.data.available && info.data.printer == null ? (
        <p className="text-sm text-ink2">Noch kein Drucker eingerichtet. Geslict wird für das Modell und die Düse des Druckers.</p>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
          <div className="lg:sticky lg:top-0 lg:self-start">
            <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-[linear-gradient(160deg,var(--c-tile-a),var(--c-tile-b))] lg:aspect-auto lg:h-[min(42rem,calc(92dvh-8rem))]">
              {lp?.has_image ? (
                // Eine Platte des Projekts: deren Bild, das 3D-Modell zeigt alle Platten übereinander
                <img src={fileUrl.plate(file.id, lp.index)} alt="" className="size-full object-contain p-4" />
              ) : VIEWABLE.includes(file.kind) ? (
                <Viewer
                  id={file.id}
                  kind={file.kind}
                  paint={paint}
                  plate={
                    d?.bed_size
                      ? {
                          size: d.bed_size,
                          type: bed || d.bed,
                          exclude: d.bed_exclude,
                          copies: canCopy ? copies : 1,
                          boxes: pv.key === optKey ? pv.plate?.boxes : undefined,
                        }
                      : undefined
                  }
                />
              ) : file.has_thumb ? (
                <img src={fileUrl.thumb(file.id, file.created_at)} alt="" className="size-full object-contain" />
              ) : (
                <Layers className="absolute inset-0 m-auto text-ink4" size={42} strokeWidth={1.3} />
              )}
              {busy && (
                <div className="anim-fade absolute inset-0 bg-bg/80">
                  <SliceFigure color={paint.color || "var(--c-accent)"} />
                </div>
              )}
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <span className="truncate text-xs text-ink3">
                {file.name}
                {lp ? ` · Platte ${lp.index}${lp.name ? ` „${lp.name}“` : ""}` : multi ? ` · alle ${layout.length} Platten` : ""}
              </span>
              {busy && <span className="shrink-0 text-sm font-semibold text-ink2">{status}</span>}
            </div>
            {d && <div className="mt-3 hidden lg:block">{usage}</div>}
          </div>

          {!d ? (
            <div className="space-y-3">
              <div className="skeleton h-9 rounded-lg" />
              <div className="skeleton h-9 rounded-lg" />
              <div className="skeleton h-24 rounded-lg" />
            </div>
          ) : (
            <fieldset disabled={!!busy} className="min-w-0 space-y-4">
              {(printers.data?.length ?? 0) > 1 && (
                <div>
                  <Label>Drucker</Label>
                  <select className="mt-1.5 h-9 w-full rounded-lg bg-card px-2 text-sm shadow-seg" value={d.printer} onChange={(e) => (setPrinterId(Number(e.target.value)), setNozzle(undefined))}>
                    {printers.data!.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {multi && (
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <Label>Welche Platte?</Label>
                    <span className="text-[11px] text-ink3">{layout.length} im Projekt</span>
                  </div>
                  <div className="mt-1.5">
                    <PlatePicker plates={layout} value={plate} image={(n) => fileUrl.plate(file.id, n)} onPick={setPlate} />
                  </div>
                  <p className="text-xs leading-snug text-ink3">
                    {plate == null
                      ? "Slict alle Platten, danach wählst du die zu druckende. Zeit und Gramm unter den Platten stammen vom Autor."
                      : "Nur diese Platte wird geslict und gedruckt, die anderen bleiben in der Datei. Zeit und Gramm unter den Platten stammen vom Autor."}
                  </p>
                </div>
              )}

              {canCopy && (
                <div>
                  <Label>Anzahl</Label>
                  <div className="mt-1.5">
                    <CopiesPicker
                      copies={copies}
                      color={paint.color}
                      total={pv.key === optKey && pv.plate ? { grams: pv.plate.weight_g, seconds: pv.plate.prediction_s } : null}
                      onCopies={(n) => setCopies(Math.min(50, Math.max(1, n)))}
                    />
                  </div>
                </div>
              )}

              <div>
                <Label>Wofür druckst du?</Label>
                <div className="mt-1.5">
                  <PurposePicker active={purpose} standard={!!baseKey && baseKey === optKey} onPick={applyPurpose} />
                </div>
              </div>

              <div>
                <Label>Qualität (Schichthöhe)</Label>
                <div className="mt-1.5">
                  <QualityPicker procs={d.processes} value={proc || d.default} def={d.default} nozzle={nz} color={paint.color} onPick={setProc} />
                </div>
              </div>

              <div>
                <Label>Düse</Label>
                <div className="mt-1.5">
                  <NozzlePicker
                    nozzles={d.nozzles}
                    value={d.nozzle}
                    installed={d.installed ?? null}
                    abrasive={abrasive ? abrasive.type : null}
                    color={paint.color}
                    onPick={setNozzle}
                  />
                </div>
              </div>

              <div>
                <Label>Druckplatte</Label>
                <select className="mt-1.5 h-9 w-full rounded-lg bg-card px-2 text-sm shadow-seg" value={bed || d.bed} onChange={(e) => setBed(e.target.value)}>
                  {d.beds.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label>{shown.length > 1 ? "Filament → Fach" : "Filament"}</Label>
                {shown.length > 1 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {slots.map((s, i) => {
                      if (!usedSlot(i)) return null;
                      const t = allTrays.find((x) => x.id === trays[i]);
                      return (
                        <button key={i} type="button" onClick={() => setCur(i)} className={`flex h-8 items-center gap-1.5 ${chip(i === slot)}`}>
                          <span className="tnum opacity-60">{i + 1}</span>
                          <Swatch color={s.color} /> <span className="max-w-24 truncate">{s.type || pl(i)}</span>
                          <span className="opacity-50">→</span>
                          {t ? <span>{t.label}</span> : <span className="opacity-60">Datei</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {l && allTrays.some((t) => t.type) && (
                  <div className="mt-2">
                    <TrayPicker
                      l={l}
                      value={trays[slot] ?? null}
                      onPick={(id) => setTrays(trays.map((t, k) => (k === slot ? id : t)))}
                      marks={new Map(trays.flatMap((t, k) => (t != null && k !== slot && shown.length > 1 && usedSlot(k) ? [[t, k + 1] as const] : [])))}
                      want={slots[slot]?.type}
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setTrays(trays.map((t, k) => (k === slot ? null : t)))}
                  className={`mt-2 ${chip(trays[slot] == null)}`}
                >
                  {slots[slot]?.type ? `Wie in der Datei (${slots[slot]!.type})` : "Standardprofil (PLA)"}
                </button>
                {!allTrays.some((t) => t.type) && (
                  <p className="mt-1 text-xs text-ink3">Drucker nicht verbunden oder AMS leer: geslict wird mit dem Material aus der Datei bzw. PLA, die Fächer wählst du danach.</p>
                )}
              </div>

              {colorSlots > 1 && (
                <div>
                  <Label>Spülen beim Farbwechsel</Label>
                  <div className="mt-1.5">
                    <FlushPicker flush={flush} from={paint.paint[0]?.to ?? ""} to={paint.paint[1]?.to ?? ""} onFlush={setFlush} />
                  </div>
                </div>
              )}

              <div>
                <Label>Stützen</Label>
                <div className="mt-1.5 flex rounded-lg bg-fill p-0.5">
                  {SUPPORT.map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setSupport(v)}
                      className={`h-8 flex-1 rounded-md text-[13px] font-semibold ${support === v ? "bg-[var(--c-seg-active)] text-ink shadow-seg" : "text-ink2"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="size-16 shrink-0">
                    <SupportFigure mode={support} color={paint.color} />
                  </div>
                  <p className="text-xs leading-snug text-ink2">{SUPPORT_NOTE[support]}</p>
                </div>
              </div>

              <div>
                <Label>Wände</Label>
                <div className="mt-1.5">
                  <WallsPicker walls={walls} profile={curProc?.walls ?? null} nozzle={nz} color={paint.color} onWalls={(n) => (setWalls(n), setTouched(true))} />
                </div>
              </div>

              <div>
                <Label>Füllung</Label>
                <div className="mt-1.5">
                  <InfillPicker
                    density={infill}
                    pattern={pattern}
                    profilePattern={curProc?.pattern ?? ""}
                    color={paint.color || ""}
                    onDensity={(v) => (setInfill(v), setTouched(true))}
                    onPattern={(v) => (setPattern(v), setTouched(true))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Optionen</Label>
                <label className="flex items-start gap-2.5 text-sm">
                  <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--c-accent)]" checked={brim} onChange={(e) => setBrim(e.target.checked)} />
                  <span>
                    Brim, wo nötig
                    <span className="block text-xs leading-snug text-ink3">
                      Flacher Rand um die erste Schicht, damit Ecken nicht hochbiegen; nach dem Druck abziehen
                    </span>
                  </span>
                </label>
                <label className="flex items-center gap-2.5 text-sm">
                  <input type="checkbox" className="size-4 accent-[var(--c-accent)]" checked={orient} onChange={(e) => setOrient(e.target.checked)} />
                  Automatisch ausrichten (größte Fläche aufs Bett)
                </label>
              </div>

              <div className="space-y-1">
                <Label>Vor dem Druck</Label>
                <CaliPicker value={popts} auto={!!l?.cali_auto} onChange={setPopts} />
              </div>

              {file.kind === "3mf" && (
                <div className="flex gap-2 rounded-lg bg-accent-soft p-2.5 text-xs text-warn">
                  <AlertTriangle size={14} className="mt-px shrink-0" />
                  <div>Druckeinstellungen aus der 3MF werden durch das gewählte Profil ersetzt; Objekte, Anordnung der Platten und Farben bleiben.</div>
                </div>
              )}
              {d?.engine && <p className="text-[11px] text-ink3">Slicer: {d.engine}</p>}

              <div className="lg:hidden">{usage}</div>

              {l && (!l.connected || printerBusy || mixed || unmapped) && (
                <div className="flex gap-2 rounded-lg bg-bad-soft p-2.5 text-xs text-bad">
                  <AlertTriangle size={14} className="mt-px shrink-0" />
                  <div>
                    {!l.connected ? (
                      <div>{pname} ist nicht verbunden. Slicen und in die Warteschlange stellen geht trotzdem.</div>
                    ) : printerBusy ? (
                      <div>{pname} druckt gerade. Mit „In Warteschlange“ kommt der Druck danach dran.</div>
                    ) : null}
                    {mixed && <div>AMS und externe Spule lassen sich nicht mischen: alle Filamente ins AMS oder alle extern.</div>}
                    {unmapped && <div>Jedem Filament ein Fach zuordnen, dann lässt sich der Druck starten.</div>}
                  </div>
                </div>
              )}

              <div className="space-y-1.5 pt-1">
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    className={`w-full justify-center ${l ? "" : "col-span-2"}`}
                    busy={busy === "queue" || busy === "slice"}
                    disabled={!!busy}
                    onClick={() => void go(l ? "queue" : "slice")}
                    title={l ? "Slicen und später drucken, z. B. wenn der aktuelle Druck fertig ist" : "Nur slicen, die Datei landet im Modell"}
                  >
                    {l ? <ListPlus size={15} /> : <Layers size={15} />} {l ? "In Warteschlange" : "Nur slicen"}
                  </Button>
                  {l && (
                    <Button type="button" kind="primary" className="w-full justify-center" busy={busy === "print"} disabled={!!busy || !canPrint} onClick={() => void go("print")}>
                      <Play size={15} /> {busy === "print" ? (status.startsWith("Wird") ? "Wird übertragen …" : "Slict …") : "Druck starten"}
                    </Button>
                  )}
                </div>
                {VIEWABLE.includes(file.kind) || file.kind === "step" ? (
                  <a
                    href={fileUrl.orca(file.id, file.name)}
                    className="flex h-8 w-fit items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-ink3 hover:bg-hover hover:text-ink"
                    title="Expertenmodus: Datei in OrcaSlicer öffnen (Stützen malen, Modifier, mehrere Platten); Drucke von dort erkennt Druckwerk trotzdem"
                  >
                    <ExternalLink size={13} /> Expertenmodus: in Orca öffnen
                  </a>
                ) : null}
              </div>
            </fieldset>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** Bauteil wächst Schicht für Schicht, der Kopf fährt darüber; ohne Bewegung bei prefers-reduced-motion */
function SliceFigure({ color }: { color: string }) {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SMIL = { dur: "2.4s", repeatCount: "indefinite" } as const;
  return (
    <svg viewBox="0 0 120 120" className="absolute inset-0 size-full" aria-hidden>
      <defs>
        <clipPath id="slice-grow">
          <rect x="0" y={still ? 52 : 92} width="120" height="60">
            {!still && <animate attributeName="y" values="92;52;52" keyTimes="0;0.85;1" {...SMIL} />}
          </rect>
        </clipPath>
      </defs>
      {/* Bett */}
      <rect x="14" y="92" width="92" height="6" rx="2" fill="var(--c-ink3)" opacity="0.55" />
      {/* Bauteil aus Schichten */}
      <g clipPath="url(#slice-grow)">
        {Array.from({ length: 10 }, (_, i) => (
          <rect key={i} x={40 + (i % 2)} y={88 - i * 4} width={40 - (i % 2) * 2} height="3.4" rx="1.2" fill={color} opacity={0.75 + (i % 2) * 0.25} />
        ))}
      </g>
      {/* Druckkopf */}
      <g>
        {!still && <animateTransform attributeName="transform" type="translate" values="-14 40;14 36;-14 32;14 28;-14 24;14 20;-14 16;14 12;-14 8;14 4;-14 0" {...SMIL} />}
        <rect x="50" y="22" width="20" height="16" rx="3" fill="var(--c-ink2)" />
        <path d="M56 38h8l-2 6h-4z" fill="var(--c-ink3)" />
        <circle cx="60" cy="45" r="1.6" fill={color} className="pf-glow" />
      </g>
    </svg>
  );
}
