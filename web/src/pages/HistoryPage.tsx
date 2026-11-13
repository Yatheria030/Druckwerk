import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fmtDuration, type PrintJob } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { PageHeader } from "../App.tsx";
import { Card, Label, LoadError } from "../ui/controls.tsx";
import { PrintRow } from "../ui/PrintRow.tsx";

const FILTER: { k: "" | PrintJob["status"]; label: string }[] = [
  { k: "", label: "Alle" },
  { k: "fertig", label: "Fertig" },
  { k: "fehler", label: "Fehler" },
  { k: "abgebrochen", label: "Abgebrochen" },
];

export function HistoryPage() {
  const q = useQuery({ queryKey: ["prints"], queryFn: api.prints, refetchInterval: 20_000 });
  const [f, setF] = useState<"" | PrintJob["status"]>("");
  const list = useMemo(() => (q.data ?? []).filter((p) => !f || p.status === f), [q.data, f]);
  const stats = useMemo(() => {
    const d = q.data ?? [];
    const done = d.filter((p) => p.status === "fertig");
    const ended = d.filter((p) => p.status !== "laeuft");
    return {
      count: d.length,
      hours: done.reduce((s, p) => s + (p.duration_s ?? 0), 0),
      rate: ended.length ? Math.round((done.length / ended.length) * 100) : null,
    };
  }, [q.data]);

  return (
    <>
      <PageHeader width="max-w-4xl" title="Verlauf" />
      <div className="mx-auto max-w-4xl space-y-5 px-4 sm:px-6">
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ["Drucke", String(stats.count)],
              ["Druckzeit", fmtDuration(stats.hours)],
              ["Erfolg", stats.rate == null ? "–" : `${stats.rate} %`],
            ] as const
          ).map(([k, v]) => (
            <Card key={k} className="px-4 py-3">
              <Label>{k}</Label>
              <div className="mt-1 text-xl font-extrabold tnum sm:text-2xl">{v}</div>
            </Card>
          ))}
        </div>
        <div className="-my-0.5 flex gap-2 overflow-x-auto py-0.5">
          {FILTER.map((x) => (
            <button
              key={x.k}
              onClick={() => setF(x.k)}
              className={`h-8 shrink-0 rounded-full px-3 text-[13px] font-semibold ${f === x.k ? "bg-ink text-bg" : "bg-card text-ink2 shadow-seg"}`}
            >
              {x.label}
            </button>
          ))}
        </div>
        {q.isError ? (
          <LoadError error={q.error} retry={() => q.refetch()} />
        ) : (
          <Card className="px-4">
            {q.isPending ? (
              <div className="skeleton my-4 h-20 rounded-xl" />
            ) : !list.length ? (
              <div className="py-10 text-center text-sm text-ink3">
                {q.data.length ? "Keine Drucke in dieser Auswahl." : "Noch keine Drucke. Jeder Druck auf einem verbundenen Drucker landet automatisch hier."}
              </div>
            ) : (
              <div className="divide-y divide-sep">
                {list.map((p) => (
                  <PrintRow key={p.id} p={p} showModel />
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
