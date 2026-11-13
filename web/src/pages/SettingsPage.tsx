import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";
import { SECTIONS } from "../../../shared/settings.ts";
import { PRINTER_MODELS, type Printer } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { PageHeader, useLive } from "../App.tsx";
import { href } from "../lib/router.ts";
import { useSettings } from "../lib/settings.ts";
import { Button, Card, Dialog, Label, LoadError } from "../ui/controls.tsx";
import { PrinterForm, SectionForm } from "../ui/settings.tsx";
import { StateDot, stateLabel } from "../ui/printer.tsx";

export function SettingsPage() {
  const printers = useQuery({ queryKey: ["printers"], queryFn: api.printers });
  const live = useLive();
  const [edit, setEdit] = useState<Printer | "neu" | null>(null);
  const settings = useSettings();

  return (
    <>
      <PageHeader width="max-w-3xl" title="Einstellungen" />
      <div className="mx-auto max-w-3xl space-y-5 px-4 sm:px-6">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <Label>Drucker</Label>
            <Button kind="ghost" className="-mr-2 h-8" onClick={() => setEdit("neu")}>
              <Plus size={15} /> Hinzufügen
            </Button>
          </div>
          {printers.isError ? (
            <LoadError error={printers.error} retry={() => printers.refetch()} />
          ) : !printers.data?.length ? (
            <p className="py-3 text-sm text-ink3">Noch kein Drucker eingerichtet.</p>
          ) : (
            <div className="mt-2 divide-y divide-sep">
              {printers.data.map((p) => {
                const l = live.data?.find((x) => x.id === p.id);
                return (
                  <div key={p.id} className="flex items-center gap-3 py-3">
                    {l && <StateDot live={l} />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{p.name}</div>
                      <div className="truncate text-xs text-ink3">
                        {PRINTER_MODELS.find((m) => m.id === p.model)?.label} · {p.host} · {p.serial} · {l ? stateLabel(l.state) : "…"}
                        {l?.error && !l.connected ? ` · ${l.error}` : ""}
                      </div>
                    </div>
                    <Button kind="ghost" className="h-8 px-2" onClick={() => setEdit(p)} aria-label="Bearbeiten">
                      <Pencil size={15} />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {SECTIONS.map((sec) => (
          <Card key={sec.id} className="p-4">
            <Label>{sec.title}</Label>
            <p className="mt-1 mb-4 text-sm leading-relaxed text-ink2">{sec.does}</p>
            <SectionForm id={sec.id} instant />
          </Card>
        ))}

        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <Label>Erste Schritte</Label>
            <p className="mt-1 text-sm text-ink2">
              {settings.data?.setup.done ? "Eingerichtet. Der Assistent führt noch einmal durch Drucker, Filament und Link-Import." : "Noch nicht abgeschlossen."}
            </p>
          </div>
          <a href={href({ page: "setup" })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-fill px-3.5 text-sm font-semibold hover:bg-fill2">
            <Wand2 size={15} /> Assistent öffnen
          </a>
        </Card>

        <Card className="space-y-3 p-4 text-sm leading-relaxed text-ink2">
          <Label>So klappt die Verbindung</Label>
          <p>
            Die App spricht den Drucker direkt im Heimnetz an, ohne Bambu-Cloud: MQTT (Port 8883) für Status und Befehle, FTPS (990) für den Upload, Kamera über
            Port 6000 (A1, P1) bzw. 322 (X1, H2, P2S).
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b>IP und Zugangscode:</b> am Drucker unter Einstellungen → WLAN bzw. Netzwerk (A1: Einstellungen → LAN-Modus).
            </li>
            <li>
              <b>Seriennummer:</b> Einstellungen → Gerät, oder in Bambu Studio unter Gerät.
            </li>
            <li>
              <b>Drucken aus der App:</b> Seit der Firmware mit „Authorization Control“ nimmt der Drucker Befehle von Fremdsoftware nur im <b>LAN-Modus</b> mit
              eingeschaltetem <b>Entwicklermodus</b> an. Status, Kamera und Verlauf gehen auch ohne.
            </li>
            <li>Der Zugangscode ändert sich, wenn der LAN-Modus neu eingeschaltet wird. Dann hier neu eintragen.</li>
          </ul>
        </Card>
      </div>
      {edit && <PrinterDialog p={edit === "neu" ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function PrinterDialog({ p, onClose }: { p: Printer | null; onClose: () => void }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => api.deletePrinter(p!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["printers"] });
      void qc.invalidateQueries({ queryKey: ["live"] });
      onClose();
    },
  });
  return (
    <Dialog title={p ? "Drucker bearbeiten" : "Drucker hinzufügen"} onClose={onClose}>
      <PrinterForm
        p={p}
        onSaved={onClose}
        footer={(busy) => (
          <div className="flex justify-between gap-2 pt-1">
            {p ? (
              <Button type="button" kind="danger" busy={del.isPending} onClick={() => confirm(`„${p.name}“ entfernen? Sein Druckverlauf wird mit gelöscht.`) && del.mutate()}>
                <Trash2 size={15} /> Entfernen
              </Button>
            ) : (
              <span />
            )}
            <Button kind="primary" busy={busy}>
              {busy ? "Verbindung wird geprüft …" : p ? "Sichern" : "Verbinden"}
            </Button>
          </div>
        )}
      />
    </Dialog>
  );
}
