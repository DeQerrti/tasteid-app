// ══════════════════════════════════════════════
//  API — все сетевые запросы
//  Зависит от: config.js
// ══════════════════════════════════════════════

// ── reviews.json ───────────────────────────────
// Раньше здесь стоял кэш (if (cache.reviews) return cache.reviews) —
// имело смысл на сайте, где reviews.json тянется по сети и весит
// четверть мегабайта. В десктопном приложении это локальный файл на
// диске: перечитать его — копейки, а не "лишний запрос в интернет".
// Поэтому теперь fetchReviews() всегда читает заново, без кэша и без
// инвалидации — целый класс багов "забыли сбросить кэш" в местах,
// которые меняют reviews.json, этим просто снят. cache.reviews ниже
// остаётся не как кэш, а как последний прочитанный список — на него
// синхронно смотрят между вызовами (cards.js, stats.js и т.п.), пока
// свежий await fetchReviews() не перезапишет его снова.
async function fetchReviews() {
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

// Вкладка под #shell-root сама не перечитается, пока открыт отдельный
// маршрут (router.js) поверх неё: её рельса не разбирается, она
// просто спрятана через .hidden и обновится только по новому клику
// (switchTab() в index.html). Поэтому после любой правки, которая
// меняет reviews.json/favorites.json где-то в своём маршруте (add.js,
// settings-edit.js, import.js и т.д.), нужно явно дёрнуть load-функцию
// текущей открытой вкладки — она сама пойдёт за свежими данными,
// кэшировать сброс уже нечего.
function refreshOpenReviewsTab() {
  const active = document.querySelector("#shell-root .tab-content:not(.hidden)");
  if (!active) return;
  if (active.id === "tab-now") loadNow();
  if (active.id === "tab-favorites") loadFavorites();
  if (active.id === "tab-reviews") loadReviews();
  if (active.id === "tab-stats") loadStats();
  if (active.id === "tab-tierlist") loadTierlist();
}
