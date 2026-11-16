import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Plus, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { baseMaterial, colorDist, type PlateFilament, type PrintJob, type Spool } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { Button, Dialog, Swatch, useToast } from "./controls.tsx";

type Row = { key: number; spool_id: number | null; grams: string };
let seq = 0;
const row = (spool_id: number | null, grams?: number): Row => ({ key: ++seq, spool_id, grams: grams == null ? "" : String(grams).replace(".", ",") });
const fmtG = (g: number) => g.toLocaleString("de-DE", { maximumFractionDigits: 1 });

/**
 * Verbrauch eines Drucks nachtragen oder korrigieren. Nötig, wenn der Druck aus Bambu Studio oder der Cloud kam und der Drucker
 * keine Datei bereithält (P2S ohne SD-Karte): Dann kennt Druckwerk die Gramm nicht. Vorschlag sind die Spulen, deren Fach
 * während des Drucks aktiv war; die Gramm kommen aus Bambu Studio/Handy oder aus der exportierten .gcode.3mf.
 */
export function PrintUsageDialog({ p, onClose }: { p: PrintJob; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const spools = useQuery({ queryKey: ["spools"], queryFn: api.spools });
  const file = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>(() =>
    p.usage.length ? p.usage.map((u) => row(u.spool_id, u.grams)) : p.seen_spools.length ? p.seen_spools.map((id) => row(id)) : [row(null)],
  );
  const factor = p.status === "fertig" ? 1 : Math.min(1, Math.max(0, p.progress / 100));

  // Vorschlag zuerst, dann Spulen in diesem Drucker, dann der Rest; archivierte nur, wenn sie schon gebucht sind
  const options = useMemo(() => {
    const all = (spools.data ?? []).filter((s) => !s.archived || p.usage.some((u) => u.spool_id === s.id));
    const rank = (s: Spool) => (p.seen_spools.includes(s.id) ? 0 : s.printer_id === p.printer_id && s.tray != null ? 1 : 2);
    return all.sort((a, b) => rank(a) - rank(b) || (a.tray ?? 99) - (b.tray ?? 99) || a.material.localeCompare(b.material) || a.id - b.id);
  }, [spools.data, p]);
  const byId = (id: number | null) => options.find((s) => s.id === id);

  const fromFile = useMutation({
    mutationFn: (f: File) => api.printUsageFile(p.id, f),
    onSuccess: (r) => {
      // Je Filament der Platte die passende Spule: gleiches Material, kleinster Farbabstand, Vorschlag bevorzugt, keine doppelt
      const taken = new Set<number>();
      const next = r.filaments.map((f: PlateFilament) => {
        const fit = options
          .filter((s) => !taken.has(s.id) && !s.archived)
          .map((s) => ({ s, d: colorDist(s.color, f.color) + (baseMaterial(s.material) === baseMaterial(f.type) ? 0 : 500) + (p.seen_spools.includes(s.id) ? 0 : 60) }))
          .sort((a, b) => a.d - b.d)[0]?.s;
        if (fit) taken.add(fit.id);
        return row(fit?.id ?? null, Math.round((f.used_g ?? 0) * factor * 10) / 10);
      });
      setRows(next.length ? next : [row(null)]);
      toast(`Platte ${r.plate}: ${r.filaments.length} Filament${r.filaments.length === 1 ? "" : "e"} übernommen, Spulen bitte prüfen`);
    },
    onError: (e) => toast((e as Error).message, "fehler"),
  });

  const items = rows.filter((r) => r.spool_id != null && Number(r.grams.replace(",", ".")) > 0).map((r) => ({ spool_id: r.spool_id!, grams: Number(r.grams.replace(",", ".")) }));
  const invalid = rows.some((r) => r.grams.trim() && !(Number(r.grams.replace(",", ".")) >= 0));
  const dup = new Set(items.map((i) => i.spool_id)).size !== items.length;
  const total = items.reduce((a, i) => a + i.grams, 0);
  const save = useMutation({
    mutationFn: () => api.setPrintUsage(p.id, items),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["prints"] });
      void qc.invalidateQueries({ queryKey: ["spools"] });
      if (p.model_id) void qc.invalidateQueries({ queryKey: ["model", p.model_id] });
      toast(items.length ? `${fmtG(total)} g gebucht` : "Verbrauch entfernt");
      onClose();
    },
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const set = (key: number, v: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...v } : r)));

  return (
    <Dialog title={`Verbrauch · ${p.model_name ?? p.name}`} onClose={onClose}>
      <p className="text-sm text-ink2">
        {p.usage_missing
          ? "Für diesen Druck kennt Druckwerk die Gramm nicht: Er kam aus Bambu Studio oder der Cloud, und der Drucker hält die Datei nicht bereit (keine SD-Karte)."
          : "Die gebuchten Gramm dieses Drucks. Änderungen ersetzen die bisherige Buchung."}{" "}
        Die Werte stehen in Bambu Studio oder Bambu Handy beim Druck, oder hier aus der geslicten Datei übernehmen.
        {factor < 1 && ` Der Druck endete bei ${p.progress} %, Werte aus der Datei werden anteilig angesetzt.`}
      </p>

      <div className="mt-4 space-y-2">
        {rows.map((r) => {
          const s = byId(r.spool_id);
          return (
            <div key={r.key} className="flex items-center gap-2">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-fill">
                {s ? <Swatch color={s.color} size={18} /> : <span className="text-sm font-bold text-ink4">?</span>}
              </span>
              <select
                className="h-9 min-w-0 flex-1 rounded-lg bg-card px-2 text-sm shadow-seg"
                value={r.spool_id ?? ""}
                onChange={(e) => set(r.key, { spool_id: e.target.value ? Number(e.target.value) : null })}
                aria-label="Spule"
              >
                <option value="">Spule wählen …</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {[o.color_name || o.color, `${o.brand} ${o.name}`.trim(), o.slot ?? `#${o.id}`].filter(Boolean).join(" · ")}
                    {p.seen_spools.includes(o.id) ? " ★" : ""}
                  </option>
                ))}
              </select>
              <label className="flex h-9 w-24 shrink-0 items-center rounded-lg bg-card pr-2.5 shadow-seg focus-within:shadow-[0_0_0_2px_var(--c-accent)]">
                <input
                  inputMode="decimal"
                  className="tnum w-full min-w-0 bg-transparent px-2.5 text-right text-sm outline-none"
                  value={r.grams}
                  placeholder="0"
                  onChange={(e) => set(r.key, { grams: e.target.value })}
                  aria-label="Gramm"
                />
                <span className="text-xs text-ink3">g</span>
              </label>
              <button
                onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [row(null)]))}
                className="grid size-9 shrink-0 place-items-center rounded-lg text-ink3 hover:bg-hover hover:text-ink"
                aria-label="Zeile entfernen"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
      {p.seen_spools.length > 0 && <div className="mt-2 text-xs text-ink3">★ Fach war während des Drucks aktiv</div>}
      {dup && <div className="mt-2 text-xs text-bad">Eine Spule steht doppelt drin.</div>}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button kind="ghost" onClick={() => setRows((rs) => [...rs, row(null)])}>
          <Plus size={15} /> Spule
        </Button>
        <Button kind="ghost" busy={fromFile.isPending} onClick={() => file.current?.click()}>
          <FileUp size={15} /> Aus .gcode.3mf
        </Button>
        <input
          ref={file}
          type="file"
          accept=".3mf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) fromFile.mutate(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="mt-5 flex items-center justify-between gap-2">
        <span className="text-sm text-ink2">
          Summe <b className="tnum text-ink">{fmtG(total)} g</b>
        </span>
        <div className="flex gap-2">
          <Button onClick={onClose}>Abbrechen</Button>
          <Button kind="primary" busy={save.isPending} disabled={invalid || dup || spools.isPending} onClick={() => save.mutate()}>
            Buchen
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
