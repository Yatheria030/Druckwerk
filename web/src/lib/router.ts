import { useEffect, useState } from "react";

export type FilamentView = "regal" | "spulen" | "katalog";

export type Route =
  | { page: "library" }
  | { page: "model"; id: number }
  | { page: "printer"; view?: "fehlercodes" }
  | { page: "filament"; view?: FilamentView; brand?: string; spool?: number }
  | { page: "history" }
  | { page: "settings" }
  | { page: "setup"; step?: number };

/** Marke als Pfadstück: „Bambu Lab“ → bambu-lab */
export const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function parse(hash: string): Route {
  const p = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (p[0] === "modell" && Number(p[1]) > 0) return { page: "model", id: Number(p[1]) };
  if (p[0] === "bibliothek") return { page: "library" };
  if (p[0] === "filament") {
    // #/filament[/spulen|/katalog[/<marke>]][/<spule>]
    const rest = p.slice(1);
    const spool = Number(rest.at(-1)) > 0 ? Number(rest.pop()) : undefined;
    const view = rest[0] === "spulen" || rest[0] === "katalog" ? rest[0] : "regal";
    return { page: "filament", view, brand: view === "katalog" && rest[1] ? decodeURIComponent(rest[1]) : undefined, spool };
  }
  if (p[0] === "verlauf") return { page: "history" };
  if (p[0] === "fehlercodes") return { page: "printer", view: "fehlercodes" };
  if (p[0] === "einstellungen") return { page: "settings" };
  if (p[0] === "start") return { page: "setup", step: Number(p[1]) > 0 ? Number(p[1]) : undefined };
  return { page: "printer" }; // Start: Drucker mit Übersicht
}

export function href(r: Route): string {
  if (r.page === "model") return `#/modell/${r.id}`;
  if (r.page === "filament") {
    const v = r.view && r.view !== "regal" ? `/${r.view}` : "";
    const b = r.view === "katalog" && r.brand ? `/${encodeURIComponent(r.brand)}` : "";
    return `#/filament${v}${b}${r.spool ? `/${r.spool}` : ""}`;
  }
  if (r.page === "printer" && r.view) return `#/${r.view}`;
  if (r.page === "setup") return `#/start${r.step ? `/${r.step}` : ""}`;
  return r.page === "library" ? "#/bibliothek" : r.page === "history" ? "#/verlauf" : r.page === "settings" ? "#/einstellungen" : "#/";
}

export const go = (r: Route) => (location.hash = href(r));

export function useRoute() {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const key = (r: Route) => JSON.stringify(r.page === "filament" ? { ...r, spool: undefined } : r);
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
