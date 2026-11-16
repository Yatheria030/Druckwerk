import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Download, Film, MessageSquare, RotateCcw, Scale, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { fmtDuration, fmtMoney, type ModelFile, type PrintJob } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { printCost } from "../lib/cost.ts";
import { errorKey, noText, useHms } from "../lib/hms.ts";
import { href } from "../lib/router.ts";
import { useSetting } from "../lib/settings.ts";
import { Button, Dialog, fmtDate, Swatch, useToast } from "./controls.tsx";
import { WikiCode } from "./hms.tsx";
import { PrintDialog } from "./PrintDialog.tsx";
import { PrintUsageDialog } from "./PrintUsage.tsx";

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
  const [video, setVideo] = useState(false);
  const [usage, setUsage] = useState(false);
  const [again, setAgain] = useState<ModelFile | null>(null);
  // Nochmal drucken: Datei samt Platten aus dem Modell holen (archivierte Drucke aus Bambu Studio haben sie auch)
  const reprint = useMutation({
    mutationFn: () => qc.fetchQuery({ queryKey: ["model", p.model_id], queryFn: () => api.model(p.model_id!) }),
    onSuccess: (m) => {
      const f = m.files.find((x) => x.id === p.file_id && x.kind === "gcode3mf");
      if (f) setAgain(f);
      else toast("Die Datei ist nicht mehr da oder nicht geslict.", "fehler");
    },
    onError: (e) => toast((e as Error).message, "fehler"),
  });
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
  const currency = useSetting<string>("filament", "currency");
  const cost = printCost(p);
  const costTip = [
    p.cost_filament != null ? `Filament ${fmtMoney(p.cost_filament, currency)}` : "",
    p.cost_energy != null ? `Strom ${fmtMoney(p.cost_energy, currency)} (${p.energy_wh} Wh${p.energy_measured ? ", gemessen" : ", geschätzt"})` : "",
  ]
    .filter(Boolean)
    .join(" · ");

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
              <button onClick={() => setUsage(true)} className="font-semibold text-ink2 tnum underline decoration-ink4 decoration-dotted underline-offset-2 hover:text-accent" title="Verbrauch ändern">
                {p.filament_g.toLocaleString("de-DE", { maximumFractionDigits: 1 })} g
              </button>
            </>
          )}
          {cost != null && (
            <>
              <span>·</span>
              <span className="font-semibold text-ink2 tnum" title={costTip}>
                {fmtMoney(cost, currency)}
              </span>
            </>
          )}
          {p.filaments.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <Swatch color={f.color} size={10} /> {f.type}
            </span>
          ))}
        </div>
        {p.status === "fehler" && p.error_code ? <PrintError code={p.error_code} /> : null}
        {(p.timelapse || p.usage_missing || (p.file_id && p.model_id && p.status !== "laeuft")) && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {p.usage_missing && (
              <button
                onClick={() => setUsage(true)}
                className="flex h-7 items-center gap-1 rounded-md bg-accent-soft px-2 text-xs font-semibold whitespace-nowrap text-accent hover:brightness-95"
                title="Druck aus Bambu Studio ohne lesbare Datei: Gramm nachtragen"
              >
                <Scale size={13} /> Verbrauch nachtragen
              </button>
            )}
            {p.timelapse && (
              <button onClick={() => setVideo(true)} className="flex h-7 items-center gap-1 rounded-md bg-fill px-2 text-xs font-semibold text-ink2 hover:bg-fill2 hover:text-ink">
                <Film size={13} /> Zeitraffer
              </button>
            )}
            {p.file_id && p.model_id && p.status !== "laeuft" && (
              <button
                onClick={() => reprint.mutate()}
                disabled={reprint.isPending}
                className="flex h-7 items-center gap-1 rounded-md bg-fill px-2 text-xs font-semibold text-ink2 hover:bg-fill2 hover:text-ink disabled:opacity-50"
              >
                <RotateCcw size={13} /> Nochmal drucken
              </button>
            )}
          </div>
        )}
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
          {costTip && <div className="mb-3 text-xs text-ink3">Kosten: {costTip}</div>}
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
      {video && p.timelapse && (
        <Dialog title={`Zeitraffer · ${p.model_name ?? p.name}`} onClose={() => setVideo(false)} wide>
          {p.timelapse === "mp4" ? (
            <video src={`/api/prints/${p.id}/timelapse`} controls autoPlay muted playsInline className="w-full rounded-xl bg-black" />
          ) : (
            <div className="space-y-3 text-sm text-ink2">
              <p>Der Drucker speichert den Zeitraffer als AVI, das Browser nicht abspielen. Mit ffmpeg im Container (Build-Argument FFMPEG=1) wandelt Druckwerk künftige Videos in MP4 um.</p>
              <a href={`/api/prints/${p.id}/timelapse`} download={`zeitraffer-${p.id}.avi`} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-fill px-3.5 font-semibold text-ink hover:bg-fill2">
                <Download size={15} /> AVI laden
              </a>
            </div>
          )}
        </Dialog>
      )}
      {usage && <PrintUsageDialog p={p} onClose={() => setUsage(false)} />}
      {again && <PrintDialog file={again} plate={p.plate} onClose={() => setAgain(null)} />}
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
  const text = hms.data?.error[key];
  return (
    <div className="mt-1 text-xs text-bad">
      <WikiCode k={key} kind="error" link={!hms.data || !!text} /> {hms.data && <span>{text || noText(key)}</span>}
    </div>
  );
}
