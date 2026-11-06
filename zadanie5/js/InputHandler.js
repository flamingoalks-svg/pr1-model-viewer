// Модуль обработки событий: тап/курок в AR и команды из UI.
// Решает, что делать: выбрать объект, поставить новый, перекрасить, повернуть, заменить модель.
import * as THREE from 'three';

const ROTATE_SPEED = Math.PI / 2; // при удержании кнопки поворота: 90° в секунду

export class InputHandler {
  constructor({ bus, ar, objects, env, renderer, getTarget, modelId }) {
    Object.assign(this, { bus, ar, objects, env, renderer, getTarget, modelId });
    this.rotateDir = 0;          // -1, 0 или 1, пока нажата кнопка поворота
    this.placeRequested = false;
    this.tmp = { origin: new THREE.Vector3(), dir: new THREE.Vector3(), quat: new THREE.Quaternion(), cam: new THREE.Vector3() };

    bus.on('xr:select', (e) => this.onXRSelect(e.controller));

    bus.on('ui:model', (id) => this.onModel(id));
    bus.on('ui:color', (hex) => this.withTarget((t) => t.setColor(hex)));
    bus.on('ui:reset', () => this.withTarget((t) => t.resetAppearance()));
    bus.on('ui:roughness', (v) => this.withTarget((t) => t.setRoughness(v), false));
    bus.on('ui:metalness', (v) => this.withTarget((t) => t.setMetalness(v), false));
    bus.on('ui:rotate-start', (dir) => { this.rotateDir = dir; });
    bus.on('ui:rotate-stop', () => { this.rotateDir = 0; });
    bus.on('ui:delete', () => this.objects.remove(this.objects.selected));
    bus.on('ui:hdri', (on) => this.env.setEnabled(on));
    bus.on('ui:exit', () => this.ar.end());
  }

  // Выполнить действие над текущим объектом и обновить UI
  withTarget(action, notify = true) {
    const target = this.getTarget();
    if (!target) return;
    action(target);
    if (notify) this.bus.emit('target-changed', target);
  }

  async onModel(id) {
    this.modelId = id; // эта модель будет ставиться следующей
    const target = this.getTarget();
    if (target) await this.objects.replaceModel(target, id);
  }

  // Тап по экрану / курок контроллера
  onXRSelect(controller) {
    // Луч из контроллера (на телефоне — из точки касания экрана)
    const { origin, dir, quat } = this.tmp;
    controller.getWorldPosition(origin);
    controller.getWorldQuaternion(quat);
    dir.set(0, 0, -1).applyQuaternion(quat);

    // Попали в уже стоящий объект — выбираем его, а не ставим новый
    const picked = this.objects.pick(origin, dir);
    if (picked) {
      this.objects.select(picked);
      return;
    }
    if (this.ar.lastHit && this.ar.reticle.isHorizontal()) this.placeRequested = true;
  }

  // Вызывается в каждом AR-кадре: якорь можно создать только из hit-test текущего кадра
  updateXR() {
    if (!this.placeRequested) return;
    this.placeRequested = false;
    if (this.ar.lastHit && this.ar.reticle.isHorizontal()) this.place(this.ar.lastHit);
  }

  async place(hit) {
    const position = this.ar.reticle.position();
    // Ставим объект лицом к пользователю (поворот только вокруг вертикали)
    this.renderer.xr.getCamera().getWorldPosition(this.tmp.cam);
    const yaw = Math.atan2(this.tmp.cam.x - position.x, this.tmp.cam.z - position.z);
    const anchorPromise = this.ar.createAnchor(hit);

    this.bus.emit('loading', true);
    const obj = await this.objects.create(this.modelId);
    this.bus.emit('loading', false);
    obj.root.position.copy(position);
    obj.root.rotation.y = yaw;
    this.objects.add(obj); // в сцену, не в камеру: объект не «едет» за телефоном

    const anchor = await anchorPromise;
    if (anchor) {
      if (this.objects.has(obj)) obj.anchor = anchor;
      else anchor.delete();
    }
  }

  // Каждый кадр: плавный поворот, пока кнопка удерживается
  update(dt) {
    if (!this.rotateDir) return;
    const target = this.getTarget();
    if (target) target.rotate(this.rotateDir * ROTATE_SPEED * dt); // rotation.y += delta
  }
}
