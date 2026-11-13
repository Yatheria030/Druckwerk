import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { api } from "../api.ts";
import { PageHeader, useLive } from "../App.tsx";
import { errorKey, hmsKey, moduleOf, MODULES, useHms, type HmsKind } from "../lib/hms.ts";
import { chipCls } from "../ui/FilamentTabs.tsx";
import { Card, Label, LoadError } from "../ui/controls.tsx";
import { levelOf, NO_TEXT, TONE_TAG, WikiCode } from "../ui/hms.tsx";
import { PrinterTabs } from "../ui/PrinterTabs.tsx";

const WIDTH = "max-w-4xl";
const PAGE = 100;

type Entry = { key: string; kind: HmsKind; text: string; module: string };

function Row({ e, at, printer }: { e: Entry; at?: string | null; printer?: string }) {
  const lv = levelOf(e.key, e.kind);
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${TONE_TAG[lv.tone]}`}>{lv.label}</span>
        <WikiCode k={e.key} kind={e.kind} />
        <span className="text-xs text-ink3">
          {e.kind === "error" ? "Druckfehler" : "HMS"} · {e.module}
          {printer ? ` · ${printer}` : ""}
          {at ? ` · ${at.slice(8, 10)}.${at.slice(5, 7)}. ${at.slice(11, 16)}` : ""}
        </span>
      </div>
      <p className={`mt-1 text-sm ${e.text ? "text-ink2" : "text-ink3 italic"}`}>{e.text || NO_TEXT}</p>
    </div>
  );
}

export function HmsPage() {
  const hms = useHms();
  const live = useLive();
  const printers = useQuery({ queryKey: ["printers"], queryFn: api.printers });
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"" | HmsKind>("");
  const [mod, setMod] = useState("");
  const [shown, setShown] = useState(PAGE);
  const dq = useDeferredValue(q.trim().toLowerCase());

  const all = useMemo<Entry[]>(() => {
    if (!hms.data) return [];
    // Rein numerische Schlüssel (10014001) zieht JavaScript vor, darum selbst sortieren
    const rows = (k: HmsKind) =>
      Object.entries(hms.data[k])
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, text]) => ({ key, kind: k, text, module: moduleOf(key) }));
    return [...rows("hms"), ...rows("error")];
  }, [hms.data]);

  // Gerade am Drucker gemeldet, auch Codes, die Bambus Liste nicht kennt
  const current = useMemo(
    () =>
      (live.data ?? []).flatMap((p) => {
        const name = printers.data?.find((x) => x.id === p.id)?.name ?? "Drucker";
        return [
        ...p.hms.map((h) => {
          const key = hmsKey(h.code);
          return { e: { key, kind: "hms" as const, text: hms.data?.hms[key] ?? "", module: moduleOf(key) }, at: h.at, printer: name };
        }),
        ...(p.print_error
          ? [(() => {
              const key = errorKey(p.print_error);
              return { e: { key, kind: "error" as const, text: hms.data?.error[key] ?? "", module: moduleOf(key) }, at: null, printer: name };
            })()]
          : []),
        ];
      }),
    [live.data, hms.data, printers.data],
  );
  const many = (live.data?.length ?? 0) > 1;

  const byKind = useMemo(() => all.filter((e) => !kind || e.kind === kind), [all, kind]);
  const list = useMemo(() => {
    const hex = dq.replace(/[\s_-]/g, "").toUpperCase();
    const code = hex.length >= 3 && /^[0-9A-F]+$/.test(hex);
    return byKind.filter((e) => (!mod || e.module === mod) && (!dq || e.text.toLowerCase().includes(dq) || (code && e.key.includes(hex))));
  }, [byKind, mod, dq]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const e of byKind) c.set(e.module, (c.get(e.module) ?? 0) + 1);
    return c;
  }, [byKind]);
  const modules = [...MODULES.map(([, m]) => m), "Sonstiges"].filter((m) => counts.has(m));
  const ver = hms.data ? String(hms.data.ver) : "";

  const reset = <T,>(set: (v: T) => void) => (v: T) => (set(v), setShown(PAGE));

  return (
    <>
      <PageHeader
        width={WIDTH}
        title="Fehlercodes"
        sub={
          hms.data &&
          `${Object.keys(hms.data.hms).length.toLocaleString("de-DE")} HMS-Meldungen und ${Object.keys(hms.data.error).length} Druckfehler aller Bambu-Drucker, Stand ${ver.slice(6, 8)}.${ver.slice(4, 6)}.${ver.slice(0, 4)}`
        }
      />
      <PrinterTabs view="errors" width={WIDTH} />
      <div className={`mx-auto ${WIDTH} space-y-5 px-4 sm:px-6`}>
        {hms.isError ? (
          <LoadError error={hms.error} retry={() => hms.refetch()} />
        ) : hms.isPending ? (
          <div className="skeleton h-96 rounded-2xl" />
        ) : (
          <>
            {current.length > 0 && (
              <section className="space-y-2">
                <Label>Gerade am Drucker</Label>
                <Card className="divide-y divide-sep">
                  {current.map((c) => (
                    <Row key={`${c.printer}-${c.e.key}`} e={c.e} at={c.at} printer={many ? c.printer : undefined} />
                  ))}
                </Card>
              </section>
            )}

            <div className="space-y-3">
              <label className="flex h-10 items-center gap-2 rounded-xl bg-card px-3 shadow-seg focus-within:shadow-[0_0_0_2px_var(--c-accent)]">
                <Search size={16} className="shrink-0 text-ink3" />
                <input
                  className="field text-[15px]"
                  placeholder="Code oder Stichwort suchen"
                  value={q}
                  onChange={(e) => reset(setQ)(e.target.value)}
                />
                {q && (
                  <button onClick={() => reset(setQ)("")} className="text-ink3 hover:text-ink" aria-label="Suche leeren">
                    <X size={16} />
                  </button>
                )}
              </label>
              <div className="-mx-4 -mt-0.5 flex gap-2 overflow-x-auto px-4 py-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
                {(
                  [
                    ["", "Alle"],
                    ["hms", "HMS"],
                    ["error", "Druckfehler"],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} className={chipCls(kind === k)} onClick={() => reset(setKind)(k)}>
                    {l}
                  </button>
                ))}
                <span className="w-px shrink-0 self-stretch bg-sep" />
                <button className={chipCls(!mod)} onClick={() => reset(setMod)("")}>
                  Alle Bereiche
                </button>
                {modules.map((m) => (
                  <button key={m} className={chipCls(mod === m)} onClick={() => reset(setMod)(mod === m ? "" : m)}>
                    {m} <span className="opacity-55">{counts.get(m)}</span>
                  </button>
                ))}
              </div>
            </div>

            <section className="space-y-2">
              <Label>{list.length === all.length ? "Alle Codes" : `${list.length.toLocaleString("de-DE")} Treffer`}</Label>
              {list.length ? (
                <Card className="divide-y divide-sep">
                  {list.slice(0, shown).map((e) => (
                    <Row key={e.kind + e.key} e={e} />
                  ))}
                  {list.length > shown && (
                    <button onClick={() => setShown((s) => s + PAGE)} className="w-full px-4 py-3 text-sm font-semibold text-accent hover:bg-hover">
                      Weitere {Math.min(PAGE, list.length - shown)} von {(list.length - shown).toLocaleString("de-DE")} anzeigen
                    </button>
                  )}
                </Card>
              ) : (
                <Card className="p-8 text-center text-sm text-ink2">Kein Code passt zur Suche.</Card>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
