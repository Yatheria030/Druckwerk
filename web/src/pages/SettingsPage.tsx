// Einstellungen: links Kategorien nach Gruppen (unter `md` als Chips oben), rechts der gewählte Bereich. Die Suche läuft über
// alle Kategorien und zeigt je Bereich nur die passenden Felder. Kategorie in der Adresse: #/einstellungen/<view>.
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Archive, Bell, BellRing, Coins, Disc3, Globe, Link2, Pencil, Plus, Printer, Search, Trash2, Wand2, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { section, type SectionId } from "../../../shared/settings.ts";
import { PRINTER_MODELS, type Printer as PrinterT, type PrinterLive } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { PageHeader, useLive } from "../App.tsx";
import { href, type SettingsView } from "../lib/router.ts";
import { useSettings } from "../lib/settings.ts";
import { Button, Card, Dialog, Label, LoadError } from "../ui/controls.tsx";
import { chipCls } from "../ui/FilamentTabs.tsx";
import { BambuAccountForm, useBambuAccount } from "../ui/BambuAccount.tsx";
import { PrinterForm, SectionForm } from "../ui/settings.tsx";
import { StateDot, stateLabel } from "../ui/printer.tsx";

type Cat = { view: SettingsView; label: string; icon: LucideIcon; group: string; section?: SectionId; does?: string; words?: string };

/** Kategorien im Seitenmenü, nach Gruppen sortiert */
const CATS: Cat[] = [
  {
    view: "drucker",
    label: "Drucker",
    icon: Printer,
    group: "Geräte",
    does: "Bambu-Drucker im Heimnetz: Adresse, Seriennummer, Zugangscode und eine messende Steckdose je Drucker.",
    words: "drucker ip adresse seriennummer zugangscode lan modus entwicklermodus verbindung kamera mqtt ftps steckdose shelly tasmota",
  },
  { view: "filament", label: "Filament", icon: Disc3, group: "Druck & Material", section: "filament" },
  { view: "kosten", label: "Kosten", icon: Coins, group: "Druck & Material", section: "kosten" },
  { view: "archiv", label: "Archiv", icon: Archive, group: "Druck & Material", section: "archiv" },
  { view: "benachrichtigungen", label: "Benachrichtigungen", icon: Bell, group: "Dienste", section: "notify" },
  { view: "import", label: "Link-Import", icon: Link2, group: "Dienste", section: "import" },
  {
    view: "makerworld",
    label: "MakerWorld",
    icon: Globe,
    group: "Dienste",
    does: "Suchen und Ansehen geht ohne Konto. Für die 3MF-Dateien der Druckprofile meldest du dich einmal mit deinem Bambu-Konto an.",
    words: "makerworld bambu konto anmelden login token passwort code mail 3mf druckprofil download",
  },
  {
    view: "app",
    label: "Erste Schritte",
    icon: Wand2,
    group: "App",
    does: "Der Assistent führt durch Drucker, Filament und Link-Import.",
    words: "erste schritte assistent einrichtung setup",
  },
];
const GROUPS = [...new Set(CATS.map((c) => c.group))];

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
/** Alle Suchwörter kommen vor */
const hit = (hay: string, q: string) => q.split(/\s+/).every((w) => norm(hay).includes(w));

