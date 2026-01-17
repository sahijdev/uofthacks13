import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

type WorkerResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: string };

export async function compileScadToStlBytes(scad: string): Promise<Uint8Array> {
  if (typeof window === "undefined") {
    throw new Error("compileScadToStlBytes must run client-side.");
  }

  const worker = new Worker("/openscad/scad.worker.js", { type: "module" });

  const result = await new Promise<WorkerResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerResult>) => resolve(e.data);
    worker.onerror = () => reject(new Error("Worker failed"));
    worker.postMessage({ scad, outName: "model.stl" });
  }).finally(() => worker.terminate());

  if (!result.ok) throw new Error(result.error);
  return result.bytes;
}

export function addStlToScene(bytes: Uint8Array, scene: THREE.Scene): void {
  const blob = new Blob([bytes], { type: "model/stl" });
  const url = URL.createObjectURL(blob);

  const loader = new STLLoader();
  loader.load(
    url,
    (geometry) => {
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
      scene.add(mesh);
      URL.revokeObjectURL(url);
    },
    undefined,
    () => {
      URL.revokeObjectURL(url);
    }
  );
}
