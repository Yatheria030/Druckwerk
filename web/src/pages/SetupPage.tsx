// Erste Schritte: Drucker, Filament, Link-Import und Übersicht. Erscheint beim ersten Start ohne Daten,
// jederzeit wieder über Einstellungen → Erste Schritte. Felder und Speichern wie in den Einstellungen (ui/settings.tsx).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, Circle, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { section } from "../../../shared/settings.ts";
import { PRINTER_MODELS } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { PageHeader } from "../App.tsx";
import { go, href } from "../lib/router.ts";
import { useSettings } from "../lib/settings.ts";
import { Button, Card, Label, useToast } from "../ui/controls.tsx";
import { PrinterForm, SectionForm, sectionStatus } from "../ui/settings.tsx";

const STEPS = ["Willkommen", "Drucker", "Filament", "Link-Import", "Übersicht"] as const;

function Nav({ step, busy, next = "Weiter", skip = true, submit = true, onNext }: { step: number; busy?: boolean; next?: string; skip?: boolean; submit?: boolean; onNext?: () => void }) {
  const to = (n: number) => go({ page: "setup", step: n });
  return (
    <div className="flex items-center justify-between gap-2 border-t border-sep pt-4">
      {step > 1 ? (
        <Button type="button" kind="ghost" className="-ml-2 px-2" onClick={() => to(step - 1)}>
          <ChevronLeft size={16} /> Zurück
        </Button>
      ) : (
        <span />
      )}
      <div className="flex gap-2">
        {skip && (
          <Button type="button" kind="ghost" onClick={() => to(step + 1)}>
            Überspringen
          </Button>
        )}
        <Button kind="primary" type={submit ? "submit" : "button"} busy={busy} onClick={submit ? undefined : onNext}>
          {next}
        </Button>
      </div>
    </div>
  );
}

function Step({ title, does, children }: { title: string; does: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-4 sm:p-6">
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-1 mb-5 text-sm leading-relaxed text-ink2">{does}</p>
      {children}
    </Card>
  );
}

