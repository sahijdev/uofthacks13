"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { compileScadToStlBytes } from "../lib/openscad";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

function buildScad(params: {
  fn: number;
  stud_d: number;
  stud_h: number;
  wall: number;
  top_thick: number;
  clearance: number;
}) {
  const { fn, stud_d, stud_h, wall, top_thick, clearance } = params;

  // Generate SCAD from parameters (keep it simple & deterministic)
  return `
$fn = 1;

// -------------------- LEGO-like dimensions (mm) --------------------
stud_pitch = 8.0;     // stud center-to-center
brick_u    = 2*stud_pitch; // 2 studs = 16mm (our brick grid unit)

stud_d = 4.8;
stud_h = 1.8;

brick_h = 9.6;        // 3 plates high (standard brick height)
wall_gap = 0.02;      // tiny spacing to avoid coincident faces

// -------------------- House parameters (in 2x2 bricks) --------------------
W = 10;          // width in 2x2 bricks
D = 8;           // depth in 2x2 bricks
H = 5;           // wall height in bricks

// Door (on front wall y=0)
door_w = 2;      // width in bricks
door_h = 2;      // height in bricks

// Windows (simple cut-outs by skipping bricks)
win_w = 1;       // width in bricks
win_h = 1;       // height in bricks
win_z = 2;       // bottom of window (brick level)
win_y = D-1;     // back wall windows near top row
win_x1 = 2;      // left window x
win_x2 = W-3;    // right window x

// Roof parameters (stepped pyramid roof made of 2x2 bricks)
roof_layers = 3; // number of roof steps

// -------------------- 2x2 brick model --------------------
module brick2x2(color_rgb=[0.85,0.1,0.1]) {
  // Simple robust brick: solid body + studs (no hollow underside)
  color(color_rgb)
  union() {
    // body
    cube([brick_u - wall_gap, brick_u - wall_gap, brick_h], center=false);

    // studs (2x2)
    for (ix=[0:1])
      for (iy=[0:1])
        translate([stud_pitch/2 + ix*stud_pitch, stud_pitch/2 + iy*stud_pitch, brick_h])
          cylinder(d=stud_d, h=stud_h, center=false);
  }
}

module place2x2(bx, by, bz, col=[0.85,0.1,0.1]) {
  translate([bx*brick_u, by*brick_u, bz*brick_h])
    brick2x2(col);
}

// -------------------- Helpers for deciding where bricks go --------------------
function in_range(v, a, b) = (v >= a) && (v <= b);

function is_perimeter(bx, by) =
  (bx == 0) || (bx == W-1) || (by == 0) || (by == D-1);

// Door opening centered on front wall (by == 0)
function is_door_gap(bx, by, bz) =
  (by == 0)
  && (bz < door_h)
  && in_range(bx, floor((W-door_w)/2), floor((W-door_w)/2) + door_w - 1);

// Window gaps (back wall) at a chosen height
function is_window_gap(bx, by, bz) =
  (by == win_y)
  && in_range(bz, win_z, win_z + win_h - 1)
  && (
      in_range(bx, win_x1, win_x1 + win_w - 1)
   || in_range(bx, win_x2, win_x2 + win_w - 1)
  );

// Simple side window gaps
function is_side_window_gap(bx, by, bz) =
  in_range(bz, win_z, win_z + win_h - 1)
  && (
      ((bx == 0)    && in_range(by, 2, 2 + win_w - 1))
   || ((bx == W-1)  && in_range(by, 2, 2 + win_w - 1))
  );

// -------------------- Build the house --------------------
module house() {
  // Baseplate (not a 2x2 brick; just a slab to sit on)
  base_th = 1.6;
  color([0.2,0.2,0.2])
    translate([-brick_u, -brick_u, -base_th])
      cube([(W+2)*brick_u, (D+2)*brick_u, base_th], center=false);

  // Walls
  for (bz = [0:H-1]) {
    for (bx = [0:W-1]) {
      for (by = [0:D-1]) {
        if (is_perimeter(bx, by)) {
          if (!is_door_gap(bx, by, bz)
              && !is_window_gap(bx, by, bz)
              && !is_side_window_gap(bx, by, bz)) {

            // Color scheme: walls slightly varied
            col = (by == 0) ? [0.9, 0.85, 0.2] : [0.85, 0.1, 0.1];
            place2x2(bx, by, bz, col);
          }
        }
      }
    }
  }

  // Top ring (cap) to strengthen the roof edge
  bz_cap = H;
  for (bx=[0:W-1]) for (by=[0:D-1]) {
    if (is_perimeter(bx, by)) place2x2(bx, by, bz_cap, [0.75,0.75,0.75]);
  }

  // Roof (stepped pyramid)
  // Each layer shrinks inward by 1 brick on each side
  for (k=[0:roof_layers-1]) {
    bx0 = 1 + k;
    by0 = 1 + k;
    bx1 = (W-2) - k;
    by1 = (D-2) - k;

    // Ensure valid range
    if (bx0 <= bx1 && by0 <= by1) {
      for (bx=[bx0:bx1])
        for (by=[by0:by1])
          place2x2(bx, by, H+1+k, [0.15,0.25,0.85]);
    }
  }

  // Tiny chimney (still only 2x2 bricks)
  place2x2(W-3, D-3, H+1, [0.2,0.2,0.2]);
  place2x2(W-3, D-3, H+2, [0.2,0.2,0.2]);
}

// -------------------- Render --------------------
house();`
}

