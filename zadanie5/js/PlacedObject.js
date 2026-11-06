// Один размещённый объект: модель + тень + кольцо выделения + якорь WebXR.
// Здесь всё управление объектом: цвет, поворот, PBR-параметры, замена модели.
import * as THREE from 'three';

export class PlacedObject {
  constructor(model, modelId) {
    this.root = new THREE.Group(); // позиция и поворот задаются на root, модель внутри
    this.anchor = null;            // XRAnchor, если устройство поддерживает якоря
    this.color = null;             // выбранный цвет ткани (null — исходный)
    this.pbr = null;               // { roughness, metalness }, если пользователь их менял

    // Мягкая тень: плоскость, которая показывает только тень
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.3 })
    );
    this.shadow.receiveShadow = true;
    this.shadow.position.y = 0.002;

    // Золотое кольцо на полу вокруг выбранного объекта
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.96, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xC9A227, transparent: true, opacity: 0.9 })
    );
    this.ring.position.y = 0.004;
    this.ring.visible = false;

    this.root.add(this.shadow, this.ring);
    this.setModel(model, modelId);
  }

  // Замена модели: позиция, поворот, якорь и выбранный цвет сохраняются
  setModel(model, modelId) {
    if (this.model) {
      this.root.remove(this.model);
      this.materials().forEach((m) => m.dispose());
    }
    // Габариты считаем до добавления в root, пока модель не повёрнута
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z) / 2;
    this.shadow.scale.set(size.x * 1.6, 1, size.z * 1.6);
    this.ring.scale.setScalar(r * 1.25);

    this.model = model;
    this.modelId = modelId;
    model.traverse((o) => { o.userData.placedObject = this; }); // для выбора объекта лучом
    this.root.add(model);
    this.applyAppearance();
  }

  materials() {
    const list = [];
    this.model.traverse((o) => {
      if (o.isMesh) list.push(...(Array.isArray(o.material) ? o.material : [o.material]));
    });
    return list;
  }

  // Красим ткань (материалы с sheen); если ткани нет — все материалы
  colorTargets() {
    const all = this.materials();
    const fabric = all.filter((m) => m.userData.isFabric);
    return fabric.length ? fabric : all;
  }

  setColor(hex) {
    this.color = hex;
    this.applyAppearance();
  }

  setRoughness(v) {
    this.pbr = { ...this.currentPBR(), roughness: v };
    this.applyAppearance();
  }

  setMetalness(v) {
    this.pbr = { ...this.currentPBR(), metalness: v };
    this.applyAppearance();
  }

  // Вернуть всё как в исходном glTF
  resetAppearance() {
    this.color = null;
    this.pbr = null;
    this.applyAppearance();
  }

  applyAppearance() {
    const targets = new Set(this.colorTargets());
    for (const m of this.materials()) {
      const base = m.userData.base;
      m.color.copy(base.color);
      // Цвет умножается на текстуру baseColor: узор ткани сохраняется, меняется оттенок
      if (this.color && targets.has(m)) m.color.set(this.color);
      m.roughness = this.pbr ? this.pbr.roughness : base.roughness;
      m.metalness = this.pbr ? this.pbr.metalness : base.metalness;
      m.needsUpdate = true;
    }
  }

  // Текущие значения PBR (для ползунков): если не меняли — среднее по материалам модели
  currentPBR() {
    if (this.pbr) return this.pbr;
    const mats = this.materials();
    const avg = (key) => mats.reduce((s, m) => s + m.userData.base[key], 0) / mats.length;
    return { roughness: avg('roughness'), metalness: avg('metalness') };
  }

  rotate(delta) {
    this.root.rotation.y += delta;
  }

  setSelected(on) {
    this.ring.visible = on;
  }

  dispose() {
    this.materials().forEach((m) => m.dispose());
    if (this.anchor) this.anchor.delete();
    this.anchor = null;
  }
}
