import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { stockStatus } from "../../../shared/stock.ts";
import { api } from "../api.ts";
import { useCatalog } from "./catalog.ts";

/** Mindestbestände mit aktuellem Bestand; `low` = Einträge der Einkaufsliste */
export function useStock() {
  const rules = useQuery({ queryKey: ["stock"], queryFn: api.stockRules, staleTime: 30_000 });
  const spools = useQuery({ queryKey: ["spools"], queryFn: api.spools, staleTime: 15_000 });
  const cat = useCatalog(); // Shop-Link aus dem Katalog
  const list = useMemo(() => stockStatus(rules.data ?? [], spools.data ?? []), [rules.data, spools.data, cat.data]);
  return { rules, spools, list, low: list.filter((x) => x.low) };
}
