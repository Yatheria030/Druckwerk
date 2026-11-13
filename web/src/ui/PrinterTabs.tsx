import { href } from "../lib/router.ts";

/** Unterseiten des Druckers; auf dem Desktop stehen sie in der Seitenleiste, darunter als Tabs oben */
export function PrinterTabs({ view, width = "max-w-6xl 2xl:max-w-[88rem]" }: { view: "printer" | "errors"; width?: string }) {
  const tab = (active: boolean) =>
    `flex h-8 shrink-0 items-center justify-center rounded-md px-3 text-[13px] font-semibold ${active ? "bg-[var(--c-seg-active)] text-ink shadow-seg" : "text-ink2"}`;
  return (
    <div className={`mx-auto ${width} px-4 pb-3 sm:px-6 md:hidden`}>
      <nav className="flex rounded-lg bg-fill p-0.5 *:flex-1">
        <a href={href({ page: "printer" })} className={tab(view === "printer")}>
          Übersicht
        </a>
        <a href={href({ page: "printer", view: "fehlercodes" })} className={tab(view === "errors")}>
          Fehlercodes
        </a>
      </nav>
    </div>
  );
}
