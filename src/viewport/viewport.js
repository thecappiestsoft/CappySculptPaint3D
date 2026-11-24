// Real-time PBR viewport (Cook-Torrance GGX via MeshStandardMaterial + IBL), solo channel views,
// optional "True Displacement", 3D brush cursor and BVH-accelerated picking.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const VIEW_MODES = ['pbr', 'albedo', 'roughness', 'metallic', 'normal', 'height', 'curvature', 'ao', 'wireframe'];

const SOLO_VS = /* glsl */`
  varying vec2 vUv; varying vec3 vN;
  void main(){ vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const SOLO_FS = /* glsl */`
  uniform int mode; uniform sampler2D albedo; uniform sampler2D orm; uniform sampler2D nmap; uniform sampler2D hmap; uniform sampler2D baked;
  varying vec2 vUv; varying vec3 vN;
  vec3 toLinear(vec3 c){ return pow(c, vec3(2.2)); }
  void main(){
    vec3 c;
    if (mode == 1) c = texture2D(albedo, vUv).rgb; // sRGB texture -> already linear when sampled
    else if (mode == 2) c = toLinear(vec3(texture2D(orm, vUv).g));
    else if (mode == 3) c = toLinear(vec3(texture2D(orm, vUv).b));
    else if (mode == 4) c = toLinear(texture2D(nmap, vUv).rgb);
    else if (mode == 5) c = toLinear(vec3(clamp(texture2D(hmap, vUv).r * 0.5 + 0.5, 0.0, 1.0)));
    else if (mode == 6) c = toLinear(vec3(texture2D(baked, vUv).r));
    else c = toLinear(vec3(texture2D(baked, vUv).g));
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

export class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.floatLinear = r.extensions.has('OES_texture_float_linear');

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.9;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
    this.camera.position.set(0, 0.35, 3.4);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    this.keyLight.position.set(2.5, 3, 2.2);
    this.scene.add(this.keyLight);
    this.lightRig = new THREE.Group(); this.lightRig.add(this.keyLight); this.scene.add(this.lightRig);

    const c = this.controls = new OrbitControls(this.camera, canvas);
    c.enableDamping = true; c.dampingFactor = 0.12; c.rotateSpeed = 0.8;
    c.minDistance = 1.15; c.maxDistance = 12;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };

    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;

    // brush cursor
    const ringGeo = new THREE.RingGeometry(0.965, 1, 64);
    const cursorMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
    this.cursor = new THREE.Mesh(ringGeo, cursorMat);
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.0, 0.035, 16), cursorMat);
    this.cursor.add(inner);
    this.cursor.renderOrder = 999; inner.renderOrder = 999;
    this.cursor.visible = false;
    this.scene.add(this.cursor);
    this.mirrorCursors = [];

    this.envRotation = 0;
    this.viewMode = 'pbr';
    this.dispScale = 0.04;
    this.trueDisplacement = false;
    this.mesh = null;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  resize() {
    const el = this.canvas.parentElement;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setClearColor(css) { this.renderer.setClearColor(new THREE.Color(css), 1); }

  /** (Re)build mesh and GPU textures for a new geometry + compositor. */
  setModel(geometry, comp, ts) {
    if (this.mesh) {
      this.scene.remove(this.mesh); this.scene.remove(this.wire);
      this.mesh.geometry.disposeBoundsTree?.();
      this.mesh.geometry.dispose();
      [this.texAlbedo, this.texOrm, this.texNormal, this.texHeight, this.texBaked].forEach((t) => t?.dispose());
      this.pbrMat?.dispose(); this.soloMat?.dispose();
    }
    const R = ts.res;
    const mk = (data, fmt, type) => {
      const t = new THREE.DataTexture(data, R, R, fmt, type);
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = type === THREE.FloatType ? (this.floatLinear ? THREE.LinearFilter : THREE.NearestFilter) : THREE.LinearMipmapLinearFilter;
      if (type === THREE.FloatType && !this.floatLinear) t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = type !== THREE.FloatType;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      t.needsUpdate = true;
      return t;
    };
    this.texAlbedo = mk(comp.albedo, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texAlbedo.colorSpace = THREE.SRGBColorSpace;
    this.texOrm = mk(comp.orm, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texNormal = mk(comp.normal, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texHeight = mk(comp.height, THREE.RedFormat, THREE.FloatType);
    this.bakedData = new Uint8Array(R * R * 4);
    this.texBaked = mk(this.bakedData, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.updateBaked(ts);

    this.pbrMat = new THREE.MeshStandardMaterial({
      map: this.texAlbedo, roughnessMap: this.texOrm, metalnessMap: this.texOrm, aoMap: this.texOrm,
      normalMap: this.texNormal, roughness: 1, metalness: 1, aoMapIntensity: 1,
    });
    this.soloMat = new THREE.ShaderMaterial({
      uniforms: { mode: { value: 1 }, albedo: { value: this.texAlbedo }, orm: { value: this.texOrm }, nmap: { value: this.texNormal }, hmap: { value: this.texHeight }, baked: { value: this.texBaked } },
      vertexShader: SOLO_VS, fragmentShader: SOLO_FS,
    });
    geometry.computeBoundsTree();
    this.mesh = new THREE.Mesh(geometry, this.pbrMat);
    this.scene.add(this.mesh);
    this.wire = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ wireframe: true, color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }));
    this.wire.visible = false;
    this.scene.add(this.wire);
    this.applyDisplacement();
    this.setViewMode(this.viewMode);
  }

  updateBaked(ts) {
    const d = this.bakedData;
    for (let k = 0; k < ts.N; k++) {
      d[4 * k] = ts.curv[k] * 255; d[4 * k + 1] = ts.ao[k] * 255; d[4 * k + 2] = ts.thick[k] * 255; d[4 * k + 3] = 255;
    }
    for (let i = 0; i < ts.padDst.length; i++) {
      const a = ts.padDst[i], b = ts.padSrc[i];
      for (let c = 0; c < 4; c++) d[4 * a + c] = d[4 * b + c];
    }
    this.texBaked.needsUpdate = true;
  }

  uploadTextures() {
    if (!this.texAlbedo) return;
    this.texAlbedo.needsUpdate = true; this.texOrm.needsUpdate = true;
    this.texNormal.needsUpdate = true; this.texHeight.needsUpdate = true;
  }

  applyDisplacement() {
    if (!this.pbrMat) return;
    this.pbrMat.displacementMap = this.trueDisplacement ? this.texHeight : null;
    this.pbrMat.displacementScale = this.dispScale;
    this.pbrMat.needsUpdate = true;
  }

  setViewMode(mode) {
    this.viewMode = mode;
    if (!this.mesh) return;
    const idx = VIEW_MODES.indexOf(mode);
    if (mode === 'pbr' || mode === 'wireframe') this.mesh.material = this.pbrMat;
    else { this.mesh.material = this.soloMat; this.soloMat.uniforms.mode.value = idx; }
    this.wire.visible = mode === 'wireframe';
  }

  setEnvRotation(deg) {
    this.envRotation = deg;
    const rad = THREE.MathUtils.degToRad(deg);
    this.scene.environmentRotation.y = rad;
    this.lightRig.rotation.y = rad;
  }

  /** Pick the model under client coords. Returns { point, normal, uv } or null. */
  pick(clientX, clientY) {
    if (!this.mesh) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.mesh, false)[0];
    if (!hit) return null;
    return { point: hit.point, faceNormal: hit.face.normal.clone(), uv: hit.uv };
  }

  /** World units per screen pixel at a given world point. */
  worldPerPixel(point) {
    const dist = this.camera.position.distanceTo(point);
    const h = this.canvas.clientHeight || 1;
    return (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
  }

  showCursor(point, normal, radius, color = 0xffffff) {
    const c = this.cursor;
    c.visible = true;
    c.position.copy(point).addScaledVector(normal, 0.002);
    c.lookAt(point.clone().add(normal));
    c.scale.setScalar(radius);
    c.material.color.set(color);
  }
  hideCursor() { this.cursor.visible = false; }

  frame() {
    this.camera.position.set(0, 0.35, 3.4);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
