// Angles and translations only: every gesture uses the same anatomical meshes.
export function evaluateRigPose(name, elapsed, { time = elapsed, lookX = 0, lookY = 0, talking = false, reducedMotion = false } = {}) {
  const pose = { rootX: 0, rootY: 0, rootZ: 0, bodyYaw: 0, bodyRoll: 0,
    headYaw: 0, headPitch: 0, headRoll: 0, leftArmX: 0, leftArmZ: -0.12,
    rightArmX: 0, rightArmZ: 0.12, leftLegX: 0, rightLegX: 0,
    leftEar: 0, rightEar: 0, blink: 0, mouth: 0, book: ['thinking', 'review'].includes(name) ? 1 : 0 };
  if (reducedMotion) {
    if (pose.book) {
      pose.headPitch = 0.16;
      pose.leftArmX = pose.rightArmX = -1.12;
      pose.leftArmZ = 0.35; pose.rightArmZ = -0.35;
    }
    return pose;
  }
  const t = Math.max(0, elapsed), s = Math.sin;
  pose.rootY = s(time * 1.8) * 0.012;
  pose.bodyRoll = s(time * 0.8) * 0.008;
  pose.headRoll = s(time * 1.1) * 0.012;
  pose.leftEar = s(time * 1.6) * 0.018;
  pose.rightEar = s(time * 1.5 + 0.7) * 0.018;
  const blinkPhase = ((time % 5.1) + 5.1) % 5.1;
  pose.blink = blinkPhase > 4.84 ? Math.sin((blinkPhase - 4.84) / 0.26 * Math.PI) : 0;
  if (name === 'idle' || name === 'listen' || name === 'waiting' || name === 'talk') {
    pose.headYaw = Math.max(-0.72, Math.min(0.72, lookX * 0.72));
    pose.headPitch = Math.max(-0.28, Math.min(0.32, lookY * 0.32));
    pose.bodyYaw = pose.headYaw * 0.16;
  }
  switch (name) {
    case 'wave':
      // Sweep outside the wide ruff so the source model's small hand stays visible.
      pose.rightArmZ = 1.25 + s(t * 7) * 0.25;
      pose.rightArmX = 0.08 + s(t * 7 - 0.6) * 0.1;
      pose.headRoll = 0.06;
      break;
    case 'dance':
      pose.rootX = s(t * 4) * 0.12;
      pose.rootY += Math.abs(s(t * 4)) * 0.13;
      pose.bodyRoll = s(t * 4) * 0.09;
      pose.headRoll = -s(t * 4) * 0.06;
      pose.leftArmZ = -0.9 + s(t * 4) * 0.35;
      pose.rightArmZ = 0.9 + s(t * 4) * 0.35;
      pose.leftLegX = s(t * 4) * 0.25;
      pose.rightLegX = -pose.leftLegX;
      break;
    case 'jump': case 'startled': {
      const jump = Math.sin(Math.min(1, t / 1.3) * Math.PI);
      pose.rootY += Math.max(0, jump) * 0.38;
      pose.leftArmZ = -jump * 1.25;
      pose.rightArmZ = jump * 1.25;
      pose.headPitch = -jump * 0.1;
      break;
    }
    case 'happy': case 'excited': case 'bounce':
      pose.rootY += Math.abs(s(t * 4.8)) * (name === 'bounce' ? 0.2 : 0.13);
      pose.leftArmZ = -0.5 + s(t * 4.8) * 0.2;
      pose.rightArmZ = -pose.leftArmZ;
      pose.headRoll = s(t * 2.4) * 0.06;
      break;
    case 'thinking': case 'review':
      pose.headPitch = 0.16 + s(t * 0.8) * 0.025;
      pose.headYaw = s(t * 0.65) * 0.035;
      pose.leftArmX = pose.rightArmX = -1.12;
      pose.leftArmZ = 0.35; pose.rightArmZ = -0.35;
      break;
    case 'walk-left': case 'walk-right':
      pose.bodyYaw = name === 'walk-left' ? -0.55 : 0.55;
      pose.leftLegX = s(t * 10) * 0.48; pose.rightLegX = -pose.leftLegX;
      pose.leftArmX = -pose.leftLegX * 0.65; pose.rightArmX = -pose.rightLegX * 0.65;
      pose.rootY += Math.abs(s(t * 10)) * 0.025;
      break;
    case 'head-tilt': case 'listen': case 'waiting':
      pose.headRoll = 0.12 + s(t * 1.1) * 0.045;
      break;
    case 'look-around':
      pose.headYaw = s(t * 0.8) * 0.72;
      pose.headPitch = s(t * 0.55) * 0.12;
      pose.bodyYaw = pose.headYaw * 0.2;
      break;
    case 'stretch': {
      const reach = Math.sin(Math.min(1, t / 2.8) * Math.PI);
      pose.leftArmZ = -reach * 1.8; pose.rightArmZ = reach * 1.8;
      pose.leftArmX = pose.rightArmX = reach * 0.8;
      pose.headPitch = -reach * 0.13;
      break;
    }
    case 'giggle':
      pose.headRoll = 0.06 + s(t * 9) * 0.025;
      pose.rootY += Math.abs(s(t * 9)) * 0.018;
      pose.rightArmX = -1; pose.rightArmZ = 0.35;
      pose.blink = 1; pose.mouth = 0.5;
      break;
    case 'sulk': case 'pout':
      pose.headYaw = -0.28; pose.headPitch = -0.04; pose.headRoll = -0.04;
      pose.leftArmX = pose.rightArmX = -0.65;
      pose.leftArmZ = 0.45; pose.rightArmZ = -0.45;
      break;
    case 'shy':
      pose.headPitch = 0.12; pose.headRoll = 0.12;
      pose.headYaw = s(t * 0.7) * 0.08;
      pose.leftArmX = pose.rightArmX = -0.85;
      pose.leftArmZ = 0.45; pose.rightArmZ = -0.45;
      break;
    case 'sleep': case 'doze':
      pose.headPitch = 0.17 + s(t * 0.9) * 0.025;
      pose.headRoll = 0.1; pose.blink = 1;
      break;
    case 'ear-twitch': {
      const envelope = Math.sin(Math.min(1, t / 2.2) * Math.PI);
      pose.leftEar = s(t * 15) * envelope * 0.15;
      pose.rightEar = s(t * 15 + 0.8) * envelope * 0.09;
      break;
    }
    case 'nod': {
      const envelope = s(Math.min(1, t / 2.4) * Math.PI) ** 2;
      pose.headPitch = (0.04 + (1 - Math.cos(t * 6)) * 0.11) * envelope;
      pose.headRoll = -0.035 * envelope;
      pose.rightEar += s(t * 6 - 0.4) * envelope * 0.04;
      break;
    }
    case 'head-shake': {
      const envelope = s(Math.min(1, t / 2.6) * Math.PI) ** 2;
      pose.headYaw = s(t * 7) * envelope * 0.38;
      pose.headPitch = -0.05 * envelope;
      pose.bodyYaw = -pose.headYaw * 0.12;
      pose.leftEar += s(t * 7 - 0.5) * envelope * 0.055;
      pose.rightEar += s(t * 7 - 0.8) * envelope * 0.055;
      break;
    }
    case 'smug': {
      const envelope = s(Math.min(1, t / 3.6) * Math.PI) ** 2;
      pose.headYaw = -0.2 * envelope;
      pose.headPitch = -0.1 * envelope;
      pose.headRoll = -0.1 * envelope;
      pose.bodyYaw = 0.14 * envelope;
      pose.rightArmX = -0.55 * envelope;
      pose.rightArmZ = 0.12 - 0.42 * envelope;
      pose.leftArmZ = -0.12 - 0.35 * envelope;
      pose.leftEar += 0.075 * envelope;
      pose.rightEar -= 0.035 * envelope;
      break;
    }
    case 'beckon': {
      const envelope = s(Math.min(1, t / 3.2) * Math.PI) ** 2;
      pose.rightArmX = (-0.35 + s(t * 7) * 0.25) * envelope;
      pose.rightArmZ = 0.12 + (0.95 + s(t * 7 - 0.5) * 0.28) * envelope;
      pose.headYaw = 0.08 * envelope;
      pose.headRoll = -0.06 * envelope;
      pose.bodyYaw = -0.1 * envelope;
      break;
    }
    case 'tiptoe': {
      const envelope = s(Math.min(1, t / 4.2) * Math.PI) ** 2;
      const step = s(t * 6);
      pose.rootY += (0.025 + step * step * 0.035) * envelope;
      pose.rootX = s(t * 3) * envelope * 0.045;
      pose.bodyYaw = -0.24 * envelope;
      pose.headYaw = (0.2 + s(t * 1.5) * 0.13) * envelope;
      pose.headPitch = 0.04 * envelope;
      pose.leftLegX = step * envelope * 0.24;
      pose.rightLegX = -pose.leftLegX;
      pose.leftArmX = (-0.4 - step * 0.08) * envelope;
      pose.rightArmX = (-0.4 + step * 0.08) * envelope;
      pose.leftArmZ = -0.12 - 0.25 * envelope;
      pose.rightArmZ = 0.12 + 0.25 * envelope;
      break;
    }
    case 'curtsy': {
      const envelope = s(Math.min(1, t / 3.2) * Math.PI) ** 2;
      pose.rootY -= 0.025 * envelope;
      pose.headPitch = 0.22 * envelope;
      pose.headRoll = 0.04 * envelope;
      pose.bodyYaw = 0.12 * envelope;
      pose.leftArmZ = -0.12 - 0.48 * envelope;
      pose.rightArmZ = 0.12 + 0.48 * envelope;
      pose.leftArmX = pose.rightArmX = -0.12 * envelope;
      pose.leftLegX = -0.12 * envelope;
      pose.rightLegX = 0.12 * envelope;
      break;
    }
    case 'yawn': {
      const envelope = s(Math.min(1, t / 4.8) * Math.PI) ** 2;
      pose.headPitch = -0.12 * envelope;
      pose.headRoll = 0.065 * envelope;
      pose.rightArmX = -1.05 * envelope;
      pose.rightArmZ = 0.12 + 0.22 * envelope;
      pose.leftArmZ = -0.12 - 0.22 * envelope;
      pose.leftEar -= 0.06 * envelope;
      pose.rightEar += 0.06 * envelope;
      pose.blink = Math.max(pose.blink, envelope);
      pose.mouth = envelope * 0.8;
      break;
    }
    case 'fist-pump': {
      const envelope = s(Math.min(1, t / 2.8) * Math.PI) ** 2;
      const pump = (1 - Math.cos(t * 8)) / 2;
      pose.rightArmZ = 0.12 + (0.75 + pump * 0.48) * envelope;
      pose.rightArmX = (-0.1 + pump * 0.15) * envelope;
      pose.leftArmZ = -0.12 - 0.28 * envelope;
      pose.rootY += pump * envelope * 0.065;
      pose.headRoll = -0.055 * envelope;
      pose.leftEar += pump * envelope * 0.04;
      break;
    }
  }
  if (talking || name === 'talk') {
    pose.mouth = 0.2 + Math.abs(s(t * 11) * s(t * 7.3)) * 0.8;
    pose.headPitch += s(t * 2.7) * 0.025;
    pose.leftArmZ += s(t * 2.3) * 0.09;
  }
  return pose;
}
