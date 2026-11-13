import * as THREE from "three";
import type { Muscle } from "../../api";

/**
 * Procedural anatomy hologram (no model file to download).
 *
 * Two layers:
 *  - a slim, athletic "skin" made of lathe-turned parts, drawn faintly;
 *  - the main muscles as separate sculpted shapes on top (pecs, delts,
 *    biceps, six-pack, lats, quads…), each with its own material so it can be
 *    coloured by its own fatigue and picked by tapping.
 *
 * Units are roughly metres: ~1.8 tall, feet at y = 0, facing +z.
 */

export interface BodyParts {
  root: THREE.Group;
  muscles: THREE.Mesh[]; // userData.muscle holds the Muscle name
}

type Mat = (m: Muscle) => THREE.Material;

/** Lathe a radius profile [[r, y], …] (y ascending), smoothed through a spline. */
function lathe(profile: [number, number][], segments = 40, rows = 48): THREE.BufferGeometry {
  const curve = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getSpacedPoints(rows).map((v) => new THREE.Vector2(Math.max(v.x, 0.0005), v.y));
  return new THREE.LatheGeometry(pts, segments, Math.PI, Math.PI * 2);
}

/** An ellipsoid muscle belly: radii (rx, ry, rz), centre, rotation (radians). */
function belly(
  r: [number, number, number],
  at: [number, number, number],
  rot: [number, number, number] = [0, 0, 0],
): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 28, 20);
  g.scale(...r);
  g.rotateX(rot[0]);
  g.rotateY(rot[1]);
  g.rotateZ(rot[2]);
  g.translate(...at);
  return g;
}

// Writes depth only. Drawn first, a slightly shrunken copy of the skin hides
// muscles on the far side of the body, while muscles sitting on the near
// surface still show (they're outside the shrunken copy).
const occluderMat = new THREE.MeshBasicMaterial({ colorWrite: false });