export default function TestPage() {
  // ---- Parameters you can tweak from UI
  const [params, setParams] = useState({
    fn: 64,
    stud_d: 4.8,
    stud_h: 1.8,
    wall: 1.6,
    top_thick: 1.0,
    clearance: 0.1,
  });

  const [status, setStatus] = useState("idle");
  const [autoCompile, setAutoCompile] = useState(true);
  const compileToken = useRef(0);

  // ---- Three.js refs (persist across renders)
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const animRef = useRef<number | null>(null);

  // ---- Setup Three.js once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
   /// scene.background = new THREE.Color(0x0b0b0b);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(600, 600);
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    camera.position.set(40, 35, 40);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // Lights + helpers
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(60, 80, 40);
    scene.add(dir);

    const grid = new THREE.GridHelper(120, 24);
    scene.add(grid);

    const axes = new THREE.AxesHelper(25);
    scene.add(axes);

    // Store refs
    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;
    controlsRef.current = controls;

    // Resize handling (keeps it responsive)
    const resize = () => {
      const size = Math.min(container.clientWidth || 600, 900);
      renderer.setSize(size, size);
      camera.aspect = 1; // square canvas
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", resize);
    resize();

    // Render loop
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener("resize", resize);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      controls.dispose();
      renderer.dispose();
      container.innerHTML = "";
    };
  }, []);

  const scad = useMemo(() => buildScad(params), [params]);

  async function compileAndShow() {
    const token = ++compileToken.current;
    setStatus("compiling...");

    try {
      const bytes = await compileScadToStlBytes(scad);
      if (token !== compileToken.current) return; // stale compile result

      setStatus(`compiled: ${bytes.byteLength} bytes`);

      const scene = sceneRef.current!;
      const camera = cameraRef.current!;
      const controls = controlsRef.current!;

      // Parse STL bytes directly
      const loader = new STLLoader();
      const geometry = loader.parse(bytes.buffer);

      geometry.computeVertexNormals();

      // Replace old mesh
      if (meshRef.current) {
        scene.remove(meshRef.current);
        meshRef.current.geometry.dispose();
        (meshRef.current.material as THREE.Material).dispose();
      }

      const material = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 });
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      meshRef.current = mesh;

      // Auto-center + auto-fit camera
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const center = new THREE.Vector3();
      box.getCenter(center);
      mesh.position.sub(center);

      const size = new THREE.Vector3();
      box.getSize(size);
      const radius = Math.max(size.x, size.y, size.z) * 0.7;

      controls.target.set(0, 0, 0);
      camera.position.set(radius * 2.2, radius * 1.7, radius * 2.2);
      camera.lookAt(0, 0, 0);
      controls.update();

      setStatus("done");
    } catch (e: any) {
      if (token !== compileToken.current) return;
      setStatus(`error: ${String(e?.message ?? e)}`);
    }
  }

  // Debounced auto-compile when params change
  useEffect(() => {
    if (!autoCompile) return;
    const t = setTimeout(() => {
      compileAndShow();
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scad, autoCompile]);

  return (
    <div style={{ padding: 16, display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div style={{ width: 320 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>OpenSCAD → STL → Three.js</div>
        <div style={{ marginTop: 8, opacity: 0.85 }}>Status: {status}</div>

        <div style={{ marginTop: 12 }}>
          <button onClick={compileAndShow} style={{ marginRight: 8 }}>
            Compile
          </button>
          <label style={{ marginLeft: 8 }}>
            <input
              type="checkbox"
              checked={autoCompile}
              onChange={(e) => setAutoCompile(e.target.checked)}
            />{" "}
            Auto-compile
          </label>
        </div>

        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          <Slider label="$fn" min={12} max={128} step={1} value={params.fn}
            onChange={(v) => setParams((p) => ({ ...p, fn: v }))} />

          <Slider label="stud_d" min={3.5} max={6.0} step={0.1} value={params.stud_d}
            onChange={(v) => setParams((p) => ({ ...p, stud_d: v }))} />

          <Slider label="stud_h" min={0.8} max={3.0} step={0.1} value={params.stud_h}
            onChange={(v) => setParams((p) => ({ ...p, stud_h: v }))} />

          <Slider label="wall" min={1.0} max={2.2} step={0.1} value={params.wall}
            onChange={(v) => setParams((p) => ({ ...p, wall: v }))} />

          <Slider label="top_thick" min={0.6} max={1.6} step={0.1} value={params.top_thick}
            onChange={(v) => setParams((p) => ({ ...p, top_thick: v }))} />

          <Slider label="clearance" min={0.0} max={0.3} step={0.01} value={params.clearance}
            onChange={(v) => setParams((p) => ({ ...p, clearance: v }))} />
        </div>

        <details style={{ marginTop: 14 }}>
          <summary>Show generated SCAD</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 240, overflow: "auto" }}>
            {scad}
          </pre>
        </details>

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8 }}>
          Mouse: left-drag rotate, wheel zoom, right-drag pan.
        </div>
      </div>

      <div ref={containerRef} style={{ width: 650, height: 650, border: "1px solid #333", borderRadius: 8 }} />
    </div>
  );
}

function Slider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span>{props.label}</span>
        <span>{props.value}</span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}
