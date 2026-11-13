import { useCatalog } from "../lib/catalog.ts";
import { href, slug, type FilamentView } from "../lib/router.ts";

export const chipCls = (on: boolean) => `flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap ${on ? "bg-ink text-bg" : "bg-card text-ink2 shadow-seg"}`;

/** Unterseiten der Filament-Seite; auf dem Desktop stehen sie in der Seitenleiste, darunter als Tabs oben */
export function FilamentTabs({ view, brand }: { view: FilamentView; brand?: string }) {
  const cat = useCatalog();
  const tab = (active: boolean) => `flex h-8 shrink-0 items-center rounded-md px-3 text-[13px] font-semibold ${active ? "bg-[var(--c-seg-active)] text-ink shadow-seg" : "text-ink2"}`;
  return (
    <div className="mx-auto max-w-6xl space-y-2 px-4 pb-3 sm:px-6 md:hidden">
      <nav className="flex rounded-lg bg-fill p-0.5 *:flex-1 *:justify-center">
        {(
          [
            ["regal", "Regal"],
            ["spulen", "Spulen"],
            ["katalog", "Katalog"],
          ] as const
        ).map(([v, l]) => (
          <a key={v} href={href({ page: "filament", view: v })} className={tab(view === v)}>
            {l}
          </a>
        ))}
      </nav>
      {view === "katalog" && (cat.data?.length ?? 0) > 0 && (
        <nav className="-mx-4 -mt-0.5 flex gap-2 overflow-x-auto px-4 py-0.5">
          <a href={href({ page: "filament", view: "katalog" })} className={chipCls(!brand)}>
            Alle Marken
          </a>
          {cat.data!.map((b) => (
            <a key={b.id} href={href({ page: "filament", view: "katalog", brand: slug(b.brand) })} className={chipCls(brand === slug(b.brand))}>
              {b.brand} <span className="opacity-55">{b.lines.length}</span>
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}

