import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { FileKind } from "../../../shared/types.ts";
import { addLights, frame, loadObject } from "../lib/three.ts";

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#c4521d";

/** Drehbare 3D-Ansicht mit Rasterboden und Maßen */
export function Viewer({ id, kind, onError }: { id: number; kind: FileKind; onError?: (msg: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"laden" | "ok" | "fehler">("laden");
  const [size, setSize] = useState<THREE.Vector3 | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const el = host.current!;
    let disposed = false;
    setState("laden");
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    const scene = new THREE.Scene();
    addLights(scene);
    const camera = new THREE.PerspectiveCamera(35, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    let obj: THREE.Object3D | null = null;
    let grid: THREE.GridHelper | null = null;

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    loadObject(id, kind, css("--c-accent"))
      .then((o) => {
        if (disposed) return;
        obj = o;
        scene.add(o);
        const { target, size } = frame(camera, o);
        controls.target.copy(target);
        const span = Math.max(size.x, size.z) * 1.6;
        const step = span > 200 ? 20 : span > 60 ? 10 : 5;
        const cells = Math.ceil(span / step);
        grid = new THREE.GridHelper(cells * step, cells, css("--c-line"), css("--c-sep"));
        scene.add(grid);
        setSize(size);
        setState("ok");
      })
      .catch((e: Error) => {
        if (disposed) return;
        setError(e.message);
        setState("fehler");
        onError?.(e.message);
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      obj?.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
      grid?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [id, kind]);

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="absolute inset-0" />
      {state === "laden" && <div className="absolute inset-0 grid place-items-center text-sm text-ink3">3D-Modell wird geladen …</div>}
      {state === "fehler" && <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-ink3">Ansicht nicht möglich: {error}</div>}
      {size && state === "ok" && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-card/85 px-2.5 py-1 text-xs tnum text-ink2 shadow-card frost">
          {[size.x, size.z, size.y].map((v) => v.toFixed(1).replace(".", ",")).join(" × ")} mm
        </div>
      )}
    </div>
  );
}
