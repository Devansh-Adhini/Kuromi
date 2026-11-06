import * as THREE from '../node_modules/three/build/three.module.js';

// The downloaded sculpture supplies every character vertex. The rig
// adds joints and skin weights, with one uniform normalization for the whole model.
export const KUROMI_PROPORTIONS = Object.freeze({ height: 3.85 });
const HEAD_MESHES = new Set(['Object_3', 'Object_5', 'Object_20', 'Object_22', 'Object_24']);
const EXPECTED_MESHES = new Set([...HEAD_MESHES, 'Object_7', 'Object_9', 'Object_10', 'Object_12', 'Object_14', 'Object_16', 'Object_18']);
const PALETTE_MESHES = new Set(['Object_5', 'Object_7', 'Object_9', 'Object_10', 'Object_12', 'Object_22']);

function applyKuromiPalette(geometry, name) {
  if (!PALETTE_MESHES.has(name)) return;
  const colors = geometry.getAttribute('color');
  const black = new THREE.Color('#111016'), pink = new THREE.Color('#ef88b6');
  const color = new THREE.Color();
  for (let index = 0; index < colors.count; index++) {
    // Retain the source's painted skull/bell boundaries, including soft edges.
    const amount = THREE.MathUtils.clamp((colors.getX(index) - colors.getY(index) - 0.015) / 0.33, 0, 1);
    color.copy(black).lerp(pink, amount);
    colors.setXYZ(index, color.r, color.g, color.b);
  }
}
const smoothstep = (low, high, value) => {
  const t = THREE.MathUtils.clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};

