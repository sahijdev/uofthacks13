"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { compileScadToStlBytes } from "../lib/openscad";
import { useSearchParams } from "next/navigation";

// ============================================================
// LEGO constants (mm)
// ============================================================
const STUD_PITCH = 8.0; // X/Z grid spacing
const BRICK_H = 9.6; // Y height for a brick
const PLATE_H = BRICK_H / 3;

// ============================================================
// Brick Templates (piece library)
// ============================================================
const BRICK_DIMS = {
  // ---- Bricks ----
  "1x1": [1, 1],
  "1x2": [1, 2],
  "1x3": [1, 3],
  "1x4": [1, 4],
  "1x5": [1, 5],
  "1x6": [1, 6],
  "1x8": [1, 8],
  "1x10": [1, 10],
  "1x12": [1, 12],

  "2x2": [2, 2],
  "2x3": [2, 3],
  "2x4": [2, 4],
  "2x6": [2, 6],
  "2x8": [2, 8],
  "2x10": [2, 10],
  "2x12": [2, 12],

  "3x3": [3, 3],
  "3x4": [3, 4],
  "3x6": [3, 6],

  "4x4": [4, 4],
  "4x6": [4, 6],
  "4x8": [4, 8],

  // ---- Plates (1/3 height) ----
  "plate_1x1": [1, 1],
  "plate_1x2": [1, 2],
  "plate_1x3": [1, 3],
  "plate_1x4": [1, 4],
  "plate_1x6": [1, 6],
  "plate_1x8": [1, 8],

  "plate_2x2": [2, 2],
  "plate_2x3": [2, 3],
  "plate_2x4": [2, 4],
  "plate_2x6": [2, 6],
  "plate_2x8": [2, 8],
  "plate_2x10": [2, 10],

  "plate_3x3": [3, 3],
  "plate_4x4": [4, 4],

  // ---- Tiles (plate height, no studs) ----
  "tile_1x1": [1, 1],
  "tile_1x2": [1, 2],
  "tile_1x3": [1, 3],
  "tile_1x4": [1, 4],
  "tile_1x6": [1, 6],

  "tile_2x2": [2, 2],
  "tile_2x3": [2, 3],
  "tile_2x4": [2, 4],
  "tile_2x6": [2, 6],

  // ---- Simple slopes (wedge body) ----
  "slope_45_1x2": [1, 2],
  "slope_45_2x2": [2, 2],
  "slope_45_2x3": [2, 3],
  "slope_45_2x4": [2, 4],
  "slope_45_3x2": [3, 2],
  "slope_45_3x3": [3, 3],
} as const;

type BrickKind = keyof typeof BRICK_DIMS;

type Brick = {
  id: string;
  kind: BrickKind;

  // IMPORTANT (conventional Three.js):
  // X/Z = floor plane, Y = vertical
  xMm: number;
  yMm: number; // vertical (height)
  zMm: number;

  rotX: number;
  rotY: number;
  rotZ: number;

  color: [number, number, number];
};

type BrickGeomParams = {
  fn: number;
  stud_d: number;
  stud_h: number;
  wall_gap: number;
};

type GeomKey = string;

