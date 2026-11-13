import { useQuery } from "@tanstack/react-query";
import { field, type SectionId, type SettingValue } from "../../../shared/settings.ts";
import { api } from "../api.ts";

export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: api.settings, staleTime: 60_000 });

/** Wirksamer Wert einer Einstellung; bis die Antwort da ist, der eingebaute Standard */
export function useSetting<T extends SettingValue>(id: SectionId, key: string): T {
  const st = useSettings();
  return (st.data?.sections[id]?.[key]?.effective ?? field(id, key)?.default) as T;
}