export function buildBody(skinMat: THREE.Material, wireMat: THREE.Material, muscleMat: Mat): BodyParts {
  const root = new THREE.Group();
  const muscles: THREE.Mesh[] = [];

  /** `inset`: shrink factor for the occluder around the part's own axis
   * (lathe parts are centred on it); 1 = no shrink. */
  const skin = (geo: THREE.BufferGeometry, parent: THREE.Object3D, inset = 0.86) => {
    const occ = new THREE.Mesh(geo.clone().scale(inset, 1, inset), occluderMat);
    occ.renderOrder = -2;
    parent.add(occ);
    const w = new THREE.Mesh(geo, wireMat);
    w.renderOrder = -1;
    parent.add(w);
    parent.add(new THREE.Mesh(geo, skinMat));
  };
  const muscle = (m: Muscle, geo: THREE.BufferGeometry, parent: THREE.Object3D) => {
    const mesh = new THREE.Mesh(geo, muscleMat(m));
    mesh.userData.muscle = m;
    mesh.renderOrder = 2;
    parent.add(mesh);
    muscles.push(mesh);
  };

  // ---------------------------------------------------------------- skin
  // V-taper torso: broad chest and lats, narrow waist.
  const torso = lathe(
    [
      [0.0, 0.88],
      [0.09, 0.885],
      [0.125, 0.92],
      [0.137, 0.97],
      [0.129, 1.03],
      [0.115, 1.1],
      [0.112, 1.15],
      [0.13, 1.22],
      [0.152, 1.29],
      [0.168, 1.35],
      [0.172, 1.4],
      [0.16, 1.435],
      [0.11, 1.46],
      [0.055, 1.475],
      [0.048, 1.48],
    ],
    56,
    90,
  );
  torso.scale(1, 1, 0.56);
  skin(torso, root);

  const neck = new THREE.CylinderGeometry(0.045, 0.052, 0.12, 24, 3, true);
  neck.translate(0, 1.525, -0.005);
  skin(neck, root, 0.8);

  const head = new THREE.SphereGeometry(0.095, 32, 24);
  head.scale(0.92, 1.22, 1.04);
  head.translate(0, 1.668, 0.006);
  skin(head, root, 1);

  // ---------------------------------------------------------------- trunk muscles
  for (const s of [-1, 1]) {
    // Pecs: broad, flat, angled up toward the shoulder
    muscle("chest", belly([0.078, 0.052, 0.026], [s * 0.068, 1.335, 0.074], [0.15, s * 0.42, s * 0.22]), root);
    // Obliques: along the sides of the waist
    muscle("obliques", belly([0.026, 0.07, 0.03], [s * 0.098, 1.125, 0.035], [0, s * 0.6, s * -0.12]), root);
    // Lats: wings from armpit down toward the waist
    muscle("lats", belly([0.062, 0.135, 0.028], [s * 0.098, 1.25, -0.056], [0, s * -0.45, s * -0.32]), root);
    // Lower back: two erector columns
    muscle("lower_back", belly([0.024, 0.072, 0.02], [s * 0.03, 1.08, -0.062], [0.12, 0, 0]), root);
    // Glutes
    muscle("glutes", belly([0.064, 0.07, 0.048], [s * 0.06, 0.955, -0.054]), root);
    // Upper traps: slopes from neck to shoulders
    muscle("traps", belly([0.07, 0.026, 0.036], [s * 0.075, 1.452, -0.018], [0, 0, s * -0.38]), root);

    // Six-pack: three blocks per side, plus a lower block
    for (const [i, y] of [1.235, 1.175, 1.115].entries()) {
      muscle("abs", belly([0.026, 0.025 - i * 0.001, 0.012], [s * 0.029, y, 0.066]), root);
    }
    muscle("abs", belly([0.022, 0.035, 0.011], [s * 0.026, 1.045, 0.071]), root);
  }
  // Mid/lower traps: diamond on the upper back
  muscle("traps", belly([0.075, 0.12, 0.02], [0, 1.35, -0.082], [0.12, 0, Math.PI / 4]), root);

  // ---------------------------------------------------------------- limbs
  for (const s of [-1, 1]) {
    // Delts: rounded cap over the shoulder joint
    muscle("shoulders", belly([0.056, 0.066, 0.058], [s * 0.192, 1.392, 0], [0, 0, s * -0.25]), root);

    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.2, 1.41, 0);
    shoulder.rotation.z = s * 0.13;
    root.add(shoulder);

    skin(
      lathe(
        [
          [0.0, -0.3],
          [0.034, -0.29],
          [0.036, -0.26],
          [0.041, -0.18],
          [0.045, -0.1],
          [0.044, -0.04],
          [0.03, -0.01],
          [0.0, 0.0],
        ],
        28,
      ),
      shoulder,
    );
    muscle("biceps", belly([0.033, 0.09, 0.032], [0, -0.165, 0.024]), shoulder);
    muscle("triceps", belly([0.035, 0.1, 0.031], [0, -0.155, -0.026]), shoulder);

    const elbow = new THREE.Group();
    elbow.position.y = -0.295;
    elbow.rotation.x = -0.14;
    shoulder.add(elbow);
    skin(
      lathe(
        [
          [0.0, -0.262],
          [0.022, -0.255],
          [0.025, -0.21],
          [0.032, -0.14],
          [0.038, -0.06],
          [0.035, -0.015],
          [0.0, 0.0],
        ],
        28,
      ),
      elbow,
    );
    muscle("forearms", belly([0.036, 0.1, 0.032], [s * 0.003, -0.085, 0.008]), elbow);

    const hand = new THREE.SphereGeometry(0.034, 16, 12);
    hand.scale(0.75, 1.3, 0.5);
    hand.translate(0, -0.3, 0);
    skin(hand, elbow, 1);

    // Legs
    const hip = new THREE.Group();
    hip.position.set(s * 0.082, 0.94, 0);
    hip.rotation.z = s * 0.022;
    root.add(hip);
    skin(
      lathe(
        [
          [0.0, -0.45],
          [0.042, -0.443],
          [0.046, -0.41],
          [0.058, -0.32],
          [0.07, -0.2],
          [0.078, -0.09],
          [0.075, 0.0],
          [0.055, 0.035],
          [0.0, 0.045],
        ],
        32,
      ),
      hip,
    );
    // Quads: rectus femoris down the middle, vastus lateralis outside,
    // teardrop vastus medialis above the knee on the inside.
    muscle("quads", belly([0.034, 0.16, 0.03], [0, -0.2, 0.04], [0.05, 0, 0]), hip);
    muscle("quads", belly([0.032, 0.15, 0.032], [s * 0.04, -0.21, 0.016], [0, 0, s * 0.05]), hip);
    muscle("quads", belly([0.028, 0.06, 0.026], [s * -0.03, -0.355, 0.03]), hip);
    // Hamstrings: two columns down the back of the thigh
    muscle("hamstrings", belly([0.03, 0.155, 0.03], [s * 0.022, -0.22, -0.042]), hip);
    muscle("hamstrings", belly([0.026, 0.145, 0.028], [s * -0.024, -0.23, -0.038]), hip);

    const knee = new THREE.Group();
    knee.position.y = -0.448;
    hip.add(knee);
    skin(
      lathe(
        [
          [0.0, -0.43],
          [0.026, -0.425],
          [0.028, -0.38],
          [0.036, -0.27],
          [0.046, -0.15],
          [0.046, -0.08],
          [0.042, -0.015],
          [0.0, 0.0],
        ],
        28,
      ),
      knee,
    );
    // Calves: the two heads of the gastrocnemius
    muscle("calves", belly([0.03, 0.085, 0.03], [s * 0.017, -0.135, -0.032]), knee);
    muscle("calves", belly([0.027, 0.075, 0.027], [s * -0.017, -0.125, -0.03]), knee);

    const foot = new THREE.SphereGeometry(0.045, 16, 12);
    foot.scale(0.8, 0.55, 2.1);
    foot.translate(0, -0.45, 0.045);
    skin(foot, knee, 1);
  }

  return { root, muscles };
}
