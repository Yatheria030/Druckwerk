import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { colorDist, type FileKind } from "../../../shared/types.ts";
import { addLights, frame, loadObject } from "../lib/three.ts";
import { buildPlate, disposePlate, type PlateSpec } from "../lib/plate.ts";

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#c4521d";

/**
 * Farben live umstellen (Slicen): `color` für Teile ohne eigene Farbe, `paint` je Filament der Datei (Farbe aus der Datei → neue Farbe);
 * Teile einer 3MF bekommen die neue Farbe des Filaments, dessen Dateifarbe ihrer am nächsten liegt.
 */
export type Paint = { color?: string; paint?: { from: string; to: string }[] };

/**
 * Druckplatte statt Rasterboden (Slice- und Druckdialog): Bettgröße und Plattentyp des Druckers, `copies` Exemplare und, sobald die
 * Vorschau des Slicers da ist, deren Lage auf dem Bett (`boxes` aus plate_N.json, minX/minY/maxX/maxY in Druckerkoordinaten)
 */
export type ViewerPlate = PlateSpec & { copies?: number; boxes?: [number, number, number, number][] };

const hex = (c: THREE.Color) => `#${c.getHexString()}`;

function applyPaint(obj: THREE.Object3D, p: Paint, fallback: string) {
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const m = o.material as THREE.MeshStandardMaterial;
    const orig = o.userData.orig as string | null;
    let to = orig == null ? p.color : undefined;
    if (orig != null && p.paint?.length) to = [...p.paint].sort((a, b) => colorDist(a.from, orig) - colorDist(b.from, orig))[0]!.to;
    if (orig == null && !to && p.paint?.length === 1) to = p.paint[0]!.to;
    m.color.set(to || orig || fallback);
  });
}

type Unit = { key: string; piece: number; x: number; z: number };

/**
 * Was wo auf dem Bett liegt (Mitte in Viewer-Koordinaten X/Z). Mit Slicer-Werten und passender Zahl (Exemplare × Teile der Datei)
 * bekommt jedes Feld das Teil mit der ähnlichsten Grundfläche; die CLI ordnet Teile einzeln an und sortiert sie nicht nach Exemplar.
 * Sonst vorläufig ganze Exemplare im Raster um die Bettmitte. Ein Teil je Datei (STL) = beide Wege gleiche Schlüssel, damit es gleitet.
 */
function layoutUnits(n: number, pieces: THREE.Vector3[], whole: THREE.Vector3, plate: ViewerPlate): Unit[] {
  const [w, h] = plate.size;
  const b = plate.boxes ?? [];
  const P = pieces.length;
  if (b.length && b.length === n * P) {
    const left = pieces.map(() => n);
    return b.map((box, i) => {
      const [bw, bd] = [box[2] - box[0], box[3] - box[1]];
      let best = -1;
      for (let k = 0; k < P; k++) {
        if (!left[k]) continue;
        const cost = (pc: THREE.Vector3) => Math.abs(pc.x - bw) + Math.abs(pc.z - bd);
        if (best < 0 || cost(pieces[k]!) < cost(pieces[best]!)) best = k;
      }
      left[best]!--;
      const x = (box[0] + box[2]) / 2 - w / 2;
      const z = -((box[1] + box[3]) / 2 - h / 2);
      return P === 1 ? { key: `w:${i}`, piece: -1, x, z } : { key: `p:${best}:${i}`, piece: best, x, z };
    });
  }
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const [sx, sz] = [whole.x + 8, whole.z + 8];
  return Array.from({ length: n }, (_, i) => ({
    key: `w:${i}`,
    piece: -1,
    x: ((i % cols) - (cols - 1) / 2) * sx,
    z: (Math.floor(i / cols) - (rows - 1) / 2) * sz,
  }));
}

/** Teile einer Datei (3MF: je Bauteil) als eigene Knoten, mittig und mit der Unterseite auf Y = 0, wie der Slicer sie aufs Bett legt */
function splitPieces(root: THREE.Object3D): THREE.Object3D[] {
  const inner = root.children[0];
  const parts = inner && inner.children.length > 1 ? inner.children : [];
  root.updateMatrixWorld(true);
  return parts.map((c) => {
    const m = c.clone(true);
    c.matrixWorld.decompose(m.position, m.quaternion, m.scale);
    const g = new THREE.Group();
    g.add(m);
    const box = new THREE.Box3().setFromObject(g);
    const ctr = box.getCenter(new THREE.Vector3());
    m.position.sub(new THREE.Vector3(ctr.x, box.min.y, ctr.z));
    return g;
  });
}

