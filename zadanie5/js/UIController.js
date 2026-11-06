// Модуль интерфейса: обычные HTML <button>, <select> и ползунки.
// UI ничего не меняет в сцене сам — он только отправляет события в шину.

export const COLORS = [
  { hex: null, name: 'Исходный' },
  { hex: '#2B3A55', name: 'Тёмно-синий' },
  { hex: '#C9A227', name: 'Горчичный' },
  { hex: '#2E7D5B', name: 'Изумрудный' },
  { hex: '#B5523B', name: 'Терракотовый' },
  { hex: '#E8A0B4', name: 'Розовый' }
];

export class UIController {
  constructor(bus, catalog) {
    this.bus = bus;
    const $ = (id) => document.getElementById(id);
    this.el = {
      panel: $('panel'),
      model: $('modelSelect'),
      swatches: $('swatches'),
      rotL: $('rotLeft'),
      rotR: $('rotRight'),
      del: $('deleteBtn'),
      reset: $('resetBtn'),
      rough: $('roughness'),
      metal: $('metalness'),
      roughVal: $('roughnessVal'),
      metalVal: $('metalnessVal'),
      hdri: $('hdriToggle'),
      exit: $('exitBtn'),
      collapse: $('collapseBtn'),
      hud: $('hud'),
      hudText: $('hudText'),
      target: $('targetText')
    };

    // Выбор модели
    for (const m of catalog) this.el.model.add(new Option(m.name, m.id));
    this.el.model.addEventListener('change', () => bus.emit('ui:model', this.el.model.value));

    // Кнопки цвета
    this.swatchButtons = COLORS.map((c) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (c.hex ? '' : ' swatch-original');
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      if (c.hex) b.style.background = c.hex;
      b.dataset.hex = c.hex || '';
      b.addEventListener('click', () => (c.hex ? bus.emit('ui:color', c.hex) : bus.emit('ui:color', null)));
      this.el.swatches.appendChild(b);
      return b;
    });

    // Поворот: пока кнопка зажата, объект вращается
    const hold = (btn, dir) => {
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); bus.emit('ui:rotate-start', dir); });
      for (const t of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(t, () => bus.emit('ui:rotate-stop'));
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    hold(this.el.rotL, 1);
    hold(this.el.rotR, -1);

    // PBR-параметры
    this.el.rough.addEventListener('input', () => {
      this.el.roughVal.textContent = Number(this.el.rough.value).toFixed(2);
      bus.emit('ui:roughness', Number(this.el.rough.value));
    });
    this.el.metal.addEventListener('input', () => {
      this.el.metalVal.textContent = Number(this.el.metal.value).toFixed(2);
      bus.emit('ui:metalness', Number(this.el.metal.value));
    });

    this.el.reset.addEventListener('click', () => bus.emit('ui:reset'));
    this.el.del.addEventListener('click', () => bus.emit('ui:delete'));
    this.el.hdri.addEventListener('change', () => bus.emit('ui:hdri', this.el.hdri.checked));
    this.el.exit.addEventListener('click', () => bus.emit('ui:exit'));
    this.el.collapse.addEventListener('click', () => {
      const collapsed = this.el.panel.classList.toggle('collapsed');
      this.el.collapse.textContent = collapsed ? 'Показать' : 'Скрыть';
    });

    // Касания панели и плашки не должны ставить объект в AR
    for (const el of [this.el.panel, this.el.hud]) el.addEventListener('beforexrselect', (e) => e.preventDefault());
  }

  // Синхронизировать панель с выбранным объектом
  showTarget(target, arMode) {
    const hasTarget = !!target;
    for (const el of [this.el.rotL, this.el.rotR, this.el.reset, this.el.rough, this.el.metal, ...this.swatchButtons]) {
      el.disabled = !hasTarget;
    }
    this.el.del.disabled = !(hasTarget && arMode);
    if (!hasTarget) {
      this.el.target.textContent = 'Объект не выбран: поставь его на пол';
      return;
    }
    const name = this.el.model.querySelector(`option[value="${target.modelId}"]`).textContent;
    this.el.target.textContent = (arMode ? 'Выбрано: ' : 'Превью: ') + name;
    this.el.model.value = target.modelId;
    const pbr = target.currentPBR();
    this.el.rough.value = pbr.roughness;
    this.el.metal.value = pbr.metalness;
    this.el.roughVal.textContent = pbr.roughness.toFixed(2);
    this.el.metalVal.textContent = pbr.metalness.toFixed(2);
    for (const b of this.swatchButtons) b.setAttribute('aria-pressed', String((b.dataset.hex || null) === target.color));
  }

  setHud(text, state) {
    if (this.el.hudText.textContent !== text) this.el.hudText.textContent = text;
    this.el.hud.dataset.state = state;
  }

  setARMode(on) {
    document.body.classList.toggle('xr-active', on);
    document.getElementById('overlay').classList.toggle('active', on);
  }
}
