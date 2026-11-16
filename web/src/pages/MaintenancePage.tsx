// Wartung je Drucker: Punkte mit Intervall in Druckstunden und/oder Tagen, Fortschritt seit dem letzten Erledigen
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Wrench } from "lucide-react";
import { useState } from "react";
import { SUGGESTIONS, type MaintPrinter, type MaintStatus, type MaintTaskInput } from "../../../shared/maintenance.ts";
import { api } from "../api.ts";
import { PageHeader } from "../App.tsx";
import { href } from "../lib/router.ts";
import { Button, Card, Dialog, Field, Label, LoadError, useToast } from "../ui/controls.tsx";
import { PrinterTabs } from "../ui/PrinterTabs.tsx";

const WIDTH = "max-w-4xl";

export const fmtHours = (h: number) => `${Math.round(h).toLocaleString("de-DE")} h`;
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
const num = (s: string) => (s.trim() ? Number(s.replace(",", ".")) : null);

/** Stand eines Punkts: „120 von 200 h · 12 von 30 Tagen“ */
export const maintProgress = (t: MaintStatus) =>
  [
    t.interval_h ? `${Math.round(t.hours_since).toLocaleString("de-DE")} von ${t.interval_h.toLocaleString("de-DE")} h` : "",
    t.interval_d ? `${Math.floor(t.days_since)} von ${t.interval_d} Tagen` : "",
  ]
    .filter(Boolean)
    .join(" · ");

export const maintTone = (t: MaintStatus) => (t.due ? "var(--c-red)" : t.soon ? "var(--c-orange)" : "var(--c-green)");

export function useMaintenance() {
  return useQuery({ queryKey: ["maintenance"], queryFn: api.maintenance, staleTime: 60_000 });
}

/** „Erledigt“ setzt den Zähler zurück */
export function useDone() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: number) => api.doneMaint(id),
    onSuccess: () => (toast("Als erledigt vermerkt"), qc.invalidateQueries({ queryKey: ["maintenance"] })),
    onError: (e) => toast((e as Error).message, "fehler"),
  });
}

export function MaintenancePage() {
  const q = useMaintenance();
  return (
    <>
      <PageHeader width={WIDTH} title="Wartung" sub="Fällig nach Druckstunden laut Verlauf oder nach Tagen. „Erledigt“ setzt den Zähler zurück." />
      <PrinterTabs view="maint" width={WIDTH} />
      <div className={`mx-auto ${WIDTH} space-y-5 px-4 sm:px-6`}>
        {q.isError ? (
          <LoadError error={q.error} retry={() => q.refetch()} />
        ) : q.isPending ? (
          <div className="skeleton h-80 rounded-2xl" />
        ) : !q.data.length ? (
          <Card className="p-8 text-center">
            <div className="text-lg font-bold">Noch kein Drucker</div>
            <a href={href({ page: "settings" })} className="mt-4 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent">
              Drucker einrichten
            </a>
          </Card>
        ) : (
          q.data.map((p) => <PrinterMaint key={p.printer_id} p={p} />)
        )}
      </div>
    </>
  );
}

