// Визуальный маркер hit-test: кольцо на найденной поверхности.
import * as THREE from 'three';

export class Reticle {
  constructor() {
    this.object = new THREE.Group();
    this.object.matrixAutoUpdate = false; // матрицу берём прямо из позы hit-test
    this.object.visible = false;

    this.ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.14, 48).rotateX(-Math.PI / 2), this.ringMaterial);
    this.pulse = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.16, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xC9A227, transparent: true })
    );
    this.object.add(ring, this.pulse);
    this.normal = new THREE.Vector3();
  }

  // Поставить маркер по матрице позы (4x4, массив из XRRigidTransform.matrix)
  setPose(matrixArray) {
    this.object.visible = true;
    this.object.matrix.fromArray(matrixArray);
    this.ringMaterial.color.set(this.isHorizontal() ? 0xffffff : 0xB3261E);
  }

  hide() {
    this.object.visible = false;
  }

  // Вторая колонка матрицы — нормаль поверхности. Смотрит вверх — значит пол или стол
  isHorizontal() {
    this.normal.setFromMatrixColumn(this.object.matrix, 1);
    return this.normal.y > 0.8;
  }

  position(target = new THREE.Vector3()) {
    return target.setFromMatrixPosition(this.object.matrix);
  }

  animate(time) {
    const k = (time % 1200) / 1200;
    this.pulse.scale.setScalar(1 + k * 0.5);
    this.pulse.material.opacity = 1 - k;
  }
}
