'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = (file) => import(pathToFileURL(path.join(__dirname, '..', 'src', file)).href);

async function fixture() {
  const [{ GLTFLoader }, THREE, { createKuromiRig }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'), import('three'), load('kuromi-rig.js'),
  ]);
  const bytes = await fs.readFile(path.join(__dirname, '..', 'assets', 'kuromi.glb'));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  const source = new Map();
  gltf.scene.traverse((mesh) => {
    if (!mesh.isMesh) return;
    source.set(mesh.name, { matrix: mesh.matrixWorld.clone(), positions: mesh.geometry.attributes.position.array.slice(),
      colors: mesh.geometry.attributes.color?.array.slice(), indices: mesh.geometry.index?.array.slice() });
  });
  return { THREE, source, rig: createKuromiRig(gltf.scene) };
}

function updateSkin(rig) {
  rig.root.updateMatrixWorld(true);
  rig.skeleton.update();
}

test('the downloaded model keeps its geometry while applying the black and pink palette', async () => {
  const { THREE, source, rig } = await fixture();
  assert.equal(source.size, 12, 'The supplied GLB contains twelve original meshes');
  assert.equal(rig.sourceMeshes.length, source.size, 'Every source mesh is retained');
  assert.ok(rig.sourceTransform?.isMatrix4, 'Normalization is one uniform transform');
  const scale = new THREE.Vector3().setFromMatrixScale(rig.sourceTransform);
  assert.ok(Math.abs(scale.x - scale.y) < 1e-10 && Math.abs(scale.y - scale.z) < 1e-10, 'Normalization preserves model proportions');
  updateSkin(rig);
  let maximumError = 0, vertices = 0;
  for (const { sourceName, mesh } of rig.sourceMeshes) {
    const original = source.get(sourceName);
    assert.ok(original && mesh.isSkinnedMesh, `${sourceName} uses its original geometry with skinning`);
    const positions = mesh.geometry.attributes.position;
    assert.equal(positions.count * 3, original.positions.length);
    if (['Object_3','Object_14','Object_16','Object_18','Object_20','Object_24'].includes(sourceName)) {
      assert.deepEqual(mesh.geometry.attributes.color.array, original.colors, `${sourceName} keeps eye and white body colors`);
    } else {
      assert.notDeepEqual(mesh.geometry.attributes.color.array, original.colors, `${sourceName} receives the requested palette`);
      const colors = mesh.geometry.attributes.color;
      let dark = 0, pink = 0;
      for (let i=0;i<colors.count;i++) {
        if (colors.getX(i)<0.02 && colors.getY(i)<0.02 && colors.getZ(i)<0.02) dark++;
        if (colors.getX(i)>colors.getY(i)*2 && colors.getZ(i)>colors.getY(i)) pink++;
      }
      if (['Object_7','Object_10','Object_12','Object_22'].includes(sourceName)) assert.ok(dark>0,'Hood, ears, tail and collar have black paint');
      if (['Object_5','Object_9','Object_22'].includes(sourceName)) assert.ok(pink>0,'Skull, nose and bells have pink paint');
    }
    assert.deepEqual(mesh.geometry.index?.array, original.indices, `${sourceName} keeps the original triangles`);
    const transform = rig.sourceTransform.clone().multiply(original.matrix);
    for (let index = 0; index < positions.count; index++) {
      const expected = new THREE.Vector3().fromArray(original.positions, index * 3).applyMatrix4(transform);
      const actual = new THREE.Vector3().fromBufferAttribute(positions, index);
      mesh.applyBoneTransform(index, actual).applyMatrix4(mesh.matrixWorld);
      maximumError = Math.max(maximumError, expected.distanceTo(actual));
    }
    vertices += positions.count;
  }
  assert.equal(vertices, 86003, 'No replacement character geometry is substituted');
  assert.ok(maximumError < 0.000003, `Binding the skeleton preserves the source shape (maximum error ${maximumError})`);
  rig.dispose();
});

