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