/** Drehbare 3D-Ansicht mit Rasterboden bzw. Druckplatte und Maßen */
export function Viewer({
  id,
  kind,
  onError,
  paint,
  plate,
}: {
  id: number;
  kind: FileKind;
  onError?: (msg: string) => void;
  paint?: Paint;
  plate?: ViewerPlate;
}) {
  const host = useRef<HTMLDivElement>(null);
  const objRef = useRef<THREE.Object3D | null>(null);
  const paintRef = useRef(paint);
  paintRef.current = paint;
  const paintKey = JSON.stringify(paint ?? null);
  useEffect(() => {
    if (objRef.current && paint) applyPaint(objRef.current, paint, css("--c-accent"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintKey]);
  const [state, setState] = useState<"laden" | "ok" | "fehler">("laden");
  const [size, setSize] = useState<THREE.Vector3 | null>(null);
  const [error, setError] = useState("");

  // Szene einmal je Datei; Platte und Exemplare stellt der zweite Effekt um, ohne das Modell neu zu laden
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    key: THREE.DirectionalLight;
    renderer: THREE.WebGLRenderer;
    copies: THREE.Group;
    plate: THREE.Group | null;
    grid: THREE.GridHelper | null;
    framedFor: string;
    pieces: { src: THREE.Object3D | null; list: THREE.Object3D[] };
  } | null>(null);
  const plateRef = useRef(plate);
  plateRef.current = plate;
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    const el = host.current!;
    let disposed = false;
    setState("laden");
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    const scene = new THREE.Scene();
    const key = addLights(scene);
    const camera = new THREE.PerspectiveCamera(35, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const copies = new THREE.Group();
    scene.add(copies);
    const ctx = { scene, camera, controls, key, renderer, copies, plate: null as THREE.Group | null, grid: null as THREE.GridHelper | null, framedFor: "", pieces: { src: null as THREE.Object3D | null, list: [] as THREE.Object3D[] } };
    sceneRef.current = ctx;
    let obj: THREE.Object3D | null = null;

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

    // Exemplare gleiten an ihren Platz, wenn die Vorschau des Slicers die echte Anordnung liefert
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const loop = () => {
      for (const c of copies.children) {
        const t = c.userData.target as THREE.Vector3 | undefined;
        if (t) still ? c.position.copy(t) : c.position.lerp(t, 0.18);
      }
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    loadObject(id, kind, css("--c-accent"))
      .then((o) => {
        if (disposed) return;
        obj = o;
        objRef.current = o;
        // Eigene Materialien je Teil, damit sich Farben einzeln ändern lassen; Ursprungsfarbe merken (null = Standardmaterial)
        const accent = css("--c-accent");
        o.traverse((m) => {
          if (!(m instanceof THREE.Mesh)) return;
          const c = (m.material as THREE.MeshStandardMaterial).color;
          m.userData.orig = c && hex(c) !== hex(new THREE.Color(accent)) ? hex(c) : null;
          m.material = (m.material as THREE.Material).clone();
        });
        if (paintRef.current) applyPaint(o, paintRef.current, accent);
        const { size } = frame(camera, o);
        setSize(size);
        setState("ok");
        setLoaded((n) => n + 1);
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
      objRef.current = null;
      sceneRef.current = null;
      obj?.traverse((o) => o instanceof THREE.Mesh && (o.geometry.dispose(), (o.material as THREE.Material).dispose()));
      ctx.grid?.dispose();
      if (ctx.plate) disposePlate(ctx.plate);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [id, kind]);

  // Platte bzw. Raster und Exemplare
  const plateKey = plate ? `${plate.size.join("x")}|${plate.type}|${(plate.exclude ?? []).join(",")}` : "";
  const n = Math.max(1, plate?.copies ?? 1);
  const boxKey = JSON.stringify(plate?.boxes ?? null);
  useEffect(() => {
    const ctx = sceneRef.current;
    const o = objRef.current;
    if (!ctx || !o) return;
    const p = plateRef.current;
    const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());

    // Boden: Platte des Druckers oder Raster in Modellgröße
    if (ctx.plate) (ctx.scene.remove(ctx.plate), disposePlate(ctx.plate), (ctx.plate = null));
    if (ctx.grid) (ctx.scene.remove(ctx.grid), ctx.grid.dispose(), (ctx.grid = null));
    if (p) {
      ctx.plate = buildPlate(p);
      ctx.scene.add(ctx.plate);
      // Schatten der Teile aufs Blech: Hauptlicht weit weg, Schattenkamera über das ganze Bett
      const [w, h] = p.size;
      const r = Math.max(w, h) * 0.75;
      ctx.key.castShadow = true;
      // weniger Umgebungslicht, damit die Schatten der Teile auf dem Blech sichtbar werden
      ctx.scene.traverse((l) => l instanceof THREE.HemisphereLight && (l.intensity = 1.05));
      ctx.key.intensity = 2.6;
      ctx.key.position.set(0.55, 1.6, 0.9).multiplyScalar(r * 2);
      ctx.key.target.position.set(0, 0, 0);
      Object.assign(ctx.key.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: r * 6 });
      ctx.key.shadow.camera.updateProjectionMatrix();
      ctx.key.shadow.mapSize.set(2048, 2048);
      ctx.key.shadow.bias = -0.0004;
      ctx.key.shadow.normalBias = 0.6;
      ctx.key.shadow.radius = 3;
    } else {
      ctx.key.castShadow = false;
      ctx.scene.traverse((l) => l instanceof THREE.HemisphereLight && (l.intensity = 1.6));
      ctx.key.intensity = 2.2;
      const span = Math.max(size.x, size.z) * 1.6;
      const step = span > 200 ? 20 : span > 60 ? 10 : 5;
      const cells = Math.ceil(span / step);
      ctx.grid = new THREE.GridHelper(cells * step, cells, css("--c-line"), css("--c-sep"));
      ctx.scene.add(ctx.grid);
    }

    // Exemplare: Klone des geladenen Modells bzw. seiner Teile (teilen Geometrie und Material, Farben wirken auf alle)
    if (ctx.pieces.src !== o) ctx.pieces = { src: o, list: splitPieces(o) };
    const pieces = ctx.pieces.list;
    const units: Unit[] = p ? layoutUnits(n, pieces.map((x) => new THREE.Box3().setFromObject(x).getSize(new THREE.Vector3())), size, p) : [{ key: "w:0", piece: -1, x: 0, z: 0 }];
    const keep = new Set(units.map((u) => u.key));
    for (const c of [...ctx.copies.children]) if (!keep.has(c.name)) ctx.copies.remove(c);
    for (const u of units) {
      let c = ctx.copies.getObjectByName(u.key);
      if (!c) {
        c = (u.piece < 0 ? o : pieces[u.piece]!).clone(true);
        c.name = u.key;
        c.position.set(u.x, 0, u.z);
        ctx.copies.add(c);
      }
      c.userData.target = new THREE.Vector3(u.x, 0, u.z);
    }
    const at = units.map((u) => [u.x, u.z] as [number, number]);

    // Kamera: beim Laden und bei anderer Anzahl auf die Exemplare samt etwas Platte ausrichten, sonst bleibt die Ansicht des Nutzers
    const framed = `${plateKey}|${n}|${loaded}`;
    if (ctx.framedFor !== framed) {
      ctx.framedFor = framed;
      const box = new THREE.Box3();
      for (const [x, z] of at) box.union(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, size.y / 2, z), size));
      if (p) {
        const min = Math.min(140, Math.max(...p.size) * 0.55);
        const c = box.getCenter(new THREE.Vector3());
        const s = box.getSize(new THREE.Vector3());
        box.setFromCenterAndSize(c, new THREE.Vector3(Math.max(s.x, min), Math.max(s.y, min * 0.25), Math.max(s.z, min)));
      }
      const helper = new THREE.Mesh(new THREE.BoxGeometry(...box.getSize(new THREE.Vector3()).toArray()));
      helper.position.copy(box.getCenter(new THREE.Vector3()));
      helper.updateMatrixWorld();
      const { target } = frame(ctx.camera, helper);
      helper.geometry.dispose();
      ctx.controls.target.copy(target);
      ctx.controls.update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plateKey, n, boxKey, loaded]);

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="absolute inset-0" />
      {state === "laden" && <div className="absolute inset-0 grid place-items-center text-sm text-ink3">3D-Modell wird geladen …</div>}
      {state === "fehler" && <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-ink3">Ansicht nicht möglich: {error}</div>}
      {size && state === "ok" && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-card/85 px-2.5 py-1 text-xs tnum text-ink2 shadow-card frost">
          {[size.x, size.z, size.y].map((v) => v.toFixed(1).replace(".", ",")).join(" × ")} mm{n > 1 ? ` · ${n} Stück` : ""}
        </div>
      )}
    </div>
  );
}
