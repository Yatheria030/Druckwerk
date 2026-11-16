// Platten einer Projekt-3MF (Bambu Studio, MakerWorld) wie auf MakerWorld: Bild, Nummer, Name, Zeit, Gramm und Farben je Platte.
// Wer aus 14 Halterplatten nur eine braucht, wählt sie hier und slict nur diese; „Alle“ slict das ganze Projekt.
import { Clock, Layers, Scale } from "lucide-react";
import type { Plate } from "../../../shared/types.ts";

export const minutesText = (s: number) => {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
};
const grams = (g: number) => `${g >= 100 ? Math.round(g) : String(Math.round(g * 10) / 10).replace(".", ",")} g`;

/** Eine Plattenzeile: Zeit, Gramm, Teile und Farbpunkte; für Kacheln und den MakerWorld-Dialog */
export function PlateFacts({ p, compact = false }: { p: Pick<Plate, "prediction_s" | "weight_g" | "objects" | "filaments">; compact?: boolean }) {
  return (
    <>
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ink3 tnum ${compact ? "text-[11px]" : "text-xs"}`}>
        {p.prediction_s != null && (
          <span className="flex items-center gap-0.5">
            <Clock size={compact ? 10 : 11} /> {minutesText(p.prediction_s)}
          </span>
        )}
        {p.weight_g != null && p.weight_g > 0 && (
          <span className="flex items-center gap-0.5">
            <Scale size={compact ? 10 : 11} /> {grams(p.weight_g)}
          </span>
        )}
        {!!p.objects && p.objects > 1 && <span>{p.objects} Teile</span>}
      </div>
      {p.filaments.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-0.5">
          {p.filaments.slice(0, 8).map((f, i) => (
            <span
              key={i}
              className="size-2.5 rounded-full ring-1 ring-black/15 dark:ring-white/20"
              style={{ background: f.color || "#888" }}
              title={`${f.type}${f.used_g ? `, ${grams(f.used_g)}` : ""}`}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** Waagrechte Kachelreihe; `value` null = alle Platten */
export function PlatePicker({ plates, value, image, onPick }: { plates: Plate[]; value: number | null; image: (n: number) => string | null; onPick: (n: number | null) => void }) {
  const tile = (on: boolean) =>
    `flex w-28 shrink-0 snap-start flex-col overflow-hidden rounded-xl bg-card text-left shadow-seg transition-shadow ${on ? "ring-2 ring-accent" : "hover:ring-1 hover:ring-line"}`;
  const total = {
    prediction_s: plates.every((p) => p.prediction_s != null) ? plates.reduce((s, p) => s + p.prediction_s!, 0) : null,
    weight_g: plates.every((p) => p.weight_g != null) ? plates.reduce((s, p) => s + p.weight_g!, 0) : null,
    objects: plates.reduce((s, p) => s + (p.objects ?? 0), 0),
    filaments: [],
  };
  return (
    <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pt-0.5 pb-2" role="radiogroup" aria-label="Platte">
      {plates.map((p) => {
        const src = p.has_image ? image(p.index) : null;
        const on = value === p.index;
        return (
          <button key={p.index} type="button" role="radio" aria-checked={on} onClick={() => onPick(p.index)} className={tile(on)} title={p.name || `Platte ${p.index}`}>
            <span className="relative block aspect-square bg-[linear-gradient(160deg,var(--c-tile-a),var(--c-tile-b))]">
              {src ? <img src={src} alt="" loading="lazy" className="size-full object-contain" /> : <Layers size={22} className="absolute inset-0 m-auto text-ink4" />}
              <span className={`absolute top-1.5 left-1.5 grid h-5 min-w-5 place-items-center rounded-md px-1 text-[11px] font-bold tnum ${on ? "bg-accent text-on-accent" : "bg-bg/85 text-ink"}`}>
                {p.index}
              </span>
            </span>
            <span className="flex flex-1 flex-col p-1.5">
              <span className="line-clamp-2 text-xs leading-snug font-semibold">{p.name || `Platte ${p.index}`}</span>
              <span className="mt-auto pt-0.5">
                <PlateFacts p={p} compact />
              </span>
            </span>
          </button>
        );
      })}
      <button type="button" role="radio" aria-checked={value == null} onClick={() => onPick(null)} className={tile(value == null)} title="Alle Platten slicen, danach eine zum Drucken wählen">
        <span className="relative grid aspect-square place-items-center bg-[linear-gradient(160deg,var(--c-tile-a),var(--c-tile-b))]">
          {/* Stapel aus Platten */}
          <svg viewBox="0 0 60 60" className="size-14" aria-hidden>
            {[0, 1, 2].map((i) => (
              <path key={i} d={`M10 ${38 - i * 9}l20-9 20 9-20 9z`} fill="var(--c-card)" stroke={value == null ? "var(--c-accent)" : "var(--c-ink3)"} strokeWidth="1.6" strokeLinejoin="round" />
            ))}
          </svg>
          <span className={`absolute top-1.5 left-1.5 grid h-5 place-items-center rounded-md px-1 text-[11px] font-bold ${value == null ? "bg-accent text-on-accent" : "bg-bg/85 text-ink"}`}>
            {plates.length}
          </span>
        </span>
        <span className="flex flex-1 flex-col p-1.5">
          <span className="text-xs leading-snug font-semibold">Alle Platten</span>
          <span className="mt-auto pt-0.5">
            <PlateFacts p={total} compact />
          </span>
        </span>
      </button>
    </div>
  );
}
