// @ts-nocheck
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
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

  return `
$fn = 1;

// -------------------- LEGO-like dimensions (mm) --------------------
stud_pitch = 8.0;
brick_u    = 2*stud_pitch;

stud_d = 4.8;
stud_h = 1.8;

brick_h = 9.6;
wall_gap = 0.02;

// -------------------- House parameters (in 2x2 bricks) --------------------
W = 10;
D = 8;
H = 5;

door_w = 2;
door_h = 2;

win_w = 1;
win_h = 1;
win_z = 2;
win_y = D-1;
win_x1 = 2;
win_x2 = W-3;

roof_layers = 3;

// -------------------- 2x2 brick model --------------------
module brick2x2(color_rgb=[0.85,0.1,0.1]) {
  color(color_rgb)
  union() {
    cube([brick_u - wall_gap, brick_u - wall_gap, brick_h], center=false);
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

function in_range(v, a, b) = (v >= a) && (v <= b);

function is_perimeter(bx, by) =
  (bx == 0) || (bx == W-1) || (by == 0) || (by == D-1);

function is_door_gap(bx, by, bz) =
  (by == 0)
  && (bz < door_h)
  && in_range(bx, floor((W-door_w)/2), floor((W-door_w)/2) + door_w - 1);

function is_window_gap(bx, by, bz) =
  (by == win_y)
  && in_range(bz, win_z, win_z + win_h - 1)
  && (
      in_range(bx, win_x1, win_x1 + win_w - 1)
   || in_range(bx, win_x2, win_x2 + win_w - 1)
  );

function is_side_window_gap(bx, by, bz) =
  in_range(bz, win_z, win_z + win_h - 1)
  && (
      ((bx == 0)    && in_range(by, 2, 2 + win_w - 1))
   || ((bx == W-1)  && in_range(by, 2, 2 + win_w - 1))
  );

module house() {
  base_th = 1.6;
  color([0.2,0.2,0.2])
    translate([-brick_u, -brick_u, -base_th])
      cube([(W+2)*brick_u, (D+2)*brick_u, base_th], center=false);

  for (bz = [0:H-1]) {
    for (bx = [0:W-1]) {
      for (by = [0:D-1]) {
        if (is_perimeter(bx, by)) {
          if (!is_door_gap(bx, by, bz)
              && !is_window_gap(bx, by, bz)
              && !is_side_window_gap(bx, by, bz)) {
            col = (by == 0) ? [0.9, 0.85, 0.2] : [0.85, 0.1, 0.1];
            place2x2(bx, by, bz, col);
          }
        }
      }
    }
  }

  bz_cap = H;
  for (bx=[0:W-1]) for (by=[0:D-1]) {
    if (is_perimeter(bx, by)) place2x2(bx, by, bz_cap, [0.75,0.75,0.75]);
  }

  for (k=[0:roof_layers-1]) {
    bx0 = 1 + k;
    by0 = 1 + k;
    bx1 = (W-2) - k;
    by1 = (D-2) - k;

    if (bx0 <= bx1 && by0 <= by1) {
      for (bx=[bx0:bx1])
        for (by=[by0:by1])
          place2x2(bx, by, H+1+k, [0.15,0.25,0.85]);
    }
  }

  place2x2(W-3, D-3, H+1, [0.2,0.2,0.2]);
  place2x2(W-3, D-3, H+2, [0.2,0.2,0.2]);
}

house();
`;
}

