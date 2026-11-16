import * as THREE from "three";

/**
 * Druckplatte für den 3D-Viewer: Federstahlblech in Bettgröße mit Griffzunge vorn, Oberfläche je Plattentyp als prozedurale Textur
 * (Farbe, Relief, Rauheit), Sperrbereich des Druckers schraffiert, darunter das Heizbett. Koordinaten wie im Viewer: Y oben,
 * Bettmitte im Ursprung, Druckervorderseite (Y = 0) zeigt nach +Z.
 */

type Surface = { base: string; light: string; dark: string; dots: number; size: [number, number]; rough: number; metal: number; bump: number; tile: number };

// Strukturierte PEI: goldene, körnige Pulverbeschichtung; glatte PEI: dunkel und glänzend; Cool/SuperTack/Engineering: graue Beschichtungen
const SURFACES: Record<string, Surface> = {
  "Textured PEI Plate": { base: "#b38c48", light: "#dcbb76", dark: "#86662f", dots: 42000, size: [0.5, 1.4], rough: 0.6, metal: 0.45, bump: 0.45, tile: 48 },
  "High Temp Plate": { base: "#1d1e20", light: "#3a3c40", dark: "#0c0c0d", dots: 5000, size: [0.4, 1], rough: 0.3, metal: 0.25, bump: 0.05, tile: 64 },
  "Supertack Plate": { base: "#2f3236", light: "#4a4e54", dark: "#1c1e21", dots: 18000, size: [0.4, 1.2], rough: 0.9, metal: 0.05, bump: 0.4, tile: 48 },
  "Cool Plate": { base: "#34373b", light: "#45494e", dark: "#25282b", dots: 4000, size: [0.4, 1], rough: 0.6, metal: 0.1, bump: 0.05, tile: 64 },
  "Engineering Plate": { base: "#3b3f44", light: "#555a60", dark: "#2a2d31", dots: 9000, size: [0.4, 1.1], rough: 0.5, metal: 0.2, bump: 0.15, tile: 64 },
};

// Feste Zufallsfolge, damit die Platte bei jedem Öffnen gleich aussieht
function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

const cache = new Map<string, { map: THREE.Texture; bump: THREE.Texture }>();

function surfaceTextures(type: string, s: Surface) {
  const hit = cache.get(type);
  if (hit) return hit;
  const N = 512;
  const color = document.createElement("canvas");
  const relief = document.createElement("canvas");
  color.width = color.height = relief.width = relief.height = N;
  const c = color.getContext("2d")!;
  const r = relief.getContext("2d")!;
  c.fillStyle = s.base;
  c.fillRect(0, 0, N, N);
  r.fillStyle = "#808080";
  r.fillRect(0, 0, N, N);
  const rand = rng(type.length * 7919 + 17);
  // Körner: jeweils hell oder dunkel, gleich ins Relief (hell = erhaben); an den Kanten umbrechen, damit die Kachel nahtlos ist
  for (let i = 0; i < s.dots; i++) {
    const x = rand() * N;
    const y = rand() * N;
    const rad = s.size[0] + rand() ** 2 * (s.size[1] - s.size[0]);
    const up = rand() > 0.45;
    c.globalAlpha = 0.12 + rand() * 0.3;
    c.fillStyle = up ? s.light : s.dark;
    r.globalAlpha = 0.5 + rand() * 0.5;
    r.fillStyle = up ? "#ffffff" : "#000000";
    for (const dx of [-N, 0, N])
      for (const dy of [-N, 0, N]) {
        if (x + dx < -4 || x + dx > N + 4 || y + dy < -4 || y + dy > N + 4) continue;
        c.beginPath();
        c.arc(x + dx, y + dy, rad, 0, Math.PI * 2);
        c.fill();
        r.beginPath();
        r.arc(x + dx, y + dy, rad, 0, Math.PI * 2);
        r.fill();
      }
  }
  const tex = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / s.tile, 1 / s.tile); // UV der Deckfläche = Millimeter
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const out = { map: tex(color, true), bump: tex(relief, false) };
  cache.set(type, out);
  return out;
}

