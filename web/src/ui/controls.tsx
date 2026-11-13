import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { X } from "lucide-react";

type BtnKind = "primary" | "secondary" | "ghost" | "danger";
const BTN: Record<BtnKind, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "bg-card text-ink shadow-seg hover:bg-fill",
  ghost: "text-ink2 hover:bg-hover hover:text-ink",
  danger: "bg-card text-bad shadow-seg hover:bg-bad-soft",
};

export function Button({ kind = "secondary", className = "", busy, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind; busy?: boolean }) {
  return (
    <button
      {...p}
      disabled={p.disabled || busy}
      className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold whitespace-nowrap transition-colors disabled:opacity-50 ${BTN[kind]} ${className}`}
    >
      {busy && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />}
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl bg-card shadow-card ${className}`}>{children}</section>;
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-bold tracking-[0.08em] text-ink3 uppercase">{children}</div>;
}

/** Pflicht/Optional-Kennzeichen neben einem Feldnamen */
export function Need({ required }: { required: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-px text-[10px] font-bold tracking-[0.06em] uppercase ${required ? "bg-accent-soft text-accent" : "bg-fill text-ink3"}`}
    >
      {required ? "Pflicht" : "Optional"}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
  required,
  aside,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  /** gesetzt: zeigt „Pflicht“ bzw. „Optional“ */
  required?: boolean;
  /** rechts neben dem Feldnamen, außerhalb des <label> (z. B. „Auf Standard“) */
  aside?: ReactNode;
}) {
  return (
    <div className="relative">
      <label className="block">
        <div className={`flex min-h-5 items-center gap-2 ${aside ? "pr-24" : ""}`}>
          <Label>{label}</Label>
          {required != null && <Need required={required} />}
        </div>
        <div className="mt-1.5 rounded-lg bg-card px-3 py-2 shadow-seg focus-within:shadow-[0_0_0_2px_var(--c-accent)]">{children}</div>
        {hint && <div className="mt-1 text-xs leading-snug text-ink3">{hint}</div>}
      </label>
      {aside && <div className="absolute top-0 right-0 flex min-h-5 items-center">{aside}</div>}
    </div>
  );
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-[var(--c-overlay)] sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-label={title}
        className={`anim-sheet flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-bg shadow-pop sm:rounded-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="grid size-8 place-items-center rounded-full text-ink2 hover:bg-hover" aria-label="Schließen">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pt-1 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

const ToastCtx = createContext<(msg: string, kind?: "ok" | "fehler") => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [list, setList] = useState<{ id: number; msg: string; kind: "ok" | "fehler" }[]>([]);
  const show = useCallback((msg: string, kind: "ok" | "fehler" = "ok") => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, msg, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === "fehler" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4">
        {list.map((t) => (
          <div key={t.id} className={`anim-sheet pointer-events-auto max-w-md rounded-xl px-4 py-2.5 text-sm font-medium shadow-pop ${t.kind === "fehler" ? "bg-bad text-white" : "bg-ink text-bg"}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function LoadError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <Card className="p-6 text-center">
      <div className="font-semibold">Laden fehlgeschlagen</div>
      <div className="mt-1 text-sm text-ink2">{error instanceof Error ? error.message : String(error)}</div>
      <Button className="mt-4" onClick={retry}>
        Erneut laden
      </Button>
    </Card>
  );
}

export function Swatch({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: color || "transparent", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--c-ink) 22%, transparent)" }}
    />
  );
}

export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–";