test('all gestures keep fixed mesh geometry, bone lengths and anatomical scales', async () => {
  const { rig } = await fixture();
  const [{ applyRigPose, ANIMATIONS }, { evaluateRigPose }] = await Promise.all([load('pet.js'), load('rig-pose.js')]);
  const nodes = [rig.root, ...rig.skeleton.bones, ...rig.anatomy];
  const scales = nodes.map(node => node.scale.toArray());
  const bonePositions = rig.skeleton.bones.map(bone => bone.position.toArray());
  const meshes = rig.sourceMeshes.map(({ mesh }) => ({ mesh, geometry: mesh.geometry, positions: mesh.geometry.attributes.position.array.slice() }));
  for (const name of Object.keys(ANIMATIONS)) {
    for (const elapsed of [0, 0.08, 0.65, 1.4, 3.1, 5.7]) {
      applyRigPose(rig, evaluateRigPose(name, elapsed, { time: elapsed, talking: name === 'talk' }));
      nodes.forEach((node, index) => assert.deepEqual(node.scale.toArray(), scales[index], `${name}: ${node.name} is not stretched`));
      rig.skeleton.bones.forEach((bone, index) => assert.deepEqual(bone.position.toArray(), bonePositions[index], `${name}: ${bone.name} keeps its bone length`));
      for (const { mesh, geometry } of meshes) assert.equal(mesh.geometry, geometry, `${name}: the model is not swapped`);
    }
  }
  for (const { mesh, positions } of meshes) assert.deepEqual(mesh.geometry.attributes.position.array, positions, 'Animations do not rewrite source anatomy');
  rig.dispose();
});

test('head, ears, arms and legs are weighted to real bones that move the supplied mesh', async () => {
  const { THREE, rig } = await fixture();
  const joints = [rig.head, ...Object.values(rig.ears), ...Object.values(rig.arms), ...Object.values(rig.legs)];
  for (const joint of joints) {
    assert.ok(joint.isBone, `${joint.name} is a skeleton joint`);
    const boneIndex = rig.skeleton.bones.indexOf(joint);
    assert.ok(boneIndex >= 0);
    let affected;
    for (const { mesh } of rig.sourceMeshes) {
      const indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
      for (let vertex = 0; vertex < indices.count && !affected; vertex++) {
        for (let slot = 0; slot < 4; slot++) {
          if (indices.array[vertex * 4 + slot] === boneIndex && weights.array[vertex * 4 + slot] > 0.5) {
            affected = { mesh, vertex }; break;
          }
        }
      }
      if (affected) break;
    }
    assert.ok(affected, `${joint.name} controls actual model vertices`);
    const { mesh, vertex } = affected;
    updateSkin(rig);
    const before = mesh.applyBoneTransform(vertex, new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, vertex));
    joint.rotation.z = 0.25;
    updateSkin(rig);
    const after = mesh.applyBoneTransform(vertex, new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, vertex));
    assert.ok(before.distanceTo(after) > 0.001, `${joint.name} moves geometry rather than an empty control`);
    joint.rotation.z = 0;
  }
  rig.dispose();
});

test('head tracking and gestures have continuous intermediate angles', async () => {
  const { evaluateRigPose } = await load('rig-pose.js');
  const positions = Array.from({ length: 121 }, (_, index) => -0.6 + index * 0.01);
  const yaw = positions.map(lookX => evaluateRigPose('idle', 0, { time: 0, lookX }).headYaw);
  assert.equal(new Set(yaw).size, positions.length, 'Cursor tracking is not quantized to sprite directions');
  for (let index = 1; index < yaw.length; index++) {
    assert.ok(yaw[index] > yaw[index - 1]);
    assert.ok(yaw[index] - yaw[index - 1] < 0.02, 'Small cursor movements produce small head movements');
  }
  const arms = Array.from({ length: 12 }, (_, index) => evaluateRigPose('wave', index / 144, { time: index / 144 }).rightArmZ);
  assert.equal(new Set(arms).size, arms.length, 'High refresh frames contain new joint angles');
});

test('all poses are finite, reduced motion is stable, and only reading reveals the book', async () => {
  const [{ ANIMATIONS }, { evaluateRigPose }] = await Promise.all([load('pet.js'), load('rig-pose.js')]);
  for (const name of Object.keys(ANIMATIONS)) {
    for (const elapsed of [0, 1 / 144, 0.65, 2.8, 9, 500]) {
      const pose = evaluateRigPose(name, elapsed, { time: elapsed, lookX: 0.45, lookY: -0.7 });
      assert.ok(Object.values(pose).every(Number.isFinite), `${name}: finite transforms`);
      assert.equal(Boolean(pose.book), ['thinking', 'review'].includes(name), `${name}: reading prop visibility`);
    }
    assert.deepEqual(evaluateRigPose(name, 0, { time: 0, reducedMotion: true }),
      evaluateRigPose(name, 400, { time: 999, lookX: 1, talking: true, reducedMotion: true }), `${name}: reduced motion holds the pose`);
  }
});
