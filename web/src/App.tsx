import { useQuery } from "@tanstack/react-query";
import { Component, useEffect, useRef, type ReactNode } from "react";
import { Box, Disc3, History, Printer, Settings } from "lucide-react";
import { api } from "./api.ts";
import { useCatalog } from "./lib/catalog.ts";
import { go, href, slug, useRoute, type Route } from "./lib/router.ts";
import { Library } from "./pages/Library.tsx";
import { ModelPage } from "./pages/ModelPage.tsx";
import { PrinterPage } from "./pages/PrinterPage.tsx";
import { FilamentPage } from "./pages/FilamentPage.tsx";
import { HistoryPage } from "./pages/HistoryPage.tsx";
import { HmsPage } from "./pages/HmsPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { SetupPage } from "./pages/SetupPage.tsx";
import { useSettings } from "./lib/settings.ts";
import { StateDot } from "./ui/printer.tsx";
import { UploadPanel } from "./ui/Uploads.tsx";

export const useLive = (fast = false) =>
  useQuery({ queryKey: ["live"], queryFn: api.live, refetchInterval: fast ? 2000 : 8000, refetchOnWindowFocus: true });

const NAV: { route: Route; label: string; icon: typeof Box }[] = [
  { route: { page: "printer" }, label: "Drucker", icon: Printer },
  { route: { page: "filament" }, label: "Filament", icon: Disc3 },
  { route: { page: "library" }, label: "Bibliothek", icon: Box },
  { route: { page: "history" }, label: "Verlauf", icon: History },
  { route: { page: "settings" }, label: "Einstellungen", icon: Settings },
];

class PageBoundary extends Component<{ children: ReactNode; k: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { k: string }) {
    if (prev.k !== this.props.k && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="p-8 text-center">
        <div className="font-semibold">Die Seite ist abgestürzt</div>
        <div className="mt-1 text-sm text-ink2">{this.state.error.message}</div>
      </div>
    );
  }
}