export function createKuromiRig(scene) {
  if (!scene?.isObject3D) throw new TypeError('The downloaded Kuromi scene is required.');
  scene.updateMatrixWorld(true);
  const originalMeshes = [];
  scene.traverse((node) => { if (node.isMesh) originalMeshes.push(node); });
  if (originalMeshes.length !== EXPECTED_MESHES.size || originalMeshes.some((mesh) => !EXPECTED_MESHES.has(mesh.name))) {
    throw new Error('The Kuromi model does not match the supported source geometry.');
  }

  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  if (!(size.y > 0) || ![...bounds.min, ...bounds.max].every(Number.isFinite)) throw new Error('The Kuromi model has invalid dimensions.');
  const scale = KUROMI_PROPORTIONS.height / size.y;
  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const sourceTransform = new THREE.Matrix4().makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(-centerX, -bounds.min.y, 0));
  const point = (x, y, z = 0) => new THREE.Vector3(x, y, z).applyMatrix4(sourceTransform);
  const root = new THREE.Group();
  root.name = 'downloaded-kuromi';
  const bones = [];
  function bone(name, parent, worldPosition) {
    const joint = new THREE.Bone();
    joint.name = name;
    joint.position.copy(worldPosition);
    if (parent?.isBone) joint.position.sub(parent.userData.restWorldPosition);
    joint.userData.restWorldPosition = worldPosition.clone();
    parent.add(joint);
    bones.push(joint);
    return joint;
  }

  const body = bone('body', root, new THREE.Vector3());
  const head = bone('head', body, point(0, -0.68, 0));
  const arms = {
    left: bone('left-arm', body, point(-0.52, -0.72, 0)),
    right: bone('right-arm', body, point(0.52, -0.72, 0)),
  };
  const legs = {
    left: bone('left-leg', body, point(-0.28, -1.28, 0)),
    right: bone('right-leg', body, point(0.28, -1.28, 0)),
  };
  const ears = {
    left: bone('left-ear', head, point(-0.78, 1.05, 0)),
    right: bone('right-ear', head, point(0.78, 1.05, 0)),
  };
  const tail = bone('tail', body, point(0.12, -1.38, -0.35));
  const indexOf = (joint) => bones.indexOf(joint);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const anatomy = [], sourceMeshes = [], restGeometry = [];
  let eyes;

  for (const original of originalMeshes) {
    const geometry = original.geometry.clone().applyMatrix4(sourceTransform.clone().multiply(original.matrixWorld));
    applyKuromiPalette(geometry, original.name);
    const positions = geometry.getAttribute('position');
    const sourcePositions = original.geometry.getAttribute('position');
    const inverseNormalization = sourceTransform.clone().invert();
    const skinIndices = new Uint16Array(positions.count * 4);
    const skinWeights = new Float32Array(positions.count * 4);
    const vertex = new THREE.Vector3();
    for (let index = 0; index < positions.count; index++) {
      vertex.fromBufferAttribute(positions, index).applyMatrix4(inverseNormalization);
      // Source scene coordinates here are already +Y up, +Z toward the face.
      const side = vertex.x < centerX ? 'left' : 'right';
      let joint = body, bodyWeight = 0;
      if (HEAD_MESHES.has(original.name)) joint = head;
      else if (original.name === 'Object_12') joint = ears[side];
      else if (original.name === 'Object_14') {
        joint = arms[side];
        // Keep the upper attachment in place beneath the original jester ruff.
        bodyWeight = smoothstep(-0.83, -0.68, vertex.y) * 0.82;
      } else if (original.name === 'Object_16') {
        joint = legs[side];
        bodyWeight = smoothstep(-1.52, -1.25, vertex.y);
      } else if (original.name === 'Object_7') joint = tail;
      const offset = index * 4;
      skinIndices[offset] = indexOf(joint);
      skinWeights[offset] = 1 - bodyWeight;
      skinIndices[offset + 1] = indexOf(body);
      skinWeights[offset + 1] = bodyWeight;
      if (original.name === 'Object_16' && Math.abs(vertex.x - centerX) < 0.045) {
        // The source's feet share a center seam; blend it instead of tearing it.
        const rightWeight = smoothstep(centerX - 0.045, centerX + 0.045, vertex.x);
        skinIndices[offset] = indexOf(legs.left);
        skinIndices[offset + 1] = indexOf(legs.right);
        skinIndices[offset + 2] = indexOf(body);
        skinWeights[offset] = (1 - bodyWeight) * (1 - rightWeight);
        skinWeights[offset + 1] = (1 - bodyWeight) * rightWeight;
        skinWeights[offset + 2] = bodyWeight;
      }
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    const materials = Array.isArray(original.material) ? original.material.map((material) => material.clone()) : original.material.clone();
    const mesh = new THREE.SkinnedMesh(geometry, materials);
    mesh.name = original.name;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false; // Small desktop model; keep moving ears/feet visible.
    root.add(mesh);
    mesh.bind(skeleton, new THREE.Matrix4());
    anatomy.push(mesh);
    sourceMeshes.push({ sourceName: original.name, mesh, sourceVertexCount: sourcePositions.count });
    restGeometry.push({ mesh, positions: positions.array.slice() });
    if (original.name === 'Object_3') {
      addBlinkMorph(mesh);
      eyes = mesh;
    }
  }

  const book = createNotebook();
  body.add(book);
  book.visible = false;
  root.updateMatrixWorld(true);
  skeleton.update();
  return {
    root, body, head, arms, legs, ears, tail, book, skeleton, eyes,
    anatomy: Object.freeze(anatomy), sourceMeshes: Object.freeze(sourceMeshes), restGeometry,
    sourceTransform,
    source: Object.freeze({ title: 'Kuromi', author: 'jiayingc',
      url: 'https://sketchfab.com/3d-models/kuromi-a9a4883cbc2a40e89722001aa6288ba8',
      height: size.y, floorY: bounds.min.y, centerX, centerZ: 0, scale,
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } }),
    proportions: KUROMI_PROPORTIONS,
    setExpression(blink) {
      if (eyes?.morphTargetInfluences) eyes.morphTargetInfluences[0] = THREE.MathUtils.clamp(Number(blink) || 0, 0, 1);
    },
    dispose() {
      const geometries = new Set(), materials = new Set();
      root.traverse((object) => {
        if (!object.isMesh) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      skeleton.dispose();
    },
  };
}

function addBlinkMorph(mesh) {
  const position = mesh.geometry.getAttribute('position');
  const bounds = { left: new THREE.Box3(), right: new THREE.Box3() };
  const point = new THREE.Vector3();
  for (let index = 0; index < position.count; index++) {
    point.fromBufferAttribute(position, index);
    bounds[point.x < 0 ? 'left' : 'right'].expandByPoint(point);
  }
  const centers = { left: bounds.left.getCenter(new THREE.Vector3()).y, right: bounds.right.getCenter(new THREE.Vector3()).y };
  const delta = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index++) {
    const side = position.getX(index) < 0 ? 'left' : 'right';
    delta[index * 3 + 1] = -(position.getY(index) - centers[side]) * 0.94;
  }
  mesh.geometry.morphTargetsRelative = true;
  mesh.geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(delta, 3)];
  mesh.updateMorphTargets();
}

function createNotebook() {
  // A removable accessory for the retained reading gesture, not character geometry.
  const book = new THREE.Group();
  book.name = 'notebook-accessory';
  book.position.set(0, 0.98, 0.68);
  book.rotation.x = -0.10;
  const coverMaterial = new THREE.MeshStandardMaterial({ color: 0x33263e, roughness: 0.85 });
  const paperMaterial = new THREE.MeshStandardMaterial({ color: 0xfbf0e9, roughness: 0.95 });
  const pinkMaterial = new THREE.MeshStandardMaterial({ color: 0xee9fc4, roughness: 0.8 });
  for (const sign of [-1, 1]) {
    const leaf = new THREE.Group();
    leaf.rotation.y = -sign * 0.18;
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.56, 0.045), coverMaterial);
    cover.position.set(sign * 0.215, 0, 0);
    leaf.add(cover);
    const pages = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.53, 0.035), paperMaterial);
    pages.position.set(sign * 0.215, 0.005, -0.04);
    leaf.add(pages);
    book.add(leaf);
  }
  const emblem = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), pinkMaterial);
  emblem.position.set(0.22, 0.035, 0.063);
  emblem.scale.set(0.09, 0.085, 0.008);
  book.add(emblem);
  return book;
}
