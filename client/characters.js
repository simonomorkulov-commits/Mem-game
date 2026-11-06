import * as THREE from './vendor/three.module.js';

export const CHARACTERS = [
  { id: 'azamat', name: 'Парень', description: 'Ак-калпак и чапан', color: '#b9ff66' },
  { id: 'aigerim', name: 'Девушка', description: 'Праздничное платье и шөкүлө', color: '#ffa7bf' }
];
export const characterInfo = id => CHARACTERS.find(character => character.id === id) || CHARACTERS[0];

export function disposeCharacter(root) {
  const materials = new Set();
  root.traverse(object => {
    object.geometry?.dispose();
    if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  for (const material of materials) material.dispose();
}

export function createCharacter(id) {
  const info = characterInfo(id), girl = info.id === 'aigerim';
  const root = new THREE.Group(); root.name = 'character:' + info.id;
  const mat = color => new THREE.MeshStandardMaterial({ color, roughness: .74, metalness: .03 });
  const skin = mat('#dbac7c'), hair = mat('#201a24'), gold = mat('#e8bc66');
  const dark = mat('#19202c'), white = mat('#fff5e3'), teal = mat('#176d71');
  const red = mat('#bf355d'), boots = mat('#3c2630');
  const cloth = girl ? red : teal;
  function mesh(geometry, material, x, y, z, parent = root) {
    const object = new THREE.Mesh(geometry, material); object.position.set(x, y, z);
    object.castShadow = true; object.receiveShadow = true; parent.add(object); return object;
  }
  const box = (w, h, d, material, x, y, z, parent) => mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z, parent);
  function seam(a, b, radius, material, parent = root) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const object = mesh(new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 6), material, 0, 0, 0, parent);
    object.position.copy(start).add(end).multiplyScalar(.5);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize()); return object;
  }
  function ornament(parent, y, z, size = .2, material = gold) {
    // Mirrored embroidered curls, repeated on the front and back of the clothes.
    for (const side of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([[0, -.36], [.28, -.08], [.82, .14], [.7, .6], [.26, .72], [.18, .35], [.47, .3]]
        .map(([x, py]) => new THREE.Vector3(x * size * side, py * size + y, z)));
      mesh(new THREE.TubeGeometry(curve, 14, .012, 4, false), material, 0, 0, 0, parent);
    }
  }

  const torso = new THREE.Group(); root.add(torso);
  box(.67, .72, .43, cloth, 0, 1.09, 0, torso);
  box(.19, .52, .03, white, 0, 1.12, -.23, torso);
  for (const side of [-1, 1]) {
    box(.055, .64, .045, gold, side * .17, 1.07, -.25, torso);
    box(.045, .5, .035, gold, side * .29, 1.1, .233, torso);
  }
  box(.7, .09, .46, gold, 0, .79, 0, torso);
  box(.14, .115, .025, girl ? white : dark, 0, .79, -.245, torso);
  ornament(torso, 1.12, .235, .26);
  if (girl) {
    // Flared dress, white hem, short embroidered vest and two dark braids.
    mesh(new THREE.CylinderGeometry(.28, .48, .66, 12), red, 0, .47, 0, torso);
    mesh(new THREE.CylinderGeometry(.45, .48, .075, 12), white, 0, .17, 0, torso);
    mesh(new THREE.CylinderGeometry(.42, .43, .04, 12), gold, 0, .25, 0, torso);
    box(.15, .43, .46, teal, -.25, 1.16, 0, torso);
    box(.15, .43, .46, teal, .25, 1.16, 0, torso);
    ornament(torso, 1.04, -.25, .11);
    for (const x of [-.11, 0, .11]) mesh(new THREE.SphereGeometry(.027, 6, 5), gold, x, 1.35 - Math.abs(x) * .25, -.26, torso);
  } else {
    box(.7, .29, .44, teal, 0, .64, 0, torso);
    box(.7, .035, .46, gold, 0, .49, 0, torso);
    ornament(torso, .65, -.24, .12);
  }
  const head = new THREE.Group(); head.position.y = 1.77; root.add(head);
  box(.62, .6, .56, skin, 0, 0, 0, head);
  box(.65, .13, .59, hair, 0, .25, 0, head);
  box(.13, .21, .07, hair, -.24, .12, -.27, head);
  if (girl) box(.11, .19, .06, hair, .245, .14, -.28, head);
  for (const side of [-1, 1]) {
    box(.095, .055, .028, hair, side * .14, .04, -.29, head);
    box(.045, .065, .035, dark, side * .14, -.015, -.30, head);
    box(.014, .023, .04, white, side * .14 - .012, .001, -.3, head);
    box(.075, .035, .015, girl ? red : skin, side * .22, -.11, -.287, head);
  }
  box(.085, .026, .025, girl ? red : hair, 0, -.17, -.29, head);
  if (girl) {
    box(.63, .47, .08, hair, 0, .07, .28, head);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const braid = mesh(new THREE.SphereGeometry(.065, 7, 6), hair, side * (.3 + Math.sin(i * 1.9) * .018), .03 - i * .095, .19, head);
        braid.scale.set(.83, 1.05, .9);
      }
      mesh(new THREE.SphereGeometry(.055, 8, 6), gold, side * .3, -.63, .19, head);
      mesh(new THREE.SphereGeometry(.03, 6, 5), gold, side * .34, -.13, -.02, head);
    }
    mesh(new THREE.CylinderGeometry(.045, .32, .53, 12), red, 0, .55, 0, head);
    mesh(new THREE.CylinderGeometry(.33, .33, .1, 16), gold, 0, .3, 0, head);
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      seam([Math.sin(angle) * .3, .34, Math.cos(angle) * .3], [Math.sin(angle) * .055, .79, Math.cos(angle) * .055], .009, gold, head);
      mesh(new THREE.SphereGeometry(.022, 5, 5), white, Math.sin(angle) * .332, .31, Math.cos(angle) * .332, head);
    }
    seam([0, .8, 0], [.06, 1.13, .01], .008, gold, head);
    for (let i = 0; i < 4; i++) {
      const feather = mesh(new THREE.SphereGeometry(1, 7, 6), white, .025 + i * .012, .88 + i * .07, .01, head);
      feather.scale.set(.052 - i * .008, .095, .017); feather.rotation.z = -.2;
    }
  } else {
    // Four white felt panels, dark seams and an upturned contrasting brim.
    const cap = mesh(new THREE.CylinderGeometry(.19, .33, .49, 4, 1), white, 0, .54, 0, head); cap.rotation.y = Math.PI / 4;
    const brim = mesh(new THREE.CylinderGeometry(.38, .35, .13, 8), white, 0, .31, 0, head); brim.rotation.y = Math.PI / 8;
    mesh(new THREE.TorusGeometry(.34, .025, 5, 24), dark, 0, .375, 0, head).rotation.x = Math.PI / 2;
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) seam([x * .31, .34, z * .31], [x * .18, .78, z * .18], .012, dark, head);
    ornament(head, .54, -.245, .105, dark);
    ornament(head, .54, .245, .105, dark);
  }

  const limbs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(side * .18, .69, 0); root.add(leg);
    box(.25, .47, .28, dark, 0, -.25, 0, leg);
    box(.28, .24, .39, boots, 0, -.51, -.045, leg);
    box(.285, .04, .4, gold, 0, -.62, -.045, leg);
    const arm = new THREE.Group(); arm.position.set(side * .46, 1.38, 0); root.add(arm);
    box(.23, .43, .31, cloth, 0, -.19, 0, arm);
    box(.24, .07, .32, gold, 0, -.39, 0, arm);
    box(.20, .17, .26, skin, 0, -.5, 0, arm);
    limbs.push({ leg, arm, side });
  }
  return { root, head, torso, limbs, id: info.id };
}

export function renderCharacterPreviews(images) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(300, 340); renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#fff6ed', '#55445c', 2.7));
  const light = new THREE.DirectionalLight('#fff8ee', 3); light.position.set(-3, 5, -5); scene.add(light);
  const camera = new THREE.PerspectiveCamera(32, 300 / 340, .1, 20);
  camera.position.set(3, 2.3, -5.7); camera.lookAt(0, 1.4, 0);
  for (const info of CHARACTERS) {
    const character = createCharacter(info.id); scene.add(character.root);
    renderer.render(scene, camera); images[info.id].src = renderer.domElement.toDataURL('image/png');
    scene.remove(character.root); disposeCharacter(character.root);
  }
  renderer.dispose(); renderer.forceContextLoss();
}