export default function TestPage() {
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

  // NEW: transform controls (move/rotate object without recompiling)
  const [xform, setXform] = useState({
    x: 0,
    y: 0,
    z: 0,
    rx: 0,
    ry: 0,
    rz: 0,
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff); // white

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

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(60, 80, 40);
    scene.add(dir);

    scene.add(new THREE.GridHelper(120, 24));
    scene.add(new THREE.AxesHelper(25));

    // NEW: TransformControls gizmo (W/E/R style)
    const tcontrols = new TransformControls(camera, renderer.domElement);
    scene.add(tcontrols);

    // When using gizmo, disable orbit controls
    tcontrols.addEventListener("dragging-changed", (ev: any) => {
      controls.enabled = !ev.value;
    });

    // Keep xform state synced while dragging
    const onObjChange = () => {
      const mesh = meshRef.current;
      if (!mesh) return;
      setXform({
        x: mesh.position.x,
        y: mesh.position.y,
        z: mesh.position.z,
        rx: THREE.MathUtils.radToDeg(mesh.rotation.x),
        ry: THREE.MathUtils.radToDeg(mesh.rotation.y),
        rz: THREE.MathUtils.radToDeg(mesh.rotation.z),
      });
    };
    tcontrols.addEventListener("objectChange", onObjChange);

    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;
    controlsRef.current = controls;
    transformRef.current = tcontrols;

    const resize = () => {
      const size = Math.min(container.clientWidth || 600, 900);
      renderer.setSize(size, size);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", resize);
    resize();

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener("resize", resize);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      tcontrols.removeEventListener("objectChange", onObjChange);
      tcontrols.dispose();
      controls.dispose();
      renderer.dispose();
      container.innerHTML = "";
    };
  }, []);

  const scad = useMemo(() => buildScad(params), [params]);

  // NEW: apply xform sliders to mesh (no recompile)
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    mesh.position.set(xform.x, xform.y, xform.z);
    mesh.rotation.set(
      THREE.MathUtils.degToRad(xform.rx),
      THREE.MathUtils.degToRad(xform.ry),
      THREE.MathUtils.degToRad(xform.rz)
    );

    // keep gizmo aligned
    const t = transformRef.current;
    if (t && t.object !== mesh) t.attach(mesh);
  }, [xform]);

  async function compileAndShow() {
    const token = ++compileToken.current;
    setStatus("compiling...");

    try {
      const bytes = await compileScadToStlBytes(scad);
      if (token !== compileToken.current) return;

      setStatus(`compiled: ${bytes.byteLength} bytes`);

      const scene = sceneRef.current!;
      const camera = cameraRef.current!;
      const controls = controlsRef.current!;
      const tcontrols = transformRef.current!;

      const loader = new STLLoader();
      const geometry = loader.parse(bytes.buffer);
      geometry.computeVertexNormals();

      if (meshRef.current) {
        scene.remove(meshRef.current);
        meshRef.current.geometry.dispose();
        (meshRef.current.material as THREE.Material).dispose();
      }

      const material = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 });
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      meshRef.current = mesh;

      // Center geometry around origin (so transforms feel nice)
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const center = new THREE.Vector3();
      box.getCenter(center);
      mesh.position.sub(center);

      // Apply current transform *after* centering
      mesh.position.add(new THREE.Vector3(xform.x, xform.y, xform.z));
      mesh.rotation.set(
        THREE.MathUtils.degToRad(xform.rx),
        THREE.MathUtils.degToRad(xform.ry),
        THREE.MathUtils.degToRad(xform.rz)
      );

      // Attach gizmo to mesh
      tcontrols.attach(mesh);
      tcontrols.setMode("translate"); // default mode

      // Auto-fit camera
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
            <input type="checkbox" checked={autoCompile} onChange={(e) => setAutoCompile(e.target.checked)} />{" "}
            Auto-compile
          </label>
        </div>

        <div style={{ marginTop: 16, fontWeight: 700 }}>SCAD params</div>
        <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
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

        <div style={{ marginTop: 16, fontWeight: 700 }}>Move / Rotate (NO recompile)</div>
        <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
          <Slider label="move X" min={-200} max={200} step={1} value={xform.x}
            onChange={(v) => setXform((s) => ({ ...s, x: v }))} />
          <Slider label="move Y" min={-200} max={200} step={1} value={xform.y}
            onChange={(v) => setXform((s) => ({ ...s, y: v }))} />
          <Slider label="move Z" min={-200} max={200} step={1} value={xform.z}
            onChange={(v) => setXform((s) => ({ ...s, z: v }))} />
          <Slider label="rot X (deg)" min={-180} max={180} step={1} value={xform.rx}
            onChange={(v) => setXform((s) => ({ ...s, rx: v }))} />
          <Slider label="rot Y (deg)" min={-180} max={180} step={1} value={xform.ry}
            onChange={(v) => setXform((s) => ({ ...s, ry: v }))} />
          <Slider label="rot Z (deg)" min={-180} max={180} step={1} value={xform.rz}
            onChange={(v) => setXform((s) => ({ ...s, rz: v }))} />
        </div>

        <details style={{ marginTop: 14 }}>
          <summary>Show generated SCAD</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 240, overflow: "auto" }}>
            {scad}
          </pre>
        </details>

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8 }}>
          Orbit: left-drag rotate, wheel zoom, right-drag pan. Gizmo: drag arrows/handles to move.
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
