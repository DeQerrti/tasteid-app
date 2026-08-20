// ══════════════════════════════════════════════
//  ПЕРЕТАСКИВАНИЕ ПАЛЬЦЕМ
//
//  Порядок отзывов, порядок вкладок, избранное и весь редактор
//  тир-листов держатся на перетаскивании. Браузер умеет его только
//  мышью: события dragstart/dragover/drop от касаний не рождаются
//  вовсе — на телефоне всё это просто не работало бы.
//
//  Здесь касания переводятся в те же самые события drag, и страницы
//  переписывать не нужно: их обработчики получают настоящий DragEvent
//  с настоящими координатами и не знают, что источник — палец.
//
//  Начало — по удержанию, как в списках самого телефона: сразу за
//  движением тащить нельзя, иначе пропадёт обычная прокрутка списка.
// ══════════════════════════════════════════════

(() => {
  // Мышь и так умеет всё сама.
  if (!window.matchMedia || !matchMedia("(pointer: coarse)").matches) return;

  const HOLD = 260; // мс удержания до начала перетаскивания
  const SLIP = 12; // px: палец уехал раньше — это прокрутка, а не захват
  const EDGE = 70; // px от края экрана, где список едет сам
  const STEP = 10; // px за шаг такой прокрутки

  let hold = null; // таймер удержания
  let src = null; // что тащим
  let ghost = null; // призрак под пальцем
  let over = null; // над чем сейчас
  let edge = null; // таймер автопрокрутки
  let start = null; // точка касания
  let dragged = false; // было ли перетаскивание — чтобы погасить клик

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
  // длинный — без этого до дальнего конца не дотащить.
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
    // Долгое нажатие в браузере — это выделение текста и своё меню.
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
    // вовсе — без этого флаг остался бы поднятым и съел следующее
    // нажатие, уже настоящее.
    setTimeout(() => (dragged = false), 350);
  }

  document.addEventListener(
    "touchstart",
    (e) => {
      if (src || e.touches.length !== 1) return;
      const el = e.target.closest?.('[draggable="true"]');
      if (!el) return;
      const p = point(e);
      start = { el, x: p.clientX, y: p.clientY };
      hold = setTimeout(() => begin(el, start.x, start.y), HOLD);
    },
    { passive: true }
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      const p = point(e);
      if (!src) {
        // Ещё не тащим: если палец поехал — это прокрутка, отменяем.
        if (start && Math.hypot(p.clientX - start.x, p.clientY - start.y) > SLIP) {
          clearTimeout(hold);
          start = null;
        }
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
    start = null;
    if (!src) return;
    const p = point(e);
    finish(p.clientX, p.clientY, e.type === "touchend");
  };
  document.addEventListener("touchend", end);
  document.addEventListener("touchcancel", end);

  // После перетаскивания браузер всё равно шлёт click по месту, где
  // палец оторвался, — а там, например, «выбрать тайтл». Гасим один раз.
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
