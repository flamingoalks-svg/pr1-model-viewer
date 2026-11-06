// Точка входа: создаёт модули и связывает их через шину событий.
import * as THREE from 'three';
import { EventBus } from './EventBus.js';
import { SceneManager } from './SceneManager.js';
import { EnvironmentLight } from './EnvironmentLight.js';
import { ModelLoader, MODEL_CATALOG } from './ModelLoader.js';
import { ObjectManager } from './ObjectManager.js';
import { PlacedObject } from './PlacedObject.js';
import { ARSession } from './ARSession.js';
import { InputHandler } from './InputHandler.js';
import { UIController } from './UIController.js';

const HDRI_URL = '../hdri/environment.hdr'; // та же HDRI-панорама, что в задании 1

class App {
  constructor() {
    this.bus = new EventBus();
    this.view = new SceneManager(document.getElementById('preview'));
    this.env = new EnvironmentLight(this.view.scene);
    this.loader = new ModelLoader(MODEL_CATALOG);
    this.objects = new ObjectManager(this.view.scene, this.loader, this.bus);
    this.ar = new ARSession(this.view.renderer, this.view.scene, this.bus);
    this.ui = new UIController(this.bus, MODEL_CATALOG);
    this.input = new InputHandler({
      bus: this.bus,
      ar: this.ar,
      objects: this.objects,
      env: this.env,
      renderer: this.view.renderer,
      getTarget: () => this.target(),
      modelId: MODEL_CATALOG[0].id
    });
    this.preview = null; // объект на стартовом экране (до запуска AR)
    this.clock = new THREE.Clock();
    this.loadingCount = 0;

    this.startBtn = document.getElementById('startBtn');
    this.statusBox = document.getElementById('status');
    this.statusText = document.getElementById('statusText');
    this.bindEvents();
  }

  // Объект, которым управляет панель: в AR — выбранный, до AR — превью
  target() {
    return this.ar.active ? this.objects.selected : this.preview;
  }

  setStatus(text, state) {
    this.statusText.textContent = text;
    this.statusBox.dataset.state = state;
    console.log('[App]', text);
  }

  bindEvents() {
    const refresh = () => this.ui.showTarget(this.target(), this.ar.active);
    this.bus.on('selection', refresh);
    this.bus.on('target-changed', (t) => {
      if (t === this.preview && !this.ar.active) this.view.frame(t.root);
      refresh();
    });
    this.bus.on('loading', (on) => { this.loadingCount += on ? 1 : -1; });

    this.bus.on('ar:start', ({ referenceSpace }) => {
      console.log('[WebXR] reference space:', referenceSpace);
      this.preview.root.visible = false;
      this.env.setBackgroundVisible(false);
      this.view.controls.enabled = false;
      this.ui.setARMode(true);
      refresh();
    });
    this.bus.on('ar:end', () => {
      this.objects.clear();
      this.preview.root.visible = true;
      this.env.setBackgroundVisible(true);
      this.view.controls.enabled = true;
      this.ui.setARMode(false);
      this.view.resize();
      refresh();
      this.setStatus('AR-сессия завершена. Можно запустить снова.', 'ok');
    });

    this.startBtn.addEventListener('click', async () => {
      try {
        await this.ar.start(document.getElementById('overlay'));
      } catch (err) {
        console.error(err);
        this.setStatus('Не удалось запустить AR: ' + err.message, 'error');
      }
    });
  }

  async init() {
    this.setStatus('Загружаю HDRI и модель…', 'wait');
    const [, model] = await Promise.all([
      this.env.load(HDRI_URL),
      this.loader.load(MODEL_CATALOG[0].id)
    ]);
    this.env.setBackgroundVisible(true);

    this.preview = new PlacedObject(model, MODEL_CATALOG[0].id);
    this.view.scene.add(this.preview.root);
    this.view.frame(this.preview.root);
    this.ui.showTarget(this.preview, false);

    const problem = await ARSession.checkSupport();
    if (problem) {
      this.setStatus(problem, 'error');
    } else {
      this.startBtn.disabled = false;
      this.setStatus('AR доступен. Нажми «Запустить AR».', 'ok');
    }

    this.view.renderer.setAnimationLoop((time, frame) => this.loop(time, frame));
  }

  loop(time, frame) {
    const dt = Math.min(this.clock.getDelta(), 0.1);

    if (this.ar.active && frame) {
      const surface = this.ar.update(frame, time);
      this.objects.updateAnchors(frame, this.ar.referenceSpace);
      this.input.updateXR();
      this.updateHud(surface);
    } else {
      this.view.controls.update();
    }

    this.input.update(dt);
    const t = this.target();
    if (t) this.env.follow(t.root.position);
    this.view.render();
  }

  updateHud(surface) {
    const name = this.loader.info(this.input.modelId).name.toLowerCase();
    if (this.loadingCount > 0) return this.ui.setHud('Загружаю модель…', 'wait');
    if (surface === 'floor') return this.ui.setHud(`Нажми на пол — поставить: ${name}. Нажми на объект — выбрать его.`, 'ok');
    if (surface === 'wall') return this.ui.setHud('Это стена. Наведи на пол или стол.', 'wait');
    this.ui.setHud('Ищу поверхность… Медленно поводи телефоном над полом.', 'wait');
  }
}

const app = new App();
app.init().catch((err) => {
  console.error(err);
  app.setStatus('Ошибка загрузки: ' + err.message, 'error');
});
