import { GLTFLoader } from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { createKuromiRig } from './kuromi-rig.js';

let bundledModel;

export async function loadKuromiRig() {
  if (!window.kuromi?.loadModel) throw new Error('The desktop model loader is unavailable.');
  // Reuse the bundled bytes, but parse a fresh scene for each independent rig.
  // No external URLs or filesystem paths are accepted from the renderer.
  bundledModel ||= window.kuromi.loadModel().then((bytes) => new Uint8Array(bytes).buffer)
    .catch((error) => { bundledModel = null; throw error; });
  const loader = new GLTFLoader();
  loader.manager.setURLModifier(() => { throw new Error('The bundled model must not load external resources.'); });
  const gltf = await loader.parseAsync(await bundledModel, '');
  return createKuromiRig(gltf.scene);
}
