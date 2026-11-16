import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Info, Layers, ListPlus, Play, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { baseMaterial, colorDist, fmtDuration, type ModelFile, type Plate, type Tray } from "../../../shared/types.ts";
import { api, fileUrl } from "../api.ts";
import { useLive } from "../App.tsx";
import { CaliPicker, effectiveCali, useCaliOpts } from "./CaliPicker.tsx";
import { plateCost, useCostBasis } from "../lib/cost.ts";
import { go } from "../lib/router.ts";
import { Button, Dialog, Label, Swatch, useToast } from "./controls.tsx";
import { stateLabel, StateDot } from "./printer.tsx";
import { fmtG, spoolTitle } from "./spool.tsx";
import { trayColor, TrayPicker } from "./Ams.tsx";
import { VIEWABLE } from "../lib/three.ts";
import { Viewer } from "./Viewer.tsx";
import { SliceUsage } from "./SliceUsage.tsx";


/** Bestes Fach je Filament: gleicher Typ, ähnlichste Farbe, jedes Fach nur einmal */
function autoMap(plate: Plate, trays: Tray[]): Record<number, number> {
  const free = trays.filter((t) => t.id !== 254 && t.type);
  const out: Record<number, number> = {};
  const used = new Set<number>();
  for (const f of plate.filaments) {
    const cand = free
      .filter((t) => !used.has(t.id))
      .map((t) => ({ t, score: (t.type.toUpperCase() === f.type.toUpperCase() ? 0 : 1000) + colorDist(t.color, f.color) }))
      .sort((a, b) => a.score - b.score)[0];
    if (cand) {
      out[f.id] = cand.t.id;
      used.add(cand.t.id);
    } else out[f.id] = 254;
  }
  return out;
}

