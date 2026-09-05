// ══════════════════════════════════════════════
//  ПЕРЕТАСКИВАНИЕ ПАЛЬЦЕМ
//
//  Порядок отзывов, порядок вкладок, избранное и весь редактор
//  тир-листов держатся на перетаскивании. Браузер умеет его только
//  мышью: события dragstart/dragover/drop от касаний не рождаются
//  вовсе – на телефоне всё это просто не работало бы.
//
//  Здесь касания переводятся в те же самые события drag, и страницы
//  переписывать не нужно: их обработчики получают настоящий DragEvent
//  с настоящими координатами и не знают, что источник – палец.
//
//  Начало – по удержанию, как в списках самого телефона: сразу за
//  движением тащить нельзя, иначе пропадёт обычная прокрутка списка.
// ══════════════════════════════════════════════

(() => {
  // Мышь и так умеет всё сама.
  if (!window.matchMedia || !matchMedia("(pointer: coarse)").matches) return;

  // draggable="true" нужен нам самим – чтобы находить, что можно тащить
  // (см. touchstart ниже), – но у части WebView он же с некоторых пор
  // может завести и СВОЙ, настоящий drag-and-drop прямо от касания,
  // параллельно нашей подмене: призрак при этом всё ещё честно едет за
  // пальцем (это рисуем мы), а вот итог отпускания достаётся уже не
  // предсказать – настоящий и поддельный drag спорят за один жест.
  // Различить их можно по isTrusted: у события, которое рождает сам
  // браузер, оно true; у нашего – всегда false, потому что fire() ниже
  // создаёт DragEvent через dispatchEvent(), а не настоящее нажатие.
  // Глушим только настоящие – своих не касается.
  document.addEventListener(
    "dragstart",
    (e) => {
      if (e.isTrusted) e.preventDefault();
    },
    true
  );

  const HOLD = 260; // мс удержания до начала перетаскивания
  const SLIP = 12; // px: палец уехал раньше – это прокрутка, а не захват
  const EDGE = 70; // px от края экрана, где список едет сам
  const STEP = 10; // px за шаг такой прокрутки

  let hold = null; // таймер удержания
  let src = null; // что тащим
  let ghost = null; // призрак под пальцем
  let over = null; // над чем сейчас
  let edge = null; // таймер автопрокрутки
  let start = null; // точка касания
  let dragged = false; // было ли перетаскивание – чтобы погасить клик

  // Прокрутка вручную (см. её же комментарий у touchmove ниже) без
  // инерции листала ровно на длину самого свайпа и резко останавливалась
  // на отпускании – в отличие от обычной прокрутки, которая после
  // быстрого свайпа ещё едет по инерции и тормозит сама. FLING* ниже –
  // тот же "доезд": на отпускании берём скорость последних мс движения
  // и гасим её трением, кадр за кадром, пока не станет пренебрежимо мала.
  let velY = 0; // px/мс на момент отпускания
  let lastMoveT = 0;
  let flingRaf = null;
  const FLING_FRICTION = 0.94; // за кадр (~16мс)
  const FLING_MIN_V = 0.02; // px/мс, дальше это уже не движение, а дрожание

  function stopFling() {
    if (flingRaf) cancelAnimationFrame(flingRaf);
    flingRaf = null;
  }
  function fling() {
    velY *= FLING_FRICTION;
    if (Math.abs(velY) < FLING_MIN_V) {
      flingRaf = null;
      return;
    }
    scrollBy(0, velY * 16);
    flingRaf = requestAnimationFrame(fling);
  }

  // Ручная прокрутка (см. её же комментарий у touchmove ниже) раньше
  // звала scrollBy() синхронно на КАЖДОЕ touchmove – а оно у некоторых
  // устройств рождается чаще, чем страница успевает отрисовать кадр.
  // Над обычным фоном списка (текст, отступы) лишний рефлоу проходил
  // незаметно, а вот там, где под пальцем большая обложка – перекраска
  // тяжелее, и стопка накопившихся синхронных scrollBy() между кадрами
  // уже ощущалась как заметное подтормаживание, которого нет вовсе над
  // промежутком между карточками (там скроллит сам браузер, эта ветка
  // не участвует). requestAnimationFrame схлопывает всё, что случилось
  // между кадрами, в один вызов – тот же приём, что и у RAF-коалессинга
  // рендера вкладок (см. её же историю в этой сессии).
  let pendingScrollDy = 0;
  let scrollRaf = null;
  function queueScroll(dy) {
    pendingScrollDy += dy;
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      scrollBy(0, pendingScrollDy);
      pendingScrollDy = 0;
    });
  }
  function stopQueuedScroll() {
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    scrollRaf = null;
    pendingScrollDy = 0;
  }

  const point = (e) => e.touches[0] || e.changedTouches[0];

  // DragEvent конструируется по-настоящему, с настоящим DataTransfer:
  // обработчики страниц читают dataTransfer.effectAllowed и clientX/Y,
  // и подделка тут вылезла бы сразу.
  const fire = (el, type, x, y, related) =>
    el?.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        relatedTarget: related || null,
        dataTransfer: new DataTransfer(),
      })
    );

  function makeGhost(el, x, y) {
    const box = el.getBoundingClientRect();
    const copy = el.cloneNode(true);
    copy.style.cssText = `
      position: fixed; left: 0; top: 0; margin: 0; z-index: 9999;
      width: ${box.width}px; height: ${box.height}px;
      opacity: .85; pointer-events: none; transition: none;`;
    copy.dataset.touchGhost = "1";
    document.body.appendChild(copy);
    copy.__dx = x - box.left;
    copy.__dy = y - box.top;
    moveGhost(copy, x, y);
    return copy;
  }

  const moveGhost = (el, x, y) => {
    el.style.transform = `translate(${x - el.__dx}px, ${y - el.__dy}px)`;
  };

  // Прокрутка у края: палец у верхней или нижней границы, а список
  // длинный – без этого до дальнего конца не дотащить.
  function edgeScroll(y) {
    stopEdge();
    const dir = y < EDGE ? -1 : y > innerHeight - EDGE ? 1 : 0;
    if (!dir) return;
    edge = setInterval(() => scrollBy(0, dir * STEP), 16);
  }
  const stopEdge = () => {
    clearInterval(edge);
    edge = null;
  };

  function begin(el, x, y) {
    src = el;
    ghost = makeGhost(el, x, y);
    dragged = true;
    // Долгое нажатие в браузере – это выделение текста и своё меню.
    document.body.style.userSelect = "none";
    fire(el, "dragstart", x, y);
  }

  function finish(x, y, drop) {
    stopEdge();
    if (drop && over) fire(over, "drop", x, y);
    fire(src, "dragend", x, y);
    ghost?.remove();
    document.body.style.userSelect = "";
    src = ghost = over = null;
    // Если палец уехал далеко, клика после отпускания браузер не пришлёт
    // вовсе – без этого флаг остался бы поднятым и съел следующее
    // нажатие, уже настоящее.
    setTimeout(() => (dragged = false), 350);
  }

  document.addEventListener(
    "touchstart",
    (e) => {
      if (src || e.touches.length !== 1) return;
      const el = e.target.closest?.('[draggable="true"]');
      if (!el) return;
      stopFling(); // новое касание – прошлый доезд (если ещё катился) больше не в счёт
      stopQueuedScroll();
      velY = 0;
      const p = point(e);
      start = { el, x: p.clientX, y: p.clientY };
      lastMoveT = performance.now();
      hold = setTimeout(() => begin(el, start.x, start.y), HOLD);
    },
    { passive: true }
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      const p = point(e);
      if (!src) {
        if (!start) return;
        // Ещё не тащим, но touch-action: none на [draggable="true"] (см.
        // её же комментарий в style.css) отключает нативную прокрутку
        // целиком, ровно на тех элементах, где палец мог опуститься для
        // захвата, – без повтора вручную список нельзя было бы пролистать,
        // начав касание прямо на строке, а не в промежутке между ними.
        const dy = start.y - p.clientY;
        queueScroll(dy);
        // Если палец поехал – это (по крайней мере уже) не захват,
        // отменяем таймер удержания. Точку отсчёта для прокрутки выше
        // при этом не обнуляем – прокрутка продолжается, пока палец на
        // экране, отмена захвата её не останавливает.
        if (Math.hypot(p.clientX - start.x, p.clientY - start.y) > SLIP) clearTimeout(hold);
        // Скорость этого шага – для доезда по инерции на отпускании
        // (см. fling() выше). Старые шаги не усредняем нарочно: важна
        // именно скорость самого последнего движения перед отрывом
        // пальца, а не средняя за весь свайп.
        const now = performance.now();
        const dt = now - lastMoveT;
        if (dt > 0) velY = dy / dt;
        lastMoveT = now;
        start.x = p.clientX;
        start.y = p.clientY;
        return;
      }
      // Тащим: страница под пальцем стоять должна.
      e.preventDefault();
      moveGhost(ghost, p.clientX, p.clientY);
      edgeScroll(p.clientY);

      const el = document.elementFromPoint(p.clientX, p.clientY);
      if (el !== over) {
        fire(over, "dragleave", p.clientX, p.clientY, el);
        fire(el, "dragenter", p.clientX, p.clientY, over);
        over = el;
      }
      fire(el, "dragover", p.clientX, p.clientY);
    },
    { passive: false }
  );

  const end = (e) => {
    clearTimeout(hold);
    const wasScrolling = !src && start;
    start = null;
    if (!src) {
      // Не захват, а обычная прокрутка (см. её же ручную scrollBy() в
      // touchmove) – отпустили после быстрого свайпа, доезжаем по
      // инерции тем же приёмом, что и настоящая прокрутка списков.
      if (wasScrolling && e.type === "touchend") fling();
      return;
    }
    const p = point(e);
    finish(p.clientX, p.clientY, e.type === "touchend");
  };
  document.addEventListener("touchend", end);
  document.addEventListener("touchcancel", end);

  // После перетаскивания браузер всё равно шлёт click по месту, где
  // палец оторвался, – а там, например, «выбрать тайтл». Гасим один раз.
  document.addEventListener(
    "click",
    (e) => {
      if (!dragged) return;
      dragged = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true
  );
})();
