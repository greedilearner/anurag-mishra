// 3D particle sculpture of the portrait.
// Every visible pixel of the cut-out becomes an ink dot: darker pixels get bigger dots
// (a halftone look), and each dot is pushed forward onto a rough head/shoulder shape so
// the portrait has real depth when it turns.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';

const canvas = document.getElementById('sculpt');
const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (canvas && !reduce) init().catch(err => console.warn('Sculpture fallback:', err));

async function init() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  // --- sample the cut-out portrait ---
  const img = await loadImage('assets/anurag-full.webp');
  const W = 228, H = 304;                        // sample grid, same 3:4 shape as the photo
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;

  const target = [], start = [], size = [], dark = [], delay = [];
  // Depth comes from the silhouette itself: the further a pixel is from the outline,
  // the further it bulges toward the viewer, so any pose gets a rounded, "inflated" body.
  const inside = new Uint8Array(W * H);
  for (let n = 0; n < W * H; n++) inside[n] = px[n * 4 + 3] >= 140 ? 1 : 0;
  const depth = distanceToEdge(inside, W, H);
  // world units stay the same whatever the grid density (figure is always HS = 208 units tall),
  // so the hover radius, waves and camera framing keep their feel
  const HS = 208, U = HS / H;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = (j * W + i) * 4;
    if (!inside[j * W + i]) continue;
    const L = px[k] / 255;
    const d = Math.min(1, Math.max(0, (0.95 - L) / 0.85));   // darker = bigger dot
    const x = i - W / 2 + (Math.random() - .5) * .6;
    const y = H / 2 - j + (Math.random() - .5) * .6;
    // inflated silhouette, with lighter skin (face, crossed forearms) lifted a little further forward
    let z = 5 * U * Math.sqrt(depth[j * W + i]) / Math.sqrt(U);
    z += smooth(0.45, 0.75, L) * 5 + (Math.random() - .5) * 1.2;
    target.push(x * U, y * U, z);
    // start: a wide scattered cloud
    const r = 140 + Math.random() * 120, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    start.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * .7, r * Math.sin(ph) * Math.sin(th));
    size.push((0.3 + 1.25 * Math.pow(d, 1.35)) * U);
    dark.push(d);
    delay.push(Math.random() * 0.28 + (j / H) * 0.3);   // top assembles first
  }
  const N = size.length;
  document.getElementById('pcount').textContent = N.toLocaleString('en-IN');

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(target, 3));
  geo.setAttribute('aStart', new THREE.Float32BufferAttribute(start, 3));
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  geo.setAttribute('aDark', new THREE.Float32BufferAttribute(dark, 1));
  geo.setAttribute('aDelay', new THREE.Float32BufferAttribute(delay, 1));

  const uniforms = {
    uTime: { value: 0 }, uProgress: { value: 0 }, uScale: { value: 1 }, uDist: { value: 1 },
    uMouse: { value: new THREE.Vector2(999, 999) }, uHover: { value: 0 },
    uScan: { value: -999 }, uBottom: { value: -HS / 2 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      attribute vec3 aStart; attribute float aSize, aDark, aDelay;
      uniform float uTime, uProgress, uScale, uDist, uHover, uScan, uBottom;
      uniform vec2 uMouse;
      varying float vDark, vAlpha;
      void main() {
        float t = clamp((uProgress - aDelay) / 0.42, 0.0, 1.0);
        float e = 1.0 - pow(1.0 - t, 3.0);
        // swirl in from the cloud
        float a = (1.0 - e) * 2.4;
        vec3 s = vec3(aStart.x * cos(a) - aStart.z * sin(a), aStart.y, aStart.x * sin(a) + aStart.z * cos(a));
        vec3 p = mix(s, position, e);
        // breathing
        p.z += sin(uTime * 1.3 + position.y * 0.07 + position.x * 0.03) * 0.9 * e;
        // scan wave travelling down the body
        float band = exp(-pow((position.y - uScan) / 5.0, 2.0));
        p.z += band * 9.0; p.x += band * sin(position.y * 0.9 + uTime * 6.0) * 1.6;
        // push dots away from the cursor
        vec2 dl = p.xy - uMouse; float dist = length(dl);
        float f = smoothstep(24.0, 0.0, dist) * uHover;
        p.xy += normalize(dl + 0.0001) * f * 12.0; p.z += f * 16.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uScale * (uDist / -mv.z) * (0.6 + 0.4 * e) * (1.0 + band * 0.6);
        vDark = aDark;
        vAlpha = smoothstep(uBottom, uBottom + 34.0, position.y) * (0.35 + 0.65 * e);
      }`,
    fragmentShader: /* glsl */`
      varying float vDark, vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5; float r = length(c);
        float edge = 1.0 - smoothstep(0.42, 0.5, r);
        vec3 ink = mix(vec3(0.40, 0.40, 0.39), vec3(0.055), smoothstep(0.15, 0.75, vDark));
        gl_FragColor = vec4(ink, edge * vAlpha);
        if (gl_FragColor.a < 0.02) discard;
      }`,
  });

  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.add(new THREE.Points(geo, mat));
  scene.add(group);

  const fov = 32, camera = new THREE.PerspectiveCamera(fov, 1, 1, 2000);
  // canvas is 124% of the portrait box tall (room for the swirl), so the figure fills ~0.93/1.24 of it
  const dist = (HS / 2) / Math.tan(THREE.MathUtils.degToRad(fov / 2)) / (0.93 / 1.24);
  camera.position.set(0, -2, dist);
  uniforms.uDist.value = dist;

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    // screen pixels per world unit at z = 0
    uniforms.uScale.value = renderer.domElement.height / (2 * dist * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
  };
  new ResizeObserver(resize).observe(canvas); resize();

  // --- pointer: turn toward the cursor, and repel dots near it ---
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ndc = new THREE.Vector2(), hit = new THREE.Vector3();
  let look = { x: 0, y: 0 }, hoverTarget = 0, mouseIn = false;
  addEventListener('pointermove', e => {
    look.x = e.clientX / innerWidth - .5; look.y = e.clientY / innerHeight - .5;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    mouseIn = Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1;
    hoverTarget = mouseIn ? 1 : 0;
  }, { passive: true });
  canvas.addEventListener('pointerleave', () => hoverTarget = 0);

  // --- run ---
  root.classList.add('has-3d');
  let started = false, t0 = 0, visible = true;
  const begin = () => { if (!started) { started = true; t0 = performance.now(); } };
  if (root.classList.contains('ready')) begin(); else document.addEventListener('site:ready', begin, { once: true });
  new IntersectionObserver(([en]) => visible = en.isIntersecting).observe(canvas);

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    if (!visible || document.hidden) return;
    const time = clock.getElapsedTime();
    uniforms.uTime.value = time;
    if (started) {
      const since = (performance.now() - t0) / 1000;
      uniforms.uProgress.value = Math.min(since / 2.8, 1);
      // a scan wave every 7 s once assembled
      const cyc = (since - 3.2) % 7;
      uniforms.uScan.value = since > 3.2 && cyc < 2.4 ? HS / 2 + 10 - (cyc / 2.4) * (HS + 30) : -999;
    }
    uniforms.uHover.value += (hoverTarget - uniforms.uHover.value) * 0.08;
    // slow idle sway plus cursor follow
    const ry = look.x * 0.6 + Math.sin(time * 0.35) * 0.12, rx = look.y * 0.25;
    group.rotation.y += (ry - group.rotation.y) * 0.05;
    group.rotation.x += (rx - group.rotation.x) * 0.05;
    if (mouseIn) {
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(plane, hit)) {
        group.worldToLocal(hit);
        uniforms.uMouse.value.set(hit.x, hit.y);
      }
    }
    renderer.render(scene, camera);
  });
}

// Two-pass chamfer distance transform: for each inside cell, roughly how many cells to the edge.
function distanceToEdge(mask, W, H) {
  const D = new Float32Array(W * H), INF = 1e6;
  for (let n = 0; n < W * H; n++) D[n] = mask[n] ? INF : 0;
  const at = (i, j) => (i < 0 || j < 0 || i >= W || j >= H) ? 0 : D[j * W + i];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const n = j * W + i; if (!D[n]) continue;
    D[n] = Math.min(D[n], at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + 1.414, at(i + 1, j - 1) + 1.414);
  }
  for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
    const n = j * W + i; if (!D[n]) continue;
    D[n] = Math.min(D[n], at(i + 1, j) + 1, at(i, j + 1) + 1, at(i + 1, j + 1) + 1.414, at(i - 1, j + 1) + 1.414);
  }
  return D;
}

function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
