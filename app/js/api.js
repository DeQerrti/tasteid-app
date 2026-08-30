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

// ── site-settings.json (для чтения на лету — не путать с
// currentSiteSettings() в config.js, та всегда идёт в сеть заново,
// потому что нужна экрану настроек перед записью поверх свежего
// файла; здесь, наоборот, кэш уместен — вкладка «Отзывы» открывается
// куда чаще, чем меняются настройки) ──
async function fetchSiteSettings() {
  if (cache.siteSettings) return cache.siteSettings;
  try {
    const res = await fetch("/site-settings.json");
    if (!res.ok) throw new Error();
    cache.siteSettings = await res.json();
    return cache.siteSettings;
  } catch {
    cache.siteSettings = {};
    return cache.siteSettings;
  }
}
