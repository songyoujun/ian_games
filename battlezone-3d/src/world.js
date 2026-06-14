import * as THREE from 'three';

export const WORLD_SIZE = 160; // 正方形战场边长

// 构建战场：地面、天空、灯光、掩体建筑
export function buildWorld(scene) {
  // 天空 + 雾
  scene.background = new THREE.Color(0x9fb6cf);
  scene.fog = new THREE.Fog(0x9fb6cf, 60, WORLD_SIZE * 1.1);

  // 灯光
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a4636, 0.95);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d6, 1.5);
  sun.position.set(40, 80, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 220;
  const s = WORLD_SIZE * 0.7;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // 地面
  const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x6b7a4e, roughness: 1 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // 地面网格纹理感（用细线条）
  const grid = new THREE.GridHelper(WORLD_SIZE, WORLD_SIZE / 4, 0x55603c, 0x55603c);
  grid.material.opacity = 0.25;
  grid.material.transparent = true;
  grid.position.y = 0.02;
  scene.add(grid);

  const obstacles = []; // { box: THREE.Box3 }  用于移动碰撞
  const colliders = []; // 用于子弹射线检测的网格

  // 四周边界墙
  const wallH = 6, wallT = 2, half = WORLD_SIZE / 2;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3c4150, roughness: 0.9 });
  const wallDefs = [
    [0, half, WORLD_SIZE, wallT],
    [0, -half, WORLD_SIZE, wallT],
    [half, 0, wallT, WORLD_SIZE],
    [-half, 0, wallT, WORLD_SIZE],
  ];
  for (const [x, z, w, d] of wallDefs) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
    m.position.set(x, wallH / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    addObstacle(m, obstacles, colliders);
  }

  // 散布的掩体：建筑、集装箱、沙袋、岩石
  const rng = mulberry32(20240613);
  const buildingMat = new THREE.MeshStandardMaterial({ color: 0x8a8170, roughness: 0.95 });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0xb5783a, roughness: 0.8 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6d6d72, roughness: 1 });
  const sandbagMat = new THREE.MeshStandardMaterial({ color: 0x9c8e5e, roughness: 1 });

  const placed = [];
  function farFromCenter(x, z, r) {
    // 出生点(0,0)附近留空
    if (Math.hypot(x, z) < 12) return false;
    for (const p of placed) if (Math.hypot(x - p.x, z - p.z) < r + p.r + 3) return false;
    return true;
  }

  // 几栋大建筑
  for (let i = 0; i < 7; i++) {
    let x, z, w, d, h, tries = 0;
    do {
      w = 6 + rng() * 10; d = 6 + rng() * 10; h = 7 + rng() * 9;
      x = (rng() - 0.5) * (WORLD_SIZE - 24);
      z = (rng() - 0.5) * (WORLD_SIZE - 24);
      tries++;
    } while (!farFromCenter(x, z, Math.max(w, d) / 2) && tries < 30);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), buildingMat);
    m.position.set(x, h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    addObstacle(m, obstacles, colliders);
    placed.push({ x, z, r: Math.max(w, d) / 2 });
  }

  // 集装箱堆
  for (let i = 0; i < 14; i++) {
    let x, z, tries = 0;
    do {
      x = (rng() - 0.5) * (WORLD_SIZE - 16);
      z = (rng() - 0.5) * (WORLD_SIZE - 16);
      tries++;
    } while (!farFromCenter(x, z, 3) && tries < 30);
    const h = rng() < 0.4 ? 5 : 2.6;
    const colr = [0x4a7ab5, 0xb5503a, 0x4f9c5a, 0xc2a13a][(rng() * 4) | 0];
    const m = new THREE.Mesh(new THREE.BoxGeometry(6, h, 2.6),
      new THREE.MeshStandardMaterial({ color: colr, roughness: 0.85 }));
    m.position.set(x, h / 2, z);
    m.rotation.y = (rng() * 4 | 0) * Math.PI / 2 + (rng() - 0.5) * 0.3;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    addObstacle(m, obstacles, colliders);
    placed.push({ x, z, r: 3 });
  }

  // 沙袋掩体（矮）
  for (let i = 0; i < 10; i++) {
    let x, z, tries = 0;
    do {
      x = (rng() - 0.5) * (WORLD_SIZE - 20);
      z = (rng() - 0.5) * (WORLD_SIZE - 20);
      tries++;
    } while (!farFromCenter(x, z, 2) && tries < 30);
    const m = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.3, 1.4), sandbagMat);
    m.position.set(x, 0.65, z);
    m.rotation.y = rng() * Math.PI;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    addObstacle(m, obstacles, colliders);
    placed.push({ x, z, r: 2.3 });
  }

  // 岩石
  for (let i = 0; i < 12; i++) {
    let x, z, tries = 0;
    do {
      x = (rng() - 0.5) * (WORLD_SIZE - 12);
      z = (rng() - 0.5) * (WORLD_SIZE - 12);
      tries++;
    } while (!farFromCenter(x, z, 2) && tries < 30);
    const r = 1.2 + rng() * 1.8;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockMat);
    m.position.set(x, r * 0.7, z);
    m.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    addObstacle(m, obstacles, colliders);
    placed.push({ x, z, r: r + 0.5 });
  }

  return { ground, obstacles, colliders, sun };
}

function addObstacle(mesh, obstacles, colliders) {
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  obstacles.push({ box, mesh });
  mesh.userData.isObstacle = true;
  colliders.push(mesh);
}

// 把一个圆形(半径 r)从所有障碍盒中推出（仅 XZ 平面）
const _min = new THREE.Vector2(), _max = new THREE.Vector2();
export function resolveCollision(pos, radius, obstacles) {
  for (const o of obstacles) {
    const b = o.box;
    _min.set(b.min.x - radius, b.min.z - radius);
    _max.set(b.max.x + radius, b.max.z + radius);
    if (pos.x > _min.x && pos.x < _max.x && pos.z > _min.y && pos.z < _max.y) {
      // 在膨胀盒内，找最小推出距离
      const dl = pos.x - _min.x;
      const dr = _max.x - pos.x;
      const db = pos.z - _min.y;
      const df = _max.y - pos.z;
      const m = Math.min(dl, dr, db, df);
      if (m === dl) pos.x = _min.x;
      else if (m === dr) pos.x = _max.x;
      else if (m === db) pos.z = _min.y;
      else pos.z = _max.y;
    }
  }
  // 边界
  const lim = WORLD_SIZE / 2 - 2 - radius;
  pos.x = Math.max(-lim, Math.min(lim, pos.x));
  pos.z = Math.max(-lim, Math.min(lim, pos.z));
}

// 确定性随机数
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