// ============================================================
// Helpers
// ============================================================
function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function rgb01ToHex(rgb: [number, number, number]) {
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`;
}
function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return [r / 255, g / 255, b / 255];
}

function stripScadComments(src: string) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock.replace(/\/\/.*$/gm, "");
}

function parseBrickDSL(scadText: string): Brick[] {
  const src = stripScadComments(scadText);
  const re = /brick\s*\(\s*"(.*?)"\s*,([\s\S]*?)\)\s*;?/g;

  const bricks: Brick[] = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(src))) {
    const kindRaw = (m[1] || "").trim();
    const args = m[2] || "";

    const kind = kindRaw as BrickKind;
    if (!(kind in BRICK_DIMS)) continue;

    const getNum = (name: string) => {
      const r = new RegExp(`${name}\\s*=\\s*([-+]?\\d*\\.?\\d+)`, "i").exec(args);
      return r ? Number(r[1]) : null;
    };
    const getVec3 = (name: string) => {
      const r = new RegExp(
        `${name}\\s*=\\s*\\[\\s*([-+]?\\d*\\.?\\d+)\\s*,\\s*([-+]?\\d*\\.?\\d+)\\s*,\\s*([-+]?\\d*\\.?\\d+)\\s*\\]`,
        "i"
      ).exec(args);
      return r ? ([Number(r[1]), Number(r[2]), Number(r[3])] as [number, number, number]) : null;
    };

    // Convention: X/Z plane, Y up
    const xMm = getNum("xMm");
    const yMm = getNum("yMm");
    const zMm = getNum("zMm");

    const xStud = getNum("xStud");
    const yStud = getNum("yStud");
    const zLevel = getNum("zLevel");

    let px = 0,
      py = 0,
      pz = 0;

    // If explicit mm is given, interpret it as (x,y,z) in THREE coordinates
    if (xMm != null && yMm != null && zMm != null) {
      px = xMm;
      py = yMm; // vertical
      pz = zMm;
    } else if (xStud != null && yStud != null && zLevel != null) {
      // studs mapping: xStud -> X, yStud -> Z, zLevel -> Y
      px = xStud * STUD_PITCH;
      pz = yStud * STUD_PITCH;
      py = zLevel * BRICK_H;
    }

    const rotArr = getVec3("rot");
    const rotY = getNum("rotY");

    let rx = 0,
      ry = 0,
      rz = 0;
    if (rotArr) [rx, ry, rz] = rotArr;
    else if (rotY != null) ry = rotY;

    const col = getVec3("color") ?? ([0.8, 0.1, 0.1] as [number, number, number]);
    const color: [number, number, number] = [clamp01(col[0]), clamp01(col[1]), clamp01(col[2])];

    bricks.push({
      id: uid(),
      kind,
      xMm: px,
      yMm: py,
      zMm: pz,
      rotX: rx,
      rotY: ry,
      rotZ: rz,
      color,
    });
  }

  return bricks;
}

function kindPretty(kind: BrickKind) {
  if (kind.startsWith("plate_")) return `plate ${kind.replace("plate_", "").replace("x", "×")}`;
  if (kind.startsWith("tile_")) return `tile ${kind.replace("tile_", "").replace("x", "×")}`;
  if (kind.startsWith("slope_")) return kind.replaceAll("_", " ");
  return `brick ${kind.replace("x", "×")}`;
}

function colorName(rgb: [number, number, number]) {
  const [r, g, b] = rgb;
  if (r > 0.7 && g > 0.7 && b < 0.35) return "yellow";
  if (r > 0.75 && g < 0.35 && b < 0.35) return "red";
  if (g > 0.65 && r < 0.45 && b < 0.55) return "green";
  if (b > 0.7 && r < 0.45 && g < 0.6) return "blue";
  if (r > 0.6 && g > 0.6 && b > 0.6) return "light gray";
  if (r < 0.35 && g < 0.35 && b < 0.35) return "dark gray";
  if (r > 0.6 && b > 0.6 && g < 0.5) return "purple";
  if (r > 0.7 && g > 0.4 && b < 0.3) return "orange";
  return "colored";
}

// ============================================================
// OpenSCAD geometry
// ============================================================
//
// We generate in OpenSCAD (Z-up), then when importing to Three (Y-up),
// we rotate the geometry -90° about X to convert axes.
// ============================================================
function buildBrickScad(kind: BrickKind, p: BrickGeomParams) {
  const { fn, stud_d, stud_h, wall_gap } = p;
  const [nx, ny] = BRICK_DIMS[kind];

  const isPlate = kind.startsWith("plate_");
  const isTile = kind.startsWith("tile_");
  const isSlope = kind.startsWith("slope_");

  const hasStuds = !isTile;
  const height = isPlate || isTile ? PLATE_H : BRICK_H;

  // Wedge: low edge at y=uY side; high edge at y=0 side (simple)
  const slopeBody = isSlope
    ? `
module slope_body(nx, ny, h) {
  uX = nx * stud_pitch - gap;
  uY = ny * stud_pitch - gap;

  // A clean 45-ish wedge: top plane ramps from 0 at y=uY to h at y=0
  polyhedron(
    points=[
      // bottom
      [0,0,0], [uX,0,0], [uX,uY,0], [0,uY,0],
      // top ridge (high edge at y=0)
      [0,0,h], [uX,0,h],
      // low edge at y=uY
      [uX,uY,0], [0,uY,0]
    ],
    faces=[
      [0,1,2,3],         // bottom
      [4,5,1,0],         // front (y=0)
      [1,5,6,2],         // right
      [0,3,7,4],         // left
      [3,2,6,7],         // back (y=uY)
      [4,7,6,5]          // sloped top
    ]
  );
}
`
    : "";

  const bodyCall = isSlope
    ? `slope_body(${nx}, ${ny}, brick_h);`
    : `cube([brick_u_x, brick_u_y, brick_h], center=false);`;

  return `
$fn = ${fn};

stud_pitch = ${STUD_PITCH};
brick_h    = ${height};

stud_d = ${stud_d};
stud_h = ${stud_h};
gap = ${wall_gap};

brick_u_x = ${nx} * stud_pitch - gap;
brick_u_y = ${ny} * stud_pitch - gap;

${slopeBody}

union() {
  ${bodyCall}

  ${hasStuds ? `
  for (ix=[0:${nx - 1}])
    for (iy=[0:${ny - 1}])
      translate([stud_pitch/2 + ix*stud_pitch,
                 stud_pitch/2 + iy*stud_pitch,
                 brick_h])
        cylinder(d=stud_d, h=stud_h, center=false);
  ` : ""}
}
`;
}

function geomKey(kind: BrickKind, p: BrickGeomParams): GeomKey {
  return JSON.stringify({ kind, ...p });
}

// ============================================================
// Highlight style (TRUE COLOR preserved)
// ============================================================
const SELECT_EMISSIVE = new THREE.Color(0.25, 0.9, 1.0);
const AUTO_EMISSIVE = new THREE.Color(1.0, 0.85, 0.2);
const BASE_EMISSIVE_INTENSITY = 0.0;
const SELECT_EMISSIVE_INTENSITY = 0.9;
const AUTO_EMISSIVE_INTENSITY = 0.85;

// ============================================================
// Main Component
// ============================================================
export default function ThreeEnvironment() {
  const [geomParams, setGeomParams] = useState<BrickGeomParams>({
    fn: 48,
    stud_d: 4.8,
    stud_h: 1.8,
    wall_gap: 0.02,
  });

  const opensCAD_DSL_Input = `/* Multi-template Brick DSL example (Three.js conventional: X/Z floor, Y up)
   * xStud -> X, yStud -> Z, zLevel -> Y (in bricks)
   */

brick("2x4", xStud=0, yStud=0, zLevel=0, rotY=0, color=[0.85,0.1,0.1]);
brick("2x2", xStud=2, yStud=0, zLevel=0, rotY=0, color=[0.1,0.7,0.2]);
brick("1x2", xStud=5, yStud=0, zLevel=0, rotY=90, color=[0.2,0.4,1.0]);

brick("plate_2x4", xStud=0, yStud=4, zLevel=0, rotY=0, color=[0.2,0.6,0.9]);
brick("tile_2x2", xStud=4, yStud=4, zLevel=0, rotY=0, color=[0.9,0.85,0.2]);
brick("slope_45_2x2", xStud=6, yStud=0, zLevel=0, rotY=90, color=[0.6,0.6,0.6]);

// explicit mm (x,y,z) where y is vertical:
brick("1x1", xMm=10.2, yMm=9.6, zMm=6.7, rot=[0,15,0], color=[0.2,0.9,0.3]);`;

  const searchParams = useSearchParams();
  const dslParam = searchParams.get("dsl");
  const [scadInput, setScadInput] = useState<string>(() =>
    dslParam ? decodeURIComponent(dslParam) : opensCAD_DSL_Input.trim()
  );

  const parsedBricks = useMemo(() => parseBrickDSL(scadInput), [scadInput]);
  const [bricks, setBricks] = useState<Brick[]>(parsedBricks);
  useEffect(() => setBricks(parsedBricks), [parsedBricks]);

  const [step, setStep] = useState(0);
  useEffect(() => setStep((s) => Math.min(s, bricks.length)), [bricks.length]);

  const [status, setStatus] = useState("idle");

  // Selection
  const selectedIndexRef = useRef<number | null>(null);
  const [selectedHex, setSelectedHex] = useState("#ffcc00");

  // Snap options
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapStud, setSnapStud] = useState(true);
  const [snapYLevels, setSnapYLevels] = useState(true);

  // THREE refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const tcontrolsRef = useRef<TransformControls | null>(null);
  const tcontrolsHelperRef = useRef<THREE.Object3D | null>(null);

  const rootRef = useRef<THREE.Group | null>(null);
  const brickMeshesRef = useRef<THREE.Mesh[]>([]);
  const animRef = useRef<number | null>(null);

  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());

  // Keep bricks in ref
  const bricksRef = useRef(bricks);
  useEffect(() => {
    bricksRef.current = bricks;
  }, [bricks]);

  // Geometry cache
  const geomCacheRef = useRef<Map<GeomKey, THREE.BufferGeometry>>(new Map());
  const geomPromiseRef = useRef<Map<GeomKey, Promise<THREE.BufferGeometry>>>(new Map());

  // Placeholder geometry (X/Z footprint, Y height)
  const placeholderGeomRef = useRef<THREE.BufferGeometry | null>(null);
  if (!placeholderGeomRef.current)
    placeholderGeomRef.current = new THREE.BoxGeometry(STUD_PITCH, BRICK_H, STUD_PITCH);

  async function getBrickGeometry(kind: BrickKind, p: BrickGeomParams): Promise<THREE.BufferGeometry> {
    const key = geomKey(kind, p);
    const cached = geomCacheRef.current.get(key);
    if (cached) return cached;

    const inflight = geomPromiseRef.current.get(key);
    if (inflight) return inflight;

    const promise = (async () => {
      const scad = buildBrickScad(kind, p);
      const bytes = await compileScadToStlBytes(scad);

      const loader = new STLLoader();
      const geo = loader.parse(bytes.buffer);

      // ✅ CRITICAL FIX: OpenSCAD (Z-up) -> Three.js (Y-up)
      geo.rotateX(-Math.PI / 2);

      geo.computeVertexNormals();

      geomCacheRef.current.set(key, geo);
      geomPromiseRef.current.delete(key);
      return geo;
    })();

    geomPromiseRef.current.set(key, promise);
    return promise;
  }

  // ============================================================
  // Highlight + animation state
  // ============================================================
  const autoHighlightIdxRef = useRef<number | null>(null);

  const pulseRef = useRef<{ active: boolean; t0: number; ms: number; strength: number }>({
    active: false,
    t0: 0,
    ms: 700,
    strength: 0.9,
  });

  const popRef = useRef<Map<number, { active: boolean; t0: number; ms: number }>>(new Map());

  function startPulse(ms: number, strength = 0.9) {
    pulseRef.current = { active: true, t0: performance.now(), ms, strength };
  }
  function startPop(idx: number, ms = 260) {
    popRef.current.set(idx, { active: true, t0: performance.now(), ms });
  }

  function applyMaterialState(i: number, extraPulse = 0) {
    const mesh = brickMeshesRef.current[i];
    if (!mesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;

    const isSelected = selectedIndexRef.current === i;
    const isAuto = autoHighlightIdxRef.current === i && selectedIndexRef.current == null;

    if (isSelected) {
      mat.emissive.copy(SELECT_EMISSIVE);
      mat.emissiveIntensity = SELECT_EMISSIVE_INTENSITY + extraPulse;
    } else if (isAuto) {
      mat.emissive.copy(AUTO_EMISSIVE);
      mat.emissiveIntensity = AUTO_EMISSIVE_INTENSITY + extraPulse;
    } else {
      mat.emissive.setRGB(0, 0, 0);
      mat.emissiveIntensity = BASE_EMISSIVE_INTENSITY;
    }
    mat.needsUpdate = true;
  }

  function refreshAllMaterials(extraPulse = 0) {
    for (let i = 0; i < brickMeshesRef.current.length; i++) applyMaterialState(i, extraPulse);
  }

  function setAutoHighlight(idx: number | null) {
    autoHighlightIdxRef.current = idx;
    refreshAllMaterials();
  }

  // ============================================================
  // Modifier keys
  // ============================================================
  const keysRef = useRef({ ctrl: false });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Control") keysRef.current.ctrl = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Control") keysRef.current.ctrl = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ============================================================
  // Clean movement/rotation: snap + commit ONLY at drag end
  // ============================================================
  const gizmoActiveRef = useRef(false);

  function snapValue(v: number, stepV: number) {
    return Math.round(v / stepV) * stepV;
  }
  function snapEulerToDegStep(e: THREE.Euler, stepDeg: number) {
    const stepRad = THREE.MathUtils.degToRad(stepDeg);
    e.x = Math.round(e.x / stepRad) * stepRad;
    e.y = Math.round(e.y / stepRad) * stepRad;
    e.z = Math.round(e.z / stepRad) * stepRad;
  }

  function applySnapToMesh(mesh: THREE.Object3D) {
    if (!snapEnabled) return;
    if (keysRef.current.ctrl) return;

    const stepXZ = snapStud ? STUD_PITCH : 1.0;
    const stepY = snapYLevels ? PLATE_H : 1.0;

    mesh.position.x = snapValue(mesh.position.x, stepXZ);
    mesh.position.z = snapValue(mesh.position.z, stepXZ);
    mesh.position.y = snapValue(mesh.position.y, stepY);

    snapEulerToDegStep(mesh.rotation, 90);
  }

  function commitSelectedMeshToState() {
    const idx = selectedIndexRef.current;
    if (idx == null) return;

    const mesh = brickMeshesRef.current[idx];
    if (!mesh) return;

    applySnapToMesh(mesh);

    const pos = mesh.position;
    const rot = mesh.rotation;

    setBricks((prev) => {
      if (!prev[idx]) return prev;
      const next = prev.slice();
      next[idx] = {
        ...next[idx],
        xMm: pos.x,
        yMm: pos.y,
        zMm: pos.z,
        rotX: THREE.MathUtils.radToDeg(rot.x),
        rotY: THREE.MathUtils.radToDeg(rot.y),
        rotZ: THREE.MathUtils.radToDeg(rot.z),
      };
      return next;
    });
  }

  // ============================================================
  // Scene init
  // ============================================================
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(6, 10, 6);
    scene.add(dir);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
    camera.position.set(180, 220, 260);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;

    // Grid is X/Z plane (Y up) -> exactly what we want now
    scene.add(new THREE.GridHelper(800, 80));
    scene.add(new THREE.AxesHelper(120));

    const tcontrols = new TransformControls(camera, renderer.domElement);
    tcontrols.setMode("translate");

    const helper = tcontrols.getHelper();
    tcontrolsHelperRef.current = helper;
    scene.add(helper);

    helper.traverse((o: any) => {
      if (o.material) {
        o.material.depthTest = false;
        o.renderOrder = 999;
      }
    });

    tcontrols.addEventListener("mouseDown" as any, () => {
      gizmoActiveRef.current = true;
      orbit.enabled = false;
    });

    tcontrols.addEventListener("mouseUp" as any, () => {
      gizmoActiveRef.current = false;
      orbit.enabled = true;
      commitSelectedMeshToState();
    });

    tcontrols.addEventListener("dragging-changed" as any, (ev: any) => {
      orbit.enabled = !ev.value;
      if (!ev.value) commitSelectedMeshToState();
    });

    const resize = () => {
      const w = container.clientWidth || 650;
      const h = container.clientHeight || 650;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", resize);
    resize();

    const animate = () => {
      orbit.update();
      tcontrols.update();

      // emissive pulse (global)
      if (pulseRef.current.active) {
        const now = performance.now();
        const { t0, ms, strength } = pulseRef.current;
        const u = (now - t0) / ms;

        if (u >= 1) {
          pulseRef.current.active = false;
          refreshAllMaterials(0);
        } else {
          const k = Math.sin(u * Math.PI);
          const extra = strength * k;
          refreshAllMaterials(extra);
        }
      }

      // per-mesh pop (scale)
      for (const [idx, st] of popRef.current.entries()) {
        const mesh = brickMeshesRef.current[idx];
        if (!mesh) continue;

        const u = (performance.now() - st.t0) / st.ms;
        if (u >= 1) {
          mesh.scale.set(1, 1, 1);
          popRef.current.delete(idx);
        } else {
          const k = Math.sin(u * Math.PI);
          const s = 1 + 0.15 * k;
          mesh.scale.set(s, s, s);
        }
      }

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(animate);
    };
    animate();

    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;
    orbitRef.current = orbit;
    tcontrolsRef.current = tcontrols;

    return () => {
      window.removeEventListener("resize", resize);
      if (animRef.current) cancelAnimationFrame(animRef.current);

      if (tcontrolsHelperRef.current) {
        scene.remove(tcontrolsHelperRef.current);
        tcontrolsHelperRef.current = null;
      }

      tcontrols.dispose();
      orbit.dispose();
      renderer.dispose();
      container.innerHTML = "";
    };
  }, []);

  // ============================================================
  // Progressive build: placeholders immediately, swap geos as compiled
  // ============================================================
  const kindsKey = useMemo(() => bricks.map((b) => b.kind).join("|"), [bricks]);

  useEffect(() => {
    let cancelled = false;

    async function rebuildProgressive() {
      const scene = sceneRef.current;
      if (!scene) return;

      const bricksNow = bricksRef.current;
      const visibleCount = Math.max(0, Math.min(step, bricksNow.length));

      setStatus("building (placeholders)...");

      // clear old root
      if (rootRef.current) {
        scene.remove(rootRef.current);
        rootRef.current.traverse((o: any) => {
          if (o.material) o.material.dispose?.();
        });
        rootRef.current = null;
      }

      brickMeshesRef.current = [];
      selectedIndexRef.current = null;
      setAutoHighlight(null);
      popRef.current.clear();
      tcontrolsRef.current?.detach();

      // create placeholder meshes immediately
      const root = new THREE.Group();
      rootRef.current = root;
      scene.add(root);

      const placeholder = placeholderGeomRef.current!;

      for (let i = 0; i < bricksNow.length; i++) {
        const b = bricksNow[i];

        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(b.color[0], b.color[1], b.color[2]),
          roughness: 0.55,
          metalness: 0.05,
          emissive: new THREE.Color(0, 0, 0),
          emissiveIntensity: 0,
          transparent: true,
          opacity: 0.35,
        });

        const mesh = new THREE.Mesh(placeholder, mat);
        mesh.userData = { brickIndex: i };

        mesh.position.set(b.xMm, b.yMm, b.zMm);
        mesh.rotation.set(
          THREE.MathUtils.degToRad(b.rotX),
          THREE.MathUtils.degToRad(b.rotY),
          THREE.MathUtils.degToRad(b.rotZ)
        );

        mesh.visible = i < visibleCount;

        root.add(mesh);
        brickMeshesRef.current.push(mesh);
      }

      refreshAllMaterials();

      const kindsNeeded = Array.from(new Set(bricksNow.map((b) => b.kind)));
      let done = 0;
      setStatus(`compiling 0/${kindsNeeded.length} kinds...`);

      await Promise.all(
        kindsNeeded.map(async (kind) => {
          try {
            const geo = await getBrickGeometry(kind, geomParams);
            if (cancelled) return;

            for (let i = 0; i < brickMeshesRef.current.length; i++) {
              const mesh = brickMeshesRef.current[i];
              const b = bricksRef.current[i];
              if (!mesh || !b) continue;
              if (b.kind !== kind) continue;

              mesh.geometry = geo;

              const mat = mesh.material as THREE.MeshStandardMaterial;
              mat.opacity = 1;
              mat.transparent = false;
              mat.needsUpdate = true;
            }

            done += 1;
            setStatus(`compiling ${done}/${kindsNeeded.length} kinds...`);
          } catch {
            done += 1;
            setStatus(`compiling ${done}/${kindsNeeded.length} kinds (some failed)`);
          }
        })
      );

      if (cancelled) return;

      setStatus(`ready (${visibleCount}/${bricksRef.current.length} visible)`);

      const idx = visibleCount > 0 ? visibleCount - 1 : null;
      if (selectedIndexRef.current == null) setAutoHighlight(idx);
      if (idx != null) {
        startPulse(650, 0.8);
        startPop(idx, 260);
      }
    }

    rebuildProgressive().catch((e) => {
      if (!cancelled) setStatus(`error: ${String((e as any)?.message ?? e)}`);
    });

    return () => {
      cancelled = true;
    };
  }, [geomParams, step, bricks.length, kindsKey]);

  // ============================================================
  // Sync transforms/colors when bricks change (NO rebuild)
  // ============================================================
  useEffect(() => {
    const meshes = brickMeshesRef.current;
    if (!meshes.length) return;

    const visibleCount = Math.max(0, Math.min(step, bricks.length));
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      const b = bricks[i];
      if (!mesh || !b) continue;

      mesh.visible = i < visibleCount;
      mesh.position.set(b.xMm, b.yMm, b.zMm);
      mesh.rotation.set(
        THREE.MathUtils.degToRad(b.rotX),
        THREE.MathUtils.degToRad(b.rotY),
        THREE.MathUtils.degToRad(b.rotZ)
      );

      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.setRGB(b.color[0], b.color[1], b.color[2]);
      mat.needsUpdate = true;
    }

    refreshAllMaterials();
  }, [bricks, step]);

  // ============================================================
  // Step transitions
  // ============================================================
  const prevStepRef = useRef(step);
  useEffect(() => {
    const prev = prevStepRef.current;
    prevStepRef.current = step;

    if (step > prev) {
      const visibleCount = Math.max(0, Math.min(step, bricks.length));
      const idx = visibleCount > 0 ? visibleCount - 1 : null;

      if (selectedIndexRef.current == null) setAutoHighlight(idx);
      if (idx != null) startPop(idx, 280);

      startPulse(step === bricks.length ? 1200 : 700, step === bricks.length ? 1.2 : 0.9);
    }
  }, [step, bricks.length]);

  // ============================================================
  // Hotkeys
  // ============================================================
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = tcontrolsRef.current;
      if (!t) return;

      if (e.key === "w" || e.key === "W") t.setMode("translate");
      if (e.key === "e" || e.key === "E") t.setMode("rotate");

      if (e.key === "Escape") {
        selectedIndexRef.current = null;
        t.detach();
        setStatus("no selection");

        const visibleCount = Math.max(0, Math.min(step, bricks.length));
        const idx = visibleCount > 0 ? visibleCount - 1 : null;
        setAutoHighlight(idx);
        startPulse(450, 0.8);
      }

      if (e.key === "Enter") setStep((s) => Math.min(bricks.length, s + 1));

      if (e.key === "Backspace") {
        const active = document.activeElement as HTMLElement | null;
        if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) return;
        setStep((s) => Math.max(0, s - 1));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step, bricks.length]);

  // ============================================================
  // Click select -> attach gizmo (ignore gizmo)
  // ============================================================
  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const tcontrols = tcontrolsRef.current;
    if (!renderer || !camera || !tcontrols) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (gizmoActiveRef.current) return;
      if ((tcontrols as any).axis != null) return;

      const meshes = brickMeshesRef.current;
      if (!meshes.length) return;

      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = mouseRef.current;
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      const ray = raycasterRef.current;
      ray.setFromCamera(mouse, camera);

      const visibleMeshes = meshes.filter((m) => m.visible);
      const hits = ray.intersectObjects(visibleMeshes, false);

      if (!hits.length) {
        selectedIndexRef.current = null;
        tcontrols.detach();
        setStatus("no selection");

        const visibleCount = Math.max(0, Math.min(step, bricks.length));
        const idx = visibleCount > 0 ? visibleCount - 1 : null;
        setAutoHighlight(idx);
        startPulse(350, 0.7);
        return;
      }

      const obj = hits[0].object as THREE.Mesh;
      const idx = obj.userData?.brickIndex as number | undefined;
      if (idx == null) return;

      selectedIndexRef.current = idx;

      const b = bricksRef.current[idx];
      setSelectedHex(rgb01ToHex(b.color));

      setAutoHighlight(null);
      refreshAllMaterials();
      startPulse(450, 0.9);
      startPop(idx, 220);

      setStatus(`selected brickIndex=${idx} kind=${b.kind}`);
      tcontrols.attach(obj);
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    return () => renderer.domElement.removeEventListener("pointerdown", onPointerDown);
  }, [step, bricks.length]);

  // ============================================================
  // Mutators
  // ============================================================
  function applySelectedColor(hex: string) {
    const idx = selectedIndexRef.current;
    if (idx == null) return;

    const rgb = hexToRgb01(hex);

    setBricks((prev) => {
      if (!prev[idx]) return prev;
      const next = prev.slice();
      next[idx] = { ...next[idx], color: rgb };
      return next;
    });
  }

  function resetCamera() {
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    if (!camera || !orbit) return;
    camera.position.set(180, 220, 260);
    orbit.target.set(0, 0, 0);
    orbit.update();
  }

  function setMode(mode: "translate" | "rotate") {
    const t = tcontrolsRef.current;
    if (!t) return;
    t.setMode(mode);
  }

  const visibleCount = Math.max(0, Math.min(step, bricks.length));
  const selIdx = selectedIndexRef.current;
  const selectedBrick = selIdx != null ? bricks[selIdx] : null;

  const instructionIdx = visibleCount > 0 ? visibleCount - 1 : null;
  const instructionBrick = instructionIdx != null ? bricks[instructionIdx] : null;

  const instructionText = !bricks.length
    ? "Add bricks in the DSL to generate a blueprint."
    : visibleCount === 0
    ? "Press Next to reveal step 1."
    : instructionBrick
    ? `Place the ${colorName(instructionBrick.color)} ${kindPretty(instructionBrick.kind)} where highlighted.`
    : "Press Next to continue.";

  const finished = bricks.length > 0 && step === bricks.length;

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#fff5d6] via-[#ffe9a7] to-[#ffd166] text-slate-900">
      <div className="border-b-2 border-[#0ea5e9] bg-[#fef08a] shadow-[0_6px_0_#f59e0b]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3 text-lg font-black text-[#111827]">
            <img src="/rocket.png" alt="Bricked" className="h-8 w-8 drop-shadow-[0_2px_0_#0f2f86]" />
            Bricked — 3D Blueprint
          </div>

          <div className="flex items-center gap-2 text-xs font-semibold text-[#0f172a]">
            <button
              onClick={() => window.location.assign("/models")}
              className="rounded-full border-2 border-[#ef4444] bg-white px-3 py-1 shadow-[0_6px_0_#b91c1c33] transition hover:-translate-y-0.5 hover:shadow-[0_8px_0_#b91c1c55]"
            >
              ← Back to builds
            </button>
            <span className="rounded-full bg-white px-3 py-1 shadow-[0_6px_0_#0f2f86]">
              Status: <span className="font-black">{status}</span>
            </span>
            <button
              onClick={resetCamera}
              className="rounded-full border-2 border-[#1d4ed8] bg-[#e0e7ff] px-3 py-1 shadow-[0_6px_0_#0f2f86] transition hover:-translate-y-0.5 hover:border-[#ef4444] hover:shadow-[0_8px_0_#b91c1c]"
            >
              Reset camera
            </button>
          </div>
        </div>
      </div>

      <div className="relative mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_20%,rgba(29,78,216,0.18),transparent_26%),radial-gradient(circle_at_85%_15%,rgba(239,68,68,0.2),transparent_30%),radial-gradient(circle_at_70%_75%,rgba(16,185,129,0.18),transparent_32%)]" />

        <div className="relative grid gap-4 lg:grid-cols-[420px_1fr]">
          <div className="space-y-4">
            <section className="relative overflow-hidden rounded-2xl border-2 border-[#1d4ed8] bg-white p-4 shadow-[0_10px_0_#0f2f86]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(251,191,36,0.18),transparent_45%)]" />

              <div className="relative space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-[#1d4ed8]">Blueprint</p>
                  <span className={["rounded-full bg-white px-3 py-1 text-[11px] font-black uppercase tracking-wide shadow-[0_6px_0_#0f2f86] transition", step > 0 ? "animate-bounce" : ""].join(" ")}>
                    Step {Math.max(0, visibleCount)}
                  </span>
                </div>

                <h2 className="text-lg font-black text-[#0f172a]">3D Lego instructions</h2>
                <p className="text-sm text-slate-700">Now conventional: floor is X/Z, vertical is Y. No more -90° nonsense.</p>

                <div
                  className={[
                    "rounded-xl border-2 p-3 text-sm font-semibold text-[#0f172a] shadow-[0_8px_0_#0f2f86] transition",
                    finished ? "border-[#16a34a] bg-[#ecfdf3] ring-4 ring-[#22c55e]/30 animate-pulse" : "border-[#0ea5e9] bg-[#e0f2fe]",
                  ].join(" ")}
                >
                  <div className="flex items-start gap-2">
                    <span className={["mt-1 h-2 w-2 rounded-full shadow-[0_0_0_3px_#0f2f86]", finished ? "bg-[#16a34a]" : "bg-[#ef4444]"].join(" ")} />
                    <span>{finished ? "Build complete. Nice." : instructionText}</span>
                  </div>

                  <div className="mt-2 text-xs text-slate-700">
                    Keys: <span className="font-black">W</span> move, <span className="font-black">E</span> rotate,{" "}
                    <span className="font-black">Ctrl</span> disables snap, <span className="font-black">Enter</span> next,{" "}
                    <span className="font-black">Backspace</span> prev, <span className="font-black">Esc</span> deselect.
                  </div>
                </div>

                <div className="grid gap-2">
                  <ThemedSlider label={`Step: ${visibleCount}/${bricks.length}`} min={0} max={bricks.length} step={1} value={step} onChange={(v) => setStep(v)} />
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setStep((s) => Math.max(0, s - 1))}
                      className="rounded-xl border-2 border-[#1d4ed8] bg-[#e0e7ff] px-3 py-2 text-xs font-semibold text-[#0f172a] shadow-[0_6px_0_#0f2f86] transition hover:-translate-y-0.5 hover:border-[#ef4444] hover:shadow-[0_8px_0_#b91c1c]"
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setStep((s) => Math.min(bricks.length, s + 1))}
                      className="rounded-xl bg-[#fbbf24] px-4 py-2 text-xs font-black uppercase tracking-wide text-[#92400e] shadow-[0_8px_0_#d97706] transition hover:-translate-y-0.5 hover:shadow-[0_10px_0_#b45309]"
                    >
                      Next
                    </button>
                    <button
                      onClick={() => {
                        setStep(bricks.length);
                        startPulse(1400, 1.2);
                      }}
                      className="rounded-xl border-2 border-[#16a34a] bg-[#ecfdf3] px-3 py-2 text-xs font-semibold text-[#166534] shadow-[0_6px_0_#15803d] transition hover:-translate-y-0.5 hover:shadow-[0_8px_0_#15803d]"
                    >
                      Finish build
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={() => setMode("translate")}
                    className="rounded-xl border-2 border-[#ef4444] bg-white px-3 py-2 text-xs font-semibold text-[#b91c1c] shadow-[0_6px_0_#b91c1c33] transition hover:-translate-y-0.5 hover:shadow-[0_8px_0_#b91c1c55]"
                  >
                    Move (W)
                  </button>
                  <button
                    onClick={() => setMode("rotate")}
                    className="rounded-xl border-2 border-[#0ea5e9] bg-[#e0f2fe] px-3 py-2 text-xs font-semibold text-[#0f172a] shadow-[0_6px_0_#0f2f86] transition hover:-translate-y-0.5 hover:shadow-[0_8px_0_#0f2f86]"
                  >
                    Rotate (E)
                  </button>
                </div>
              </div>
            </section>

            <section className="relative overflow-hidden rounded-2xl border-2 border-[#16a34a] bg-white p-4 shadow-[0_10px_0_#15803d]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(16,185,129,0.16),transparent_40%)]" />
              <div className="relative space-y-3">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-[#15803d]">Snapping</p>

                <label className="flex items-center gap-3 text-sm font-semibold text-[#0f172a]">
                  <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} className="h-4 w-4 accent-[#16a34a]" />
                  Snap enabled
                </label>

                <label className="flex items-center gap-3 text-sm font-semibold text-[#0f172a]">
                  <input type="checkbox" checked={snapStud} onChange={(e) => setSnapStud(e.target.checked)} className="h-4 w-4 accent-[#16a34a]" />
                  Snap X/Z to studs (8mm) — off = 1mm
                </label>

                <label className="flex items-center gap-3 text-sm font-semibold text-[#0f172a]">
                  <input type="checkbox" checked={snapYLevels} onChange={(e) => setSnapYLevels(e.target.checked)} className="h-4 w-4 accent-[#16a34a]" />
                  Snap Y to LEGO levels (plate height)
                </label>
              </div>
            </section>

            <section className="relative overflow-hidden rounded-2xl border-2 border-[#0ea5e9] bg-white p-4 shadow-[0_10px_0_#0f2f86]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_20%,rgba(14,165,233,0.16),transparent_40%)]" />
              <div className="relative space-y-3">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0ea5e9]">Geometry</p>
                <p className="text-sm text-slate-700">
                  Recompiles STL per <span className="font-black">kind + params</span> (cached).
                </p>

                <div className="space-y-3">
                  <ThemedSlider label="$fn" min={12} max={128} step={1} value={geomParams.fn} onChange={(v) => setGeomParams((p) => ({ ...p, fn: v }))} />
                  <ThemedSlider label="stud_d" min={3.5} max={6.0} step={0.1} value={geomParams.stud_d} onChange={(v) => setGeomParams((p) => ({ ...p, stud_d: v }))} />
                  <ThemedSlider label="stud_h" min={0.8} max={3.0} step={0.1} value={geomParams.stud_h} onChange={(v) => setGeomParams((p) => ({ ...p, stud_h: v }))} />
                  <ThemedSlider label="wall_gap" min={0.0} max={0.2} step={0.01} value={geomParams.wall_gap} onChange={(v) => setGeomParams((p) => ({ ...p, wall_gap: v }))} />
                </div>
              </div>
            </section>

            <section className="relative overflow-hidden rounded-2xl border-2 border-[#ef4444] bg-white p-4 shadow-[0_10px_0_#b91c1c]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_20%,rgba(251,191,36,0.22),transparent_40%)]" />
              <div className="relative space-y-2">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-[#b91c1c]">Selected</p>

                {selectedBrick ? (
                  <div className="space-y-2 text-sm font-semibold text-[#0f172a]">
                    <div>
                      kind: <span className="font-black">{selectedBrick.kind}</span>
                    </div>
                    <div className="text-xs text-slate-700">
                      pos(mm): ({selectedBrick.xMm.toFixed(2)}, {selectedBrick.yMm.toFixed(2)}, {selectedBrick.zMm.toFixed(2)})
                    </div>
                    <div className="text-xs text-slate-700">
                      rot(deg): ({selectedBrick.rotX.toFixed(1)}, {selectedBrick.rotY.toFixed(1)}, {selectedBrick.rotZ.toFixed(1)})
                    </div>

                    <label className="block">
                      <div className="flex items-center justify-between text-xs text-slate-700">
                        <span className="font-black uppercase tracking-wide">Color</span>
                        <span className="font-mono">{selectedHex}</span>
                      </div>
                      <input
                        type="color"
                        value={selectedHex}
                        onChange={(e) => {
                          const hex = e.target.value;
                          setSelectedHex(hex);
                          applySelectedColor(hex);
                        }}
                        className="mt-2 h-10 w-full cursor-pointer rounded-xl border-2 border-[#ef4444] bg-[#fff7ed] shadow-[0_6px_0_#b91c1c]"
                      />
                    </label>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-slate-700">None selected (click a visible brick).</p>
                )}
              </div>
            </section>

            <section className="relative overflow-hidden rounded-2xl border-2 border-[#1d4ed8] bg-white p-4 shadow-[0_10px_0_#0f2f86]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(29,78,216,0.14),transparent_45%)]" />
              <div className="relative space-y-2">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-[#1d4ed8]">Brick DSL</p>
                <textarea
                  value={scadInput}
                  onChange={(e) => setScadInput(e.target.value)}
                  className="h-56 w-full rounded-2xl border-2 border-[#ef4444] bg-[#fff7ed] p-3 font-mono text-[12px] text-[#0f172a] shadow-[0_10px_0_#b91c1c] outline-none transition focus:-translate-y-0.5 focus:border-[#1d4ed8] focus:shadow-[0_12px_0_#0f2f86]"
                />
                <div className="text-xs text-slate-700">
                  Supported kinds:{" "}
                  <span className="font-mono text-[11px] text-[#0f172a]">{Object.keys(BRICK_DIMS).join(", ")}</span>
                </div>
              </div>
            </section>
          </div>

          <section className="relative overflow-hidden rounded-2xl border-2 border-[#0ea5e9] bg-white p-3 shadow-[0_10px_0_#0f2f86]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(14,165,233,0.14),transparent_42%)]" />
            <div className="relative">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-black text-[#0f172a]">Scene</div>
                <div className="text-xs font-semibold text-slate-700">Tip: click a brick to edit; snapping applies on release.</div>
              </div>

              <div ref={containerRef} className="h-[650px] w-full rounded-xl border-2 border-[#111827] bg-white" />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

// ============================================================
// Themed Slider (Tailwind)
// ============================================================
function ThemedSlider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="grid gap-2">
      <div className="flex items-center justify-between text-xs font-semibold text-[#0f172a]">
        <span className="uppercase tracking-wide">{props.label}</span>
        <span className="rounded-full bg-white px-2 py-0.5 font-mono shadow-[0_4px_0_#0f2f86]">
          {Number.isInteger(props.value) ? props.value : props.value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer accent-[#ef4444]"
      />
    </label>
  );
}
