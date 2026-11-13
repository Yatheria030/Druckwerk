import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, MessageSquare, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { fmtDuration, type PrintJob } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { errorKey, useHms } from "../lib/hms.ts";
import { href } from "../lib/router.ts";
import { Button, Dialog, fmtDate, Swatch, useToast } from "./controls.tsx";
import { NO_TEXT, WikiCode } from "./hms.tsx";

const STATUS: Record<PrintJob["status"], { label: string; cls: string }> = {
  laeuft: { label: "Läuft", cls: "bg-accent-soft text-accent" },
  fertig: { label: "Fertig", cls: "bg-good-soft text-good" },
  fehler: { label: "Fehler", cls: "bg-bad-soft text-bad" },
  abgebrochen: { label: "Abgebrochen", cls: "bg-fill text-ink2" },
};

export function PrintRow({ p, showModel }: { p: PrintJob; showModel?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [note, setNote] = useState(p.note);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["prints"] });
    if (p.model_id) void qc.invalidateQueries({ queryKey: ["model", p.model_id] });
  };
  const upd = useMutation({
    mutationFn: (b: { rating?: number | null; note?: string }) => api.updatePrint(p.id, b),
    onSuccess: refresh,
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const del = useMutation({ mutationFn: () => api.deletePrint(p.id), onSuccess: () => (refresh(), setEdit(false)) });
  const st = STATUS[p.status];

  return (
    <div className="flex gap-3 py-3">
      {p.has_photo ? (
        <button onClick={() => setPhoto(true)} className="size-14 shrink-0 overflow-hidden rounded-lg bg-fill" aria-label="Foto ansehen">
          <img src={`/api/prints/${p.id}/photo`} alt="" loading="lazy" className="size-full object-cover" />
        </button>
      ) : (
        <div className="grid size-14 shrink-0 place-items-center rounded-lg bg-fill text-ink4">
          <Camera size={18} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${st.cls}`}>
            {st.label}
            {p.status === "laeuft" ? ` ${p.progress} %` : ""}
          </span>
          {showModel && p.model_id ? (
            <a href={href({ page: "model", id: p.model_id })} className="truncate text-sm font-bold hover:text-accent">
              {p.model_name}
            </a>
          ) : (
            <span className="truncate text-sm font-bold">{showModel ? p.name : p.plate ? `Platte ${p.plate}` : p.name}</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink3">
          <span className="tnum">{fmtDate(p.started_at)}</span>
          <span>·</span>
          <span className="tnum">{fmtDuration(p.duration_s)}</span>
          <span>·</span>
          <span>{p.printer_name}</span>
          {p.filament_g != null && (
            <>
              <span>·</span>
              <span className="font-semibold text-ink2 tnum">{p.filament_g.toLocaleString("de-DE", { maximumFractionDigits: 1 })} g</span>
            </>
          )}
          {p.filaments.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <Swatch color={f.color} size={10} /> {f.type}
            </span>
          ))}
        </div>
        {p.status === "fehler" && p.error_code ? <PrintError code={p.error_code} /> : null}
        {p.note && <div className="mt-1 text-xs text-ink2">{p.note}</div>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <div className="flex">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => upd.mutate({ rating: p.rating === n ? null : n })} className="p-0.5 text-star" aria-label={`${n} Sterne`}>
              <Star size={14} fill={p.rating && n <= p.rating ? "currentColor" : "none"} className={p.rating && n <= p.rating ? "" : "text-ink4"} />
            </button>
          ))}
        </div>
        <button onClick={() => (setNote(p.note), setEdit(true))} className="flex items-center gap-1 text-xs font-semibold text-ink3 hover:text-ink">
          <MessageSquare size={12} /> Notiz
        </button>
      </div>

      {edit && (
        <Dialog title="Notiz zum Druck" onClose={() => setEdit(false)}>
          <textarea
            className="h-32 w-full rounded-lg bg-card p-3 text-sm shadow-seg outline-none focus:shadow-[0_0_0_2px_var(--c-accent)]"
            placeholder="Was lief gut, was nicht? Profil, Haftung, Support …"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
          />
          <div className="mt-4 flex justify-between gap-2">
            <Button kind="danger" busy={del.isPending} onClick={() => confirm("Diesen Druck aus dem Verlauf löschen?") && del.mutate()}>
              <Trash2 size={15} /> Löschen
            </Button>
            <Button kind="primary" busy={upd.isPending} onClick={() => upd.mutate({ note }, { onSuccess: () => setEdit(false) })}>
              Sichern
            </Button>
          </div>
        </Dialog>
      )}
      {photo && (
        <Dialog title={`${p.model_name ?? p.name} · ${fmtDate(p.ended_at ?? p.started_at)}`} onClose={() => setPhoto(false)} wide>
          <img src={`/api/prints/${p.id}/photo`} alt="Foto am Druckende" className="w-full rounded-xl" />
        </Dialog>
      )}
    </div>
  );
}

/** Druckfehler mit Text von Bambu, Code als Wiki-Link */
function PrintError({ code }: { code: number }) {
  const hms = useHms();
  const key = errorKey(code);
  return (
    <div className="mt-1 text-xs text-bad">
      <WikiCode k={key} kind="error" /> {hms.data && <span>{hms.data.error[key] ?? NO_TEXT}</span>}
    </div>
  );
}
