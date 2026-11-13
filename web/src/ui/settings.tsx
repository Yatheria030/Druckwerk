// Formulare für Einstellungen und Assistent: dieselben Bausteine an beiden Stellen.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { section, type FieldDef, type FieldState, type SectionId, type SectionPatch, type SettingsState } from "../../../shared/settings.ts";
import { PRINTER_MODELS, type Printer, type PrinterInput } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { useSettings } from "../lib/settings.ts";
import { Button, Field, LoadError, useToast } from "./controls.tsx";

const show = (f: FieldDef, v: FieldState["effective"]) =>
  v == null ? "–" : f.type === "bool" ? (v ? "an" : "aus") : `${typeof v === "number" ? v.toLocaleString("de-DE") : v}${f.unit ? ` ${f.unit}` : ""}`;

/** Statuszeile eines Bereichs: was gilt und woher es kommt */
export function sectionStatus(id: SectionId, st: SettingsState): { ok: boolean; text: string } {
  const sec = section(id);
  const vals = st.sections[id];
  if (id === "import") {
    const k = vals.api_key!;
    if (!k.hint) return { ok: false, text: "Aus: kein API-Key hinterlegt" };
    return { ok: true, text: `Aktiv, Key ${k.hint} ${k.source === "env" ? "aus der Umgebung" : "in der App"} · Modell ${vals.model!.effective}` };
  }
  const own = sec.fields.filter((f) => vals[f.key]!.source === "db").length;
  const env = sec.fields.filter((f) => vals[f.key]!.source === "env").length;
  const parts = [own ? `${own} eigene${own === 1 ? "r Wert" : " Werte"}` : "", env ? `${env} aus der Umgebung` : ""].filter(Boolean);
  return { ok: true, text: parts.length ? `${parts.join(" · ")}, Rest Standard` : "Alles auf Standard" };
}

export function StatusLine({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink2">
      <span className={`inline-block size-2 shrink-0 rounded-full ${ok ? "bg-good" : "bg-ink4"}`} />
      <span className="min-w-0">{text}</span>
    </div>
  );
}

function Toggle({ on, disabled, onChange, label, name }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string; name: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-0.5">
      <span className="text-sm font-semibold">{label}</span>
      <input type="checkbox" role="switch" aria-label={name} checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors peer-focus-visible:shadow-[0_0_0_2px_var(--c-accent)] ${on ? "bg-accent" : "bg-ink4"}`}
      >
        <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : ""}`} />
      </span>
    </label>
  );
}

type Draft = Record<string, string | boolean>;

/**
 * Felder eines Bereichs. Leeres Feld = Standard (steht als Platzhalter drin), „Auf Standard“ löscht den gespeicherten Wert.
 * `instant`: Schalter sichern sofort (Einstellungsseite). `footer` ersetzt die Sichern-Zeile (Assistent: Zurück/Weiter).
 */
