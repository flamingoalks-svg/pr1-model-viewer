// Модуль освещения: HDRI как карта окружения (image-based lighting).
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export class EnvironmentLight {
  constructor(scene) {
    this.scene = scene;
    this.texture = null;
    this.enabled = true;

    // Направленный свет нужен только для теней. Основное освещение и блики даёт HDRI.
    this.shadowLight = new THREE.DirectionalLight(0xffffff, 1.2);
    this.shadowOffset = new THREE.Vector3(1, 3, 1.5);
    this.shadowLight.position.copy(this.shadowOffset);
    this.shadowLight.castShadow = true;
    this.shadowLight.shadow.mapSize.set(1024, 1024);
    const cam = this.shadowLight.shadow.camera;
    cam.left = cam.bottom = -2;
    cam.right = cam.top = 2;
    scene.add(this.shadowLight, this.shadowLight.target);

    // Слабый запасной свет: когда HDRI выключен, модели не становятся совсем чёрными
    this.fallback = new THREE.HemisphereLight(0xffffff, 0x666666, 0.6);
    this.fallback.visible = false;
    scene.add(this.fallback);
  }

  // Загружаем .hdr (equirectangular-панорама с широким диапазоном яркости)
  async load(url) {
    this.texture = await new RGBELoader().loadAsync(url);
    this.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.apply();
  }

  setEnabled(on) {
    this.enabled = on;
    this.apply();
  }

  apply() {
    // Ключевая строка: все PBR-материалы (MeshStandardMaterial / MeshPhysicalMaterial)
    // берут из environment рассеянный свет и отражения
    this.scene.environment = this.enabled ? this.texture : null;
    this.fallback.visible = !this.enabled;
  }

  // Фон-панорама только для превью. В AR фон должен быть прозрачным, там видна камера
  setBackgroundVisible(on) {
    this.scene.background = on && this.texture ? this.texture : null;
    this.scene.backgroundBlurriness = 0.35;
    this.scene.backgroundIntensity = 0.8;
  }

  // Свет для теней переезжает к выбранному объекту, чтобы тень попадала в зону расчёта
  follow(position) {
    this.shadowLight.target.position.copy(position);
    this.shadowLight.position.copy(position).add(this.shadowOffset);
  }
}
