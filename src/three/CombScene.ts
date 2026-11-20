// three.js 巢脾三维场景：实例化渲染（单面约 3400 房，>7000 房整脾可流畅旋转）
// 蜡壁为真实深度的开口六棱柱，卵立于房底 —— 遮挡完全由几何产生，
// 与 geometry.ts 的解析/射线计算互为验证。
// ============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  CELL_DEPTH,
  DRONE_R,
  EGG_HEIGHT,
  FRAME_BORDER,
  FRAME_H,
  FRAME_W,
  WORKER_R,
  centerOcclusionAngle,
  droneScale,
  eggOcclusionAngle,
  hexVisibilityFraction,
  hexVisibilityFractionRay,
  circleVisibilityFraction,
  rimShift,
  FrameLayout,
} from '../core/geometry';
import {
  CellState,
  CellStateValue,
  CellType,
  CombSideData,
  POLLEN_COLORS,
  STATE_META,
  defaultAgeFor,
} from '../core/types';
import { projectCell } from '../core/simulation';
import { Rng, hashString } from '../core/rng';

interface Pickable {
  mesh: THREE.InstancedMesh;
  idMap: number[]; // instanceId -> cellIndex
}

export interface SelfCheckResult {
  maxHexRayDiff: number;
  maxHexCircleDiff: number;
  samples: number;
  pass: boolean;
  rows: { tilt: number; az: number; hex: number; ray: number; circle: number }[];
}