export function SectionForm({
  id,
  instant = false,
  onDone,
  footer,
}: {
  id: SectionId;
  instant?: boolean;
  onDone?: () => void;
  footer?: (busy: boolean, dirty: boolean) => ReactNode;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const st = useSettings();
  const sec = section(id);
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: (patch: SectionPatch) => api.saveSection(id, patch),
    onSuccess: (d, patch) => {
      qc.setQueryData(["settings"], d);
      setDraft((o) => Object.fromEntries(Object.entries(o).filter(([k]) => !(k in patch))));
      setError("");
    },
    onError: (e) => setError((e as Error).message),
  });

  if (st.isError) return <LoadError error={st.error} retry={() => st.refetch()} />;
  if (!st.data) return <div className="py-4 text-sm text-ink3">…</div>;
  const vals = st.data.sections[id];

  const patchOf = (): SectionPatch => {
    const p: SectionPatch = {};
    for (const [k, v] of Object.entries(draft)) {
      const f = sec.fields.find((x) => x.key === k)!;
      if (f.type === "secret" && v === "") continue; // leer = behalten
      p[k] = v === "" ? null : v;
    }
    return p;
  };
  const dirty = Object.keys(patchOf()).length > 0;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = patchOf();
    if (!Object.keys(p).length) return onDone?.();
    save.mutate(p, { onSuccess: () => (instant && toast(`${sec.title}: gesichert`), onDone?.()) });
  };
  const reset = (f: FieldDef) =>
    save.mutate({ [f.key]: null }, { onSuccess: () => toast(f.type === "secret" ? `${f.label} entfernt` : `${f.label}: auf Standard`) });

  const status = sectionStatus(id, st.data);
  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      {sec.fields.map((f) => {
        const s = vals[f.key]!;
        const stored = f.type === "secret" ? s.set : s.stored != null;
        const src =
          f.type === "secret"
            ? s.hint
              ? `Gesetzt ${s.hint}${s.source === "env" ? ` · aus ${f.env}` : " · in der App"}`
              : "Nicht gesetzt"
            : s.source === "db"
              ? `Eigener Wert · Standard ${show(f, s.default)}`
              : s.source === "env"
                ? `Aus ${f.env}: ${show(f, s.effective)}`
                : `Standard ${show(f, s.default)}`;
        const aside = stored && (
          <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline" onClick={() => reset(f)}>
            <RotateCcw size={12} /> {f.type === "secret" ? "Entfernen" : "Auf Standard"}
          </button>
        );
        const hint = (
          <>
            {f.help}
            {f.find && <span className="block">Zu finden: {f.find}</span>}
            <span className="mt-0.5 block font-semibold text-ink2">{src}</span>
          </>
        );
        if (f.type === "bool") {
          const on = (draft[f.key] as boolean | undefined) ?? (s.effective as boolean);
          return (
            <div key={f.key} className="relative">
              <div className="flex min-h-5 items-center gap-2 pr-24">
                <span className="text-[11px] font-bold tracking-[0.08em] text-ink3 uppercase">{f.label}</span>
                <span className="rounded bg-fill px-1.5 py-px text-[10px] font-bold tracking-[0.06em] text-ink3 uppercase">Optional</span>
              </div>
              {aside && <div className="absolute top-0 right-0 flex min-h-5 items-center">{aside}</div>}
              <div className="mt-1.5 rounded-lg bg-card px-3 py-2 shadow-seg">
                <Toggle
                  label={on ? "An" : "Aus"}
                  name={f.label}
                  on={on}
                  disabled={save.isPending}
                  onChange={(v) => (instant ? save.mutate({ [f.key]: v }) : setDraft({ ...draft, [f.key]: v }))}
                />
              </div>
              <div className="mt-1 text-xs leading-snug text-ink3">{hint}</div>
            </div>
          );
        }
        const placeholder =
          f.type === "secret" ? (s.hint ? `${s.hint} behalten` : "sk-ant-…") : String(s.source === "env" ? s.effective : (s.default ?? ""));
        const value = (draft[f.key] as string | undefined) ?? (f.type === "secret" ? "" : s.stored != null ? String(s.stored) : "");
        return (
          <Field key={f.key} label={f.unit ? `${f.label} (${f.unit})` : f.label} required={false} aside={aside} hint={hint}>
            <input
              className={`field ${f.type === "secret" || f.key === "model" ? "font-mono" : ""} ${f.type === "number" ? "tnum" : ""}`}
              type={f.type === "secret" ? "password" : "text"}
              inputMode={f.type === "number" ? "numeric" : undefined}
              value={value}
              placeholder={placeholder}
              autoComplete={f.type === "secret" ? "new-password" : "off"}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
            />
          </Field>
        );
      })}
      {error && <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm font-semibold text-bad">{error}</div>}
      {footer ? (
        footer(save.isPending, dirty)
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sep pt-3">
          <StatusLine {...status} />
          <Button kind="primary" busy={save.isPending && dirty} disabled={!dirty}>
            Sichern
          </Button>
        </div>
      )}
    </form>
  );
}

/** Druckerfelder samt Speichern (Verbindung wird vorher geprüft); im Dialog und im Assistenten */
export function PrinterForm({
  p,
  onSaved,
  footer,
}: {
  p: Printer | null;
  onSaved: () => void;
  footer: (busy: boolean) => ReactNode;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState<PrinterInput>({ name: p?.name ?? "Bambu", host: p?.host ?? "", serial: p?.serial ?? "", model: p?.model ?? "P2S", access_code: "" });
  const save = useMutation({
    mutationFn: () => {
      const b = { ...v, access_code: v.access_code || undefined };
      return p ? api.updatePrinter(p.id, b) : api.addPrinter(b);
    },
    onSuccess: () => {
      toast(p ? "Drucker gesichert" : "Drucker verbunden");
      void qc.invalidateQueries({ queryKey: ["printers"] });
      void qc.invalidateQueries({ queryKey: ["live"] });
      void qc.invalidateQueries({ queryKey: ["settings"] });
      onSaved();
    },
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const set = (k: keyof PrinterInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
        <Field label="Name" required hint="Frei wählbar, erscheint in der Seitenleiste.">
          <input className="field" value={v.name} onChange={set("name")} required />
        </Field>
        <Field label="Modell" required hint="Bestimmt, wie die Kamera angesprochen wird.">
          <select className="field" value={v.model} onChange={set("model")}>
            {PRINTER_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="IP-Adresse" required hint="Am Drucker unter Einstellungen → WLAN bzw. Netzwerk (A1: Einstellungen → LAN-Modus).">
        <input className="field tnum" value={v.host} onChange={set("host")} placeholder="192.168.1.50" inputMode="decimal" autoComplete="off" required />
      </Field>
      <Field label="Seriennummer" required hint="Am Drucker unter Einstellungen → Gerät oder in Bambu Studio unter Gerät.">
        <input className="field font-mono uppercase" value={v.serial} onChange={set("serial")} placeholder="01P00A000000000" autoComplete="off" required />
      </Field>
      <Field
        label="Zugangscode"
        required={!p}
        hint={
          p?.has_code
            ? "Leer lassen, um den gespeicherten zu behalten."
            : "8 Zeichen, am Drucker neben der IP angezeigt. Ändert sich, wenn der LAN-Modus neu eingeschaltet wird."
        }
      >
        <input className="field font-mono" type="password" value={v.access_code} onChange={set("access_code")} autoComplete="new-password" required={!p} />
      </Field>
      {footer(save.isPending)}
    </form>
  );
}
