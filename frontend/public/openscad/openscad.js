// // <reference types = "./openscad.d.ts"/>
// // basically uses the reference types defined in openscad.d.ts

// let wasmModule
// // A module-level variable so that you only have to fetch/prepare the glue once.


// // Returns a promise that resolves into a OPENSCAD instance ( the Emscripten module object ) 
// async function OpenSCAD(options){

//     if(!wasmModule){
//         const url = new URL(`./openscad.wasm.js`,import.meta.url).href;
//         const request = await fetch(url);
//         //downloads url result as text.
//         wasmModule = "data:text/javascript;base64," + btoa(await request.text());
//         //base64-encodes the JS source 
//         //basically turns it into data, so we can import this now safe, encoded javascript to other modules.
//     }

//     //creating the Emscripten Module Object
//     const module ={
//         noInitialRun: true,
//         //Prevents running int main() automatically, so we can module.callMain([...]), later.
//         //Emscripten will ask "where" is "opencad.wasm" (or other files)
//         //this function returns the absolute url for those files
//         locateFile: (path)=> new URL(`./${path}`,import.meta.url).href,
//         ...options,
//         //lets caller override/extend "defaults" (e.g. add print, printErr, memory Management, etc...)
//     };

//     globalThis.OpenSCAD = module;
//     //basically a global variable u can access in any environment for a given window
//     await import(wasmModule + `#${Math.random()}`);
//     //loads the encoded glue as a module.
//     //so that each call creates a "different" module specififer.
//     /// this is so, Javascript doesn't skip repeated imports, and instead, reevaluations are needed;
//     //this is sincec browsers cache ES moduels imports by specifier
//     delete globalThis.OpenSCAD;
// // after importing its no longer needed.

// //waits until the program is actually usable.
// await new Promise((resolve) => {
//     module.onRuntimeInitialized = () => resolve(null);
// });

// return module;
// //now we can do
// /*
// module.FS.writeFile(...), 
// module.FS.readFile(...),
// module.callMain([...])
// to run OpenSCAD like a Command Line Interface ( CLI )

// */
// }
// export {OpenSCAD as default};

// <reference types="./openscad.d.ts" />
let wasmModule;
async function OpenSCAD(options) {
    if (!wasmModule) {
        const url = new URL(`./openscad.wasm.js`, import.meta.url).href;
        const request = await fetch(url);
        wasmModule = "data:text/javascript;base64," + btoa(await request.text());
    }
    const module = {
        noInitialRun: true,
        locateFile: (path) => new URL(`./${path}`, import.meta.url).href,
        ...options,
    };
    globalThis.OpenSCAD = module;
    await import(wasmModule + `#${Math.random()}`);
    delete globalThis.OpenSCAD;
    await new Promise((resolve) => {
        module.onRuntimeInitialized = () => resolve(null);
    });
    return module;
}

export { OpenSCAD as default };