let hatch: THREE.Texture | null = null;
function hatchTexture() {
  if (hatch) return hatch;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 32;
  const c = cv.getContext("2d")!;
  c.strokeStyle = "rgba(20,20,20,0.75)";
  c.lineWidth = 6;
  for (const o of [-32, 0, 32]) {
    c.beginPath();
    c.moveTo(o, 32);
    c.lineTo(o + 32, 0);
    c.stroke();
  }
  hatch = new THREE.CanvasTexture(cv);
  hatch.wrapS = hatch.wrapT = THREE.RepeatWrapping;
  hatch.repeat.set(1 / 6, 1 / 6);
  return hatch;
}

/** Umriss des Blechs: Bett plus Rand, runde Ecken, Griffzunge vorn in der Mitte (Formkoordinaten: Y = Drucker-Y − Tiefe/2) */
function sheetShape(w: number, h: number) {
  const m = 5;
  const [x0, x1, y0, y1, r] = [-w / 2 - m, w / 2 + m, -h / 2 - m, h / 2 + m, 7];
  const tw = Math.min(34, w / 6);
  const td = 9;
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0);
  s.lineTo(-tw, y0);
  s.lineTo(-tw, y0 - td + 4);
  s.quadraticCurveTo(-tw, y0 - td, -tw + 4, y0 - td);
  s.lineTo(tw - 4, y0 - td);
  s.quadraticCurveTo(tw, y0 - td, tw, y0 - td + 4);
  s.lineTo(tw, y0);
  s.lineTo(x1 - r, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r);
  s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

export type PlateSpec = { size: [number, number]; type: string; exclude?: string[] };

/** Baut die Platte; Oberkante der Beschichtung liegt bei Y = 0, damit Modelle (Unterseite Y = 0) aufstehen */
export function buildPlate({ size: [w, h], type, exclude = [] }: PlateSpec): THREE.Group {
  const g = new THREE.Group();
  const s = SURFACES[type] ?? SURFACES["Textured PEI Plate"]!;
  const { map, bump } = surfaceTextures(type in SURFACES ? type : "Textured PEI Plate", s);

  const T = 1.2;
  const geo = new THREE.ExtrudeGeometry(sheetShape(w, h), { depth: T, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.4, bevelSegments: 2, curveSegments: 10 });
  geo.rotateX(-Math.PI / 2); // Form-Y → −Z, Dicke nach oben
  geo.translate(0, -T - 0.25, 0);
  const top = new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: s.bump, roughness: s.rough, metalness: s.metal });
  const edge = new THREE.MeshStandardMaterial({ color: "#9aa0a6", roughness: 0.35, metalness: 0.85 });
  const sheet = new THREE.Mesh(geo, [top, edge]);
  sheet.receiveShadow = true;
  g.add(sheet);

  // Heizbett darunter, etwas größer, dunkel eloxiert
  const bedGeo = new THREE.BoxGeometry(w + 26, 7, h + 22);
  const bed = new THREE.Mesh(bedGeo, new THREE.MeshStandardMaterial({ color: "#26282b", roughness: 0.55, metalness: 0.4 }));
  bed.position.set(0, -T - 0.6 - 3.5, -2);
  bed.receiveShadow = true;
  g.add(bed);

  // Sperrbereich (z. B. Schneide vorn links): Vierecke aus je vier Punkten „XxY“, schraffiert
  const pts = exclude.map((p) => p.split("x").map(Number) as [number, number]).filter((p) => p.length === 2 && p.every(Number.isFinite));
  for (let i = 0; i + 3 < pts.length; i += 4) {
    const q = pts.slice(i, i + 4);
    const [minX, maxX] = [Math.min(...q.map((p) => p[0])), Math.max(...q.map((p) => p[0]))];
    const [minY, maxY] = [Math.min(...q.map((p) => p[1])), Math.max(...q.map((p) => p[1]))];
    if (maxX - minX < 0.5 || maxY - minY < 0.5) continue;
    const t = hatchTexture().clone();
    t.repeat.set((maxX - minX) / 6, (maxY - minY) / 6);
    t.needsUpdate = true;
    const zone = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX, maxY - minY), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    zone.rotation.x = -Math.PI / 2;
    zone.position.set((minX + maxX) / 2 - w / 2, 0.02, -((minY + maxY) / 2 - h / 2));
    g.add(zone);
  }
  return g;
}

/** Geometrie und Materialien freigeben (Texturen bleiben im Zwischenspeicher) */
export function disposePlate(g: THREE.Group) {
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    for (const m of [o.material].flat() as THREE.Material[]) {
      if (m instanceof THREE.MeshBasicMaterial && m.map && m.map !== hatch) m.map.dispose();
      m.dispose();
    }
  });
}
