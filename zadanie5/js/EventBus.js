// Шина событий: модули не вызывают друг друга напрямую, а обмениваются событиями.
// Например, UI сообщает «ui:color» с цветом, а InputHandler решает, к какому объекту его применить.
export class EventBus {
  constructor() {
    this.handlers = new Map(); // тип события -> набор обработчиков
  }

  on(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(handler);
    return () => this.handlers.get(type).delete(handler); // функция отписки
  }

  emit(type, detail) {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of set) handler(detail);
  }
}
