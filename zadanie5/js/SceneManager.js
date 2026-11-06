// Рендерер, сцена, камера превью и управление камерой мышью/пальцем.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    // alpha: true — в AR фон прозрачный, видно изображение с камеры
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Тональная компрессия для HDR-освещения: яркие участки HDRI не «выгорают»
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.xr.enabled = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.01, 50);
    this.camera.position.set(1.4, 1.1, 1.8);

    // В превью модель можно крутить и приближать мышью или пальцем
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0.4, 0);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    if (this.renderer.xr.isPresenting) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Камера превью смотрит на объект целиком
  frame(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    this.controls.target.copy(center);
    const dir = new THREE.Vector3(0.6, 0.45, 0.8).normalize();
    this.camera.position.copy(center).addScaledVector(dir, size * 1.25);
    this.controls.update();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
