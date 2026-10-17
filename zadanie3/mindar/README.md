# Модули MindAR Face Tracking

Файлы взяты из исходников MindAR (https://github.com/hiukim/mind-ar-js, версия 1.2.5, лицензия MIT — см. LICENSE):

- `estimator.js` — оценка позы головы по 468 точкам лица (src/face-target/face-geometry/estimator.js);
- `face-data.js` — каноническая модель лица MediaPipe;
- `face-geometry.js` — сетка лица для three.js (используется как невидимый окклюдер);
- `one-euro-filter.js` — фильтр сглаживания One Euro (src/libs);
- `opencv.js`, `opencv-helper.js` — OpenCV (WASM), нужен для расчёта позы (src/libs).

Единственное изменение: в `estimator.js` исправлен путь импорта `opencv-helper.js` под эту папку.

Управляющая часть (камера, нейросеть, привязка объектов к точкам) находится в `../multi-face.js`:
она повторяет логику MindAR (Controller и A-Frame-система mindar-face), но отслеживает несколько лиц.
