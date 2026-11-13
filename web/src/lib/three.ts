import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import type { FileKind } from "../../../shared/types.ts";
import { api, fileUrl } from "../api.ts";

export const VIEWABLE: FileKind[] = ["stl", "obj", "3mf"];

/** Lädt eine Datei als Objekt, Z nach oben (Druckerkoordinaten) in Y nach oben gedreht, auf das Bett gestellt und zentriert */
export async function loadObject(id: number, kind: FileKind, color: string): Promise<THREE.Object3D> {
  const buf = await fetch(fileUrl.raw(id)).then((r) => {
    if (!r.ok) throw new Error("Datei nicht ladbar");
    return r.arrayBuffer();
  });
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
  let obj: THREE.Object3D;
  if (kind === "stl") {
    const geo = new STLLoader().parse(buf);
    geo.computeVertexNormals();
    obj = new THREE.Mesh(geo, mat);
  } else if (kind === "obj") {
    obj = new OBJLoader().parse(new TextDecoder().decode(buf));
    obj.traverse((o) => o instanceof THREE.Mesh && (o.material = mat));
  } else {
    obj = new ThreeMFLoader().parse(buf);
    let meshes = 0;
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        meshes++;
        // Farben aus der Datei behalten, sonst Standardmaterial
        if (!o.material || (o.material as THREE.MeshBasicMaterial).color?.getHex() === 0xffffff) o.material = mat;
      }
    });
    if (!meshes) throw new Error("Keine Geometrie in der 3MF-Datei");
  }
  const root = new THREE.Group();
  obj.rotation.x = -Math.PI / 2;
  root.add(obj);
  const box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return root;
}

export function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a80, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1, 2, 1.4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(-1.5, 0.8, -1);
  scene.add(fill);
}

/** Kamera so setzen, dass das Objekt schräg von vorne oben ganz ins Bild passt */
export function frame(camera: THREE.PerspectiveCamera, obj: THREE.Object3D, target = new THREE.Vector3()) {
  const box = new THREE.Box3().setFromObject(obj);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  target.copy(sphere.center);
  const fov = (camera.fov * Math.PI) / 180;
  const dist = (sphere.radius / Math.sin(Math.min(fov, fov * camera.aspect) / 2)) * 1.08;
  camera.position.copy(target).add(new THREE.Vector3(0.75, 0.62, 1).normalize().multiplyScalar(dist));
  camera.near = dist / 100;
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
  camera.lookAt(target);
  return { target, size: box.getSize(new THREE.Vector3()) };
}

// Vorschaubilder für STL/OBJ/3MF ohne eingebettetes Bild: im Browser rendern und am Server ablegen.
// Ein gemeinsamer Renderer, Aufträge nacheinander (Browser erlauben nur wenige WebGL-Kontexte).
let renderer: THREE.WebGLRenderer | null = null;
const queue: { id: number; kind: FileKind; done: (ok: boolean) => void }[] = [];
const queued = new Set<number>();
let busy = false;

export function requestThumb(id: number, kind: FileKind): Promise<boolean> {
  if (queued.has(id)) return Promise.resolve(false);
  queued.add(id);
  return new Promise((done) => {
    queue.push({ id, kind, done });
    void pump();
  });
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift()!;
    try {
      const blob = await renderThumb(job.id, job.kind);
      await api.putThumb(job.id, blob);
      job.done(true);
    } catch (e) {
      console.warn(`Vorschau für Datei ${job.id}:`, e);
      job.done(false);
    }
  }
  busy = false;
}

async function renderThumb(id: number, kind: FileKind): Promise<Blob> {
  const S = 512;
  renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(S, S, false);
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  addLights(scene);
  const obj = await loadObject(id, kind, "#c9c4bc");
  scene.add(obj);
  const cam = new THREE.PerspectiveCamera(32, 1);
  frame(cam, obj);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, cam);
  const blob = await new Promise<Blob | null>((res) => renderer!.domElement.toBlob(res, "image/png"));
  obj.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
  if (!blob) throw new Error("Rendern fehlgeschlagen");
  return blob;
}
