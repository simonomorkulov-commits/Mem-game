import * as THREE from './vendor/three.module.js';
import { MEMES, PORTAL_X } from './data.js';
import { move, portalAt } from './game.js';
import { createCharacter, disposeCharacter } from './characters.js';
import { joystickStrength } from './joystick.js';
import { ROOM_THEMES } from './scoring.js';

export async function createWorld(canvas, onPortal, onWalk, characterId = 'azamat') {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  const sharpPixelRatio = () => Math.min(devicePixelRatio || 1, matchMedia('(pointer: coarse)').matches ? 2.5 : 2);
  renderer.setPixelRatio(sharpPixelRatio());
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#151425');
  scene.fog = new THREE.Fog('#151425', 24, 53);
  const camera = new THREE.PerspectiveCamera(43, 1, .1, 70);
  camera.position.set(0, 11.5, 16.8);
  camera.lookAt(0, 1, -1.4);
  scene.add(new THREE.HemisphereLight('#c2c0ff', '#302148', 2.7));
  const key = new THREE.DirectionalLight('#f4eaff', 3.5);
  key.position.set(-5, 12, 6); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 });
  key.shadow.bias = -.001;
  scene.add(key);
  const rim = new THREE.PointLight('#a58aff', 38, 20);
  rim.position.set(0, 5, -4); scene.add(rim);

  const material = (color, roughness = .65, metalness = .05) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const ink = material('#181827');
  const wallMat = material('#33304e');
  const floorMat = material('#35334e', .38, .18);
  const lime = new THREE.MeshStandardMaterial({ color: '#bdff72', emissive: '#8feb3e', emissiveIntensity: .7 });
  const lavender = new THREE.MeshStandardMaterial({ color: '#b39aff', emissive: '#9a71ff', emissiveIntensity: .5 });
  function box(w, h, d, mat, x = 0, y = 0, z = 0, parent = scene) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  }
  box(14, .4, 15, floorMat, 0, -.24, .8);
  box(14, 5.9, .4, wallMat, 0, 2.5, -5.95);
  box(.35, 1.3, 14, wallMat, -7, .4, .7);
  box(.35, 1.3, 14, wallMat, 7, .4, .7);
  const grid = new THREE.GridHelper(14, 14, '#827399', '#55506b');
  grid.position.set(0, -.018, .8); scene.add(grid);
  box(13.7, .04, .04, lavender, 0, .03, 7.8);
  box(.04, .04, 13.7, lavender, -6.8, .03, .8);
  box(.04, .04, 13.7, lavender, 6.8, .03, .8);
  // Slender architectural lights make the room readable without external models.
  for (const x of [-6.75, 6.75]) {
    box(.28, 5.3, .35, ink, x, 2.4, -5.5);
    box(.055, 4.6, .08, lavender, x, 2.5, -5.28);
    box(.8, .3, .8, ink, x, .1, -5.4);
  }
  const loader = new THREE.TextureLoader();
  const textures = new Map();
  let pinnedTextures = new Set();
  async function loadTextures(memes) {
    await Promise.all(memes.filter(meme => !textures.has(meme.id)).map(async meme => {
    let texture = await loader.loadAsync(meme.image);
    if (meme.contentAspect) {
      // Show the source frame, leaving the collection's title outside the game picture.
      const source = texture.image, aspect = meme.contentAspect;
      const sw = Math.min(900, 1020 * aspect), sh = sw / aspect, sx = (900 - sw) / 2, sy = (1110 - sh) / 2;
      const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 1250;
      const ctx = canvas.getContext('2d'), fill = Math.max(900 / sw, 1250 / sh), fit = Math.min(900 / sw, 1250 / sh) * 1.08;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#171322'; ctx.fillRect(0, 0, 900, 1250);
      ctx.filter = 'blur(28px) brightness(0.4)'; ctx.drawImage(source, sx, sy, sw, sh, (900 - sw * fill) / 2, (1250 - sh * fill) / 2, sw * fill, sh * fill);
      ctx.filter = 'none'; ctx.drawImage(source, sx, sy, sw, sh, (900 - sw * fit) / 2, (1250 - sh * fit) / 2, sw * fit, sh * fit);
      texture.dispose(); texture = new THREE.CanvasTexture(canvas);
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const aspect = texture.image.width / texture.image.height;
    const frameAspect = 3.52 / 4.85;
    if (aspect > frameAspect) { texture.repeat.x = frameAspect / aspect; texture.offset.x = (1 - texture.repeat.x) / 2; }
    else { texture.repeat.y = aspect / frameAspect; texture.offset.y = (1 - texture.repeat.y) / 2; }
      textures.set(meme.id, texture);
    }));
    for (const [id, texture] of textures) {
      if (textures.size <= 12) break;
      if (!pinnedTextures.has(id) && !memes.some(m => m.id === id)) { texture.dispose(); textures.delete(id); }
    }
  }
  await loadTextures(MEMES.slice(0, 3));
  const portalMeshes = [];
  const portals = PORTAL_X.map((x, index) => {
    const group = new THREE.Group(); group.position.set(x, 0, -5.55); scene.add(group);
    const frameMat = new THREE.MeshStandardMaterial({ color: '#bda4ff', emissive: '#9164ff', emissiveIntensity: .65, roughness: .35 });
    box(3.62, 5.05, .26, ink, 0, 2.9, 0, group);
    const image = new THREE.Mesh(new THREE.PlaneGeometry(3.52, 4.85), new THREE.MeshBasicMaterial({ map: textures.get(MEMES[index].id), fog: false, toneMapped: false }));
    image.position.set(0, 2.9, .15); image.userData.portal = index; group.add(image);
    const touchTarget = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 5.05), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    touchTarget.position.set(0, 2.9, .2); touchTarget.userData.portal = index; group.add(touchTarget);
    portalMeshes.push(touchTarget);
    box(.085, 4.96, .1, frameMat, -1.8, 2.9, .17, group);
    box(.085, 4.96, .1, frameMat, 1.8, 2.9, .17, group);
    box(3.68, .085, .1, frameMat, 0, 5.38, .17, group);
    box(3.68, .085, .1, frameMat, 0, .42, .17, group);
    const step = box(3.75, .12, 1.08, frameMat, 0, .015, .65, group);
    step.castShadow = false;
    const pad = box(2.4, .015, .09, lavender, 0, .015, 1.5, group);
    // The number above the picture matches keyboard and touch controls.
    const label = document.createElement('canvas'); label.width = 128; label.height = 128;
    const ctx = label.getContext('2d'); ctx.fillStyle = '#25223b'; ctx.beginPath(); ctx.arc(64, 64, 50, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#bda4ff'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#eee8ff'; ctx.font = 'bold 64px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(index + 1), 64, 68);
    const labelTexture = new THREE.CanvasTexture(label); labelTexture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture }));
    sprite.scale.set(.62, .62, 1); sprite.position.set(0, 5.98, 0); group.add(sprite);
    return { group, image, frameMat, pad };
  });

  const character = new THREE.Group(); character.position.set(0, 0, 4); scene.add(character);
  let rig = createCharacter(characterId); character.add(rig.root);
  const halo = new THREE.Mesh(new THREE.RingGeometry(.57, .63, 40), new THREE.MeshBasicMaterial({ color: '#c2ff82', side: THREE.DoubleSide, transparent: true, opacity: .75 }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = .015; character.add(halo);
  const destination = new THREE.Mesh(new THREE.RingGeometry(.26, .32, 32), new THREE.MeshBasicMaterial({ color: '#dbffb0', side: THREE.DoubleSide, transparent: true, opacity: .8 }));
  destination.rotation.x = -Math.PI / 2; destination.position.y = .04; destination.visible = false; scene.add(destination);
  const particleGeometry = new THREE.BufferGeometry();
  const points = new Float32Array(100 * 3);
  for (let i = 0; i < 100; i++) { points[i * 3] = (Math.random() - .5) * 14; points[i * 3 + 1] = Math.random() * 7; points[i * 3 + 2] = (Math.random() - .5) * 15; }
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
  const dust = new THREE.Points(particleGeometry, new THREE.PointsMaterial({ color: '#d6baff', size: .035, transparent: true, opacity: .45 }));
  scene.add(dust);

  let position = { x: 0, z: 4 }, active = false, target = null, last = performance.now(), elapsed = 0, phase = 0;
  let joystick = { x: 0, z: 0 };
  let cameraOffset = 0;
  const cameraProbe = new THREE.Vector3();
  function followCharacter(dt, snap = false) {
    // Pan parallel to the room after the avatar leaves the middle of the view.
    // A wider visible area near the portals naturally returns the camera to the centre.
    const bottomEdge = Math.abs(cameraProbe.set(cameraOffset + 1, 0, position.z + .65).project(camera).x);
    const topEdge = Math.abs(cameraProbe.set(cameraOffset + 1, 2.75, position.z + .65).project(camera).x);
    const deadZone = .48 / Math.max(bottomEdge, topEdge, .001);
    const targetOffset = position.x - Math.max(-deadZone, Math.min(deadZone, position.x));
    cameraOffset += (targetOffset - cameraOffset) * (snap ? 1 : 1 - Math.exp(-8 * dt));
    camera.position.x = cameraOffset;
    camera.lookAt(cameraOffset, 1, -1.4); camera.updateMatrixWorld();
  }
  let pendingTap = null;
  const keys = new Set();
  const clearKeys = () => { keys.clear(); joystick = { x: 0, z: 0 }; pendingTap = null; target = null; destination.visible = false; };
  const keyMap = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
  window.addEventListener('keydown', event => {
    if (!active || !keyMap[event.code] || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    event.preventDefault(); keys.add(event.code); target = null; destination.visible = false;
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', clearKeys);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearKeys(); });
  const raycaster = new THREE.Raycaster(); const mouse = new THREE.Vector2();
  function walkTo(x, z) {
    if (!active) return;
    clearKeys(); target = { x: Math.max(-6, Math.min(6, x)), z: Math.max(-5, Math.min(6, z)) };
    destination.position.set(target.x, .04, target.z); destination.visible = true; onWalk?.();
  }
  canvas.addEventListener('pointerdown', event => {
    if (!active || event.button > 0 || event.isPrimary === false) return;
    pendingTap = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now() };
  });
  canvas.addEventListener('pointercancel', () => { pendingTap = null; });
  canvas.addEventListener('pointerup', event => {
    const tap = pendingTap; pendingTap = null;
    if (!active || !tap || tap.id !== event.pointerId || performance.now() - tap.time > 600 || Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 12) return;
    const rect = canvas.getBoundingClientRect();
    mouse.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.intersectObjects(portalMeshes)[0];
    if (hit) { walkTo(PORTAL_X[hit.object.userData.portal], -4.9); return; }
  });
  const observer = new ResizeObserver(() => {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false); camera.aspect = width / height;
    if (camera.aspect < 1.2) { camera.position.set(cameraOffset, 13.5, 22); camera.fov = 51; }
    else { camera.position.set(cameraOffset, 11.5, 16.8); camera.fov = 43; }
    camera.lookAt(cameraOffset, 1, -1.4); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    followCharacter(0, true);
    if (!document.hidden) renderer.render(scene, camera);
  });
  observer.observe(canvas);
  function frame(now) {
    const dt = Math.min((now - last) / 1000, .05); last = now; elapsed += dt;
    let direction = { x: 0, z: 0 }, speed = 1;
    if (active) {
      for (const key of keys) { const value = keyMap[key]; if (value) { direction.x += value[0]; direction.z += value[1]; } }
      if (target && !direction.x && !direction.z) {
        direction = { x: target.x - position.x, z: target.z - position.z };
        if (Math.hypot(direction.x, direction.z) < .12) { target = null; direction = { x: 0, z: 0 }; destination.visible = false; }
      }
      const strength = joystickStrength(joystick.x, joystick.z);
      if (strength > 0) { direction = joystick; speed = strength; }
      position = move(position, direction, dt, speed);
      const portal = portalAt(position.x, position.z);
      if (portal !== -1) { active = false; clearKeys(); onPortal(portal); }
    }
    const walking = active && Math.hypot(direction.x, direction.z) > .1;
    if (walking) {
      phase += dt * 13;
      const desired = Math.atan2(-direction.x, -direction.z);
      let difference = desired - character.rotation.y;
      difference = Math.atan2(Math.sin(difference), Math.cos(difference));
      character.rotation.y += difference * Math.min(dt * 14, 1);
    }
    character.position.set(position.x, walking ? Math.abs(Math.sin(phase)) * .06 : Math.sin(elapsed * 2) * .025, position.z);
    followCharacter(dt);
    for (const { leg, arm, side } of rig.limbs) {
      leg.rotation.x = walking ? Math.sin(phase) * .55 * side : 0;
      arm.rotation.x = walking ? -Math.sin(phase) * .5 * side : Math.sin(elapsed * 2) * .035;
    }
    rig.head.rotation.z = Math.sin(elapsed * 1.4) * .025;
    rig.torso.rotation.z = walking ? Math.sin(phase) * .025 : 0;
    halo.material.opacity = .55 + Math.sin(elapsed * 3) * .13;
    dust.rotation.y = elapsed * .012;
    if (!document.hidden && !document.querySelector('dialog[open]') && now - lastRender >= (powerSaving ? 1000 / 30 : active ? 1000 / 60 : 1000 / 20)) {
      renderer.render(scene, camera); lastRender = now;
    }
    requestAnimationFrame(frame);
  }
  let powerSaving = false, lastRender = 0;
  requestAnimationFrame(frame);
  return {
    get position() { return { ...position }; },
    get active() { return active; },
    setActive(value) { active = value; clearKeys(); },
    reset() {
      position = { x: 0, z: 4.6 }; character.rotation.y = 0; clearKeys();
      cameraOffset = 0; camera.position.x = 0; camera.lookAt(0, 1, -1.4); camera.updateMatrixWorld();
    },
    walkToPortal(index) { if (index >= 0 && index < 3) walkTo(PORTAL_X[index], -4.9); },
    setDirection(code, down) { if (!active) return; if (down) { keys.add(code); target = null; destination.visible = false; } else keys.delete(code); },
    setJoystick(x, z) { if (!active) return; joystick = { x, z }; if (joystickStrength(x, z) > 0) { target = null; destination.visible = false; } },
    setPowerSaving(value) {
      if (powerSaving === value) return;
      powerSaving = value; renderer.shadowMap.enabled = !value; dust.visible = !value;
      renderer.setPixelRatio(value ? Math.min(devicePixelRatio || 1, 1) : sharpPixelRatio());
    },
    setCharacter(id) {
      if (rig.id === id) return;
      character.remove(rig.root); disposeCharacter(rig.root);
      rig = createCharacter(id); character.add(rig.root);
    },
    async preloadRounds(rounds) {
      const memes = [...new Map(rounds.flatMap(round => round.options).map(meme => [meme.id, meme])).values()];
      pinnedTextures = new Set(memes.map(meme => meme.id));
      await loadTextures(memes);
    },
    async setRound(round) {
      await loadTextures(round.options);
      const theme = ROOM_THEMES[round.theme] || ROOM_THEMES.neon;
      round.options.forEach((meme, i) => {
        portals[i].image.material.map = textures.get(meme.id); portals[i].image.material.needsUpdate = true;
        portals[i].frameMat.color.set(theme.light); portals[i].frameMat.emissive.set(theme.light);
      });
      wallMat.color.set(theme.wall); floorMat.color.set(theme.floor); rim.color.set(theme.light);
    },
    reveal(correct, selected) {
      portals.forEach((portal, i) => {
        const color = i === correct ? '#b8ff65' : i === selected ? '#ff6585' : '#635b78';
        portal.frameMat.color.set(color); portal.frameMat.emissive.set(color);
      });
    }
  };
}
