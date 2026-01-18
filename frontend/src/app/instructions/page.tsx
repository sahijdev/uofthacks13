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
const STUD_PITCH = 8.0;
const BRICK_H = 9.6;

// ============================================================
// Brick Templates (piece library)
// ============================================================
const BRICK_DIMS = {
  // Bricks
  "1x1": [1, 1],
  "1x2": [1, 2],
  "1x3": [1, 3],
  "1x4": [1, 4],
  "1x6": [1, 6],
  "1x8": [1, 8],

  "2x2": [2, 2],
  "2x3": [2, 3],
  "2x4": [2, 4],
  "2x6": [2, 6],
  "2x8": [2, 8],
  "2x10": [2, 10],

  "3x3": [3, 3],
  "4x4": [4, 4],

  // Plates (1/3 height)
  "plate_1x2": [1, 2],
  "plate_1x4": [1, 4],
  "plate_2x2": [2, 2],
  "plate_2x4": [2, 4],
  "plate_2x6": [2, 6],

  // Tiles (plate height, no studs)
  "tile_1x2": [1, 2],
  "tile_1x4": [1, 4],
  "tile_2x2": [2, 2],
  "tile_2x4": [2, 4],

  // Simple slopes (wedge body)
  "slope_45_2x2": [2, 2],
  "slope_45_2x4": [2, 4],
} as const;

type BrickKind = keyof typeof BRICK_DIMS;

