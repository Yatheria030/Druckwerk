// Farbkatalog aus der Datenbank: einmal laden, in den gemeinsamen Speicher (shared/catalog.ts) legen, damit Farbnamen und
// Sortenauswahl damit rechnen. Komponenten, die den Katalog nutzen, rufen den Hook, damit sie bei Änderungen neu zeichnen.
import { useQuery } from "@tanstack/react-query";
import { getCatalog, setCatalog } from "../../../shared/catalog.ts";
import { api } from "../api.ts";

export function useCatalog() {
  const q = useQuery({ queryKey: ["catalog"], queryFn: api.catalog, staleTime: 5 * 60_000 });
  if (q.data && getCatalog() !== q.data) setCatalog(q.data);
  return q;
}
