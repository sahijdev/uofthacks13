// scad.worker.js
let instancePromise = null;

async function getInstance() {
  if (!instancePromise) {
    instancePromise = (async () => {
      const mod = await import("/openscad/openscad.js");
      const OpenSCAD = mod.default;
      const inst = await OpenSCAD({ noInitialRun: true });
      return inst;
    })();
  }
  return instancePromise;
}

self.onmessage = async (e) => {
  const { scad, outName = "model.stl" } = e.data;

  try {
    const inst = await getInstance();

    // Clean up from previous runs if needed
    try { inst.FS.unlink("/input.scad"); } catch {}
    try { inst.FS.unlink("/" + outName); } catch {}

    inst.FS.writeFile("/input.scad", scad);

    // Run "CLI": input.scad -> outName
    // NOTE: flags vary by build; keep minimal first.
    inst.callMain(["/input.scad", "-o", outName]);

    const bytes = inst.FS.readFile("/" + outName); // Uint8Array
    self.postMessage({ ok: true, bytes }, [bytes.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err?.message ?? err) });
  }
};
