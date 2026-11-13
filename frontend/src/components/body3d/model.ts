import * as THREE from "three";
import { ALL_MUSCLES, type Muscle } from "../../api";

/**
 * Procedural 3D mannequin for the hologram, built from lathe-turned body
 * parts (no model file to download). Every vertex carries a `muscle`
 * attribute: an index into ALL_MUSCLES, or -1 for skin with no muscle (head,
 * hands, shins). The shader colours each vertex from that muscle's fatigue.
 *
 * Units are roughly metres: the figure is ~1.8 tall with its feet at y = 0
 * and faces +z.
 */

export const MUSCLE_INDEX: Record<Muscle, number> = Object.fromEntries(
  ALL_MUSCLES.map((m, i) => [m, i]),
) as Record<Muscle, number>;

type Classifier = (p: THREE.Vector3, n: THREE.Vector3) => Muscle | null;

const NONE: Classifier = () => null;

/** Lathe a radius profile [[r, y], …] (y ascending) around the Y axis. The
 * profile is smoothed through a spline and resampled densely, so the outline
 * has no corners and muscle boundaries land on fine rows. The seam sits at the
 * back so it never shows from the front. */
function lathe(profile: [number, number][], segments = 40, rows = 48): THREE.BufferGeometry {
  const curve = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getSpacedPoints(rows).map((v) => new THREE.Vector2(Math.max(v.x, 0.0005), v.y));
  return new THREE.LatheGeometry(pts, segments, Math.PI, Math.PI * 2);
}

/** Tag every vertex with its muscle using the classifier (in part-local space),
 * and add per-vertex `fatigue` and `selected` attributes that the app fills in
 * (see paintBody). Per-vertex values interpolate smoothly across triangles,
 * so boundaries between muscles blend instead of showing jagged edges. */
function tag(geo: THREE.BufferGeometry, classify: Classifier): THREE.BufferGeometry {
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const ids = new Float32Array(pos.count);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i).normalize();
    const m = classify(p, n);
    ids[i] = m === null ? -1 : MUSCLE_INDEX[m];
  }
  geo.setAttribute("muscle", new THREE.BufferAttribute(ids, 1));
  geo.setAttribute("fatigue", new THREE.BufferAttribute(new Float32Array(pos.count), 1));
  geo.setAttribute("selected", new THREE.BufferAttribute(new Float32Array(pos.count), 1));
  return geo;
}

/** Write each muscle's fatigue (0-1) and the selection into the vertex attributes. */
export function paintBody(meshes: THREE.Mesh[], fatigue: number[], selected: number) {
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const ids = geo.getAttribute("muscle") as THREE.BufferAttribute;
    const fat = geo.getAttribute("fatigue") as THREE.BufferAttribute;
    const sel = geo.getAttribute("selected") as THREE.BufferAttribute;
    for (let i = 0; i < ids.count; i++) {
      const m = ids.getX(i);
      fat.setX(i, m >= 0 ? fatigue[m] : -1);
      sel.setX(i, m >= 0 && m === selected ? 1 : 0);
    }
    fat.needsUpdate = true;
    sel.needsUpdate = true;
  }
}

// --- Classifiers (part-local coordinates; +z is the front of the body) -------

const torso: Classifier = (p, n) => {
  const ax = Math.abs(p.x);
  const y = p.y;
  const front = n.z > 0.2;
  const back = n.z < -0.2;
  if (y > 1.425 && ax < 0.15) return "traps"; // slope from neck to shoulders
  if (front) {
    if (y >= 1.26 && y <= 1.425 && ax < 0.168) return "chest";
    if (y >= 1.03 && y < 1.26) return ax < 0.072 ? "abs" : "obliques";
    return null;
  }
  if (back) {
    if (y >= 1.32 && ax < 0.125) return "traps";
    if (y >= 1.1) return "lats";
    if (y >= 1.02) return "lower_back";
    return "glutes";
  }
  // Sides of the trunk
  if (y >= 1.12 && y <= 1.38) return "lats";
  if (y >= 1.03 && y < 1.12) return "obliques";
  return null;
};

const neck: Classifier = (_p, n) => (n.z < -0.1 ? "traps" : null);
const shoulderCap: Classifier = () => "shoulders";
const upperArm: Classifier = (p, n) => {
  if (p.y > -0.055) return "shoulders";
  return n.z >= -0.05 ? "biceps" : "triceps";
};
const forearm: Classifier = () => "forearms";
const thigh: Classifier = (p, n) => {
  if (p.y > -0.07 && n.z < -0.2) return "glutes";
  return n.z > -0.3 ? "quads" : "hamstrings";
};
const lowerLeg: Classifier = (p, n) => (n.z < 0.25 && p.y < -0.03 && p.y > -0.36 ? "calves" : null);

