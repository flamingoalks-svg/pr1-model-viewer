// Список размещённых объектов: добавление, выбор, удаление, выбор лучом, якоря.
import * as THREE from 'three';
import { PlacedObject } from './PlacedObject.js';

export class ObjectManager {
  constructor(scene, loader, bus) {
    this.scene = scene;
    this.loader = loader;
    this.bus = bus;
    this.objects = [];
    this.selected = null;
    this.raycaster = new THREE.Raycaster();
  }

  async create(modelId) {
    const model = await this.loader.load(modelId);
    return new PlacedObject(model, modelId);
  }

  add(obj) {
    this.scene.add(obj.root);
    this.objects.push(obj);
    this.select(obj);
  }

  select(obj) {
    if (this.selected) this.selected.setSelected(false);
    this.selected = obj;
    if (obj) obj.setSelected(true);
    this.bus.emit('selection', obj);
  }

  remove(obj) {
    if (!obj) return;
    this.scene.remove(obj.root);
    obj.dispose();
    this.objects.splice(this.objects.indexOf(obj), 1);
    if (this.selected === obj) this.select(this.objects[this.objects.length - 1] || null);
  }

  clear() {
    [...this.objects].forEach((o) => this.remove(o));
  }

  has(obj) {
    return this.objects.includes(obj);
  }

  async replaceModel(obj, modelId) {
    const model = await this.loader.load(modelId);
    obj.setModel(model, modelId);
    this.bus.emit('target-changed', obj);
  }

  // Какой объект пересекает луч (из контроллера или из точки касания экрана)
  pick(origin, direction) {
    this.raycaster.set(origin, direction);
    const hits = this.raycaster.intersectObjects(this.objects.map((o) => o.model), true);
    return hits.length ? hits[0].object.userData.placedObject : null;
  }

  // Объекты с якорем каждый кадр берут позицию из якоря: устройство само уточняет,
  // где эта точка комнаты, и объект остаётся на месте даже после пересчёта трекинга
  updateAnchors(frame, referenceSpace) {
    if (!frame.trackedAnchors) return;
    for (const obj of this.objects) {
      if (!obj.anchor || !frame.trackedAnchors.has(obj.anchor)) continue;
      const pose = frame.getPose(obj.anchor.anchorSpace, referenceSpace);
      if (pose) {
        const p = pose.transform.position;
        obj.root.position.set(p.x, p.y, p.z);
      }
    }
  }
}