export class CombScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private container: HTMLElement;
  private raf = 0;
  private frames = 0;
  private fpsTime = performance.now();
  private fps = 0;
  private lastHudKey = '';

  private wallGroup = new THREE.Group();
  private contentGroup = new THREE.Group();
  private pickables: Pickable[] = [];
  private hoverRing: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private sunGizmo: THREE.Mesh;
  private sunAz = -35; // 度
  private sunEl = 55;

  private side: CombSideData | null = null;
  private layout: FrameLayout | null = null;
  private projectedState: Uint8Array | null = null;
  private projectedAge: Uint16Array | null = null;
  private timelineOffset = 0;

  private hoverCell = -1;
  private selectedCell = -1;
  private brushState: CellStateValue | null = null;
  private painting = false;
  private dirty = false;
  private saveTimer = 0;
  private lowQuality = false;

  onEdit: (() => void) | null = null;
  onSelect: ((cellIndex: number) => void) | null = null;
  onFps: ((fps: number, drawCalls: number) => void) | null = null;
  onView: ((info: ViewInfo) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    // 软件渲染（无头/虚拟显卡）自动降级，保证 7000 房仍可交互
    const probe = document.createElement('canvas').getContext('webgl2');
    const dbg = probe?.getExtension('WEBGL_debug_renderer_info');
    const rendererName = dbg ? probe!.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string : '';
    this.lowQuality = /SwiftShader|llvmpipe|Software|Microsoft Basic/i.test(rendererName);

    this.renderer = new THREE.WebGLRenderer({ antialias: !this.lowQuality, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.lowQuality ? 1 : 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x14110d);
    this.camera = new THREE.PerspectiveCamera(
      40,
      container.clientWidth / container.clientHeight,
      0.1,
      4000,
    );
    this.camera.position.set(0, 0, 420);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 60;
    this.controls.maxDistance = 900;

    // 环境反射（给蜜面用），离线程序化生成，无外部资源；软件渲染下跳过 PMREM
    if (!this.lowQuality) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    }

    const hemi = new THREE.HemisphereLight(0xfff2dc, 0x2a2018, 0.65);
    this.scene.add(hemi);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.35);
    fill.position.set(-200, -160, 300);
    this.scene.add(fill);

    this.sun = new THREE.DirectionalLight(0xffe6b8, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.lowQuality ? 1024 : 2048, this.lowQuality ? 1024 : 2048);
    const s = 260;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 1200;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.sunGizmo = new THREE.Mesh(
      new THREE.SphereGeometry(7, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0xffd27a }),
    );
    this.scene.add(this.sunGizmo);
    this.updateSun();

    this.hoverRing = new THREE.Mesh(
      new THREE.RingGeometry(WORKER_R * 1.05, WORKER_R * 1.28, 6),
      new THREE.MeshBasicMaterial({ color: 0x48e0ff, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
    );
    this.hoverRing.visible = false;
    this.hoverRing.position.z = CELL_DEPTH + 0.6;
    this.scene.add(this.hoverRing);

    this.scene.add(this.wallGroup);
    this.scene.add(this.contentGroup);
    this.buildWoodFrame();

    this.bindEvents();
    this.loop();
  }

  // —— 木框 ——
  private buildWoodFrame() {
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2e, roughness: 0.85 });
    const t = FRAME_BORDER;
    const mk = (w: number, h: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 10), wood);
      m.position.set(x, y, -1);
      m.castShadow = true;
      this.scene.add(m);
    };
    mk(FRAME_W + t * 2, t, 0, FRAME_H / 2 + t / 2);
    mk(FRAME_W + t * 2, t, 0, -FRAME_H / 2 - t / 2);
    mk(t, FRAME_H, -FRAME_W / 2 - t / 2, 0);
    mk(t, FRAME_H, FRAME_W / 2 + t / 2, 0);
  }

  // —— 装载巢脾 ——
  setComb(side: CombSideData, layout: FrameLayout) {
    this.side = side;
    this.layout = layout;
    this.timelineOffset = 0;
    this.hoverCell = -1;
    this.selectedCell = -1;
    this.buildWalls();
    this.rebuildProjection();
    this.rebuildContent();
  }

  get currentSide(): CombSideData | null {
    return this.side;
  }

  // 蜡壁 + 房底（状态无关，只建一次）
  private buildWalls() {
    if (!this.side || !this.layout) return;
    this.wallGroup.clear();
    this.pickables = [];
    const { types, cx, cy, count } = this.layout;

    const wallGeo = new THREE.CylinderGeometry(1, 1, CELL_DEPTH, 6, 1, true);
    wallGeo.rotateX(Math.PI / 2);
    wallGeo.rotateZ(Math.PI / 6); // 尖顶六边形（壁面竖直）
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xc99a5b,
      roughness: 0.72,
      metalness: 0,
      side: THREE.DoubleSide,
    });

    const floorGeo = new THREE.CircleGeometry(0.92, 6);
    floorGeo.rotateZ(Math.PI / 6);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x6e4b28, roughness: 0.9 });

    const cupGeo = new THREE.CylinderGeometry(1.35, 0.9, CELL_DEPTH * 1.7, 10, 1, true);
    cupGeo.rotateX(Math.PI / 2);

    const groups: Record<number, number[]> = {
      [CellType.Worker]: [],
      [CellType.Drone]: [],
      [CellType.QueenCup]: [],
    };
    for (let i = 0; i < count; i++) groups[types[i]].push(i);

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const rng = new Rng(hashString(this.side.key));

    // 工蜂 / 雄蜂壁
    for (const type of [CellType.Worker, CellType.Drone]) {
      const ids = groups[type];
      if (!ids.length) continue;
      const R = type === CellType.Drone ? DRONE_R : WORKER_R;
      const mesh = new THREE.InstancedMesh(wallGeo, wallMat, ids.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const idMap: number[] = [];
      ids.forEach((cellIdx, k) => {
        const scale = type === CellType.Drone ? droneScale() : 1;
        dummy.position.set(cx[cellIdx], cy[cellIdx], CELL_DEPTH / 2);
        dummy.scale.set(R * scale, R * scale, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
        color.setHSL(0.095, 0.45, 0.55 + (rng.float() - 0.5) * 0.08);
        mesh.setColorAt(k, color);
        idMap.push(cellIdx);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.wallGroup.add(mesh);
      this.pickables.push({ mesh, idMap });
    }

    // 王台杯（长在脾边、更深更大）
    const cupIds = groups[CellType.QueenCup];
    if (cupIds.length) {
      const cupMesh = new THREE.InstancedMesh(
        cupGeo,
        new THREE.MeshStandardMaterial({ color: 0xb9843f, roughness: 0.8, side: THREE.DoubleSide }),
        cupIds.length,
      );
      const idMap: number[] = [];
      cupIds.forEach((cellIdx, k) => {
        dummy.position.set(cx[cellIdx], cy[cellIdx], (CELL_DEPTH * 1.7) / 2);
        dummy.scale.set(WORKER_R, WORKER_R, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        cupMesh.setMatrixAt(k, dummy.matrix);
        idMap.push(cellIdx);
      });
      cupMesh.instanceMatrix.needsUpdate = true;
      this.wallGroup.add(cupMesh);
      this.pickables.push({ mesh: cupMesh, idMap });
    }

    // 房底中隔（全部房，拾取兜底）
    const floorMesh = new THREE.InstancedMesh(floorGeo, floorMat, count);
    const idMap: number[] = [];
    for (let i = 0; i < count; i++) {
      const scale = types[i] === CellType.Drone ? droneScale() : 1;
      dummy.position.set(cx[i], cy[i], 0);
      dummy.scale.set(WORKER_R * scale, WORKER_R * scale, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      floorMesh.setMatrixAt(i, dummy.matrix);
      color.setHSL(0.08, 0.5, 0.24 + (rng.float() - 0.5) * 0.05);
      floorMesh.setColorAt(i, color);
      idMap.push(i);
    }
    floorMesh.instanceMatrix.needsUpdate = true;
    if (floorMesh.instanceColor) floorMesh.instanceColor.needsUpdate = true;
    floorMesh.receiveShadow = true;
    this.wallGroup.add(floorMesh);
    this.pickables.push({ mesh: floorMesh, idMap });
  }

  // —— 时间轴投影 ——
  private rebuildProjection() {
    if (!this.side) return;
    const n = this.side.count;
    this.projectedState = new Uint8Array(n);
    this.projectedAge = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const p = projectCell(this.side.states[i] as CellStateValue, this.side.ages[i], this.timelineOffset);
      this.projectedState[i] = p.state;
      this.projectedAge[i] = p.age;
    }
  }

  setTimelineOffset(days: number) {
    this.timelineOffset = days;
    this.rebuildProjection();
    this.rebuildContent();
  }

  // —— 内容物（按状态分组建实例） ——
  private rebuildContent() {
    if (!this.side || !this.layout || !this.projectedState) return;
    for (const child of [...this.contentGroup.children]) {
      const m = child as THREE.InstancedMesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.contentGroup.clear();

    const n = this.side.count;
    const states = this.projectedState;
    const types = this.side.types;
    const eggs = this.side.eggs;
    const cx = this.side.cx;
    const cy = this.side.cy;

    const buckets: Record<number, number[]> = {};
    for (let i = 0; i < n; i++) {
      const st = states[i];
      (buckets[st] ??= []).push(i);
    }

    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const rng = new Rng(hashString(this.side.key + ':content'));

    const addMesh = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      ids: number[],
      place: (cellIdx: number, k: number) => { pos: THREE.Vector3; scale: THREE.Vector3; rotZ?: number; color?: THREE.Color },
    ) => {
      if (!ids.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, ids.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      let useColor = false;
      ids.forEach((cellIdx, k) => {
        const { pos, scale, rotZ, color } = place(cellIdx, k);
        dummy.position.copy(pos);
        dummy.scale.copy(scale);
        dummy.rotation.set(0, 0, rotZ ?? 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
        if (color) {
          mesh.setColorAt(k, color);
          useColor = true;
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (useColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.contentGroup.add(mesh);
    };

    const radiusOf = (i: number) => (types[i] === CellType.Drone ? DRONE_R : WORKER_R);
    const depthOf = (i: number) => (types[i] === CellType.QueenCup ? CELL_DEPTH * 1.7 : CELL_DEPTH);

    // 卵：立在房底的细长椭球；多卵工蜂产卵散开
    const eggIds = buckets[CellState.Egg] ?? [];
    if (eggIds.length) {
      const geo = new THREE.SphereGeometry(1, 10, 8);
      const mat = new THREE.MeshStandardMaterial({ color: 0xfdf3d6, roughness: 0.45 });
      const flat: { cell: number; k: number }[] = [];
      for (const cellIdx of eggIds) {
        const cnt = Math.max(1, eggs[cellIdx]);
        for (let k = 0; k < cnt; k++) flat.push({ cell: cellIdx, k });
      }
      addMesh(geo, mat, flat.map((f) => f.cell), (cellIdx, k) => {
        const f = flat[k];
        const R = radiusOf(cellIdx);
        const off = f.k === 0 ? 0 : R * 0.32;
        const ang = f.k * 2.1;
        return {
          pos: new THREE.Vector3(cx[cellIdx] + Math.cos(ang) * off, cy[cellIdx] + Math.sin(ang) * off, EGG_HEIGHT / 2 + 0.2),
          scale: new THREE.Vector3(0.42, EGG_HEIGHT / 2, 0.42),
          rotZ: f.k === 0 ? 0 : (rng.float() - 0.5) * 0.5,
        };
      });
    }

    // 小幼虫 / 大幼虫：房底 C 形小白虫（压扁椭球）
    for (const st of [CellState.LarvaS, CellState.LarvaL]) {
      const ids = buckets[st] ?? [];
      if (!ids.length) continue;
      const big = st === CellState.LarvaL;
      const geo = new THREE.SphereGeometry(1, 12, 8);
      const mat = new THREE.MeshStandardMaterial({
        color: big ? 0xf0ddb0 : 0xf6ecd2,
        roughness: 0.6,
      });
      addMesh(geo, mat, ids, (i) => {
        const R = radiusOf(i);
        const sz = big ? R * 0.55 : R * 0.32;
        return {
          pos: new THREE.Vector3(cx[i], cy[i], 0.9),
          scale: new THREE.Vector3(sz, sz * 0.6, sz * 0.5),
          rotZ: rng.float() * Math.PI,
        };
      });
    }

    // 封盖子：微微鼓起的蜡盖（浅穹顶）
    {
      const ids = buckets[CellState.CappedBrood] ?? [];
      if (ids.length) {
        const geo = new THREE.SphereGeometry(1, 12, 8);
        const mat = new THREE.MeshStandardMaterial({ color: 0xb98a4e, roughness: 0.75 });
        addMesh(geo, mat, ids, (i) => {
          const R = radiusOf(i) * 0.98;
          return {
            pos: new THREE.Vector3(cx[i], cy[i], depthOf(i) - 0.8),
            scale: new THREE.Vector3(R, R, 1.5),
            color: col.setHSL(0.09, 0.4, 0.52 + (rng.float() - 0.5) * 0.06),
          };
        });
      }
    }

    // 封盖蜜：平而发白的盖
    {
      const ids = buckets[CellState.CappedHoney] ?? [];
      if (ids.length) {
        const geo = new THREE.CylinderGeometry(0.96, 0.96, 0.5, 6);
        geo.rotateX(Math.PI / 2);
        geo.rotateZ(Math.PI / 6);
        const mat = new THREE.MeshStandardMaterial({ color: 0xe9e3d5, roughness: 0.55 });
        addMesh(geo, mat, ids, (i) => {
          const R = radiusOf(i);
          return { pos: new THREE.Vector3(cx[i], cy[i], depthOf(i) - 0.3), scale: new THREE.Vector3(R, R, 1) };
        });
      }
    }

    // 蜜：半透明琥珀，环境反射出高光
    {
      const ids = buckets[CellState.Honey] ?? [];
      if (ids.length) {
        const geo = new THREE.CylinderGeometry(0.86, 0.86, 1, 6);
        geo.rotateX(Math.PI / 2);
        geo.rotateZ(Math.PI / 6);
        const mat = new THREE.MeshPhysicalMaterial({
          color: 0xd98e22,
          roughness: 0.12,
          metalness: 0,
          // 软件渲染下透射通道代价过高，降级为高光不透明琥珀
          transmission: this.lowQuality ? 0 : 0.25,
          transparent: !this.lowQuality,
          opacity: 0.9,
          clearcoat: 1,
          clearcoatRoughness: 0.08,
          envMapIntensity: 1.4,
        });
        addMesh(geo, mat, ids, (i) => {
          const R = radiusOf(i);
          const fill = depthOf(i) * (0.55 + rng.float() * 0.3);
          return {
            pos: new THREE.Vector3(cx[i], cy[i], fill / 2),
            scale: new THREE.Vector3(R, R, fill),
          };
        });
      }
    }

    // 花粉：按粉源颜色区分的粉团
    {
      const ids = buckets[CellState.Pollen] ?? [];
      if (ids.length) {
        const geo = new THREE.CylinderGeometry(0.82, 0.82, 1, 6);
        geo.rotateX(Math.PI / 2);
        geo.rotateZ(Math.PI / 6);
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
        addMesh(geo, mat, ids, (i) => {
          const R = radiusOf(i);
          const h = depthOf(i) * 0.5;
          const c = POLLEN_COLORS[Math.abs(Math.round(cx[i] * 7 + cy[i] * 3)) % POLLEN_COLORS.length];
          return {
            pos: new THREE.Vector3(cx[i], cy[i], h / 2),
            scale: new THREE.Vector3(R, R, h),
            color: col.setHex(c).offsetHSL(0, 0, (rng.float() - 0.5) * 0.08),
          };
        });
      }
    }

    // 白垩病：白色干瘪僵虫
    {
      const ids = buckets[CellState.Chalkbrood] ?? [];
      if (ids.length) {
        const geo = new THREE.SphereGeometry(1, 10, 8);
        const mat = new THREE.MeshStandardMaterial({ color: 0xeef0ee, roughness: 1 });
        addMesh(geo, mat, ids, (i) => {
          const R = radiusOf(i);
          return {
            pos: new THREE.Vector3(cx[i], cy[i], depthOf(i) * 0.6),
            scale: new THREE.Vector3(R * 0.45, R * 0.4, R * 0.7),
            rotZ: rng.float() * Math.PI,
          };
        });
      }
    }

    // 囊状幼虫病：暗褐穿孔封盖
    {
      const ids = buckets[CellState.Sacbrood] ?? [];
      if (ids.length) {
        const geo = new THREE.CylinderGeometry(0.9, 0.9, 0.6, 6);
        geo.rotateX(Math.PI / 2);
        geo.rotateZ(Math.PI / 6);
        const mat = new THREE.MeshStandardMaterial({ color: 0x7a5a3c, roughness: 0.9 });
        addMesh(geo, mat, ids, (i) => ({
          pos: new THREE.Vector3(cx[i], cy[i], depthOf(i) - 0.4),
          scale: new THREE.Vector3(radiusOf(i), radiusOf(i), 1),
        }));
      }
    }
  }

  // —— 交互 ——
  private bindEvents() {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => {
      if (this.dragSun(e)) return;
      this.painting = true;
      this.handlePointer(e);
    });
    dom.addEventListener('pointermove', (e) => {
      if (this.painting) this.handlePointer(e);
      else this.updateHover(e);
    });
    window.addEventListener('pointerup', () => {
      this.painting = false;
    });
    dom.addEventListener('click', (e) => {
      if (!this.brushState) {
        const cell = this.pick(e);
        if (cell >= 0) {
          this.selectedCell = cell;
          this.onSelect?.(cell);
        }
      }
    });
    new ResizeObserver(() => this.resize()).observe(this.container);
  }

  private pick(e: MouseEvent): number {
    if (!this.layout) return -1;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    let best: { dist: number; cell: number } | null = null;
    for (const p of this.pickables) {
      const hits = this.raycaster.intersectObject(p.mesh);
      if (hits.length && hits[0].instanceId != null) {
        const cell = p.idMap[hits[0].instanceId];
        if (!best || hits[0].distance < best.dist) best = { dist: hits[0].distance, cell };
      }
    }
    return best ? best.cell : -1;
  }

  private handlePointer(e: MouseEvent) {
    const cell = this.pick(e);
    if (cell < 0 || !this.side) return;
    if (this.brushState != null) {
      this.paintCell(cell, this.brushState);
    }
  }

  private updateHover(e: MouseEvent) {
    const cell = this.pick(e);
    this.hoverCell = cell;
    if (cell >= 0 && this.side) {
      this.hoverRing.visible = true;
      const scale = this.side.types[cell] === CellType.Drone ? droneScale() : 1;
      this.hoverRing.position.set(this.side.cx[cell], this.side.cy[cell], CELL_DEPTH + 0.6);
      this.hoverRing.scale.set(scale, scale, 1);
    } else {
      this.hoverRing.visible = false;
    }
  }

  private paintCell(cell: number, state: CellStateValue) {
    if (!this.side) return;
    if (this.timelineOffset !== 0) return; // 时间轴推演态不可改
    if (this.side.states[cell] === state) return;
    this.side.states[cell] = state;
    const age = defaultAgeFor(state);
    this.side.ages[cell] = age;
    if (state === CellState.Egg && this.side.eggs[cell] === 0) this.side.eggs[cell] = 1;
    if (state !== CellState.Egg) this.side.eggs[cell] = 0;
    this.dirty = true;
    this.rebuildProjection();
    this.rebuildContent();
    this.scheduleSave();
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      if (this.dirty) {
        this.dirty = false;
        this.onEdit?.();
      }
    }, 500);
  }

  flushSave() {
    clearTimeout(this.saveTimer);
    if (this.dirty) {
      this.dirty = false;
      this.onEdit?.();
    }
  }

  setBrush(state: CellStateValue | null) {
    this.brushState = state;
    this.renderer.domElement.style.cursor = state != null ? 'crosshair' : 'default';
  }

  getCellInfo(cell: number) {
    if (!this.side) return null;
    return {
      cell,
      type: this.side.types[cell],
      state: this.side.states[cell],
      age: this.side.ages[cell],
      eggs: this.side.eggs[cell],
      x: this.side.cx[cell],
      y: this.side.cy[cell],
    };
  }

  // —— 太阳（可拖） ——
  private draggingSun = false;
  private dragSun(e: MouseEvent): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.raycaster.intersectObject(this.sunGizmo).length) {
      this.draggingSun = true;
      const move = (ev: MouseEvent) => {
        this.sunAz += ev.movementX * 0.5;
        this.sunEl = THREE.MathUtils.clamp(this.sunEl - ev.movementY * 0.4, 8, 88);
        this.updateSun();
      };
      const up = () => {
        this.draggingSun = false;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return true;
    }
    return false;
  }

  setSun(az: number, el: number) {
    this.sunAz = az;
    this.sunEl = THREE.MathUtils.clamp(el, 8, 88);
    this.updateSun();
  }

  getSun() {
    return { az: this.sunAz, el: this.sunEl };
  }

  private updateSun() {
    const r = 520;
    const az = THREE.MathUtils.degToRad(this.sunAz);
    const el = THREE.MathUtils.degToRad(this.sunEl);
    const x = r * Math.cos(el) * Math.sin(az);
    const y = r * Math.sin(el);
    const z = r * Math.cos(el) * Math.cos(az);
    this.sun.position.set(x, y, z);
    this.sun.target.position.set(0, 0, 0);
    this.sunGizmo.position.set(x, y, z);
  }

  // —— 视角 ——
  setViewTilt(tiltDeg: number) {
    // 保持当前方位角，把极角调到相对房底法线的 tilt
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.phi = Math.PI / 2 - THREE.MathUtils.degToRad(tiltDeg); // phi 为与 +Y 夹角
    this.camera.position.setFromSpherical(spherical).add(this.controls.target);
    this.controls.update();
  }

  setShadowEnabled(on: boolean) {
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
  }

  get isLowQuality(): boolean {
    return this.lowQuality;
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** 当前视线相对房底法线的倾角与方位 */
  getViewInfo(): ViewInfo {
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    const normal = new THREE.Vector3(0, 0, 1);
    const tilt = (Math.acos(THREE.MathUtils.clamp(dir.dot(normal), -1, 1)) * 180) / Math.PI;
    const az = (Math.atan2(dir.x, dir.y) * 180) / Math.PI;
    return { tilt, az, sunAz: this.sunAz, sunEl: this.sunEl };
  }

  /** 双算法 + 圆管解析 三方交叉自检 */
  runSelfCheck(): SelfCheckResult {
    const rows: SelfCheckResult['rows'] = [];
    let maxHexRay = 0;
    let maxHexCircle = 0;
    let samples = 0;
    for (let tilt = 0; tilt <= 75; tilt += 5) {
      for (let az = 0; az < 360; az += 30) {
        const hex = hexVisibilityFraction(WORKER_R, CELL_DEPTH, tilt, az);
        const ray = hexVisibilityFractionRay(WORKER_R, CELL_DEPTH, tilt, az);
        const circle = circleVisibilityFraction(WORKER_R, CELL_DEPTH, tilt);
        maxHexRay = Math.max(maxHexRay, Math.abs(hex - ray));
        maxHexCircle = Math.max(maxHexCircle, Math.abs(hex - circle));
        samples++;
        if (az % 60 === 0) rows.push({ tilt, az, hex, ray, circle });
      }
    }
    return {
      maxHexRayDiff: maxHexRay,
      maxHexCircleDiff: maxHexCircle,
      samples,
      pass: maxHexRay < 0.02,
      rows,
    };
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    this.frames++;
    const now = performance.now();
    if (now - this.fpsTime >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsTime));
      this.frames = 0;
      this.fpsTime = now;
      this.onFps?.(this.fps, this.renderer.info.render.calls);
    }
    if (this.onView && this.side) {
      const info = this.getViewInfo();
      const key = `${info.tilt.toFixed(1)}|${info.az.toFixed(0)}|${info.sunAz}|${info.sunEl}`;
      if (key !== this.lastHudKey) {
        this.lastHudKey = key;
        this.onView(info);
      }
    }
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export interface ViewInfo {
  tilt: number;
  az: number;
  sunAz: number;
  sunEl: number;
}

export function occlusionReadout(view: ViewInfo) {
  const t = view.tilt;
  return {
    tilt: t,
    az: view.az,
    workerHex: hexVisibilityFraction(WORKER_R, CELL_DEPTH, t, view.az),
    workerRay: hexVisibilityFractionRay(WORKER_R, CELL_DEPTH, t, view.az),
    workerCircle: circleVisibilityFraction(WORKER_R, CELL_DEPTH, t),
    droneHex: hexVisibilityFraction(DRONE_R, CELL_DEPTH, t, view.az),
    eggAngle: eggOcclusionAngle(WORKER_R, CELL_DEPTH, EGG_HEIGHT),
    centerAngle: centerOcclusionAngle(WORKER_R, CELL_DEPTH),
    shift: rimShift(CELL_DEPTH, t),
  };
}