// --- Parts -------------------------------------------------------------------

export interface BodyParts {
  root: THREE.Group;
  meshes: THREE.Mesh[]; // muscle-tagged surfaces (raycast targets)
}

export function buildBody(material: THREE.Material, wire: THREE.Material): BodyParts {
  const root = new THREE.Group();
  const meshes: THREE.Mesh[] = [];

  const add = (geo: THREE.BufferGeometry, parent: THREE.Object3D, classify: Classifier) => {
    tag(geo, classify);
    const mesh = new THREE.Mesh(geo, material);
    mesh.renderOrder = 1;
    parent.add(mesh);
    meshes.push(mesh);
    const w = new THREE.Mesh(geo, wire);
    w.renderOrder = 0;
    parent.add(w);
    return mesh;
  };

  // Torso: crotch to neck base, flattened front-to-back.
  const torsoGeo = lathe(
    [
      [0.0, 0.9],
      [0.1, 0.905],
      [0.15, 0.93],
      [0.17, 0.98],
      [0.168, 1.04],
      [0.15, 1.1],
      [0.138, 1.15],
      [0.142, 1.2],
      [0.155, 1.26],
      [0.17, 1.32],
      [0.18, 1.38],
      [0.176, 1.42],
      [0.14, 1.452],
      [0.075, 1.472],
      [0.055, 1.48],
    ],
    56,
    90,
  );
  torsoGeo.scale(1, 1, 0.62);
  add(torsoGeo, root, torso);

  // Neck and head
  const neckGeo = new THREE.CylinderGeometry(0.05, 0.056, 0.12, 24, 3, true);
  neckGeo.translate(0, 1.52, -0.005);
  add(neckGeo, root, neck);

  const headGeo = new THREE.SphereGeometry(0.1, 32, 24);
  headGeo.scale(0.95, 1.2, 1.05);
  headGeo.translate(0, 1.665, 0.005);
  add(headGeo, root, NONE);

  for (const side of [-1, 1]) {
    // Shoulder cap
    const cap = new THREE.SphereGeometry(0.066, 24, 16);
    cap.scale(1, 0.95, 0.88);
    cap.translate(side * 0.186, 1.405, 0);
    add(cap, root, shoulderCap);

    // Arm hangs from the shoulder, slightly away from the body.
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.212, 1.425, 0);
    shoulder.rotation.z = side * 0.11;
    root.add(shoulder);

    const upper = lathe(
      [
        [0.0, -0.3],
        [0.038, -0.292],
        [0.041, -0.27],
        [0.047, -0.2],
        [0.052, -0.14],
        [0.055, -0.07],
        [0.05, -0.012],
        [0.0, 0.0],
      ],
      28,
    );
    upper.scale(1, 1, 0.92);
    add(upper, shoulder, upperArm);

    const elbow = new THREE.Group();
    elbow.position.y = -0.295;
    elbow.rotation.x = -0.12;
    shoulder.add(elbow);

    const fore = lathe(
      [
        [0.0, -0.262],
        [0.027, -0.255],
        [0.031, -0.21],
        [0.037, -0.15],
        [0.044, -0.06],
        [0.041, -0.015],
        [0.0, 0.0],
      ],
      28,
    );
    fore.scale(1, 1, 0.85);
    add(fore, elbow, forearm);

    const hand = new THREE.SphereGeometry(0.038, 16, 12);
    hand.scale(0.75, 1.25, 0.5);
    hand.translate(0, -0.3, 0);
    add(hand, elbow, NONE);

    // Leg
    const hip = new THREE.Group();
    hip.position.set(side * 0.088, 0.955, 0);
    hip.rotation.z = side * 0.025;
    root.add(hip);

    const thighGeo = lathe(
      [
        [0.0, -0.45],
        [0.05, -0.443],
        [0.054, -0.41],
        [0.066, -0.32],
        [0.08, -0.2],
        [0.09, -0.08],
        [0.088, -0.02],
        [0.0, 0.0],
      ],
      32,
    );
    thighGeo.scale(1, 1, 0.95);
    add(thighGeo, hip, thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.448;
    hip.add(knee);

    const shin = lathe(
      [
        [0.0, -0.43],
        [0.03, -0.425],
        [0.032, -0.38],
        [0.045, -0.25],
        [0.057, -0.14],
        [0.056, -0.09],
        [0.05, -0.015],
        [0.0, 0.0],
      ],
      28,
    );
    shin.scale(1, 1, 0.95);
    add(shin, knee, lowerLeg);

    const foot = new THREE.SphereGeometry(0.05, 16, 12);
    foot.scale(0.8, 0.55, 2.1);
    foot.translate(0, -0.45, 0.045);
    add(foot, knee, NONE);
  }

  return { root, meshes };
}
