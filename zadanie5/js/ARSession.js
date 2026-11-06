// Модуль WebXR: проверка поддержки, запуск immersive-ar, hit-test, якоря, контроллеры.
import { Reticle } from './Reticle.js';

export class ARSession {
  constructor(renderer, scene, bus) {
    this.renderer = renderer;
    this.bus = bus;
    this.session = null;
    this.referenceSpace = null;
    this.viewerSource = null;     // луч из центра экрана телефона
    this.controllerSource = null; // луч из правого контроллера (шлем, эмулятор)
    this.lastHit = null;          // XRHitTestResult текущего кадра

    this.reticle = new Reticle();
    scene.add(this.reticle.object);

    // Касание экрана (на шлеме — курок) приходит как событие select.
    // Сам модуль ничего не решает, а передаёт событие дальше — в InputHandler
    this.controllers = [0, 1].map((i) => {
      const c = renderer.xr.getController(i);
      c.addEventListener('select', () => this.bus.emit('xr:select', { controller: c }));
      scene.add(c);
      return c;
    });
  }

  get active() {
    return !!this.session;
  }

  // Проверка поддержки до запуска: текст ошибки или null
  static async checkSupport() {
    if (!window.isSecureContext) return 'WebXR работает только по HTTPS.';
    if (!('xr' in navigator)) {
      const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      return iOS
        ? 'Safari на iPhone не поддерживает WebXR. Можно менять модель и цвет в превью, а AR открыть в Chrome на Android или в эмуляторе.'
        : 'Браузер не поддерживает WebXR. Нужен Chrome на Android или WebXR-эмулятор.';
    }
    if (!(await navigator.xr.isSessionSupported('immersive-ar'))) {
      return 'immersive-ar не поддерживается. Нужен Chrome на Android с ARCore или эмулятор.';
    }
    return null;
  }

  async start(overlayRoot) {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['local-floor', 'dom-overlay', 'anchors'],
      domOverlay: { root: overlayRoot }
    });

    // local-floor: начало координат на уровне пола. Если нет — local
    let type = 'local-floor';
    try {
      await session.requestReferenceSpace('local-floor');
    } catch (e) {
      type = 'local';
    }
    this.renderer.xr.setReferenceSpaceType(type);
    await this.renderer.xr.setSession(session);
    this.referenceSpace = this.renderer.xr.getReferenceSpace();

    const viewerSpace = await session.requestReferenceSpace('viewer');
    this.viewerSource = await session.requestHitTestSource({ space: viewerSpace });

    this.session = session;
    session.addEventListener('inputsourceschange', () => this.updateControllerSource());
    this.updateControllerSource();
    session.addEventListener('end', () => this.onEnd());
    this.bus.emit('ar:start', { referenceSpace: type });
  }

  // На шлеме целимся правым контроллером, как указкой
  async updateControllerSource() {
    if (!this.session) return;
    const pointers = [...this.session.inputSources].filter((s) => s.targetRayMode === 'tracked-pointer');
    const src = pointers.find((s) => s.handedness === 'right') || pointers[0];
    if (this.controllerSource) this.controllerSource.cancel();
    this.controllerSource = src ? await this.session.requestHitTestSource({ space: src.targetRaySpace }) : null;
  }

  end() {
    if (this.session) this.session.end();
  }

  onEnd() {
    if (this.viewerSource) this.viewerSource.cancel();
    if (this.controllerSource) this.controllerSource.cancel();
    this.viewerSource = this.controllerSource = null;
    this.session = null;
    this.lastHit = null;
    this.reticle.hide();
    this.bus.emit('ar:end');
  }

  // Каждый кадр: результат hit-test -> маркер. Возвращает 'floor' | 'wall' | 'none'
  update(frame, time) {
    const source = this.controllerSource || this.viewerSource;
    if (!source) return 'none';
    const results = frame.getHitTestResults(source);
    this.reticle.animate(time);
    if (!results.length) {
      this.lastHit = null;
      this.reticle.hide();
      return 'none';
    }
    this.lastHit = results[0];
    const pose = this.lastHit.getPose(this.referenceSpace);
    this.reticle.setPose(pose.transform.matrix);
    return this.reticle.isHorizontal() ? 'floor' : 'wall';
  }

  // Якорь создаётся из результата hit-test текущего кадра. Promise<XRAnchor|null>
  createAnchor(hitResult) {
    if (!hitResult || !hitResult.createAnchor) return Promise.resolve(null);
    return hitResult.createAnchor().catch((err) => {
      console.warn('[WebXR] якорь не создан', err);
      return null;
    });
  }
}
