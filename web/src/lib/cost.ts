import { useQuery } from "@tanstack/react-query";
import { estimatePerG, fmtMoney, type Plate, type PrintJob, type Spool } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { useSetting } from "./settings.ts";

export type PlateCost = { filament: number | null; energy: number | null; total: number | null; exact: boolean; perPiece: number | null };

/**
 * Kosten einer Platte vorab: Gramm je Filament × Preis je Gramm (Spule im gewählten Fach, sonst Schätzung über Material und Farbe),
 * dazu Strom aus Druckdauer × eingestellter Leistung. spoolOf liefert die Spule je Filament-ID, wenn bekannt.
 */
export function plateCost(plate: Plate, spools: Spool[], kwh: number | null, watts: number | null, spoolOf?: (filamentId: number) => number | null): PlateCost {
  let filament: number | null = null;
  let exact = plate.filaments.length > 0;
  for (const f of plate.filaments) {
    if (!f.used_g) continue;
    const e = estimatePerG(spools, f.type, f.color, spoolOf?.(f.id));
    if (!e) {
      exact = false;
      continue;
    }
    filament = (filament ?? 0) + f.used_g * e.perG;
    exact &&= e.exact;
  }
  const energy = kwh != null && watts && plate.prediction_s ? ((watts * plate.prediction_s) / 3600 / 1000) * kwh : null;
  const total = filament == null && energy == null ? null : (filament ?? 0) + (energy ?? 0);
  const n = plate.objects ?? 0;
  return { filament, energy, total, exact: exact && filament != null, perPiece: total != null && n >= 1 ? total / n : null };
}

/** Kosten eines gelaufenen Drucks (Filament + Strom), null ohne Preise */
export const printCost = (p: PrintJob) => (p.cost_filament == null && p.cost_energy == null ? null : (p.cost_filament ?? 0) + (p.cost_energy ?? 0));

/** Alles, was die Kostenrechnung in der Oberfläche braucht */
export function useCostBasis() {
  const spools = useQuery({ queryKey: ["spools"], queryFn: api.spools });
  const currency = useSetting<string>("filament", "currency");
  const kwh = useSetting<number | null>("kosten", "kwh_price");
  const watts = useSetting<number | null>("kosten", "watts");
  return { spools: spools.data ?? [], currency, kwh, watts, money: (v: number) => fmtMoney(v, currency) };
}