export function PrintDialog({
  file,
  plate: initialPlate,
  queueId,
  printer: initialPrinter,
  onReslice,
  source,
  onClose,
}: {
  file: ModelFile;
  plate?: number | null;
  /** Start aus der Warteschlange: Eintrag fällt nach dem Start weg, „In Warteschlange“ entfällt */
  queueId?: number;
  printer?: number | null;
  /** Quelldatei neu slicen (Slice-Dialog statt dieser Datei) */
  onReslice?: () => void;
  /** Quelldatei für die 3D-Ansicht (STL/3MF/OBJ), sonst Plattenbild */
  source?: ModelFile | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const printers = useQuery({ queryKey: ["printers"], queryFn: api.printers });
  const live = useLive(true);
  const plates = file.meta.plates ?? [];
  const [plateNo, setPlateNo] = useState(plates.find((p) => p.index === initialPlate)?.index ?? plates[0]?.index ?? 1);
  const [printerId, setPrinterId] = useState<number | null>(initialPrinter ?? null);
  const [map, setMap] = useState<Record<number, number>>({});
  const [cur, setCur] = useState(0);
  const [opts, setOpts] = useCaliOpts();
  const cb = useCostBasis();

  useEffect(() => {
    if (printerId == null && printers.data?.[0]) setPrinterId(printers.data[0].id);
  }, [printers.data, printerId]);

  const plate = plates.find((p) => p.index === plateNo);
  const l = live.data?.find((x) => x.id === printerId);
  const trays = l?.trays ?? [];
  const trayKey = trays.map((t) => `${t.id}${t.type}${t.color}`).join();
  useEffect(() => {
    if (plate) setMap(autoMap(plate, trays));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plateNo, printerId, trayKey]);

  const useAms = useMemo(() => !!plate && plate.filaments.some((f) => (map[f.id] ?? 254) !== 254), [plate, map]);
  const mixed = !!plate && useAms && plate.filaments.some((f) => (map[f.id] ?? 254) === 254);
  const busy = l && ["RUNNING", "PREPARE", "PAUSE"].includes(l.state);
  const fi = Math.min(cur, Math.max((plate?.filaments.length ?? 1) - 1, 0));
  const curF = plate?.filaments[fi];
  const trayOf = (fid: number) => trays.find((t) => t.id === (map[fid] ?? 254));
  const cost = plate ? plateCost(plate, cb.spools, cb.kwh, cb.watts, (fid) => trayOf(fid)?.spool_id ?? null) : null;
  // Reicht die Spule, passt das Material? Warnt nur, der Druck lässt sich trotzdem starten
  const hints = (plate?.filaments ?? []).flatMap((f) => {
    const t = trayOf(f.id);
    if (!t) return [];
    const out: string[] = [];
    if (t.type && f.type && baseMaterial(t.type) !== baseMaterial(f.type)) out.push(`${t.label}: ${t.type} eingelegt, die Platte braucht ${f.type}.`);
    const s = t.spool_id != null ? cb.spools.find((x) => x.id === t.spool_id) : undefined;
    if (s && f.used_g) {
      const name = `${spoolTitle(s)}${s.brand ? ` (${s.brand})` : ""}`;
      if (s.remaining_g < f.used_g) out.push(`${t.label}: ${name} hat noch ${fmtG(s.remaining_g)}, gebraucht werden ${fmtG(f.used_g)}. Das reicht nicht.`);
      else if (s.remaining_g < f.used_g * 1.1 + 5) out.push(`${t.label}: ${name} wird knapp, noch ${fmtG(s.remaining_g)} für ${fmtG(f.used_g)}.`);
    }
    return out;
  });
  const modelMismatch = plate?.printer_model && printers.data?.find((p) => p.id === printerId) && !matchesModel(plate.printer_model, printers.data.find((p) => p.id === printerId)!.model);

  const start = useMutation({
    mutationFn: () => {
      const max = Math.max(0, ...(plate?.filaments.map((f) => f.id) ?? []));
      const ams_mapping = Array.from({ length: max }, (_, i) => {
        const v = map[i + 1];
        return v == null || v === 254 ? -1 : v;
      });
      return api.print(printerId!, { file_id: file.id, plate: plateNo, use_ams: useAms, ams_mapping, ...effectiveCali(opts, !!l?.cali_auto), ...(queueId ? { queue_id: queueId } : {}) });
    },
    onSuccess: () => {
      toast("Druck gestartet");
      if (queueId) void qc.invalidateQueries({ queryKey: ["queue"] });
      onClose();
      go({ page: "printer" });
    },
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  // Bei mehreren Druckern merkt sich der Eintrag den gewählten, sonst nimmt ihn der erste freie
  const enqueue = useMutation({
    mutationFn: () => api.enqueue({ file_id: file.id, plate: plateNo, printer_id: (printers.data?.length ?? 0) > 1 ? printerId : null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["queue"] });
      toast("In die Warteschlange gestellt");
      onClose();
    },
    onError: (e) => toast((e as Error).message, "fehler"),
  });

  // Bettgröße und Platte des Druckers für die Plattenansicht (Hook vor dem frühen Ausstieg)
  const bedInfo = useQuery({
    queryKey: ["slicer", printerId, null, undefined],
    queryFn: () => api.slicer({ printer_id: printerId }),
    staleTime: 60_000,
    enabled: !!source && printerId != null,
  });
  if (printers.data && !printers.data.length)
    return (
      <Dialog title="Drucken" onClose={onClose}>
        <p className="text-sm text-ink2">Noch kein Drucker eingerichtet.</p>
        <Button kind="primary" className="mt-4" onClick={() => (onClose(), go({ page: "settings" }))}>
          Drucker einrichten
        </Button>
      </Dialog>
    );

  // Fach je Filament-Index wie im Slice-Dialog, damit der Verbrauch dieselben Spulen zeigt
  const slotTrays = Array.from({ length: Math.max(0, ...(plate?.filaments.map((f) => f.id) ?? [])) }, (_, i) => map[i + 1] ?? null);
  const spoolMap = new Map(cb.spools.map((x) => [x.id, x]));
  const usage = <SliceUsage plate={plate ?? null} computing={false} error="" trays={trays} slotTrays={slotTrays} spools={spoolMap} />;
  // Modell in der Farbe des ersten Fachs, wie im Slice-Dialog
  const t0 = plate?.filaments[0] ? trayOf(plate.filaments[0].id) : undefined;
  const paintColor = (t0 && trayColor(t0, t0.spool_id ? spoolMap.get(t0.spool_id) : undefined)) || plate?.filaments[0]?.color || "";
  const pname = printers.data?.find((p) => p.id === printerId)?.name ?? "Der Drucker";
  // Quelldatei auf der Platte des Druckers, Teile dort, wo der Slicer sie hingelegt hat (plate_N.json); Anzahl aus dem Namen „…, 3×)“
  const bi = bedInfo.data && bedInfo.data.available && bedInfo.data.printer != null ? bedInfo.data : null;
  const copies = Number(/, (\d+)×\)\.gcode\.3mf$/.exec(file.name)?.[1] ?? 1);
  const viewerPlate = bi?.bed_size ? { size: bi.bed_size, type: bi.bed, exclude: bi.bed_exclude, copies, boxes: plate?.boxes } : undefined;

  return (
    <Dialog title="Drucken" onClose={onClose} wide="xl">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
        <div className="lg:sticky lg:top-0 lg:self-start">
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-[linear-gradient(160deg,var(--c-tile-a),var(--c-tile-b))] lg:aspect-auto lg:h-[min(36rem,calc(92dvh-16rem))]">
            {source && VIEWABLE.includes(source.kind) ? (
              <Viewer id={source.id} kind={source.kind} paint={{ color: paintColor, paint: [] }} plate={viewerPlate} />
            ) : plate?.has_image ? (
              <img src={fileUrl.plate(file.id, plateNo)} alt="" className="size-full object-contain p-4" />
            ) : file.has_thumb ? (
              <img src={fileUrl.thumb(file.id, file.created_at)} alt="" className="size-full object-contain p-4" />
            ) : (
              <Layers className="absolute inset-0 m-auto text-ink4" size={42} strokeWidth={1.3} />
            )}
            {plate && (
              <div className={`absolute inset-x-3 flex flex-wrap gap-1.5 text-xs font-semibold ${source && VIEWABLE.includes(source.kind) ? "pointer-events-none top-3 [&>span]:pointer-events-auto" : "bottom-3"}`}>
                {plate.printer_model && <span className="rounded-md bg-card/90 px-2 py-1 shadow-seg backdrop-blur">Geslict für {plate.printer_model}{plate.nozzle ? ` · ${plate.nozzle.replace(".", ",")} mm` : ""}</span>}
                {cost?.total != null && (
                  <span
                    className="rounded-md bg-card/90 px-2 py-1 tnum shadow-seg backdrop-blur"
                    title={[cost.filament != null ? `Filament ${cb.money(cost.filament)}` : "", cost.energy != null ? `Strom ${cb.money(cost.energy)}` : ""].filter(Boolean).join(" · ")}
                  >
                    Kosten {cost.exact ? "" : "ca. "}
                    {cb.money(cost.total)}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <span className="truncate text-xs text-ink3">{file.name}</span>
            {plate && <span className="shrink-0 text-xs text-ink3 tnum">{fmtDuration(plate.prediction_s)}</span>}
          </div>
          {plate && <div className="mt-3 hidden lg:block">{usage}</div>}
        </div>

        <div className="min-w-0 space-y-4">
          {(printers.data?.length ?? 0) > 1 && (
            <div>
              <Label>Drucker</Label>
              <select className="mt-1.5 h-9 w-full rounded-lg bg-card px-2 text-sm shadow-seg" value={printerId ?? ""} onChange={(e) => setPrinterId(Number(e.target.value))}>
                {printers.data!.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {l && (
            <div className="flex items-center gap-2 text-sm">
              <StateDot live={l} /> <span className="font-semibold">{pname}</span>
              <span className="text-ink3">{stateLabel(l.state)}</span>
              {l.error && <span className="text-xs text-bad">{l.error}</span>}
            </div>
          )}

          {plates.length > 1 && (
            <div>
              <Label>Platte</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {plates.map((p) => (
                  <button
                    key={p.index}
                    onClick={() => setPlateNo(p.index)}
                    className={`h-8 rounded-lg px-3 text-sm font-semibold ${p.index === plateNo ? "bg-ink text-bg" : "bg-card shadow-seg hover:bg-hover"}`}
                  >
                    {p.index}
                  </button>
                ))}
              </div>
            </div>
          )}

          {plate && plate.filaments.length > 0 && (
            <div>
              <Label>{plate.filaments.length > 1 ? "Filament → Fach" : "Filament"}</Label>
              {plate.filaments.length > 1 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {plate.filaments.map((f, i) => {
                    const t = trayOf(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setCur(i)}
                        className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ${i === fi ? "bg-ink text-bg" : "bg-card shadow-seg hover:bg-hover"}`}
                      >
                        <span className="tnum opacity-60">{f.id}</span>
                        <Swatch color={f.color} /> <span className="max-w-24 truncate">{f.type || "?"}</span>
                        <span className="opacity-50">→</span>
                        <span>{t ? t.label : "extern"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {l && trays.some((t) => t.type) ? (
                <div className="mt-2">
                  <TrayPicker
                    l={l}
                    value={map[curF!.id] ?? 254}
                    onPick={(id) => setMap({ ...map, [curF!.id]: id })}
                    marks={new Map(plate.filaments.flatMap((f) => (f.id !== curF!.id && plate.filaments.length > 1 && map[f.id] != null && map[f.id] !== 254 ? [[map[f.id]!, f.id] as const] : [])))}
                    want={curF!.type}
                  />
                </div>
              ) : (
                <p className="mt-1.5 text-xs text-ink3">{l?.connected ? "Im AMS liegt kein Filament: gedruckt wird von der externen Spule." : "Drucker nicht verbunden, die Fächer erscheinen, sobald er sich meldet."}</p>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label>Vor dem Druck</Label>
            <CaliPicker value={opts} auto={!!l?.cali_auto} onChange={setOpts} />
          </div>

          {plate && <div className="lg:hidden">{usage}</div>}

          {hints.length > 0 && (
            <div className="flex gap-2 rounded-lg bg-accent-soft p-2.5 text-xs text-warn">
              <Info size={14} className="mt-px shrink-0" />
              <div className="space-y-0.5">
                {hints.map((h) => (
                  <div key={h}>{h}</div>
                ))}
              </div>
            </div>
          )}
          {(mixed || modelMismatch || busy || (l && !l.connected)) && (
            <div className="flex gap-2 rounded-lg bg-bad-soft p-2.5 text-xs text-bad">
              <AlertTriangle size={14} className="mt-px shrink-0" />
              <div>
                {l && !l.connected && <div>{pname} ist nicht verbunden.{!queueId && " In die Warteschlange stellen geht trotzdem."}</div>}
                {busy && <div>{pname} druckt gerade.{!queueId && " Mit „In Warteschlange“ kommt der Druck danach dran."}</div>}
                {mixed && <div>AMS und externe Spule lassen sich nicht mischen: alle Filamente ins AMS oder alle extern.</div>}
                {modelMismatch && <div>Die Datei wurde für {plate!.printer_model} geslict, nicht für diesen Drucker.</div>}
              </div>
            </div>
          )}

          <div className="space-y-1.5 pt-1">
            <div className="grid grid-cols-2 gap-2">
              {!queueId && (
                <Button className="w-full justify-center" busy={enqueue.isPending} disabled={!plate} onClick={() => enqueue.mutate()} title="Später drucken, z. B. wenn der aktuelle Druck fertig ist">
                  <ListPlus size={15} /> In Warteschlange
                </Button>
              )}
              <Button
                kind="primary"
                className={`w-full justify-center ${queueId ? "col-span-2" : ""}`}
                busy={start.isPending}
                disabled={!l?.connected || !!busy || mixed || !plate}
                onClick={() => start.mutate()}
              >
                <Play size={15} /> {start.isPending ? "Wird übertragen …" : "Druck starten"}
              </Button>
            </div>
            {onReslice && (
              <button
                type="button"
                onClick={onReslice}
                className="flex h-8 w-fit items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-ink3 hover:bg-hover hover:text-ink"
                title="Quelldatei mit anderen Einstellungen (Qualität, Füllung, Stützen) neu slicen"
              >
                <SlidersHorizontal size={13} /> Mit anderen Einstellungen neu slicen
              </button>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// "X1 Carbon" und "X1" teilen sich die Profile, "A1 mini" und "A1" nicht
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace("CARBON", "").replace("MINI", "M").replace(/^X1C$/, "X1");
const matchesModel = (sliced: string, printer: string) => norm(sliced) === norm(printer);
