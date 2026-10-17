// Трекинг нескольких лиц на основе модулей MindAR Face Tracking.
//
// Готовая сборка MindAR (mindar-face-aframe) умеет отслеживать только ОДНО лицо:
// в её коде нейросеть MediaPipe создаётся с numFaces: 1 и берётся только faceLandmarks[0].
// Поэтому здесь используются те же модули MindAR (папка mindar/: оценка позы головы
// Estimator, фильтр One Euro, данные канонической модели лица), а управляющая часть
// (у MindAR это Controller и A-Frame-система) переписана так, чтобы лиц было несколько.
// Для каждого лица — свой «слот» со своими фильтрами сглаживания.

import { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/vision_bundle.mjs';
import { waitCV } from './mindar/opencv-helper.js';
import { Estimator } from './mindar/estimator.js';
import { createThreeFaceGeometry } from './mindar/face-geometry.js';
import { OneEuroFilter } from './mindar/one-euro-filter.js';
import { positions as canonicalLandmarks } from './mindar/face-data.js';

const THREE = AFRAME.THREE;
const N_LANDMARKS = canonicalLandmarks.length; // 468 точек канонической модели лица
const KEEP_FRAMES = 4; // сколько кадров держать маску, если нейросеть на миг потеряла лицо

// Общее состояние: к нему обращаются компоненты face-anchor и dog-tongue
const state = { slots: [], anchors: [] };

// ---------- Слот одного лица ----------
class FaceSlot {
  constructor(minCutOff, beta) {
    // Фильтр One Euro (как в MindAR): на каждую точку лица, на матрицу позы и на масштаб
    this.landmarkFilters = Array.from({ length: N_LANDMARKS }, () => new OneEuroFilter({ minCutOff, beta }));
    this.matrixFilter = new OneEuroFilter({ minCutOff, beta });
    this.scaleFilter = new OneEuroFilter({ minCutOff, beta });
    this.reset();
  }

  reset() {
    this.landmarkFilters.forEach((f) => f.reset());
    this.matrixFilter.reset();
    this.scaleFilter.reset();
    this.active = false;
    this.result = null;   // сглаженные metricLandmarks, faceMatrix, faceScale
    this.center = null;   // положение кончика носа на кадре — по нему узнаём лицо в следующем кадре
    this.missed = 0;
    this.jawOpen = 0;     // насколько открыт рот, 0..1
    this.lastT = 0;
  }

  update(estimate, center, jawOpen) {
    let t = Date.now();
    if (t <= this.lastT) t = this.lastT + 1; // фильтру нужен ненулевой промежуток времени
    this.lastT = t;

    this.result = {
      metricLandmarks: estimate.metricLandmarks.map((l, i) => this.landmarkFilters[i].filter(t, l)),
      faceMatrix: this.matrixFilter.filter(t, estimate.faceMatrix),
      faceScale: this.scaleFilter.filter(t, [estimate.faceScale])[0]
    };
    this.center = center;
    this.missed = 0;
    this.active = true;
    // Открытость рта сглаживаем простым усреднением, чтобы язык не дёргался
    this.jawOpen += (jawOpen - this.jawOpen) * 0.4;
  }

  // Матрица ключевой точки — та же формула, что в MindAR (Controller.getLandmarkMatrix):
  // поза головы × сдвиг в точку × масштаб «1 единица = ширина лица»
  landmarkMatrix(index) {
    const { metricLandmarks, faceMatrix: fm, faceScale: s } = this.result;
    const t = metricLandmarks[index];
    return [
      fm[0] * s, fm[1] * s, fm[2] * s, fm[0] * t[0] + fm[1] * t[1] + fm[2] * t[2] + fm[3],
      fm[4] * s, fm[5] * s, fm[6] * s, fm[4] * t[0] + fm[5] * t[1] + fm[6] * t[2] + fm[7],
      fm[8] * s, fm[9] * s, fm[10] * s, fm[8] * t[0] + fm[9] * t[1] + fm[10] * t[2] + fm[11],
      fm[12] * s, fm[13] * s, fm[14] * s, fm[12] * t[0] + fm[13] * t[1] + fm[14] * t[2] + fm[15]
    ];
  }
}

// ---------- Компонент сцены: камера, нейросеть, распределение лиц по слотам ----------
AFRAME.registerComponent('multi-face', {
  schema: {
    maxFaces: { type: 'int', default: 3 },
    filterMinCF: { type: 'number', default: 0.0001 },
    filterBeta: { type: 'number', default: 1.5 },
    template: { type: 'selector' } // <template> с маской, копируется на каждое лицо
  },

  init: function () {
    const { maxFaces, filterMinCF, filterBeta } = this.data;
    state.slots = Array.from({ length: maxFaces }, () => new FaceSlot(filterMinCF, filterBeta));
    this.ready = false;
    this.lastCount = -1;

    // Копия маски на каждое лицо: в каждой копии прописываем номер слота
    for (let i = 0; i < maxFaces; i++) {
      const frag = this.data.template.content.cloneNode(true);
      frag.querySelectorAll('[face-anchor]').forEach((el) => {
        el.setAttribute('face-anchor', el.getAttribute('face-anchor') + '; face: ' + i);
      });
      this.el.appendChild(frag);
    }

    this.el.addEventListener('renderstart', () => this.start());
  },

  start: async function () {
    this.container = this.el.parentNode;
    const video = this.video = document.createElement('video');
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.style.cssText = 'position:absolute;top:0;left:0;z-index:-2;transform:scaleX(-1)'; // зеркально, как в MindAR
    this.container.appendChild(video);

    try {
      video.srcObject = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user' } });
      await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
      video.setAttribute('width', video.videoWidth);
      video.setAttribute('height', video.videoHeight);

      // Кадр для нейросети отражаем по горизонтали, как это делает MindAR
      this.flipCanvas = document.createElement('canvas');
      this.flipCanvas.width = video.videoWidth;
      this.flipCanvas.height = video.videoHeight;
      this.flipCtx = this.flipCanvas.getContext('2d');

      await waitCV(); // OpenCV (WASM) нужен Estimator для расчёта позы головы
      this.landmarker = await this.createLandmarker();
    } catch (err) {
      console.error(err);
      this.el.emit('arError', { error: err.message });
      return;
    }

    // Невидимая сетка лица для каждого слота: закрывает то, что за лицом
    this.faceMeshes = state.slots.map(() => {
      const mesh = new THREE.Mesh(createThreeFaceGeometry(THREE), new THREE.MeshBasicMaterial({ colorWrite: false }));
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = -1;
      mesh.visible = false;
      this.el.object3D.add(mesh);
      return mesh;
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.ready = true;
    this.el.emit('arReady');
  },

  createLandmarker: async function () {
    const fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm');
    const options = (delegate) => ({
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate
      },
      runningMode: 'VIDEO',
      numFaces: this.data.maxFaces,   // главное отличие от MindAR: больше одного лица
      outputFaceBlendshapes: true     // коэффициенты мимики, из них берём jawOpen (открыт ли рот)
    });
    try {
      return await FaceLandmarker.createFromOptions(fileset, options('GPU'));
    } catch (e) {
      console.warn('GPU недоступен, нейросеть работает на CPU', e);
      return await FaceLandmarker.createFromOptions(fileset, options('CPU'));
    }
  },

  // Камера сцены и размеры видео — по тому же принципу, что MindAR (_resize)
  resize: function () {
    const video = this.video;
    this.estimator = new Estimator(video);
    const camera = this.el.camera;
    camera.fov = this.estimator.fov * 180 / Math.PI;
    camera.aspect = this.estimator.frameWidth / this.estimator.frameHeight;
    camera.near = this.estimator.near;
    camera.far = this.estimator.far;
    camera.updateProjectionMatrix();

    // Видео «обрезается» под экран без искажений (как object-fit: cover)
    const videoRatio = video.videoWidth / video.videoHeight;
    const box = this.container;
    let vw, vh;
    if (videoRatio > box.clientWidth / box.clientHeight) {
      vh = box.clientHeight; vw = vh * videoRatio;
    } else {
      vw = box.clientWidth; vh = vw / videoRatio;
    }
    for (const el of [video, this.el]) {
      el.style.position = 'absolute';
      el.style.top = (-(vh - box.clientHeight) / 2) + 'px';
      el.style.left = (-(vw - box.clientWidth) / 2) + 'px';
      el.style.width = vw + 'px';
      el.style.height = vh + 'px';
    }
  },

  tick: function () {
    if (!this.ready || this.video.readyState < 2) return;

    // 1. Нейросеть ищет лица на отражённом кадре
    const ctx = this.flipCtx;
    const w = this.flipCanvas.width;
    ctx.setTransform(-1, 0, 0, 1, w, 0);
    ctx.drawImage(this.video, 0, 0, w, this.flipCanvas.height);
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    const results = this.landmarker.detectForVideo(this.flipCanvas, ts);

    // 2. Каждое найденное лицо: поза головы (Estimator из MindAR), центр, открытость рта
    const found = results.faceLandmarks.map((landmarks, k) => {
      const points = landmarks.map((l) => [l.x, l.y, l.z]);
      const shapes = results.faceBlendshapes[k];
      const jaw = shapes ? shapes.categories.find((c) => c.categoryName === 'jawOpen') : null;
      return {
        estimate: this.estimator.estimate(points),
        center: [points[1][0], points[1][1]], // точка 1 — кончик носа
        jawOpen: jaw ? jaw.score : 0
      };
    });

    // 3. Сопоставляем лица со слотами. Порядок лиц в ответе нейросети может меняться
    //    от кадра к кадру, поэтому каждое лицо отдаём тому слоту, где в прошлом кадре
    //    было ближайшее лицо. Иначе маски «перепрыгивали» бы между людьми.
    const freeFaces = new Set(found.keys());
    const pairs = [];
    state.slots.forEach((slot, s) => {
      if (!slot.active) return;
      found.forEach((f, k) => {
        pairs.push({ s, k, d: Math.hypot(f.center[0] - slot.center[0], f.center[1] - slot.center[1]) });
      });
    });
    pairs.sort((a, b) => a.d - b.d);
    const usedSlots = new Set();
    for (const { s, k, d } of pairs) {
      if (usedSlots.has(s) || !freeFaces.has(k) || d > 0.25) continue;
      state.slots[s].update(found[k].estimate, found[k].center, found[k].jawOpen);
      usedSlots.add(s);
      freeFaces.delete(k);
    }
    // Новые лица — в свободные слоты
    for (const k of freeFaces) {
      const s = state.slots.findIndex((slot, i) => !slot.active && !usedSlots.has(i));
      if (s === -1) break;
      state.slots[s].update(found[k].estimate, found[k].center, found[k].jawOpen);
      usedSlots.add(s);
    }
    // Лица, которых нет в кадре несколько кадров подряд, освобождают слот
    state.slots.forEach((slot, s) => {
      if (slot.active && !usedSlots.has(s) && ++slot.missed > KEEP_FRAMES) slot.reset();
    });

    // 4. Переносим позы на сцену
    for (const anchor of state.anchors) {
      const slot = state.slots[anchor.data.face];
      const obj = anchor.el.object3D;
      obj.visible = !!(slot && slot.active);
      if (obj.visible) obj.matrix.set(...slot.landmarkMatrix(anchor.data.landmark));
    }
    state.slots.forEach((slot, s) => {
      const mesh = this.faceMeshes[s];
      mesh.visible = slot.active;
      if (slot.active) {
        mesh.matrix.set(...slot.result.faceMatrix);
        mesh.geometry.updatePositions(slot.result.metricLandmarks);
      }
    });

    const count = state.slots.filter((slot) => slot.active).length;
    if (count !== this.lastCount) {
      this.lastCount = count;
      this.el.emit('facescount', { count });
    }
  }
});

// ---------- Привязка к ключевой точке лица (аналог mindar-face-target) ----------
AFRAME.registerComponent('face-anchor', {
  schema: {
    landmark: { type: 'int', default: 1 }, // номер точки (0–467)
    face: { type: 'int', default: 0 }      // номер слота (лица)
  },
  init: function () {
    this.el.object3D.matrixAutoUpdate = false; // матрицу задаём сами каждый кадр
    this.el.object3D.visible = false;
    state.anchors.push(this);
  },
  remove: function () {
    state.anchors.splice(state.anchors.indexOf(this), 1);
  }
});

// ---------- Язык: высовывается, когда рот открыт ----------
AFRAME.registerComponent('dog-tongue', {
  schema: {
    from: { type: 'number', default: 0.12 }, // при какой открытости рта язык начинает появляться
    to: { type: 'number', default: 0.45 }    // при какой он высунут полностью
  },
  tick: function (time) {
    if (!this.anchor) {
      const el = this.el.closest('[face-anchor]');
      this.anchor = el && el.components['face-anchor'];
      if (!this.anchor) return;
    }
    const slot = state.slots[this.anchor.data.face];
    const jaw = slot ? slot.jawOpen : 0;
    const k = THREE.MathUtils.smoothstep(jaw, this.data.from, this.data.to);
    const obj = this.el.object3D;
    obj.visible = k > 0.02;
    obj.scale.set(1, Math.max(k, 0.001), 1);       // язык «вытягивается» вниз
    obj.rotation.z = Math.sin(time / 180) * 0.12 * k; // и виляет, как у собаки
  }
});

// ---------- Окклюдер: пишет только глубину, сам невидим ----------
AFRAME.registerComponent('occluder', {
  init: function () {
    const apply = () => {
      this.el.object3D.traverse((o) => {
        if (o.isMesh) {
          o.material = new THREE.MeshBasicMaterial({ colorWrite: false });
          o.renderOrder = -1; // рисуется первым, чтобы закрыть то, что за ним
        }
      });
    };
    apply();
    this.el.addEventListener('object3dset', apply);
  }
});

// Сцену вставляем только теперь, когда все компоненты зарегистрированы:
// модуль загружается позже обычных скриптов, и A-Frame иначе обработал бы сцену раньше
const sceneTpl = document.getElementById('sceneTpl');
document.getElementById('arContainer').appendChild(sceneTpl.content.cloneNode(true));
