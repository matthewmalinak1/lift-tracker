import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ALL_MUSCLES, type BodyStatus, type Muscle } from "../../api";
import { buildBody } from "./model";

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying float vY;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vY = world.y;
    vec4 mv = viewMatrix * world;
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

// Hologram look: colour from the muscle's fatigue (blue -> red), a Fresnel rim
// glow where the surface turns away from the camera, and a bright band
// sweeping up the body. uFatigue < 0 draws the faint skin layer.
const FRAG = /* glsl */ `
  uniform float uFatigue;
  uniform float uSelected;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying float vY;
  void main() {
    bool skin = uFatigue < 0.0;
    // Muscle fibres: on an ellipsoid stretched along its long axis, lines of
    // constant u run the length of the muscle, like striations.
    float fibre = 0.5 + 0.5 * sin(vUv.x * 6.2832 * 22.0);
    float f = max(uFatigue, 0.0);
    vec3 blue = vec3(0.486, 0.769, 1.0);
    vec3 red = vec3(1.0, 0.28, 0.35);
    vec3 col = mix(blue, red, f);

    float facing = abs(dot(normalize(vNormalV), normalize(vViewDir)));
    float rim = pow(1.0 - facing, 2.0);
    float sweepY = mod(uTime * 0.35, 2.4) - 0.3;
    float sweep = 1.0 - smoothstep(0.0, 0.07, abs(vY - sweepY));

    float a = skin
      ? 0.02 + rim * 0.38 + sweep * 0.1
      : 0.14 + 0.5 * f + rim * 0.75 + sweep * 0.2 + uSelected * 0.35;
    vec3 c = col * (skin ? 0.6 + rim * 0.6 : 0.55 + 0.3 * fibre + rim * 0.9 + uSelected * 0.6)
           + sweep * 0.12;
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
  const time = useRef({ value: 0 });
  // One material per muscle, so each can be coloured by its own fatigue.
  const mats = useRef<Map<Muscle, THREE.ShaderMaterial>>(new Map());
  const [hinted, setHinted] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // Recolour whenever recovery data or the selected muscle changes.
  const paint = () => {
    for (const [m, mat] of mats.current) {
      mat.uniforms.uFatigue.value = status?.muscles[m]?.fatigue ?? 0;
      mat.uniforms.uSelected.value = m === selected ? 1 : 0;
    }
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

    const shader = (fatigue: number) =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uFatigue: { value: fatigue }, uSelected: { value: 0 }, uTime: time.current },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
      });
    const skinMat = shader(-1);
    mats.current = new Map(ALL_MUSCLES.map((m) => [m, shader(0)]));
    const wire = new THREE.MeshBasicMaterial({
      color: 0x7cc4ff,
      wireframe: true,
      transparent: true,
      opacity: 0.03,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const { root, muscles } = buildBody(skinMat, wire, (m) => mats.current.get(m)!);
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
      const hit = raycaster.intersectObjects(muscles, false)[0];
      if (!hit) {
        onSelectRef.current(null);
        return;
      }
      const m = hit.object.userData.muscle as Muscle;
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
      time.current.value = (now - start) / 1000;
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
