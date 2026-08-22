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
    data.sort((a, b) => new Date(b.date) - new Date(a.date));
    cache.reviews = data;
    return data;
  } catch {
    cache.reviews = [];
    return [];
  }
}
