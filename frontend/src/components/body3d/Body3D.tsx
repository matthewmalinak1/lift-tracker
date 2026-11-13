import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ALL_MUSCLES, type BodyStatus, type Muscle } from "../../api";
import { buildBody, MUSCLE_INDEX, paintBody } from "./model";

const VERT = /* glsl */ `
  attribute float fatigue;   // 0-1, or -1 for skin with no muscle
  attribute float selected;  // 1 on the tapped muscle
  varying float vFatigue;
  varying float vSelected;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying float vY;
  void main() {
    vFatigue = fatigue;
    vSelected = selected;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vY = world.y;
    vec4 mv = viewMatrix * world;
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

// Hologram look: colour from the muscle's fatigue (blue -> red), a Fresnel rim
// glow on edges facing away from the camera, faint scan lines, and a bright
// band sweeping up the body.
const FRAG = /* glsl */ `
  uniform float uTime;
  varying float vFatigue;
  varying float vSelected;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying float vY;
  void main() {
    float muscle = clamp(vFatigue + 1.0, 0.0, 1.0);  // 0 on bare skin, 1 on muscle
    float f = max(vFatigue, 0.0);
    vec3 blue = vec3(0.486, 0.769, 1.0);
    vec3 red = vec3(1.0, 0.30, 0.37);
    vec3 col = mix(blue, red, f);

    float facing = abs(dot(normalize(vNormalV), normalize(vViewDir)));
    float rim = pow(1.0 - facing, 2.0);
    float sweepY = mod(uTime * 0.35, 2.4) - 0.3;
    float sweep = 1.0 - smoothstep(0.0, 0.07, abs(vY - sweepY));
    float sel = vSelected;

    float a = mix(0.035, 0.07 + 0.5 * f, muscle)
            + rim * 0.7
            + sweep * 0.18
            + sel * 0.3;
    vec3 c = col * (0.55 + rim * 0.9 + sel * 0.5) + sweep * 0.15;
    gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
  }
`;

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export const canUse3D = typeof document !== "undefined" && webglAvailable();

/**
 * 3D rotating body hologram. Drag sideways to spin it (with momentum); tap a
 * muscle to select it.
 */
export default function Body3D({
  status,
  selected,
  onSelect,
}: {
  status: BodyStatus | null;
  selected: Muscle | null;
  onSelect: (m: Muscle | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const uniforms = useRef({ uTime: { value: 0 } });
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const [hinted, setHinted] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // Repaint the body whenever recovery data or the selected muscle changes.
  const paint = () => {
    const fatigue = ALL_MUSCLES.map((m) => status?.muscles[m]?.fatigue ?? 0);
    paintBody(meshesRef.current, fatigue, selected ? MUSCLE_INDEX[selected] : -1);
  };
  const paintRef = useRef(paint);
  paintRef.current = paint;
  useEffect(() => paint(), [status, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const wrap = wrapRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    wrap.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "pan-y";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 20);
    camera.position.set(0, 1.12, 4.1);
    camera.lookAt(0, 0.9, 0);

    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: uniforms.current,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });
    const wire = new THREE.MeshBasicMaterial({
      color: 0x7cc4ff,
      wireframe: true,
      transparent: true,
      opacity: 0.045,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const { root, meshes } = buildBody(material, wire);
    meshesRef.current = meshes;
    paintRef.current();
    scene.add(root);

    // Projector rings under the feet
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x7cc4ff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const rings = new THREE.Group();
    for (const [r, o] of [
      [0.32, 0.55],
      [0.24, 0.3],
      [0.4, 0.18],
    ] as const) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.006, r, 96), ringMat.clone());
      (ring.material as THREE.MeshBasicMaterial).opacity = o;
      ring.rotation.x = -Math.PI / 2;
      rings.add(ring);
    }
    scene.add(rings);

    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // --- Drag to rotate, with momentum; tap to pick a muscle -----------------
    let yaw = 0;
    let velocity = 0; // radians per ms
    let dragging = false;
    let startX = 0;
    let lastX = 0;
    let lastT = 0;
    let moved = false;
    const RAD_PER_PX = 0.012;
    const el = renderer.domElement;

    const down = (e: PointerEvent) => {
      dragging = true;
      moved = false;
      startX = lastX = e.clientX;
      lastT = performance.now();
      velocity = 0;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const now = performance.now();
      const dx = e.clientX - lastX;
      if (Math.abs(e.clientX - startX) > 6) {
        moved = true;
        setHinted(true);
      }
      if (moved) {
        yaw += dx * RAD_PER_PX;
        velocity = 0.75 * ((dx * RAD_PER_PX) / Math.max(1, now - lastT)) + 0.25 * velocity;
      }
      lastX = e.clientX;
      lastT = now;
    };
    const raycaster = new THREE.Raycaster();
    const up = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (moved) return;
      velocity = 0;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster
        .intersectObjects(meshes, false)
        .find((h) => h.face && (h.object as THREE.Mesh).geometry.getAttribute("muscle").getX(h.face.a) >= 0);
      if (!hit || !hit.face) {
        onSelectRef.current(null);
        return;
      }
      const idx = (hit.object as THREE.Mesh).geometry.getAttribute("muscle").getX(hit.face.a);
      const m = ALL_MUSCLES[Math.round(idx)];
      onSelectRef.current(m === selectedRef.current ? null : m);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);

    // --- Render loop ---------------------------------------------------------
    let raf = 0;
    let last = performance.now();
    const start = last;
    const frame = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      if (!dragging && Math.abs(velocity) > 1e-5) {
        yaw += velocity * dt;
        velocity *= Math.pow(0.995, dt);
      }
      root.rotation.y = yaw;
      rings.rotation.y = -yaw * 0.3;
      uniforms.current.uTime.value = (now - start) / 1000;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((mat) => mat.dispose());
        }
      });
      renderer.dispose();
      el.remove();
    };
  }, []);

  return (
    <div className="body3d" ref={wrapRef}>
      <span className={`turn-hint ${hinted ? "gone" : ""}`}>⟲ drag to rotate · tap a muscle</span>
    </div>
  );
}
