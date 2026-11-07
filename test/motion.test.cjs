'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test('streamed talking updates are idempotent and preserve completion reactions',async()=>{
  const {PetAnimator}=await import(pathToFileURL(path.join(__dirname,'../src/pet.js')).href);
  const calls=[];
  const pet=Object.assign(Object.create(PetAnimator.prototype),{
    currentState:'idle',play(name){calls.push(name);this.currentState=name;},
  });
  pet.setTalking(true);pet.setTalking(true);pet.setTalking(true);
  assert.deepEqual(calls,['talk']);
  pet.currentState='happy';pet.setTalking(false);
  assert.equal(pet.currentState,'happy');
  pet.currentState='talk';pet.setTalking(false);
  assert.equal(pet.currentState,'idle');
});

test('new gestures contain distinct continuous motion at high refresh rates', async () => {
  const [{ ANIMATIONS }, { evaluateRigPose }] = await Promise.all([
    import(pathToFileURL(path.join(__dirname, '../src/pet.js')).href),
    import(pathToFileURL(path.join(__dirname, '../src/rig-pose.js')).href),
  ]);
  const names = ['nod', 'head-shake', 'smug', 'beckon', 'tiptoe', 'curtsy', 'yawn', 'fist-pump'];
  const trajectories = new Set();
  for (const name of names) {
    const duration = ANIMATIONS[name].duration / 1000;
    let prior = evaluateRigPose(name, 0, { time: 0 });
    let maximumDeparture = 0;
    const trajectory = [];
    for (let frame = 1; frame <= Math.ceil(duration * 144); frame++) {
      const elapsed = Math.min(frame / 144, duration);
      const pose = evaluateRigPose(name, elapsed, { time: elapsed });
      const idle = evaluateRigPose('idle', elapsed, { time: elapsed });
      for (const [joint, value] of Object.entries(pose)) {
        assert.ok(Number.isFinite(value), `${name} has finite ${joint} values`);
        assert.ok(Math.abs(value - prior[joint]) < 0.1, `${name} keeps ${joint} continuous between high refresh frames`);
        maximumDeparture = Math.max(maximumDeparture, Math.abs(value - idle[joint]));
      }
      if (frame % 24 === 0) trajectory.push(JSON.stringify(pose));
      prior = pose;
    }
    assert.ok(maximumDeparture > 0.05, `${name} visibly moves beyond the idle pose`);
    const signature = trajectory.join('\n');
    assert.ok(!trajectories.has(signature), `${name} has a distinct motion sequence`);
    trajectories.add(signature);
  }
});
