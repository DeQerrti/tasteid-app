// Часть редактора отзыва (#/add) – см. шапку app/js/routes/add.js про
// разбивку файла. Поиск тайтла по названию в открытых базах и заполнение
// формы выбранным результатом: название, год, тип, формат, обложка (сразу
// с резервной копией, как при вставке ссылки руками) и номера в базах
// (ids – по ним потом сходятся импорт и сравнение паспортов).
//
// Источник – по типу отзыва:
//   аниме                       → AniList (аниме)
//   манга, манхва, маньхуа,
//   ранобэ                      → AniList (манга; страна и формат
//                                 уточняют тип: Корея – манхва и т.д.)
//   фильм                       → TMDB (фильмы)
//   сериал, дорама              → TMDB (сериалы)
//   книга                       → Open Library
//   игры, гача, свои типы       → источника нет
// AniList и Open Library – открытые, без ключа. TMDB – по ключу, который
// вводится в Настройки → Импорт и хранится только на этом устройстве
// (localStorage, см. TMDB_KEY_STORAGE в js/import.js; сам import.js в
// одиночный add.html не подключён, поэтому ключ читается здесь напрямую).
// Наружу уходит только набранное название.

const ED_LOOKUP_TMDB_KEY = "tasteid_tmdb_key";
const ED_LOOKUP_TMDB = "https://api.themoviedb.org/3";
const ED_LOOKUP_TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const ED_LOOKUP_ANILIST = "https://graphql.anilist.co";
let edLookupItems = [];

function edLookupTmdbKey() {
  try {
    return localStorage.getItem(ED_LOOKUP_TMDB_KEY) || "";
  } catch {
    return "";
  }
}

// Какой источник у текущего типа: { id, label } или null.
function edLookupSource(type) {
  if (type === "anime") return { id: "anilist-anime", label: "AniList" };
  if (["manga", "manhwa", "manhua", "novel"].includes(type)) return { id: "anilist-manga", label: "AniList" };
  if (type === "movie") return { id: "tmdb-movie", label: "TMDB" };
  if (type === "show" || type === "dorama") return { id: "tmdb-tv", label: "TMDB" };
  if (type === "book") return { id: "openlibrary", label: "Open Library" };
  return null;
}

// Подпись над полем и доступность – при открытии формы и смене типа
// (syncTypePickerLabel зовёт эту функцию, см. add-type-picker.js).
function edLookupSync() {
  const box = document.getElementById("ed-lookup");
  if (!box) return;
  const type = document.getElementById("f-type")?.value;
  const src = edLookupSource(type);
  const hint = document.getElementById("ed-lookup-hint");
  const input = document.getElementById("ed-lookup-q");
  const btn = document.getElementById("ed-lookup-btn");
  let disabled = false;
  if (!src) {
    hint.textContent = i18n("Для этого типа автоматического поиска нет – обложку можно добавить ссылкой или файлом слева.");
    disabled = true;
  } else if (src.id.startsWith("tmdb") && !edLookupTmdbKey()) {
    hint.textContent = i18n("Для фильмов и сериалов нужен ключ TMDB – его вводят один раз в Настройки → Импорт.");
    disabled = true;
  } else {
    hint.textContent = i18n("Тип «{type}» – ищем в {source}. Подставятся название, год, формат, обложка и номер в базе; тип можно сменить ниже.", {
      type: typeof typeLabel === "function" ? typeLabel(type) : type,
      source: src.label,
    });
  }
  input.disabled = disabled;
  btn.disabled = disabled;
  if (box.dataset.src !== (src?.id || "")) {
    document.getElementById("ed-lookup-results").innerHTML = "";
    box.dataset.src = src?.id || "";
  }
}

const ED_ANILIST_QUERY = `
  query ($q: String, $type: MediaType) {
    Page(perPage: 10) {
      media(search: $q, type: $type, sort: SEARCH_MATCH) {
        id
        idMal
        type
        format
        countryOfOrigin
        episodes
        chapters
        title { romaji english native }
        startDate { year }
        coverImage { extraLarge large }
      }
    }
  }`;