type Brick = {
  id: string;
  kind: BrickKind;

  xMm: number;
  yMm: number;
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
function blend(a: [number, number, number], b: [number, number, number], t: number) {
  t = clamp01(t);
  return [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t, a[2] * (1 - t) + b[2] * t] as [
    number,
    number,
    number,
  ];
}
const HIGHLIGHT_T = 0.55;
const HIGHLIGHT_RGB: [number, number, number] = [1, 1, 0];

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
        "i",
      ).exec(args);
      return r ? ([Number(r[1]), Number(r[2]), Number(r[3])] as [number, number, number]) : null;
    };

    const xMm = getNum("xMm");
    const yMm = getNum("yMm");
    const zMm = getNum("zMm");

    const xStud = getNum("xStud");
    const yStud = getNum("yStud");
    const zLevel = getNum("zLevel");

    let px = 0,
      py = 0,
      pz = 0;

    if (xMm != null && yMm != null && zMm != null) {
      px = xMm;
      py = yMm;
      pz = zMm;
    } else if (xStud != null && yStud != null && zLevel != null) {
      px = xStud * STUD_PITCH;
      py = yStud * STUD_PITCH;
      pz = zLevel * BRICK_H;
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

// small “good enough” name for instruction text
function kindPretty(kind: BrickKind) {
  if (kind.startsWith("plate_")) return `plate ${kind.replace("plate_", "").replace("_", "×")}`;
  if (kind.startsWith("tile_")) return `tile ${kind.replace("tile_", "").replace("_", "×")}`;
  if (kind.startsWith("slope_")) return kind.replaceAll("_", " ");
  return `brick ${kind.replace("x", "×")}`;
}

function colorName(rgb: [number, number, number]) {
  const [r, g, b] = rgb;
  // super rough buckets (fast + stable)
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
function buildBrickScad(kind: BrickKind, p: BrickGeomParams) {
  const { fn, stud_d, stud_h, wall_gap } = p;
  const [nx, ny] = BRICK_DIMS[kind];

  const isPlate = kind.startsWith("plate_");
  const isTile = kind.startsWith("tile_");
  const isSlope = kind.startsWith("slope_");

  const hasStuds = !isTile;
  const height = isPlate || isTile ? BRICK_H / 3 : BRICK_H;

  const slopeBody = isSlope
    ? `
module slope_body(nx, ny, h) {
  uX = nx * stud_pitch - gap;
  uY = ny * stud_pitch - gap;
  polyhedron(
    points=[
      [0,0,0], [uX,0,0], [uX,uY,0], [0,uY,0],
      [0,0,h], [uX,0,h], [uX,uY,h], [0,uY,h/2]
    ],
    faces=[
      [0,1,2,3], [4,5,6,7],
      [0,1,5,4], [1,2,6,5], [2,3,7,6], [3,0,4,7]
    ]
  );
}
`
    : "";

  const bodyCall = isSlope ? `slope_body(${nx}, ${ny}, brick_h);` : `cube([brick_u_x, brick_u_y, brick_h], center=false);`;

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
// Main Component (same functionality, “Bricked” theme)
// ============================================================
export default function ThreeEnvironment() {
  const [geomParams, setGeomParams] = useState<BrickGeomParams>({
    fn: 48,
    stud_d: 4.8,
    stud_h: 1.8,
    wall_gap: 0.02,
  });

  let opensCAD_DSL_Input = `/* Multi-template Brick DSL example */

brick("2x4", xStud=0, yStud=0, zLevel=0, rotY=0, color=[0.85,0.1,0.1]);
brick("2x2", xStud=2, yStud=0, zLevel=0, rotY=0, color=[0.1,0.7,0.2]);
brick("1x2", xStud=5, yStud=0, zLevel=0, rotY=90, color=[0.2,0.4,1.0]);

brick("plate_2x4", xStud=0, yStud=4, zLevel=0, rotY=0, color=[0.2,0.6,0.9]);
brick("tile_2x2", xStud=4, yStud=4, zLevel=0, rotY=0, color=[0.9,0.85,0.2]);
brick("slope_45_2x2", xStud=6, yStud=0, zLevel=0, rotY=90, color=[0.6,0.6,0.6]);

brick("1x1", xMm=10.2, yMm=6.7, zMm=9.6, rot=[0,15,0], color=[0.2,0.9,0.3]);`;

  const searchParams = useSearchParams();
  const dslParam = searchParams.get("dsl");

  const [scadInput, setScadInput] = useState(() => dslParam ? decodeURIComponent(dslParam) : opensCAD_DSL_Input);

  const parsedBricks = useMemo(() => parseBrickDSL(scadInput), [scadInput]);
  const [bricks, setBricks] = useState<Brick[]>(parsedBricks);
  useEffect(() => setBricks(parsedBricks), [parsedBricks]);

  const [step, setStep] = useState(0);
  useEffect(() => setStep((s) => Math.min(s, bricks.length)), [bricks.length]);

  const [status, setStatus] = useState("idle");

  // Selection
  const selectedIndexRef = useRef<number | null>(null);
  const prevSelectedIndexRef = useRef<number | null>(null);
  const [selectedHex, setSelectedHex] = useState("#ffcc00");

  // Snap options
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapStud, setSnapStud] = useState(true);
  const [snapZLevels, setSnapZLevels] = useState(true);

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
      geo.computeVertexNormals();
      geomCacheRef.current.set(key, geo);
      geomPromiseRef.current.delete(key);
      return geo;
    })();

    geomPromiseRef.current.set(key, promise);
    return promise;
  }

  // ============================================================
  // Highlight helper
  // ============================================================
  function setBrickHighlight(brickIndex: number, on: boolean) {
    const mesh = brickMeshesRef.current[brickIndex];
    const b = bricksRef.current[brickIndex];
    if (!mesh || !b) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const c = on ? blend(b.color, HIGHLIGHT_RGB, HIGHLIGHT_T) : b.color;
    mat.color.setRGB(c[0], c[1], c[2]);
  }

  // Auto-highlight the most recently revealed brick (instruction step)
  useEffect(() => {
    // don’t fight user selection highlight
    if (selectedIndexRef.current != null) return;

    const last = step - 1;
    if (last < 0) return;

    // clear previous auto highlight
    const prev = prevSelectedIndexRef.current;
    if (prev != null) setBrickHighlight(prev, false);

    prevSelectedIndexRef.current = last;
    setBrickHighlight(last, true);

    // small pulse (optional): turn it off after a bit so the scene isn’t always yellow
    const t = window.setTimeout(() => {
      // still no manual selection -> keep it highlighted for “where highlighted”
      // (comment this out if you want it to auto-unhighlight)
    }, 250);

    return () => window.clearTimeout(t);
  }, [step]);

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
  // ✅ Clean movement/rotation: snap + commit ONLY at drag end
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

    const stepXY = snapStud ? STUD_PITCH : 1.0;
    const stepZ = snapZLevels ? BRICK_H / 3 : 1.0;

    mesh.position.x = snapValue(mesh.position.x, stepXY);
    mesh.position.y = snapValue(mesh.position.y, stepXY);
    mesh.position.z = snapValue(mesh.position.z, stepZ);

    // LEGO rotation snapping: 90° increments
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================
  // Build meshes (ONLY when geometry/kinds/step changes)
  // ============================================================
  const kindsKey = useMemo(() => bricks.map((b) => b.kind).join("|"), [bricks]);

  useEffect(() => {
    let cancelled = false;

    async function rebuild() {
      const scene = sceneRef.current;
      if (!scene) return;

      setStatus("building brick meshes...");

      if (rootRef.current) {
        scene.remove(rootRef.current);
        rootRef.current.traverse((o: any) => {
          if (o.material) o.material.dispose?.();
        });
        rootRef.current = null;
      }

      brickMeshesRef.current = [];
      selectedIndexRef.current = null;
      prevSelectedIndexRef.current = null;

      tcontrolsRef.current?.detach();

      const kindsNeeded = Array.from(new Set(bricksRef.current.map((b) => b.kind)));
      const geoByKind = new Map<BrickKind, THREE.BufferGeometry>();
      for (const k of kindsNeeded) geoByKind.set(k, await getBrickGeometry(k, geomParams));
      if (cancelled) return;

      const root = new THREE.Group();

      const visibleCount = Math.max(0, Math.min(step, bricksRef.current.length));
      for (let i = 0; i < bricksRef.current.length; i++) {
        const b = bricksRef.current[i];
        const geo = geoByKind.get(b.kind)!;

        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(b.color[0], b.color[1], b.color[2]),
          roughness: 0.55,
          metalness: 0.05,
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { brickIndex: i };

        mesh.position.set(b.xMm, b.yMm, b.zMm);
        mesh.rotation.set(
          THREE.MathUtils.degToRad(b.rotX),
          THREE.MathUtils.degToRad(b.rotY),
          THREE.MathUtils.degToRad(b.rotZ),
        );

        mesh.visible = i < visibleCount;

        root.add(mesh);
        brickMeshesRef.current.push(mesh);
      }

      scene.add(root);
      rootRef.current = root;

      setStatus(`ready (${visibleCount}/${bricksRef.current.length} visible)`);
    }

    rebuild().catch((e) => {
      if (!cancelled) setStatus(`error: ${String((e as any)?.message ?? e)}`);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        THREE.MathUtils.degToRad(b.rotZ),
      );

      const mat = mesh.material as THREE.MeshStandardMaterial;
      const isSelected = selectedIndexRef.current === i;
      const c = isSelected ? blend(b.color, HIGHLIGHT_RGB, HIGHLIGHT_T) : b.color;
      mat.color.setRGB(c[0], c[1], c[2]);
    }
  }, [bricks, step]);

  // ============================================================
  // Hotkeys: W/E + Esc (NO scale)
  // ============================================================
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = tcontrolsRef.current;
      if (!t) return;

      if (e.key === "w" || e.key === "W") t.setMode("translate");
      if (e.key === "e" || e.key === "E") t.setMode("rotate");

      if (e.key === "Escape") {
        const prev = prevSelectedIndexRef.current;
        if (prev != null) setBrickHighlight(prev, false);
        selectedIndexRef.current = null;
        prevSelectedIndexRef.current = null;
        t.detach();
        setStatus("no selection");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================
  // Click select -> attach gizmo (ignore gizmo interactions)
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
        const prev = prevSelectedIndexRef.current;
        if (prev != null) setBrickHighlight(prev, false);
        selectedIndexRef.current = null;
        prevSelectedIndexRef.current = null;
        tcontrols.detach();
        setStatus("no selection");
        return;
      }

      const obj = hits[0].object as THREE.Mesh;
      const idx = obj.userData?.brickIndex as number | undefined;
      if (idx == null) return;

      const prev = prevSelectedIndexRef.current;
      if (prev != null) setBrickHighlight(prev, false);

      selectedIndexRef.current = idx;
      prevSelectedIndexRef.current = idx;

      const b = bricksRef.current[idx];
      setSelectedHex(rgb01ToHex(b.color));
      setBrickHighlight(idx, true);
      setStatus(`selected brickIndex=${idx} kind=${b.kind}`);

      tcontrols.attach(obj);
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    return () => renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // “instruction step” is the most recently revealed brick
  const instructionIdx = Math.max(0, Math.min(visibleCount - 1, Math.max(0, bricks.length - 1)));
  const instructionBrick = bricks.length && visibleCount > 0 ? bricks[instructionIdx] : null;

  const instructionText = !bricks.length
    ? "Add bricks in the DSL to generate a blueprint."
    : visibleCount === 0
      ? "Press Next to reveal step 1."
      : instructionBrick
        ? `Place the ${colorName(instructionBrick.color)} ${kindPretty(instructionBrick.kind)}, where highlighted.`
        : "Press Next to continue.";

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#fff5d6] via-[#ffe9a7] to-[#ffd166] text-slate-900">
      {/* Header */}
      <div className="border-b-2 border-[#0ea5e9] bg-[#fef08a] shadow-[0_6px_0_#f59e0b]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3 text-lg font-black text-[#111827]">
            <img src="/rocket.png" alt="Bricked" className="h-8 w-8 drop-shadow-[0_2px_0_#0f2f86]" />
            Bricked — 3D Blueprint
          </div>

          <div className="flex items-center gap-2 text-xs font-semibold text-[#0f172a]">
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

      {/* Content */}
      <div className="relative mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_20%,rgba(29,78,216,0.18),transparent_26%),radial-gradient(circle_at_85%_15%,rgba(239,68,68,0.2),transparent_30%),radial-gradient(circle_at_70%_75%,rgba(16,185,129,0.18),transparent_32%)]" />

        <div className="relative grid gap-4 lg:grid-cols-[420px_1fr]">
          {/* Left Panel */}
          <div className="space-y-4">
            {/* Instructions */}
            <section className="relative overflow-hidden rounded-2xl border-2 border-[#1d4ed8] bg-white p-4 shadow-[0_10px_0_#0f2f86]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(251,191,36,0.18),transparent_45%)]" />
              <div className="relative space-y-2">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-[#1d4ed8]">Blueprint</p>
                <h2 className="text-lg font-black text-[#0f172a]">3D Lego instructions</h2>
                <p className="text-sm text-slate-700">
                  Your DSL defines the model. This panel turns it into steps — the scene highlights the current piece.
                </p>

                <div className="rounded-xl border-2 border-[#0ea5e9] bg-[#e0f2fe] p-3 text-sm font-semibold text-[#0f172a] shadow-[0_8px_0_#0f2f86]">
                  <div className="flex items-start gap-2">
                    <span className="mt-1 h-2 w-2 rounded-full bg-[#ef4444] shadow-[0_0_0_3px_#0f2f86]" />
                    <span>{instructionText}</span>
                  </div>

                  <div className="mt-2 text-xs text-slate-700">
                    Controls: <span className="font-black">W</span> move, <span className="font-black">E</span> rotate,{" "}
                    <span className="font-black">Ctrl</span> = disable snap while dragging, <span className="font-black">Esc</span> deselect.
                  </div>
                </div>

                <div className="grid gap-2">
                  <ThemedSlider
                    label={`Step: ${visibleCount}/${bricks.length}`}
                    min={0}
                    max={bricks.length}
                    step={1}
                    value={step}
                    onChange={(v) => setStep(v)}
                  />
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
                      onClick={() => setStep(bricks.length)}
                      className="rounded-xl border-2 border-[#16a34a] bg-[#ecfdf3] px-3 py-2 text-xs font-semibold text-[#166534] shadow-[0_6px_0_#15803d] transition hover:-translate-y-0.5 hover:shadow-[0_8px_0_#15803d]"
                    >
                      Show all
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

            {/* Snapping */}
            <section className="relative overflow-hidden rounded-2xl border-2 border-[#16a34a] bg-white p-4 shadow-[0_10px_0_#15803d]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(16,185,129,0.16),transparent_40%)]" />
              <div className="relative space-y-3">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-[#15803d]">Snapping</p>

                <label className="flex items-center gap-3 text-sm font-semibold text-[#0f172a]">
                  <input
                    type="checkbox"
                    checked={snapEnabled}
                    onChange={(e) => setSnapEnabled(e.target.checked)}
                    className="h-4 w-4 accent-[#16a34a]"
                  />
                  Snap enabled
                </label>

                <label className="flex items-center gap-3 text-sm font-semibold text-[#0f172a]">
                  <input
                    type="checkbox"
                    checked={snapStud}
                    onChange={(e) => setSnapStud(e.target.checked)}
                    className="h-4 w-4 accent-[#16a34a]"
                  />
                  Snap X/Y to studs (8mm) — off = 1mm
                </label>

                <label className="flex items-center gap-3 text-sm font-semibold text-[#0f172a]">
                  <input
                    type="checkbox"
                    checked={snapZLevels}
                    onChange={(e) => setSnapZLevels(e.target.checked)}
                    className="h-4 w-4 accent-[#16a34a]"
                  />
                  Snap Z to LEGO levels (BRICK_H/3)
                </label>
              </div>
            </section>

            {/* Geometry */}
            <section className="relative overflow-hidden rounded-2xl border-2 border-[#0ea5e9] bg-white p-4 shadow-[0_10px_0_#0f2f86]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_20%,rgba(14,165,233,0.16),transparent_40%)]" />
              <div className="relative space-y-3">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0ea5e9]">Geometry</p>
                <p className="text-sm text-slate-700">
                  Recompiles STL per <span className="font-black">kind + params</span> (cached).
                </p>

                <div className="space-y-3">
                  <ThemedSlider
                    label="$fn"
                    min={12}
                    max={128}
                    step={1}
                    value={geomParams.fn}
                    onChange={(v) => setGeomParams((p) => ({ ...p, fn: v }))}
                  />
                  <ThemedSlider
                    label="stud_d"
                    min={3.5}
                    max={6.0}
                    step={0.1}
                    value={geomParams.stud_d}
                    onChange={(v) => setGeomParams((p) => ({ ...p, stud_d: v }))}
                  />
                  <ThemedSlider
                    label="stud_h"
                    min={0.8}
                    max={3.0}
                    step={0.1}
                    value={geomParams.stud_h}
                    onChange={(v) => setGeomParams((p) => ({ ...p, stud_h: v }))}
                  />
                  <ThemedSlider
                    label="wall_gap"
                    min={0.0}
                    max={0.2}
                    step={0.01}
                    value={geomParams.wall_gap}
                    onChange={(v) => setGeomParams((p) => ({ ...p, wall_gap: v }))}
                  />
                </div>
              </div>
            </section>

            {/* Selected */}
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

            {/* DSL */}
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

          {/* Right: 3D */}
          <section className="relative overflow-hidden rounded-2xl border-2 border-[#0ea5e9] bg-white p-3 shadow-[0_10px_0_#0f2f86]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(14,165,233,0.14),transparent_42%)]" />
            <div className="relative">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-black text-[#0f172a]">Scene</div>
                <div className="text-xs font-semibold text-slate-700">
                  Tip: click a brick to edit; snapping applies on release.
                </div>
              </div>

              <div
                ref={containerRef}
                className="h-[650px] w-full rounded-xl border-2 border-[#111827] bg-white"
              />
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
  