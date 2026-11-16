import { useEffect, useState } from "react";

/** Kategorien der Einstellungen (#/einstellungen/<view>), Standard „drucker“ */
export const SETTINGS_VIEWS = ["drucker", "filament", "kosten", "archiv", "benachrichtigungen", "import", "makerworld", "app"] as const;
export type SettingsView = (typeof SETTINGS_VIEWS)[number];

export type FilamentView = "regal" | "spulen" | "einkauf" | "katalog" | "kennwerte" | "preise" | "etiketten";

export type Route =
  | { page: "library"; collection?: number }
  | { page: "model"; id: number }
  | { page: "printables"; id?: string }
  | { page: "makerworld"; id?: string }
  | { page: "printer"; view?: "fehlercodes" | "wartung" }
  | { page: "filament"; view?: FilamentView; brand?: string; line?: string; material?: string; spool?: number }
  | { page: "history"; view?: "statistik" }
  | { page: "settings"; view?: SettingsView }
  | { page: "setup"; step?: number };

/** Marke als Pfadstück: „Bambu Lab“ → bambu-lab */
export const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function parse(hash: string): Route {
  const p = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (p[0] === "modell" && Number(p[1]) > 0) return { page: "model", id: Number(p[1]) };
  if (p[0] === "bibliothek" && (p[1] === "printables" || p[1] === "makerworld")) {
    const page = p[1];
    return /^\d+$/.test(p[2] ?? "") ? { page, id: p[2] } : { page };
  }
  if (p[0] === "bibliothek") return p[1] === "sammlung" && Number(p[2]) > 0 ? { page: "library", collection: Number(p[2]) } : { page: "library" };
  if (p[0] === "filament") {
    // #/filament[/spulen|/einkauf|/etiketten|/preise|/katalog[/<marke>]|/kennwerte[/material/<mat>|/<marke>/<sorte>]][/<spule>]
    const rest = p.slice(1);
    const spool = Number(rest.at(-1)) > 0 ? Number(rest.pop()) : undefined;
    const view = (["spulen", "katalog", "kennwerte", "preise", "einkauf", "etiketten"] as const).find((v) => v === rest[0]) ?? "regal";
    const d = (s?: string) => (s ? decodeURIComponent(s) : undefined);
    if (view === "kennwerte")
      return rest[1] === "material" ? { page: "filament", view, material: d(rest[2]), spool } : { page: "filament", view, brand: d(rest[1]), line: d(rest[2]), spool };
    return { page: "filament", view, brand: view === "katalog" ? d(rest[1]) : undefined, spool };
  }
  if (p[0] === "verlauf") return p[1] === "statistik" ? { page: "history", view: "statistik" } : { page: "history" };
  if (p[0] === "fehlercodes") return { page: "printer", view: "fehlercodes" };
  if (p[0] === "wartung") return { page: "printer", view: "wartung" };
  if (p[0] === "einstellungen") return { page: "settings", view: SETTINGS_VIEWS.find((v) => v === p[1]) };
  if (p[0] === "start") return { page: "setup", step: Number(p[1]) > 0 ? Number(p[1]) : undefined };
  return { page: "printer" }; // Start: Drucker mit Übersicht
}

export function href(r: Route): string {
  if (r.page === "model") return `#/modell/${r.id}`;
  if (r.page === "printables" || r.page === "makerworld") return `#/bibliothek/${r.page}${r.id ? `/${r.id}` : ""}`;
  if (r.page === "filament") {
    const v = r.view && r.view !== "regal" ? `/${r.view}` : "";
    const e = encodeURIComponent;
    const b =
      r.view === "kennwerte"
        ? r.material ? `/material/${e(r.material)}` : r.brand && r.line ? `/${e(r.brand)}/${e(r.line)}` : ""
        : r.view === "katalog" && r.brand ? `/${e(r.brand)}` : "";
    return `#/filament${v}${b}${r.spool ? `/${r.spool}` : ""}`;
  }
  if (r.page === "printer" && r.view) return `#/${r.view}`;
  if (r.page === "history" && r.view) return `#/verlauf/${r.view}`;
  if (r.page === "settings" && r.view && r.view !== "drucker") return `#/einstellungen/${r.view}`;
  if (r.page === "setup") return `#/start${r.step ? `/${r.step}` : ""}`;
  if (r.page === "library" && r.collection) return `#/bibliothek/sammlung/${r.collection}`;
  return r.page === "library" ? "#/bibliothek" : r.page === "history" ? "#/verlauf" : r.page === "settings" ? "#/einstellungen" : "#/";
}

export const go = (r: Route) => (location.hash = href(r));

export function useRoute() {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const key = (r: Route) => JSON.stringify(r.page === "filament" ? { ...r, spool: undefined } : r.page === "printables" || r.page === "makerworld" ? { page: r.page } : r);
    let page = key(parse(location.hash));
    const on = () => {
      const next = parse(location.hash);
      setRoute(next);
      // Dialoge innerhalb einer Seite (Spule öffnen) behalten die Scrollposition
      if (key(next) !== page) window.scrollTo(0, 0);
      page = key(next);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
