// QR-Etiketten für Spulen: Der Code enthält den Link zur Spule (#/filament/<id>), die iPhone-Kamera öffnet ihn direkt.
// Ersatz für NFC, das iOS-Safari nicht kann. Gedruckt wird über den Browser, auf Etikettendrucker oder A4-Bogen.
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Printer, Search } from "lucide-react";
import qrcode from "qrcode-generator";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Spool } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { PageHeader } from "../App.tsx";
import { href } from "../lib/router.ts";
import { Button, Card, LoadError, Swatch } from "../ui/controls.tsx";
import { FilamentTabs } from "../ui/FilamentTabs.tsx";
import { fmtG, spoolSub, spoolTitle } from "../ui/spool.tsx";

type Format = { id: string; label: string; w: number; h: number; sheet?: { cols: number; rows: number } };
const FORMATS: Format[] = [
  { id: "50x30", label: "Etikett 50 × 30 mm", w: 50, h: 30 },
  { id: "62x29", label: "Endlos 62 × 29 mm", w: 62, h: 29 },
  { id: "a4", label: "A4-Bogen 70 × 37 mm", w: 70, h: 37, sheet: { cols: 3, rows: 8 } },
];

export const spoolLink = (id: number) => `${location.origin}/#/filament/${id}`;

/** QR-Code als SVG-Pfad (ein Pfad statt vieler Rechtecke, scharf in jeder Größe) */
export function Qr({ text, className, size }: { text: string; className?: string; size?: string }) {
  const { n, d } = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    let d = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
    return { n, d };
  }, [text]);
  return (
    <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} className={className} style={size ? { width: size, height: size } : undefined} shapeRendering="crispEdges" aria-label="QR-Code">
      <rect x={-1} y={-1} width={n + 2} height={n + 2} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

const temps = (s: Spool) =>
  [s.nozzle_min != null || s.nozzle_max != null ? `Düse ${[s.nozzle_min, s.nozzle_max].filter((x) => x != null).join("–")} °C` : "", s.bed_temp != null ? `Bett ${s.bed_temp} °C` : ""]
    .filter(Boolean)
    .join(" · ");

/** Ein Etikett in echter Größe (mm), schwarz auf weiß unabhängig vom Farbschema */
function Label({ s, f }: { s: Spool; f: Format }) {
  const qr = Math.min(f.h - 4, f.w * 0.45);
  return (
    <div
      className="flex items-center overflow-hidden bg-white text-black"
      style={{ width: `${f.w}mm`, height: `${f.h}mm`, padding: "2mm", gap: "2mm", fontFamily: "Manrope Variable, sans-serif" }}
    >
      <Qr text={spoolLink(s.id)} className="shrink-0" size={`${qr}mm`} />
      <div className="flex min-w-0 flex-1 flex-col justify-center" style={{ gap: "0.6mm", lineHeight: 1.15 }}>
        <div className="truncate font-bold tracking-wide uppercase" style={{ fontSize: "2.1mm", color: "#555" }}>
          {s.brand || s.material}
        </div>
        <div lang="de" className="line-clamp-2 font-extrabold break-words hyphens-auto" style={{ fontSize: f.h > 32 ? "3.6mm" : "3.2mm" }}>
          {spoolTitle(s)}
        </div>
        <div className="flex min-w-0 items-center" style={{ gap: "1mm", fontSize: "2.4mm" }}>
          {/^#[0-9a-f]{6}$/i.test(s.color) && (
            <span className="shrink-0 rounded-full" style={{ width: "2.6mm", height: "2.6mm", background: s.color, boxShadow: "0 0 0 0.2mm #0004 inset" }} />
          )}
          <span className="truncate">{s.color_name && s.name ? s.name : s.material}</span>
        </div>
        {temps(s) && (
          <div className="truncate" style={{ fontSize: "2.1mm", color: "#444" }}>
            {temps(s)}
          </div>
        )}
        <div className="font-bold tabular-nums" style={{ fontSize: "2.1mm", color: "#555" }}>
          Spule #{s.id}
        </div>
      </div>
    </div>
  );
}

