// ══════════════════════════════════════════════
//  API — все сетевые запросы
//  Зависит от: config.js
// ══════════════════════════════════════════════

// ── reviews.json ───────────────────────────────
async function fetchReviews() {
  if (cache.reviews) return cache.reviews;
  try {
    // Абсолютный путь — та же причина, что у site-settings.json в
    // theme.js: перехватчик fetch на телефоне ловит только запросы,
    // начинающиеся с "/".
    const res = await fetch("/reviews.json");
    if (!res.ok) throw new Error(i18n("reviews.json не найден"));
    const data = await res.json();
    // Сортировки здесь нет намеренно. Раньше стояла по r.date — поля,
    // которого в записях не бывает: даты зовутся date_start/date_end
    // (r.date — остаток от самого первого формата). Компаратор из-за
    // этого возвращал NaN на каждой паре, то есть не делал ничего, и
    // порядок держался только на том, что хранилище отдаёт файл уже
    // отсортированным (core/api.js, sortReviews — свежее сверху).
    // Так оно и есть: сортировать второй раз, да ещё по-другому,
    // значит однажды разъехаться с ним.
    cache.reviews = data;
    return data;
  } catch {
    cache.reviews = [];
    return [];
  }
}

// После любой правки, которая сбрасывает cache.reviews (сохранение,
// удаление, импорт — все места ищи по "cache.reviews = null"), вкладка
// под #shell-root сама не перечитается: её рельса не разбирается, пока
// открыт отдельный маршрут (router.js) поверх неё, она просто спрятана
// через .hidden и обновится только по новому клику (switchTab() в
// index.html). Раньше это чинилось в одном settings-edit.js (там же,
// где обнаружилось) — с переносом сюда используют все места, что
// сбрасывают cache.reviews из своего собственного маршрута, а не
// только «Внешний вид» в настройках.
function refreshOpenReviewsTab() {
  const active = document.querySelector("#shell-root .tab-content:not(.hidden)");
  if (!active) return;
  if (active.id === "tab-now") loadNow();
  if (active.id === "tab-favorites") loadFavorites();
  if (active.id === "tab-reviews") loadReviews();
  if (active.id === "tab-stats") loadStats();
  if (active.id === "tab-tierlist") loadTierlist();
}
