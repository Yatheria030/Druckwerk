// Druckwarteschlange auf der Druckerseite: Reihenfolge ändern, entfernen, starten (öffnet den Druckdialog mit frischer AMS-Zuordnung)
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ListOrdered, Play, X } from "lucide-react";
import { useState } from "react";
import { fmtDuration, type PrinterLive, type QueueEntry } from "../../../shared/types.ts";
import { api, fileUrl } from "../api.ts";
import { href } from "../lib/router.ts";
import { Button, Card, useToast } from "./controls.tsx";
import { PrintDialog } from "./PrintDialog.tsx";

const BUSY = ["RUNNING", "PREPARE", "PAUSE"];

export function QueueCard({ live }: { live: PrinterLive[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["queue"], queryFn: api.queue, refetchInterval: 30_000 });
  const printers = useQuery({ queryKey: ["printers"], queryFn: api.printers });
  const [start, setStart] = useState<{ e: QueueEntry; printer: number | null } | null>(null);
  const done = () => void qc.invalidateQueries({ queryKey: ["queue"] });
  const order = useMutation({ mutationFn: api.orderQueue, onSettled: done, onError: (e) => toast((e as Error).message, "fehler") });
  const remove = useMutation({ mutationFn: api.dequeue, onSettled: done, onError: (e) => toast((e as Error).message, "fehler") });

  const list = q.data ?? [];
  if (!list.length) return null;
  const free = (e: QueueEntry) => live.find((l) => l.connected && !BUSY.includes(l.state) && (e.printer_id == null || l.id === e.printer_id));
  const move = (i: number, d: -1 | 1) => {
    const ids = list.map((e) => e.id);
    [ids[i], ids[i + d]] = [ids[i + d]!, ids[i]!];
    // sofort umsortiert zeigen, Server zieht nach
    qc.setQueryData<QueueEntry[]>(["queue"], ids.map((id) => list.find((e) => e.id === id)!));
    order.mutate(ids);
  };
  const ready = list.find((e) => free(e));
  const total = list.reduce((s, e) => s + (e.file.meta.plates?.find((p) => p.index === e.plate)?.prediction_s ?? 0), 0);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-sep px-4 py-3">
        <div className="flex items-center gap-2 font-bold">
          <ListOrdered size={17} className="text-accent" /> Warteschlange
        </div>
        <div className="text-xs text-ink3 tnum">
          {list.length === 1 ? "1 Druck" : `${list.length} Drucke`}
          {total > 0 && ` · ${fmtDuration(total)}`}
        </div>
      </div>
      {ready && (
        <div className="bg-accent-soft px-4 py-2.5 text-sm">
          <b>{printers.data?.find((x) => x.id === free(ready)!.id)?.name ?? "Der Drucker"} ist frei.</b> Bett räumen, dann „{ready.model_name}“ starten.
        </div>
      )}
      <ul className="divide-y divide-sep">
        {list.map((e, i) => {
          const plate = e.file.meta.plates?.find((p) => p.index === e.plate);
          const p = free(e);
          const fixed = e.printer_id != null && (printers.data?.length ?? 0) > 1 ? printers.data?.find((x) => x.id === e.printer_id)?.name : null;
          return (
            <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-4 shrink-0 text-center text-xs font-bold text-ink3 tnum">{i + 1}</span>
              <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-[linear-gradient(160deg,var(--c-tile-a),var(--c-tile-b))]">
                {plate?.has_image && <img src={fileUrl.plate(e.file.id, e.plate)} alt="" loading="lazy" className="size-full object-contain" />}
              </div>
              <div className="min-w-0 flex-1">
                <a href={href({ page: "model", id: e.file.model_id })} className="block truncate text-sm font-bold hover:text-accent">
                  {e.model_name}
                </a>
                <div className="truncate text-xs text-ink3 tnum">
                  {[
                    (e.file.meta.plates?.length ?? 0) > 1 ? `Platte ${e.plate}` : e.file.name,
                    plate?.prediction_s ? fmtDuration(plate.prediction_s) : "",
                    plate?.weight_g != null ? `${Math.round(plate.weight_g)} g` : "",
                    fixed ? `auf ${fixed}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <div className="hidden sm:flex">
                  <IconBtn label="Nach oben" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp size={15} />
                  </IconBtn>
                  <IconBtn label="Nach unten" disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown size={15} />
                  </IconBtn>
                </div>
                {i > 0 && (
                  <span className="sm:hidden">
                    <IconBtn label="Nach oben" onClick={() => move(i, -1)}>
                      <ArrowUp size={15} />
                    </IconBtn>
                  </span>
                )}
                <IconBtn label="Aus der Warteschlange nehmen" onClick={() => remove.mutate(e.id)}>
                  <X size={15} />
                </IconBtn>
                <Button
                  kind={p && e === ready ? "primary" : "secondary"}
                  className="ml-1 h-8 px-2.5"
                  disabled={!p}
                  title={p ? "Druckdialog öffnen" : "Kein freier Drucker"}
                  onClick={() => setStart({ e, printer: p?.id ?? e.printer_id })}
                >
                  <Play size={14} /> <span className="hidden min-[420px]:inline">Starten</span>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {start && <PrintDialog file={start.e.file} plate={start.e.plate} queueId={start.e.id} printer={start.printer} onClose={() => setStart(null)} />}
    </Card>
  );
}

function IconBtn({ label, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button {...p} aria-label={label} title={label} className="grid size-8 place-items-center rounded-lg text-ink2 enabled:hover:bg-hover enabled:hover:text-ink disabled:opacity-30">
      {children}
    </button>
  );
}
