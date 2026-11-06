// Модуль загрузки моделей: GLTFLoader + кэш + подготовка PBR-материалов.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Каталог моделей. Все модели — glTF 2.0 с PBR-материалами (baseColor, roughness/metalness,
// normal-текстуры, бархат через расширение KHR_materials_sheen), размеры в метрах.
export const MODEL_CATALOG = [
  { id: 'sheen-chair', name: 'Кресло (бархат)', url: './models/SheenChair.glb' },
  { id: 'damask-chair', name: 'Стул (дамаск)', url: './models/ChairDamaskPurplegold.glb' },
  { id: 'sofa', name: 'Диван (бархат)', url: './models/GlamVelvetSofa.glb' }
];

export class ModelLoader {
  constructor(catalog = MODEL_CATALOG) {
    this.catalog = catalog;
    this.loader = new GLTFLoader();
    this.cache = new Map(); // id -> Promise<gltf>: каждый файл скачивается один раз
  }

  info(id) {
    return this.catalog.find((m) => m.id === id);
  }

  // Возвращает НОВУЮ копию модели: у каждой копии свои материалы,
  // поэтому смена цвета одного кресла не перекрашивает остальные.
  async load(id) {
    const info = this.info(id);
    if (!info) throw new Error('Неизвестная модель: ' + id);
    if (!this.cache.has(id)) this.cache.set(id, this.loader.loadAsync(info.url));
    const gltf = await this.cache.get(id);
    return this.prepare(gltf.scene.clone(true));
  }

  // Подготовка модели к сцене
  prepare(model) {
    const lights = [];
    model.traverse((obj) => {
      // У дивана в файле есть свои источники света (KHR_lights_punctual) — в AR они не нужны,
      // освещение задаёт HDRI
      if (obj.isLight) lights.push(obj);
      if (!obj.isMesh) return;
      obj.castShadow = true;
      const clone = (m) => {
        const mat = m.clone(); // текстуры при клонировании общие, копируются только параметры
        mat.userData.base = {
          color: mat.color.clone(),
          roughness: mat.roughness,
          metalness: mat.metalness
        };
        // Ткань узнаём по расширению sheen (бархатный отлив): красим только её, дерево не трогаем
        mat.userData.isFabric = (mat.sheen || 0) > 0;
        return mat;
      };
      obj.material = Array.isArray(obj.material) ? obj.material.map(clone) : clone(obj.material);
    });
    lights.forEach((l) => l.removeFromParent());
    return model;
  }
}