/** Druckbereich: nur er erscheint beim Drucken, mit passender Seitengröße */
function PrintSheet({ list, f }: { list: Spool[]; f: Format }) {
  const page = f.sheet ? "size: A4; margin: 0" : `size: ${f.w}mm ${f.h}mm; margin: 0`;
  return createPortal(
    <div id="print-root">
      <style>{`@page { ${page} }`}</style>
      {f.sheet ? (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${f.sheet.cols}, ${f.w}mm)`, gridAutoRows: `${f.h}mm`, paddingTop: `${(297 - f.sheet.rows * f.h) / 2}mm` }}>
          {list.map((s) => (
            <div key={s.id} style={{ breakInside: "avoid" }}>
              <Label s={s} f={f} />
            </div>
          ))}
        </div>
      ) : (
        list.map((s) => (
          <div key={s.id} style={{ breakAfter: "page" }}>
            <Label s={s} f={f} />
          </div>
        ))
      )}
    </div>,
    document.body,
  );
}

export function LabelsPage({ spoolId }: { spoolId?: number }) {
  const q = useQuery({ queryKey: ["spools"], queryFn: api.spools });
  const [fmt, setFmt] = useState(() => {
    try {
      return localStorage.getItem("labels.format") ?? "50x30";
    } catch {
      return "50x30";
    }
  });
  const f = FORMATS.find((x) => x.id === fmt) ?? FORMATS[0];
  const [sel, setSel] = useState<Set<number> | null>(null);
  const [search, setSearch] = useState("");
  const spools = useMemo(() => (q.data ?? []).filter((s) => !s.archived), [q.data]);
  // Vorauswahl: die geöffnete Spule, sonst alle im Regal
  useEffect(() => {
    if (sel || !q.data) return;
    setSel(new Set(spoolId ? [spoolId] : spools.map((s) => s.id)));
  }, [q.data, spools, spoolId, sel]);
  useEffect(() => {
    try {
      localStorage.setItem("labels.format", fmt);
    } catch {
      /* ohne Speicher */
    }
  }, [fmt]);
  const shown = spools.filter((s) => !search || `${s.brand} ${s.material} ${s.name} ${s.color_name} #${s.id}`.toLowerCase().includes(search.toLowerCase()));
  const chosen = spools.filter((s) => sel?.has(s.id));
  const toggle = (id: number) => setSel((p) => new Set(p?.has(id) ? [...p].filter((x) => x !== id) : [...(p ?? []), id]));
  const sheets = f.sheet ? Math.ceil(chosen.length / (f.sheet.cols * f.sheet.rows)) : chosen.length;

  return (
    <>
      <PageHeader
        title="Etiketten"
        sub="QR-Code mit der iPhone-Kamera scannen, die Spule öffnet sich in Druckwerk."
        back={
          <a href={href({ page: "filament", view: "spulen" })} className="mb-1 inline-flex items-center gap-1 text-sm font-semibold text-ink3 hover:text-ink">
            <ChevronLeft size={16} /> Spulen
          </a>
        }
      >
        <Button kind="primary" disabled={!chosen.length} onClick={() => window.print()}>
          <Printer size={16} /> Drucken
        </Button>
      </PageHeader>
      <FilamentTabs view="spulen" />
      <div className="mx-auto grid max-w-6xl gap-5 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem] 2xl:max-w-[88rem]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap gap-2">
            {FORMATS.map((x) => (
              <button
                key={x.id}
                onClick={() => setFmt(x.id)}
                className={`h-8 shrink-0 rounded-full px-3 text-[13px] font-semibold ${fmt === x.id ? "bg-ink text-bg" : "bg-card text-ink2 shadow-seg"}`}
              >
                {x.label}
              </button>
            ))}
          </div>
          <Card className="overflow-x-auto p-4">
            {chosen.length ? (
              <div className="flex flex-wrap gap-3">
                {chosen.slice(0, 24).map((s) => (
                  <div key={s.id} className="rounded-sm shadow-[0_0_0_1px_var(--c-sep)]">
                    <Label s={s} f={f} />
                  </div>
                ))}
                {chosen.length > 24 && <div className="self-center text-sm text-ink3">und {chosen.length - 24} weitere</div>}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-ink3">Rechts Spulen auswählen.</div>
            )}
          </Card>
          <p className="text-xs text-ink3">
            {chosen.length === 1 ? "1 Etikett" : `${chosen.length} Etiketten`}
            {f.sheet ? `, ${sheets === 1 ? "1 Bogen" : `${sheets} Bogen`} (3 × 8, ohne Rand)` : `, je Etikett eine Seite in ${f.w} × ${f.h} mm`}. Im Druckdialog Skalierung
            auf 100 % und Ränder auf „Keine“ stellen. Der Code enthält die Adresse, unter der Druckwerk gerade geöffnet ist.
          </p>
        </div>
        <Card className="order-first flex max-h-[45vh] min-h-0 flex-col lg:sticky lg:top-6 lg:order-none lg:max-h-[70vh] lg:self-start">
          {q.isError ? (
            <div className="p-4">
              <LoadError error={q.error} retry={() => q.refetch()} />
            </div>
          ) : (
            <>
              <div className="space-y-2 border-b border-sep p-3">
                <label className="flex h-9 items-center gap-2 rounded-lg bg-fill px-2.5">
                  <Search size={15} className="shrink-0 text-ink3" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Spule suchen …" className="field text-sm" />
                </label>
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-ink3 tnum">
                    {chosen.length} von {spools.length}
                  </span>
                  <span className="flex gap-3 font-semibold">
                    <button className="text-accent" onClick={() => setSel(new Set([...(sel ?? []), ...shown.map((s) => s.id)]))}>
                      Alle
                    </button>
                    <button className="text-ink2" onClick={() => setSel(new Set([...(sel ?? [])].filter((id) => !shown.some((s) => s.id === id))))}>
                      Keine
                    </button>
                  </span>
                </div>
              </div>
              <div className="min-h-0 flex-1 divide-y divide-sep overflow-y-auto">
                {shown.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-hover">
                    <input type="checkbox" checked={!!sel?.has(s.id)} onChange={() => toggle(s.id)} className="size-4 accent-[var(--c-accent)]" />
                    <Swatch color={s.color} size={18} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{spoolTitle(s)}</span>
                      <span className="block truncate text-xs text-ink3">{spoolSub(s)}</span>
                    </span>
                    <span className="shrink-0 text-xs text-ink3 tnum">{fmtG(s.remaining_g)}</span>
                  </label>
                ))}
                {!shown.length && <div className="p-6 text-center text-sm text-ink3">Keine Spule gefunden.</div>}
              </div>
            </>
          )}
        </Card>
      </div>
      {chosen.length > 0 && <PrintSheet list={chosen} f={f} />}
    </>
  );
}