export function SetupPage({ step: raw }: { step: number }) {
  const step = Math.min(STEPS.length, Math.max(1, raw));
  const next = () => go({ page: "setup", step: step + 1 });
  const st = useSettings();

  return (
    <>
      <PageHeader width="max-w-3xl" title="Erste Schritte" sub="Druckwerk in ein paar Minuten einrichten. Alles lässt sich später in den Einstellungen ändern.">
        <a href={href({ page: "printer" })} className="text-sm font-semibold text-ink3 hover:text-ink">
          {st.data?.setup.done ? "Schließen" : "Später"}
        </a>
      </PageHeader>
      <div className="mx-auto max-w-3xl space-y-5 px-4 sm:px-6">
        {/* Fortschritt */}
        <nav aria-label="Fortschritt">
          <div className="mb-2 text-xs font-semibold text-ink3 tnum">
            Schritt {step} von {STEPS.length} · {STEPS[step - 1]}
          </div>
          <ol className="grid grid-cols-5 gap-1.5">
            {STEPS.map((s, i) => (
              <li key={s}>
                <a href={href({ page: "setup", step: i + 1 })} className="group block" aria-current={i + 1 === step ? "step" : undefined}>
                  <span className={`block h-1.5 rounded-full ${i + 1 <= step ? "bg-accent" : "bg-fill2 group-hover:bg-ink4"}`} />
                  <span className={`mt-1.5 hidden truncate text-xs font-semibold sm:block ${i + 1 === step ? "text-accent" : "text-ink3"}`}>{s}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {step === 1 && (
          <Step
            title="Willkommen bei Druckwerk"
            does="Druckwerk verwaltet 3D-Modelle, startet Drucke auf Bambu-Lab-Druckern im Heimnetz und führt Buch über Filament und Verlauf, ohne Cloud."
          >
            <ul className="mb-5 space-y-2 text-sm leading-relaxed text-ink2">
              <li>
                <b className="text-ink">Drucker:</b> verbindet die App mit deinem Drucker. Ohne ihn gehen Bibliothek und Filament, aber kein Status, Druck oder Verlauf.
              </li>
              <li>
                <b className="text-ink">Filament:</b> Währung, Standardgewicht und Anzeige der Spulen.
              </li>
              <li>
                <b className="text-ink">Link-Import:</b> füllt neue Spulen aus einer Produktseite. Braucht einen Key für die Anthropic-API, sonst bleibt er aus.
              </li>
            </ul>
            <p className="mb-5 text-sm text-ink3">Jeder Schritt lässt sich überspringen. Leere Felder nutzen den Standardwert.</p>
            <Nav step={1} next="Los geht’s" skip={false} submit={false} onNext={next} />
          </Step>
        )}

        {step === 2 && <PrinterStep onNext={next} />}

        {(step === 3 || step === 4) && (
          <Step title={section(step === 3 ? "filament" : "import").title} does={section(step === 3 ? "filament" : "import").does}>
            <SectionForm key={step} id={step === 3 ? "filament" : "import"} onDone={next} footer={(busy) => <Nav step={step} busy={busy} />} />
          </Step>
        )}

        {step === 5 && <Summary />}
      </div>
    </>
  );
}

function PrinterStep({ onNext }: { onNext: () => void }) {
  const printers = useQuery({ queryKey: ["printers"], queryFn: api.printers });
  const [adding, setAdding] = useState(false);
  const list = printers.data ?? [];
  const form = !list.length || adding;
  return (
    <Step
      title="Drucker verbinden"
      does={
        <>
          Verbindet die App direkt im Heimnetz mit dem Drucker (MQTT, FTPS, Kamera). Vorher am Drucker <b>LAN-Modus</b> einschalten; für den Druckstart aus der
          App zusätzlich den <b>Entwicklermodus</b>. Beim Sichern prüft die App die Verbindung.
        </>
      }
    >
      {list.length > 0 && (
        <div className="mb-5 divide-y divide-sep rounded-xl bg-fill px-3">
          {list.map((p) => (
            <div key={p.id} className="flex items-center gap-2 py-2.5 text-sm">
              <Check size={16} className="shrink-0 text-good" />
              <span className="font-semibold">{p.name}</span>
              <span className="truncate text-ink3">
                {PRINTER_MODELS.find((m) => m.id === p.model)?.label} · {p.host}
              </span>
            </div>
          ))}
        </div>
      )}
      {form ? (
        <PrinterForm
          p={null}
          onSaved={() => (list.length ? setAdding(false) : onNext())}
          footer={(busy) => <Nav step={2} busy={busy} next={busy ? "Verbindung wird geprüft …" : "Verbinden und weiter"} />}
        />
      ) : (
        <>
          <Button type="button" kind="ghost" className="-ml-2 mb-4" onClick={() => setAdding(true)}>
            <Plus size={15} /> Weiteren Drucker hinzufügen
          </Button>
          <Nav step={2} skip={false} submit={false} onNext={onNext} />
        </>
      )}
    </Step>
  );
}

function Summary() {
  const qc = useQueryClient();
  const toast = useToast();
  const st = useSettings();
  const printers = useQuery({ queryKey: ["printers"], queryFn: api.printers });
  const finish = useMutation({
    mutationFn: () => api.setupDone(true),
    onSuccess: (d) => {
      qc.setQueryData(["settings"], d);
      toast("Eingerichtet");
      go({ page: "printer" });
    },
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const n = printers.data?.length ?? 0;
  const rows: { step: number; title: string; ok: boolean; text: string; open?: string }[] = st.data
    ? [
        {
          step: 2,
          title: "Drucker",
          ok: n > 0,
          text: n ? `${n} Drucker verbunden: ${printers.data!.map((p) => p.name).join(", ")}` : "Kein Drucker",
          open: n ? undefined : "Status, Druckstart, Kamera und Verlauf brauchen einen Drucker.",
        },
        { step: 3, title: "Filament", ...sectionStatus("filament", st.data) },
        {
          step: 4,
          title: "Link-Import",
          ...sectionStatus("import", st.data),
          open: st.data.sections.import.api_key!.hint ? undefined : "Spulen lassen sich weiter von Hand anlegen.",
        },
      ]
    : [];
  const open = rows.filter((r) => !r.ok).length;
  return (
    <Step title="Übersicht" does="Das ist eingerichtet. Offene Punkte lassen sich jederzeit unter Einstellungen nachholen.">
      <div className="mb-5 divide-y divide-sep">
        {rows.map((r) => (
          <div key={r.title} className="flex items-start gap-3 py-3">
            {r.ok ? <Check size={18} className="mt-0.5 shrink-0 text-good" /> : <Circle size={18} className="mt-0.5 shrink-0 text-ink4" />}
            <div className="min-w-0 flex-1">
              <Label>{r.title}</Label>
              <div className="mt-1 text-sm text-ink2">{r.text}</div>
              {r.open && <div className="mt-0.5 text-xs text-ink3">Offen: {r.open}</div>}
            </div>
            <a href={href({ page: "setup", step: r.step })} className="shrink-0 text-sm font-semibold text-accent hover:underline">
              Ändern
            </a>
          </div>
        ))}
      </div>
      <p className="mb-5 text-sm text-ink2">{open ? `${open} ${open === 1 ? "Punkt bleibt" : "Punkte bleiben"} offen.` : "Alles eingerichtet."}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          finish.mutate();
        }}
      >
        <Nav step={5} skip={false} next="Fertig" busy={finish.isPending} />
      </form>
    </Step>
  );
}