async function edLookupFetch(src, q) {
  if (src.id.startsWith("anilist")) {
    const res = await fetch(ED_LOOKUP_ANILIST, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: ED_ANILIST_QUERY, variables: { q, type: src.id === "anilist-anime" ? "ANIME" : "MANGA" } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.errors?.[0]?.message || i18n("Сервер ответил {status}", { status: res.status }));
    return (data.data?.Page?.media || []).map((m) => {
      // Тип записи – по стране и формату: корейская манга – манхва,
      // китайская – маньхуа, NOVEL – ранобэ.
      let type = m.type === "ANIME" ? "anime" : "manga";
      if (m.type === "MANGA") {
        if (m.format === "NOVEL") type = "novel";
        else if (m.countryOfOrigin === "KR") type = "manhwa";
        else if (m.countryOfOrigin === "CN" || m.countryOfOrigin === "TW") type = "manhua";
      }
      const n = m.type === "ANIME" ? m.episodes : m.chapters;
      const unit =
        m.type === "ANIME"
          ? [i18n("серия"), i18n("серии"), i18n("серий")]
          : [i18n("глава"), i18n("главы"), i18n("глав")];
      return {
        title: m.title?.romaji || m.title?.english || m.title?.native || "",
        sub: [m.title?.english && m.title.english !== m.title?.romaji ? m.title.english : "", m.startDate?.year].filter(Boolean).join(" · "),
        year: m.startDate?.year || null,
        type,
        format: n ? `${n} ${plural(n, unit)}` : "",
        cover: m.coverImage?.extraLarge || m.coverImage?.large || "",
        ids: { anilist: m.id, ...(m.idMal ? { mal: m.idMal } : {}) },
      };
    });
  }
  if (src.id.startsWith("tmdb")) {
    const kind = src.id === "tmdb-movie" ? "movie" : "tv";
    const params = new URLSearchParams({ api_key: edLookupTmdbKey(), query: q, language: "ru-RU" });
    const res = await fetch(`${ED_LOOKUP_TMDB}/search/${kind}?${params}`);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error(i18n("TMDB не принял ключ – проверьте его в Настройки → Импорт."));
    if (!res.ok) throw new Error(data.status_message || i18n("Сервер ответил {status}", { status: res.status }));
    return (data.results || []).slice(0, 10).map((r) => {
      const date = kind === "movie" ? r.release_date : r.first_air_date;
      const year = date ? Number(date.slice(0, 4)) : null;
      const title = (kind === "movie" ? r.title : r.name) || "";
      const original = (kind === "movie" ? r.original_title : r.original_name) || "";
      return {
        title,
        sub: [original && original !== title ? original : "", year].filter(Boolean).join(" · "),
        year,
        type: null, // тип оставляем выбранным (фильм / сериал / дорама)
        format: "",
        cover: r.poster_path ? `${ED_LOOKUP_TMDB_IMG}${r.poster_path}` : "",
        ids: { tmdb: r.id },
      };
    });
  }
  // Open Library
  const params = new URLSearchParams({ q, limit: "10", fields: "key,title,author_name,first_publish_year,cover_i,isbn" });
  const res = await fetch(`https://openlibrary.org/search.json?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(i18n("Сервер ответил {status}", { status: res.status }));
  return (data.docs || []).map((d) => {
    const isbn13 = (d.isbn || []).find((x) => /^\d{13}$/.test(x));
    return {
      title: d.title || "",
      sub: [(d.author_name || []).slice(0, 2).join(", "), d.first_publish_year].filter(Boolean).join(" · "),
      year: d.first_publish_year || null,
      type: null,
      format: "",
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : "",
      ids: isbn13 ? { isbn13 } : {},
    };
  });
}

async function edLookupSearch() {
  const input = document.getElementById("ed-lookup-q");
  const q = input.value.trim() || document.getElementById("f-title").value.trim();
  const box = document.getElementById("ed-lookup-results");
  const btn = document.getElementById("ed-lookup-btn");
  const src = edLookupSource(document.getElementById("f-type").value);
  if (!q || !src) return;
  if (!input.value.trim()) input.value = q;
  btn.disabled = true;
  box.innerHTML = `<div class="ed-lookup-msg">${i18n("Ищем…")}</div>`;
  try {
    edLookupItems = await edLookupFetch(src, q);
    edLookupRender();
  } catch (err) {
    box.innerHTML = `<div class="ed-lookup-msg err">${esc(i18n("{source} не ответил: ", { source: src.label }) + err.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

function edLookupRender() {
  const box = document.getElementById("ed-lookup-results");
  if (!edLookupItems.length) {
    box.innerHTML = `<div class="ed-lookup-msg">${i18n("Ничего не нашлось")}</div>`;
    return;
  }
  box.innerHTML = edLookupItems
    .map(
      (it, i) => `<button type="button" class="ed-lookup-item" onclick="edLookupApply(${i})">
        ${it.cover ? `<img src="${esc(it.cover)}" alt="" loading="lazy">` : `<span class="ed-lookup-nocover">?</span>`}
        <span class="ed-lookup-title">${esc(it.title)}</span>
        ${it.sub ? `<span class="ed-lookup-sub">${esc(it.sub)}</span>` : ""}
      </button>`
    )
    .join("");
}

function edLookupApply(index) {
  const it = edLookupItems[index];
  if (!it) return;
  if (it.title) document.getElementById("f-title").value = it.title;
  if (it.year) document.getElementById("f-year").value = String(it.year);
  if (it.format && !document.getElementById("f-format").value.trim()) {
    document.getElementById("f-format").value = it.format;
  }
  if (it.type && it.type !== document.getElementById("f-type").value) selectTypePicker(it.type);
  if (it.cover) {
    openCoverPanel();
    const cover = document.getElementById("f-cover");
    cover.value = it.cover;
    document.getElementById("f-cover-backup").value = "";
    previewCover(it.cover);
    scheduleBackupCover();
  }
  // Номера в базах – к уже сохранённым, ничего не затирая (mergeIds,
  // js/external-ids.js); при сохранении их подхватит saveReview().
  editingIds = mergeIds(editingIds, it.ids);
  document.getElementById("ed-lookup-results").innerHTML = "";
  markAddDirty();
  renderEdPreview();
  setStatus("ok", i18n("Заполнено из поиска – проверьте и сохраните."));
}
