// Spulen ziehen: Maus ab 6 px Bewegung, Touch nach langem Drücken (sonst scrollt die Seite normal).
// Ziele tragen data-drop="tray:<drucker>:<fach>" bzw. data-drop="shelf", gesucht per elementFromPoint.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SpoolArt } from "./spool.tsx";

export type DragItem = { spoolId: number; color: string; fraction: number; from: { printer_id: number; tray: number } | null };
export type DropTarget = { kind: "tray"; printer_id: number; tray: number } | { kind: "shelf" };

/** Ziehbar: DragItem; gesperrt: Text, der beim Ziehversuch als Hinweis kommt; null: gar nicht ziehbar */
export type Draggable = DragItem | string | null;
type Ctx = { item: DragItem | null; over: string | null; bind: (item: Draggable) => React.HTMLAttributes<HTMLElement> };
const DragCtx = createContext<Ctx>({ item: null, over: null, bind: () => ({}) });
export const useDrag = () => useContext(DragCtx);

const parse = (key: string | null): DropTarget | null => {
  if (key === "shelf") return { kind: "shelf" };
  const m = key?.match(/^tray:(\d+):(\d+)$/);
  return m ? { kind: "tray", printer_id: Number(m[1]), tray: Number(m[2]) } : null;
};

export function DragProvider({
  onDrop,
  onBlocked,
  children,
}: {
  onDrop: (item: DragItem, target: DropTarget) => void;
  onBlocked: (message: string) => void;
  children: React.ReactNode;
}) {
  const [item, setItem] = useState<DragItem | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [over, setOverState] = useState<string | null>(null);
  const overRef = useRef<string | null>(null);
  const setOver = (k: string | null) => {
    overRef.current = k;
    setOverState(k);
  };
  const st = useRef<{ item: DragItem | string; x: number; y: number; id: number; touch: boolean; timer: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const raf = useRef(0); // Intervall fürs Rand-Scrollen
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const blockedRef = useRef(onBlocked);
  blockedRef.current = onBlocked;

  const targetAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest("[data-drop]") as HTMLElement | null)?.dataset.drop ?? null;

  const activate = useCallback((x: number, y: number) => {
    const s = st.current;
    if (!s || s.active) return;
    s.active = true;
    if (typeof s.item === "string") {
      // Gesperrte Spule: Hinweis statt Ziehen; bis zum Loslassen aktiv, damit der folgende Klick nichts öffnet
      navigator.vibrate?.([10, 60, 10]);
      blockedRef.current(s.item);
      return;
    }
    setItem(s.item);
    setPos({ x, y });
    setOver(targetAt(x, y));
    navigator.vibrate?.(12);
    document.body.classList.add("dragging");
    last.current = { x, y };
    // Am Rand weiterscrollen (Scrollen per Finger ist während des Ziehens aus): Regal unten, AMS oben
    const loop = () => {
      if (!st.current?.active) return clearInterval(raf.current);
      const { x: px, y: py } = last.current;
      const top = 90;
      const bottom = innerHeight - (document.querySelector("nav.fixed")?.getBoundingClientRect().height ?? 0) - 70;
      const dy = py < top ? -Math.ceil((top - py) / 5) : py > bottom ? Math.ceil((py - bottom) / 5) : 0;
      if (dy) {
        window.scrollBy(0, dy);
        setOver(targetAt(px, py));
      }
    };
    clearInterval(raf.current);
    raf.current = window.setInterval(loop, 16);
  }, []);

  const end = useCallback((drop: boolean) => {
    const s = st.current;
    st.current = null;
    if (!s) return;
    clearTimeout(s.timer);
    clearInterval(raf.current);
    document.body.classList.remove("dragging");
    if (!s.active) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 50);
    setItem(null);
    const t = drop ? parse(overRef.current) : null;
    setOver(null);
    if (t && typeof s.item !== "string") dropRef.current(s.item, t);
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const s = st.current;
      if (!s || e.pointerId !== s.id) return;
      const dist = Math.hypot(e.clientX - s.x, e.clientY - s.y);
      if (!s.active) {
        if (s.touch) {
          // Vor dem langen Drücken bewegt: der Nutzer scrollt
          if (dist > 8) end(false);
        } else if (dist > 6) activate(e.clientX, e.clientY);
        return;
      }
      if (typeof s.item === "string") return;
      last.current = { x: e.clientX, y: e.clientY };
      setPos({ x: e.clientX, y: e.clientY });
      setOver(targetAt(e.clientX, e.clientY));
    };
    const up = (e: PointerEvent) => st.current && e.pointerId === st.current.id && end(true);
    const cancel = (e: PointerEvent) => st.current && e.pointerId === st.current.id && end(false);
    // Während des Ziehens nicht scrollen (iOS braucht einen nicht-passiven touchmove-Listener)
    const touch = (e: TouchEvent) => st.current?.active && e.cancelable && e.preventDefault();
    const click = (e: MouseEvent) => {
      if (suppressClick.current) {
        e.preventDefault();
        e.stopPropagation();
        suppressClick.current = false;
      }
    };
    const menu = (e: Event) => st.current && e.preventDefault();
    const key = (e: KeyboardEvent) => e.key === "Escape" && end(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("touchmove", touch, { passive: false });
    window.addEventListener("click", click, true);
    window.addEventListener("contextmenu", menu);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("touchmove", touch);
      window.removeEventListener("click", click, true);
      window.removeEventListener("contextmenu", menu);
      window.removeEventListener("keydown", key);
    };
  }, [activate, end]);

  const bind = useCallback(
    (it: Draggable): React.HTMLAttributes<HTMLElement> =>
      it
        ? {
            onPointerDown: (e) => {
              if (e.button !== 0 || st.current) return;
              const touch = e.pointerType !== "mouse";
              const s = { item: it, x: e.clientX, y: e.clientY, id: e.pointerId, touch, timer: 0, active: false };
              st.current = s;
              if (touch) s.timer = window.setTimeout(() => st.current === s && activate(s.x, s.y), 320);
            },
            onDragStart: (e) => e.preventDefault(),
            style: { WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" },
          }
        : {},
    [activate],
  );

  return (
    <DragCtx.Provider value={{ item, over, bind }}>
      {children}
      {item &&
        createPortal(
          <div className="pointer-events-none fixed z-[100] w-20 -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_10px_18px_rgba(0,0,0,0.35)]" style={{ left: pos.x, top: pos.y }}>
            <SpoolArt color={item.color} fraction={item.fraction} className="w-full" />
          </div>,
          document.body,
        )}
    </DragCtx.Provider>
  );
}
