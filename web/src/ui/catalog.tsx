// Farbauswahl aus dem Herstellerkatalog: erst die Sorte (PLA Meta, PLA+ 2.0 …), dann deren Farben mit offiziellem Namen.
import { useId, useState } from "react";
import { catalogBrand, catalogLine, type CatalogLine } from "../../../shared/catalog.ts";
import { useCatalog } from "../lib/catalog.ts";

export { carryColorName } from "../../../shared/catalog.ts";

const OWN = "\u0000eigene";

/** Sorte: Liste des Herstellers, wenn er im Katalog steht, sonst (oder bei „Eigene Sorte“) freie Eingabe */
export function SorteField({
  brand,
  value,
  onText,
  onLine,
  className,
  placeholder = "Basic, Matte, Silk …",
}: {
  brand: string;
  value: string;
  onText: (name: string) => void;
  onLine: (line: CatalogLine) => void;
  className: string;
  placeholder?: string;
}) {
  useCatalog();
  const b = catalogBrand(brand);
  const line = catalogLine(brand, value);
  const [own, setOwn] = useState(false);
  const [typing, setTyping] = useState(false); // beim Tippen nicht mittendrin auf die Liste umschalten
  const id = useId();
  if (!b || own || typing || (value.trim() && !line))
    return (
      <>
        <input
          className={className}
          value={value}
          onChange={(e) => onText(e.target.value)}
          onFocus={() => setTyping(true)}
          onBlur={() => {
            setTyping(false);
            if (!value.trim()) setOwn(false);
            else if (line && !own) onLine(line); // Sorte aus der Liste getippt: Material mitnehmen
          }}
          placeholder={placeholder}
          aria-label="Sorte"
          autoFocus={own}
          list={b ? id : undefined}
        />
        {b && (
          <datalist id={id}>
            {b.lines.map((l) => (
              <option key={l.id} value={l.name} />
            ))}
          </datalist>
        )}
      </>
    );
  const groups = [...new Set(b.lines.map((l) => l.material))];
  return (
    <select
      className={className}
      value={line?.name ?? ""}
      onChange={(e) => {
        if (e.target.value === OWN) return (setOwn(true), onText(""));
        const l = b.lines.find((x) => x.name === e.target.value);
        if (l) onLine(l);
      }}
      aria-label="Sorte"
    >
      <option value="">Sorte wählen …</option>
      {groups.map((m) => (
        <optgroup key={m} label={m}>
          {b.lines
            .filter((l) => l.material === m)
            .map((l) => (
              <option key={l.id} value={l.name}>
                {l.name} ({l.colors.length})
              </option>
            ))}
        </optgroup>
      ))}
      <option value={OWN}>Eigene Sorte …</option>
    </select>
  );
}

/** Farben der gewählten Sorte; unbekannter Farbcode (?) übernimmt nur den Namen, die Farbe setzt der Nutzer selbst */
export function CatalogColors({ brand, line, colorName, onPick }: { brand: string; line: string; colorName: string; onPick: (name: string, hex: string | null) => void }) {
  useCatalog();
  const l = catalogLine(brand, line);
  if (!l) return null;
  const b = catalogBrand(brand)!;
  const picked = l.colors.find((c) => c.name === colorName);
  return (
    <div>
      <div className="text-[11px] font-bold tracking-[0.08em] text-ink3 uppercase">
        Farben {b.brand} {l.name} · {l.colors.length}
      </div>
      <div className="mt-1.5 flex max-h-44 flex-wrap gap-1.5 overflow-y-auto overscroll-contain p-0.5">
        {l.colors.map((c) => (
          <button
            type="button"
            key={c.id}
            onClick={() => onPick(c.name, c.hex)}
            className={`flex h-7 items-center gap-1.5 rounded-full bg-card pr-2.5 pl-1 text-xs font-semibold shadow-seg ${colorName === c.name ? "ring-2 ring-accent" : ""}`}
          >
            {c.hex ? (
              <span className="size-5 shrink-0 rounded-full" style={{ background: `#${c.hex}`, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.18)" }} />
            ) : (
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-ink3 text-[10px] font-black text-ink3">?</span>
            )}
            {c.name}
          </button>
        ))}
      </div>
      {picked && !picked.hex && (
        <p className="mt-1.5 text-[11px] leading-snug text-ink3">Für „{picked.name}“ ist kein Farbcode hinterlegt, bitte die Farbe selbst wählen.</p>
      )}
    </div>
  );
}