export function App() {
  const route = useRoute();
  const live = useLive();
  const p = live.data?.[0];
  const active = (r: Route) => r.page === route.page || (r.page === "library" && route.page === "model") || (r.page === "settings" && route.page === "setup");
  const catalog = useCatalog();
  // Erster Start ohne Daten: einmal zum Assistenten (danach jederzeit über die Einstellungen)
  const settings = useSettings();
  const routed = useRef(false);
  useEffect(() => {
    if (routed.current || !settings.data) return;
    routed.current = true;
    if (settings.data.setup.needed && route.page !== "setup") go({ page: "setup" });
  }, [settings.data, route.page]);
  const fv = route.page === "filament" ? (route.view ?? "regal") : null;
  const sub = (on: boolean) => `flex h-8 items-center gap-2 rounded-lg pr-2.5 text-[13px] font-semibold ${on ? "text-accent" : "text-ink3 hover:bg-hover hover:text-ink"}`;

  return (
    <div className="min-h-dvh md:pl-56">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-sep bg-[var(--c-sidebar)] px-3 py-5 md:flex">
        <a href="#/" className="mb-6 flex items-center gap-2.5 px-2">
          <img src="/icon.svg" alt="" className="size-8" />
          <span className="text-[15px] font-extrabold tracking-tight">Druckwerk</span>
        </a>
        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ route: r, label, icon: Icon }) => (
            <div key={label}>
              <a
                href={href(r)}
                className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-semibold ${active(r) ? "bg-selected text-accent" : "text-ink2 hover:bg-hover hover:text-ink"}`}
              >
                <Icon size={17} strokeWidth={2.2} />
                {label}
              </a>
              {/* Drucker: Übersicht und Fehlercodes */}
              {r.page === "printer" && active(r) && (
                <div className="mt-0.5 mb-1 ml-[1.15rem] flex flex-col border-l border-sep pl-2.5">
                  <a href={href({ page: "printer" })} className={sub(route.page === "printer" && !route.view) + " pl-2"}>
                    Übersicht
                  </a>
                  <a href={href({ page: "printer", view: "fehlercodes" })} className={sub(route.page === "printer" && route.view === "fehlercodes") + " pl-2"}>
                    Fehlercodes
                  </a>
                </div>
              )}
              {/* Filament: Unterseiten, im Katalog zusätzlich die Marken aus der Datenbank */}
              {r.page === "filament" && fv && (
                <div className="mt-0.5 mb-1 ml-[1.15rem] flex flex-col border-l border-sep pl-2.5">
                  {(
                    [
                      ["regal", "Regal"],
                      ["spulen", "Spulen"],
                      ["katalog", "Katalog"],
                    ] as const
                  ).map(([v, l]) => (
                    <div key={v}>
                      <a href={href({ page: "filament", view: v })} className={sub(fv === v && !(v === "katalog" && route.page === "filament" && route.brand)) + " pl-2"}>
                        {l}
                      </a>
                      {v === "katalog" && fv === "katalog" && (
                        <div className="flex flex-col">
                          {catalog.data?.map((b) => (
                            <a
                              key={b.id}
                              href={href({ page: "filament", view: "katalog", brand: slug(b.brand) })}
                              className={sub(route.page === "filament" && route.brand === slug(b.brand)) + " pl-5"}
                            >
                              <span className="truncate">{b.brand}</span>
                              <span className="ml-auto text-[11px] font-medium text-ink3 tnum">{b.lines.length}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        {p && (
          <a href={href({ page: "printer" })} className="mt-auto rounded-xl bg-fill px-3 py-2.5 text-xs hover:bg-fill2">
            <div className="flex items-center gap-2 font-semibold">
              <StateDot live={p} />
              <span className="truncate">{live.data!.length > 1 ? `${live.data!.length} Drucker` : "Drucker"}</span>
            </div>
            {p.ams.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {p.ams.flatMap((u) => u.trays).map((t) => (
                  <span
                    key={t.id}
                    title={`${t.label} ${t.rfid || t.spool_id ? t.type : t.loaded ? "unbekannt" : "leer"}`}
                    className={`size-3 rounded-full ${t.active ? "ring-2 ring-accent ring-offset-1 ring-offset-[var(--c-fill)]" : ""} ${!t.rfid && !t.spool_id && t.loaded ? "border border-dashed border-ink3" : ""}`}
                    style={{
                      // Ohne Chip und ohne zugeordnete Spule ist die Fachfarbe nur die alte Einstellung: dann gestrichelt statt geraten
                      background: (t.rfid || t.spool_id) && t.color ? t.color : "transparent",
                      boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--c-ink) 22%, transparent)",
                    }}
                  />
                ))}
              </div>
            )}
            {p.state === "RUNNING" && p.percent != null && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-fill2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${p.percent}%` }} />
              </div>
            )}
          </a>
        )}
      </aside>

      <main className="pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-10">
        <PageBoundary k={JSON.stringify(route)}>
          {route.page === "library" && <Library />}
          {route.page === "model" && <ModelPage key={route.id} id={route.id} />}
          {route.page === "printer" && (route.view === "fehlercodes" ? <HmsPage /> : <PrinterPage />)}
          {route.page === "filament" && <FilamentPage view={route.view ?? "regal"} brand={route.brand} spoolId={route.spool} />}
          {route.page === "history" && <HistoryPage />}
          {route.page === "settings" && <SettingsPage />}
          {route.page === "setup" && <SetupPage step={route.step ?? 1} />}
        </PageBoundary>
      </main>

      <UploadPanel />

      <nav className="frost fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-sep bg-[var(--c-toolbar)] pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map(({ route: r, label, icon: Icon }) => (
          <a key={label} href={href(r)} className={`flex flex-col items-center gap-0.5 py-2 text-[10.5px] font-semibold ${active(r) ? "text-accent" : "text-ink3"}`}>
            <span className="relative">
              <Icon size={21} strokeWidth={2.1} />
              {r.page === "printer" && p && (
                <span className="absolute -top-0.5 -right-1">
                  <StateDot live={p} />
                </span>
              )}
            </span>
            {label}
          </a>
        ))}
      </nav>
    </div>
  );
}

/** Kopfzeile jeder Seite */
export function PageHeader({
  title,
  sub,
  children,
  back,
  width = "max-w-6xl 2xl:max-w-[88rem]",
}: { title: ReactNode; sub?: ReactNode; children?: ReactNode; back?: ReactNode; width?: string }) {
  return (
    <header className={`mx-auto flex ${width} flex-wrap items-end justify-between gap-3 px-4 pt-6 pb-4 sm:px-6 md:pt-8`}>
      <div className={sub ? "min-w-0 flex-1 basis-0" : "min-w-0"}>
        {back}
        <h1 className="truncate text-2xl font-extrabold tracking-tight sm:text-[28px]">{title}</h1>
        {sub && <div className="mt-1 text-sm text-ink2">{sub}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}