function PrinterMaint({ p }: { p: MaintPrinter }) {
  const [edit, setEdit] = useState<MaintStatus | Partial<MaintTaskInput> | null>(null);
  const [hours, setHours] = useState(false);
  const done = useDone();
  const qc = useQueryClient();
  const toast = useToast();
  const add = useMutation({
    mutationFn: (t: MaintTaskInput) => api.addMaint(p.printer_id, t),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maintenance"] }),
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const missing = SUGGESTIONS.filter((s) => !p.tasks.some((t) => t.name.toLowerCase() === s.name.toLowerCase()));

  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <Label>{p.name}</Label>
        <button onClick={() => setHours(true)} className="flex items-center gap-1 text-[13px] font-semibold text-ink2 hover:text-ink">
          <span className="tnum">{fmtHours(p.hours)}</span> Druckzeit <Pencil size={13} />
        </button>
      </div>
      <Card className="divide-y divide-sep">
        {p.tasks.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 truncate font-semibold">{t.name}</span>
                {(t.due || t.soon) && (
                  <span className="shrink-0 text-[11px] font-bold tracking-wide uppercase" style={{ color: maintTone(t) }}>
                    {t.due ? "Fällig" : "Bald"}
                  </span>
                )}
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fill">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, t.ratio * 100)}%`, background: maintTone(t) }} />
              </div>
              <div className="mt-1 text-xs text-ink3 tnum">
                {maintProgress(t)} · zuletzt {fmtDay(t.done_at)}
                {t.note && <span className="hidden sm:inline"> · {t.note}</span>}
              </div>
            </div>
            <Button className="shrink-0" busy={done.isPending && done.variables === t.id} onClick={() => done.mutate(t.id)} aria-label={`${t.name} erledigt`}>
              <Check size={16} /> <span className="hidden sm:inline">Erledigt</span>
            </Button>
            <button onClick={() => setEdit(t)} className="grid size-8 shrink-0 place-items-center rounded-full text-ink3 hover:bg-hover hover:text-ink" aria-label="Ändern">
              <Pencil size={15} />
            </button>
          </div>
        ))}
        {!p.tasks.length && (
          <div className="flex items-center gap-3 px-4 py-5 text-sm text-ink2">
            <Wrench size={18} className="shrink-0 text-ink3" /> Noch keine Wartungspunkte. Vorschläge unten antippen oder eigenen anlegen.
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
          <button onClick={() => setEdit({})} className="flex h-7 items-center gap-1 rounded-full bg-accent px-2.5 text-xs font-semibold text-on-accent">
            <Plus size={14} /> Punkt
          </button>
          {missing.map((s) => (
            <button
              key={s.name}
              disabled={add.isPending}
              onClick={() => add.mutate(s)}
              title={s.note}
              className="flex h-7 items-center gap-1 rounded-full bg-card px-2.5 text-xs font-semibold text-ink2 shadow-seg hover:text-ink"
            >
              <Plus size={13} /> {s.name}
              <span className="font-medium text-ink3">· {s.interval_h ? `${s.interval_h} h` : `${s.interval_d} Tage`}</span>
            </button>
          ))}
        </div>
      </Card>
      {missing.length > 0 && <p className="text-xs text-ink3">Vorschläge sind Richtwerte, Intervalle laut Handbuch des Druckers anpassen.</p>}
      {edit && <TaskDialog printerId={p.printer_id} task={edit} onClose={() => setEdit(null)} />}
      {hours && <HoursDialog p={p} onClose={() => setHours(false)} />}
    </section>
  );
}

function TaskDialog({ printerId, task, onClose }: { printerId: number; task: MaintStatus | Partial<MaintTaskInput>; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const id = "id" in task ? task.id : undefined;
  const [v, setV] = useState({
    name: task.name ?? "",
    h: task.interval_h != null ? String(task.interval_h) : "",
    d: task.interval_d != null ? String(task.interval_d) : "",
    note: task.note ?? "",
    ago: "",
  });
  const done = () => (void qc.invalidateQueries({ queryKey: ["maintenance"] }), onClose());
  const save = useMutation({
    mutationFn: (): Promise<unknown> => {
      const b: MaintTaskInput = { name: v.name.trim(), interval_h: num(v.h), interval_d: num(v.d), note: v.note.trim() };
      return id ? api.updateMaint(id, b) : api.addMaint(printerId, { ...b, done_hours_ago: num(v.ago) ?? 0 });
    },
    onSuccess: () => (toast(id ? "Wartungspunkt gesichert" : "Wartungspunkt angelegt"), done()),
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const del = useMutation({ mutationFn: () => api.deleteMaint(id!), onSuccess: done, onError: (e) => toast((e as Error).message, "fehler") });

  return (
    <Dialog title={id ? "Wartungspunkt ändern" : "Wartungspunkt"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Bezeichnung">
          <input className="field" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required placeholder="Achsen schmieren" autoFocus={!id} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Alle … Druckstunden">
            <input className="field tnum" inputMode="decimal" value={v.h} onChange={(e) => setV({ ...v, h: e.target.value })} placeholder="200" />
          </Field>
          <Field label="Oder alle … Tage">
            <input className="field tnum" inputMode="decimal" value={v.d} onChange={(e) => setV({ ...v, d: e.target.value })} placeholder="–" />
          </Field>
        </div>
        <p className="-mt-2 text-xs text-ink3">Mit beidem wird der Punkt fällig, sobald das Erste erreicht ist.</p>
        {!id && (
          <Field label="Zuletzt erledigt vor (Druckstunden)" hint="Leer = gerade eben. Zählt ab dem aktuellen Stand rückwärts.">
            <input className="field tnum" inputMode="decimal" value={v.ago} onChange={(e) => setV({ ...v, ago: e.target.value })} placeholder="0" />
          </Field>
        )}
        <Field label="Notiz">
          <textarea className="field min-h-16 resize-y" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Fett, Werkzeug, Link zur Anleitung …" />
        </Field>
        <div className="flex items-center justify-between gap-2 pt-1">
          {id ? (
            <Button type="button" kind="danger" busy={del.isPending} onClick={() => confirm(`„${v.name}“ löschen?`) && del.mutate()}>
              Löschen
            </Button>
          ) : (
            <span />
          )}
          <Button kind="primary" busy={save.isPending} disabled={!v.name.trim() || (!num(v.h) && !num(v.d))}>
            Sichern
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function HoursDialog({ p, onClose }: { p: MaintPrinter; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fromHistory = p.hours - p.hours_base;
  const [total, setTotal] = useState(String(Math.round(p.hours)));
  const save = useMutation({
    mutationFn: () => api.setPrinterHours(p.printer_id, Math.max(0, (num(total) ?? 0) - fromHistory)),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["maintenance"] }), onClose()),
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  return (
    <Dialog title="Druckzeit" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Druckstunden insgesamt" hint={`Davon ${fmtHours(fromHistory)} aus dem Verlauf. Der Rest zählt als Zeit vor Druckwerk; Wartungsstände bleiben, wie sie sind.`}>
          <input className="field tnum" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} autoFocus />
        </Field>
        <div className="flex justify-end">
          <Button kind="primary" busy={save.isPending}>
            Sichern
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Dashboard: fällige und bald fällige Punkte aller Drucker */
export function MaintDue() {
  const q = useMaintenance();
  const done = useDone();
  const list = (q.data ?? []).flatMap((p) => p.tasks.filter((t) => t.due || t.soon).map((t) => ({ p, t })));
  if (!list.length) return null;
  const multi = (q.data?.length ?? 0) > 1;
  return (
    <Card className="divide-y divide-sep">
      <a href={href({ page: "printer", view: "wartung" })} className="flex items-center gap-2 px-4 py-2.5 hover:bg-hover">
        <Wrench size={16} className="text-accent" />
        <span className="flex-1 text-sm font-bold">{list.some((x) => x.t.due) ? "Wartung fällig" : "Wartung bald fällig"}</span>
        <span className="text-[13px] font-semibold text-ink3">Alle Punkte</span>
      </a>
      {list.map(({ p, t }) => (
        <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
          <span className="size-2 shrink-0 rounded-full" style={{ background: maintTone(t) }} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">
              {t.name}
              {multi && <span className="font-medium text-ink3"> · {p.name}</span>}
            </div>
            <div className="text-xs text-ink3 tnum">{maintProgress(t)}</div>
          </div>
          <Button className="shrink-0" busy={done.isPending && done.variables === t.id} onClick={() => done.mutate(t.id)}>
            <Check size={16} /> Erledigt
          </Button>
        </div>
      ))}
    </Card>
  );
}
