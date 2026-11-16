// Wartung je Drucker: fällig nach Druckstunden (aus dem Verlauf plus Stunden vor Druckwerk) und/oder nach Tagen.
export type MaintTask = {
  id: number;
  printer_id: number;
  name: string;
  interval_h: number | null;
  interval_d: number | null;
  done_hours: number; // Druckstunden beim letzten Erledigen (beim Anlegen: Stand von da)
  done_at: string;
  note: string;
  created_at: string;
};
export type MaintTaskInput = Pick<MaintTask, "name" | "interval_h" | "interval_d" | "note">;

export type MaintStatus = MaintTask & {
  hours_since: number;
  days_since: number;
  /** Anteil des Intervalls (größerer von Stunden und Tagen), 1 = fällig */
  ratio: number;
  due: boolean;
  soon: boolean;
};

export type MaintPrinter = { printer_id: number; name: string; hours: number; hours_base: number; tasks: MaintStatus[] };

/** Ab diesem Anteil gilt ein Punkt als „bald fällig“ */
export const SOON = 0.9;

/** Vorschläge zum schnellen Anlegen; Richtwerte, der Nutzer passt sie an sein Gerät an */
export const SUGGESTIONS: MaintTaskInput[] = [
  { name: "Druckplatte gründlich reinigen", interval_h: 50, interval_d: null, note: "Mit Spülmittel und warmem Wasser, nicht nur Alkohol." },
  { name: "Düse und Hotend prüfen", interval_h: 200, interval_d: null, note: "Ablagerungen, Verstopfung, Silikonsocke." },
  { name: "Achsen reinigen und schmieren", interval_h: 200, interval_d: null, note: "Führungen abwischen, Fett laut Handbuch." },
  { name: "Riemenspannung prüfen", interval_h: 500, interval_d: null, note: "" },
  { name: "Düsenabstreifer prüfen", interval_h: 300, interval_d: null, note: "" },
  { name: "Aktivkohlefilter tauschen", interval_h: 720, interval_d: null, note: "" },
  { name: "AMS-Trockenmittel tauschen", interval_h: null, interval_d: 30, note: "Oder wenn die Feuchte steigt." },
];

export function maintStatus(t: MaintTask, hours: number, now = Date.now()): MaintStatus {
  const hours_since = Math.max(0, hours - t.done_hours);
  const days_since = Math.max(0, (now - Date.parse(t.done_at)) / 86_400_000);
  const ratio = Math.max(t.interval_h ? hours_since / t.interval_h : 0, t.interval_d ? days_since / t.interval_d : 0);
  return { ...t, hours_since, days_since, ratio, due: ratio >= 1, soon: ratio >= SOON && ratio < 1 };
}