export function SettingsPage({ view }: { view: SettingsView }) {
  const settings = useSettings();
  const printers = useQuery({ queryKey: ["printers"], queryFn: api.printers });
  const live = useLive();
  const bambu = useBambuAccount();
  const [query, setQuery] = useState("");
  const q = norm(query.trim());
  const st = settings.data;

  /** vom Standard abweichende Werte je Bereich (eigene Werte in der App) */
  const changed = (id?: SectionId) => (id && st ? section(id).fields.filter((f) => st.sections[id][f.key]!.source === "db").length : 0);
  const badge = (c: Cat): { n: number | string; accent: boolean; title: string } | null => {
    if (c.view === "drucker") return printers.data?.length ? { n: printers.data.length, accent: false, title: "Drucker" } : null;
    if (c.view === "import" && st && !st.sections.import.api_key!.hint) return { n: "aus", accent: false, title: "Kein API-Key" };
    if (c.view === "makerworld" && bambu.data && !bambu.data.logged_in)
      return { n: bambu.data.expired ? "!" : "aus", accent: bambu.data.expired, title: bambu.data.expired ? "Anmeldung abgelaufen" : "Nicht angemeldet" };
    const n = changed(c.section);
    return n ? { n, accent: true, title: `${n} vom Standard abweichend` } : null;
  };

  // Suche: über alle Kategorien, je Bereich nur die passenden Felder
  const results = useMemo(() => {
    if (!q) return null;
    return CATS.map((c) => {
      if (!c.section) return { c, only: undefined, ok: hit(`${c.label} ${c.group} ${c.words ?? ""}`, q) };
      const sec = section(c.section);
      const all = hit(`${c.label} ${sec.title} ${c.group}`, q);
      const only = new Set(sec.fields.filter((f) => all || hit(`${f.label} ${f.help} ${f.find ?? ""} ${f.unit ?? ""}`, q)).map((f) => f.key));
      return { c, only, ok: only.size > 0 };
    }).filter((r) => r.ok);
  }, [q]);
  const hits = results?.reduce((n, r) => n + (r.only?.size ?? 1), 0) ?? 0;
  const current = CATS.find((c) => c.view === view) ?? CATS[0]!;
  // Aktiven Chip ins Bild rollen (Handy, Kategorie per Adresse geöffnet)
  const chips = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = chips.current;
    const a = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && a) nav.scrollLeft += a.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - a.offsetWidth) / 2;
  }, [current.view]);

  const body = (c: Cat, only?: Set<string>) =>
    c.view === "drucker" ? (
      <PrintersPanel key={c.view} printers={printers} live={live.data} />
    ) : c.view === "makerworld" ? (
      <Card key={c.view} className="p-4 sm:p-5">
        <CatHead cat={c} />
        <BambuAccountForm />
      </Card>
    ) : c.view === "app" ? (
      <SetupCard key={c.view} done={!!st?.setup.done} />
    ) : (
      <SectionCard key={c.view} cat={c} only={only} changed={changed(c.section)} />
    );

  return (
    <>
      <PageHeader title="Einstellungen" sub="Jede Änderung wirkt sofort, ohne Neustart. Leere Felder nutzen den Standard.">
        <label className="flex h-9 w-[calc(100vw-2rem)] items-center gap-2 rounded-lg bg-card px-3 shadow-seg focus-within:shadow-[0_0_0_2px_var(--c-accent)] sm:w-72">
          <Search size={15} className="shrink-0 text-ink3" />
          <input
            className="field text-sm"
            type="search"
            placeholder="Suchen … (z. B. Strompreis, ntfy)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Einstellungen durchsuchen"
          />
        </label>
      </PageHeader>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 2xl:max-w-[88rem]">
        {/* Handy und schmale Fenster: Kategorien als Chips */}
        <nav ref={chips} className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 py-0.5 sm:-mx-6 sm:px-6 md:hidden" aria-label="Kategorien">
          {CATS.map((c) => {
            const b = badge(c);
            return (
              <a
                key={c.view}
                href={href({ page: "settings", view: c.view })}
                onClick={() => setQuery("")}
                aria-current={!q && c.view === current.view ? "page" : undefined}
                className={chipCls(!q && c.view === current.view)}
              >
                <c.icon size={14} /> {c.label}
                {b && <span className="opacity-55 tnum">{b.n}</span>}
              </a>
            );
          })}
        </nav>

        <div className="items-start gap-6 md:grid md:grid-cols-[12.5rem_minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="sticky top-6 hidden md:block" aria-label="Kategorien">
            {GROUPS.map((g) => (
              <div key={g} className="mb-4">
                <div className="mb-1 px-3">
                  <Label>{g}</Label>
                </div>
                {CATS.filter((c) => c.group === g).map((c) => {
                  const on = !q && c.view === current.view;
                  const b = badge(c);
                  return (
                    <a
                      key={c.view}
                      href={href({ page: "settings", view: c.view })}
                      onClick={() => setQuery("")}
                      aria-current={on ? "page" : undefined}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold ${on ? "bg-card text-ink shadow-seg" : "text-ink2 hover:bg-hover hover:text-ink"}`}
                    >
                      <c.icon size={16} className={on ? "text-accent" : "text-ink3"} />
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {b && (
                        <span
                          title={b.title}
                          className={`rounded-full px-1.5 text-[11px] leading-[18px] font-bold tnum ${b.accent ? "bg-accent-soft text-accent" : "bg-fill text-ink3"}`}
                        >
                          {b.n}
                        </span>
                      )}
                    </a>
                  );
                })}
              </div>
            ))}
            <p className="px-3 text-xs leading-relaxed text-ink3">
              Datenordner, Port und ffmpeg stehen in <span className="font-mono">compose.yaml</span> bzw. <span className="font-mono">.env</span>.
            </p>
          </aside>

          <div className="min-w-0 space-y-5">
            {settings.isError && <LoadError error={settings.error} retry={() => settings.refetch()} />}
            {results ? (
              <>
                <p className="text-sm text-ink2">{results.length ? `${hits} Treffer für „${query.trim()}“` : `Nichts gefunden für „${query.trim()}“.`}</p>
                {results.map((r) => body(r.c, r.only))}
              </>
            ) : (
              body(current)
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** Kopf einer Kategorie-Karte: Symbol, Gruppe, Titel, Beschreibung, rechts Zusatz */
function CatHead({ cat, title, does, aside }: { cat: Cat; title?: string; does?: string; aside?: ReactNode }) {
  const text = does ?? cat.does;
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 basis-64 gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <cat.icon size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <Label>{cat.group}</Label>
          <h2 className="text-lg font-bold">{title ?? cat.label}</h2>
          {text && <p className="mt-0.5 max-w-3xl text-sm leading-relaxed text-ink2">{text}</p>}
        </div>
      </div>
      {aside}
    </div>
  );
}

function SectionCard({ cat, only, changed }: { cat: Cat; only?: Set<string>; changed: number }) {
  const sec = section(cat.section!);
  return (
    <Card className="p-4 sm:p-5">
      <CatHead
        cat={cat}
        title={sec.title}
        does={sec.does}
        aside={changed > 0 && <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-bold text-accent">{changed} geändert</span>}
      />
      <SectionForm id={sec.id} instant columns only={only} />
      {sec.id === "notify" && !only && <NotifyTest />}
    </Card>
  );
}

function PrintersPanel({ printers, live }: { printers: UseQueryResult<PrinterT[]>; live?: PrinterLive[] }) {
  const [edit, setEdit] = useState<PrinterT | "neu" | null>(null);
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <Card className="p-4 sm:p-5">
        <CatHead
          cat={CATS[0]!}
          aside={
            <Button kind="primary" onClick={() => setEdit("neu")}>
              <Plus size={15} /> Drucker
            </Button>
          }
        />
        {printers.isError ? (
          <LoadError error={printers.error} retry={() => printers.refetch()} />
        ) : printers.isPending ? (
          <div className="skeleton h-16 rounded-xl" />
        ) : !printers.data.length ? (
          <p className="rounded-xl bg-fill px-4 py-6 text-center text-sm text-ink2">Noch kein Drucker eingerichtet.</p>
        ) : (
          <div className="grid gap-2 2xl:grid-cols-2">
            {printers.data.map((p) => {
              const l = live?.find((x) => x.id === p.id);
              return (
                <button key={p.id} onClick={() => setEdit(p)} className="flex items-center gap-3 rounded-xl bg-fill px-3.5 py-3 text-left hover:bg-hover" aria-label={`${p.name} bearbeiten`}>
                  {l && <StateDot live={l} />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{p.name}</div>
                    <div className="truncate text-xs text-ink3">
                      {PRINTER_MODELS.find((m) => m.id === p.model)?.label} · {p.host} · {p.serial}
                    </div>
                    <div className="truncate text-xs text-ink2">
                      {l ? stateLabel(l.state) : "…"}
                      {l?.error && !l.connected ? ` · ${l.error}` : ""}
                      {p.plug ? " · mit Steckdose" : ""}
                    </div>
                  </div>
                  <Pencil size={15} className="shrink-0 text-ink3" />
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-4 text-sm leading-relaxed text-ink2 sm:p-5">
        <Label>So klappt die Verbindung</Label>
        <p>
          Die App spricht den Drucker direkt im Heimnetz an, ohne Bambu-Cloud: MQTT (Port 8883) für Status und Befehle, FTPS (990) für den Upload, Kamera über Port
          6000 (A1, P1) bzw. 322 (X1, H2, P2S).
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
            eingeschaltetem <b>Entwicklermodus</b> an. Status, Kamera, Verlauf und das Licht gehen auch ohne.
          </li>
          <li>Der Zugangscode ändert sich, wenn der LAN-Modus neu eingeschaltet wird. Dann hier neu eintragen.</li>
        </ul>
      </Card>
      {edit && <PrinterDialog p={edit === "neu" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function SetupCard({ done }: { done: boolean }) {
  return (
    <Card className="p-4 sm:p-5">
      <CatHead cat={CATS.find((c) => c.view === "app")!} />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-fill px-4 py-3">
        <p className="text-sm text-ink2">{done ? "Eingerichtet. Der Assistent lässt sich jederzeit noch einmal durchgehen." : "Noch nicht abgeschlossen."}</p>
        <a href={href({ page: "setup" })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-semibold text-on-accent">
          <Wand2 size={15} /> Assistent öffnen
        </a>
      </div>
    </Card>
  );
}

function PrinterDialog({ p, onClose }: { p: PrinterT | null; onClose: () => void }) {
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

/** Testmeldung an alle eingetragenen Kanäle, Ergebnis je Kanal */
function NotifyTest() {
  const t = useMutation({ mutationFn: api.notifyTest });
  const names: Record<string, string> = { ntfy: "ntfy", gotify: "Gotify", webhook: "Webhook" };
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-sep pt-4">
      <Button onClick={() => t.mutate()} busy={t.isPending}>
        <BellRing size={15} /> Testmeldung senden
      </Button>
      {t.isError && <span className="text-sm text-bad">{(t.error as Error).message}</span>}
      {t.data?.map((r) => (
        <span key={r.channel} className={`text-sm ${r.ok ? "text-good" : "text-bad"}`}>
          {names[r.channel] ?? r.channel}: {r.ok ? "gesendet" : r.error}
        </span>
      ))}
    </div>
  );
}
