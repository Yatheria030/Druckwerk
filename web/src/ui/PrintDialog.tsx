import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fmtDuration, type ModelFile, type Plate, type Tray } from "../../../shared/types.ts";
import { api, fileUrl } from "../api.ts";
import { useLive } from "../App.tsx";
import { go } from "../lib/router.ts";
import { Button, Dialog, Label, Swatch, useToast } from "./controls.tsx";
import { stateLabel, StateDot } from "./printer.tsx";

/** Abstand zweier Farben (RGB), für die Vorauswahl des AMS-Fachs */
const dist = (a: string, b: string) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
  const [x, y] = [p(a), p(b)];
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
};

/** Bestes Fach je Filament: gleicher Typ, ähnlichste Farbe, jedes Fach nur einmal */
function autoMap(plate: Plate, trays: Tray[]): Record<number, number> {
  const free = trays.filter((t) => t.id !== 254 && t.type);
  const out: Record<number, number> = {};
  const used = new Set<number>();
  for (const f of plate.filaments) {
    const cand = free
      .filter((t) => !used.has(t.id))
      .map((t) => ({ t, score: (t.type.toUpperCase() === f.type.toUpperCase() ? 0 : 1000) + dist(t.color, f.color) }))
      .sort((a, b) => a.score - b.score)[0];
    if (cand) {
      out[f.id] = cand.t.id;
      used.add(cand.t.id);
    } else out[f.id] = 254;
  }
  return out;
}

export function PrintDialog({ file, onClose }: { file: ModelFile; onClose: () => void }) {
  const toast = useToast();
  const printers = useQuery({ queryKey: ["printers"], queryFn: api.printers });
  const live = useLive(true);
  const plates = file.meta.plates ?? [];
  const [plateNo, setPlateNo] = useState(plates[0]?.index ?? 1);
  const [printerId, setPrinterId] = useState<number | null>(null);
  const [map, setMap] = useState<Record<number, number>>({});
  const [opts, setOpts] = useState({ bed_leveling: true, flow_cali: false, timelapse: false });

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
  const modelMismatch = plate?.printer_model && printers.data?.find((p) => p.id === printerId) && !matchesModel(plate.printer_model, printers.data.find((p) => p.id === printerId)!.model);

  const start = useMutation({
    mutationFn: () => {
      const max = Math.max(0, ...(plate?.filaments.map((f) => f.id) ?? []));
      const ams_mapping = Array.from({ length: max }, (_, i) => {
        const v = map[i + 1];
        return v == null || v === 254 ? -1 : v;
      });
      return api.print(printerId!, { file_id: file.id, plate: plateNo, use_ams: useAms, ams_mapping, ...opts });
    },
    onSuccess: () => {
      toast("Druck gestartet");
      onClose();
      go({ page: "printer" });
    },
    onError: (e) => toast((e as Error).message, "fehler"),
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

  return (
    <Dialog title="Drucken" onClose={onClose} wide>
      <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
        <div>
          <div className="aspect-square overflow-hidden rounded-xl bg-[linear-gradient(160deg,var(--c-tile-a),var(--c-tile-b))]">
            {plate?.has_image && <img src={fileUrl.plate(file.id, plateNo)} alt="" className="size-full object-contain" />}
          </div>
          <div className="mt-2 truncate text-xs text-ink3">{file.name}</div>
        </div>
        <div className="min-w-0 space-y-4">
          {plates.length > 1 && (
            <div>
              <Label>Platte</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {plates.map((p) => (
                  <button
                    key={p.index}
                    onClick={() => setPlateNo(p.index)}
                    className={`h-8 rounded-lg px-3 text-sm font-semibold ${p.index === plateNo ? "bg-ink text-bg" : "bg-card shadow-seg"}`}
                  >
                    {p.index}
                  </button>
                ))}
              </div>
            </div>
          )}
          {plate && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span>
                <span className="text-ink3">Dauer</span> <b className="tnum">{fmtDuration(plate.prediction_s)}</b>
              </span>
              {plate.weight_g != null && (
                <span>
                  <span className="text-ink3">Filament</span> <b className="tnum">{plate.weight_g.toFixed(1).replace(".", ",")} g</b>
                </span>
              )}
              {plate.printer_model && (
                <span>
                  <span className="text-ink3">Geslict für</span> <b>{plate.printer_model}</b>
                </span>
              )}
            </div>
          )}

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
              <StateDot live={l} /> <span className="font-semibold">{stateLabel(l.state)}</span>
              {l.error && <span className="text-xs text-bad">{l.error}</span>}
            </div>
          )}

          {plate && plate.filaments.length > 0 && (
            <div>
              <Label>Filament → Fach</Label>
              <div className="mt-1.5 space-y-1.5">
                {plate.filaments.map((f) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <div className="flex w-28 shrink-0 items-center gap-2 text-sm">
                      <Swatch color={f.color} /> <span className="font-semibold">{f.type || "?"}</span>
                    </div>
                    <span className="text-ink3">→</span>
                    <select
                      className="h-9 min-w-0 flex-1 rounded-lg bg-card px-2 text-sm shadow-seg"
                      value={map[f.id] ?? 254}
                      onChange={(e) => setMap({ ...map, [f.id]: Number(e.target.value) })}
                    >
                      {trays
                        .filter((t) => t.id !== 254)
                        .map((t) => (
                          <option key={t.id} value={t.id} disabled={!t.type}>
                            {t.label} · {t.type || (t.loaded ? "ohne Daten" : "leer")}
                            {t.type && t.type.toUpperCase() !== f.type.toUpperCase() ? " (anderer Typ)" : ""}
                          </option>
                        ))}
                      <option value={254}>Externe Spule{trays.find((t) => t.id === 254)?.type ? ` · ${trays.find((t) => t.id === 254)!.type}` : ""}</option>
                    </select>
                    <Swatch color={trays.find((t) => t.id === (map[f.id] ?? 254))?.color ?? ""} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            {(
              [
                ["bed_leveling", "Bett nivellieren"],
                ["flow_cali", "Flussrate kalibrieren"],
                ["timelapse", "Zeitraffer aufnehmen"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2.5 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--c-accent)]" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>

          {(mixed || modelMismatch || busy) && (
            <div className="flex gap-2 rounded-lg bg-bad-soft p-2.5 text-xs text-bad">
              <AlertTriangle size={14} className="mt-px shrink-0" />
              <div>
                {busy && <div>Der Drucker ist gerade beschäftigt.</div>}
                {mixed && <div>AMS und externe Spule lassen sich nicht mischen: alle Filamente ins AMS oder alle extern.</div>}
                {modelMismatch && <div>Die Datei wurde für {plate!.printer_model} geslict, nicht für diesen Drucker.</div>}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={onClose}>Abbrechen</Button>
            <Button kind="primary" busy={start.isPending} disabled={!l?.connected || !!busy || mixed || !plate} onClick={() => start.mutate()}>
              {start.isPending ? "Wird übertragen …" : "Druck starten"}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// "X1 Carbon" und "X1" teilen sich die Profile, "A1 mini" und "A1" nicht
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace("CARBON", "").replace("MINI", "M").replace(/^X1C$/, "X1");
const matchesModel = (sliced: string, printer: string) => norm(sliced) === norm(printer);
