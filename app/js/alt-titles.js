// ══════════════════════════════════════════════
//  ALT-TITLES – оригинальные названия тайтлов для поиска
//  Зависит от: utils.js (fetchExternal, shikimoriFetch, postRecordOrThrow),
//  cards.js (normTitle), api.js (cache, fetchReviews), config.js (isAdmin).
//
//  Поиск в «Отзывах» и «Статусах» шёл только по названию, как его записал
//  человек: «Frieren» не находило «Фрирен», «Атака титанов» – «Shingeki no
//  Kyojin» (owner, ноябрь 2026). Раз за запуск, в фоне, для записей, у
//  которых ещё нет alt_titles (или сменился номер тайтла), спрашиваем:
//    – AniList по номеру AniList: ромадзи, английское, родное, синонимы;
//    – Шикимори по номеру MAL: русское и ромадзи;
//    – аниме, мангу, манхву, маньхуа и ранобэ без номера – поиском по
//      названию на Шикимори, фильмы и сериалы – на TMDB (если в импорте
//      введён ключ). Совпадение принимается только с тем же годом выхода.
//      Найденный так номер в ids НЕ пишется: угаданный по названию номер
//      мог бы оказаться чужим, а по ids импорт склеивает записи.
//  Записывается пачкой одним запросом (/api/set-alt-titles в core/api.js).
//  На экране ничего не появляется – названия видит только поиск
//  (reviewSearchText в utils.js). Ошибка сети – молча до следующего запуска.
// ══════════════════════════════════════════════

const ALT_TMDB_TYPES = { movie: "movie", show: "tv", dorama: "tv" };
const ALT_SHIKI_KIND = { anime: "animes", manga: "mangas", manhwa: "mangas", manhua: "mangas", novel: "ranobe" };

// Откуда брать названия для этой записи; null – неоткуда. Сменился номер
// (новым поиском тайтла в редакторе) или название с годом у записи без
// номера – src другой, и названия спрашиваются заново.
function altTitlesSrc(r) {
  const ids = r.ids || {};
  if (ids.anilist || (ids.mal && ALT_SHIKI_KIND[r.type])) {
    return [ids.anilist ? `anilist:${ids.anilist}` : "", ids.mal ? `mal:${ids.mal}` : ""].filter(Boolean).join("|");
  }
  if (ALT_TMDB_TYPES[r.type] && ids.tmdb) return `tmdb:${ids.tmdb}`;
  if (ALT_TMDB_TYPES[r.type] || ALT_SHIKI_KIND[r.type]) return `q:${r.title}|${r.year || ""}`;
  return null;
}

const altSleep = (ms) => new Promise((done) => setTimeout(done, ms));
const altYear = (r) => parseInt(r.year, 10) || null;

// Ответы – { main, extra }: main – русское, ромадзи, английское, родное;
// extra – синонимы AniList (там бывают переводы на двадцать языков, и
// без разделения они вытесняли русское из предела в 20 названий).
async function altFromAnilist(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const res = await fetchExternal("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: "query($ids:[Int]){Page(perPage:50){media(id_in:$ids){id title{romaji english native} synonyms}}}",
        variables: { ids: ids.slice(i, i + 50) },
      }),
    });
    if (!res.ok) throw new Error(`AniList ${res.status}`);
    const data = await res.json();
    for (const m of data.data?.Page?.media || []) {
      out.set(m.id, { main: [m.title?.romaji, m.title?.english, m.title?.native], extra: m.synonyms || [] });
    }
  }
  return out;
}

async function altFromShikimori(kind, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    if (i) await altSleep(700); // предел Шикимори – 5 запросов в секунду, 90 в минуту
    const res = await shikimoriFetch(`/api/${kind}?ids=${ids.slice(i, i + 50).join(",")}&limit=50`);
    if (!res.ok) throw new Error(`Shikimori ${res.status}`);
    for (const m of await res.json()) out.set(m.id, { main: [m.russian, m.name], extra: [] });
  }
  return out;
}

// Без номера – поиском по названию, только с тем же годом выхода.
async function altSearchShikimori(r) {
  const year = altYear(r);
  if (!year) return null; // без года совпадение не проверить – лучше ничего
  const kind = ALT_SHIKI_KIND[r.type];
  const res = await shikimoriFetch(`/api/${kind}?search=${encodeURIComponent(r.title)}&limit=10`);
  if (!res.ok) throw new Error(`Shikimori ${res.status}`);
  const m = (await res.json()).find((x) => Number(String(x.aired_on || "").slice(0, 4)) === year);
  return m ? { main: [m.russian, m.name], extra: [] } : null;
}

async function altFromTmdb(r, key) {
  const kind = ALT_TMDB_TYPES[r.type];
  const base = "https://api.themoviedb.org/3";
  const pick = (m) => ({
    main: [kind === "movie" ? m.title : m.name, kind === "movie" ? m.original_title : m.original_name],
    extra: [],
  });
  if (r.ids?.tmdb) {
    const params = new URLSearchParams({ api_key: key, language: "en-US" });
    const res = await fetchExternal(`${base}/${kind}/${r.ids.tmdb}?${params}`);
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    return pick(await res.json());
  }
  const year = altYear(r);
  if (!year) return null;
  const params = new URLSearchParams({ api_key: key, query: r.title, language: "en-US" });
  const res = await fetchExternal(`${base}/search/${kind}?${params}`);
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  const found = ((await res.json()).results || []).find((m) => {
    const date = kind === "movie" ? m.release_date : m.first_air_date;
    return date && Number(date.slice(0, 4)) === year;
  });
  return found ? pick(found) : null;
}

let altTitlesRunning = false;

async function altTitlesFill() {
  if (altTitlesRunning || typeof isAdmin !== "function" || !isAdmin() || navigator.onLine === false) return;
  altTitlesRunning = true;
  try {
    const list = cache.reviews || (await fetchReviews());
    const todo = new Set(
      list.filter((r) => {
        const src = altTitlesSrc(r);
        return src && r.alt_titles?.src !== src;
      })
    );
    if (!todo.size) return;

    const main = new Map(); // запись → русское и основные названия
    const extra = new Map(); // запись → синонимы
    const add = (r, n) => {
      main.set(r, [...(main.get(r) || []), ...n.main]);
      extra.set(r, [...(extra.get(r) || []), ...n.extra]);
    };
    // Сервис не ответил – запись в этот раз не записываем вовсе: иначе она
    // осталась бы отмеченной «спрошено» с пустым списком навсегда.
    const skip = (recs) => recs.forEach((r) => todo.delete(r));

    const al = [...todo].filter((r) => r.ids?.anilist);
    if (al.length) {
      const got = await altFromAnilist([...new Set(al.map((r) => r.ids.anilist))]).catch(() => null);
      if (got) for (const r of al) add(r, got.get(r.ids.anilist) || { main: [], extra: [] });
      else skip(al);
    }
    for (const kind of new Set(Object.values(ALT_SHIKI_KIND))) {
      const recs = [...todo].filter((r) => r.ids?.mal && ALT_SHIKI_KIND[r.type] === kind);
      if (!recs.length) continue;
      await altSleep(700);
      const got = await altFromShikimori(kind, [...new Set(recs.map((r) => r.ids.mal))]).catch(() => null);
      if (got) for (const r of recs) add(r, got.get(r.ids.mal) || { main: [], extra: [] });
      else skip(recs);
    }

    const key = localStorage.getItem("tasteid_tmdb_key") || "";
    for (const r of [...todo].filter((x) => !x.ids?.anilist && !x.ids?.mal)) {
      const viaTmdb = !!ALT_TMDB_TYPES[r.type];
      if (viaTmdb && !key) {
        skip([r]); // без ключа не спрашивали – спросим, когда он появится
        continue;
      }
      try {
        await altSleep(viaTmdb ? 150 : 700);
        const hit = viaTmdb ? await altFromTmdb(r, key) : await altSearchShikimori(r);
        if (hit) add(r, hit);
      } catch {
        skip([r]);
      }
    }

    const items = [...todo].map((r) => {
      const seen = new Set([normTitle(r.title)]);
      const names = [];
      for (const n of [...(main.get(r) || []), ...(extra.get(r) || [])]) {
        const k = normTitle(n);
        if (!n || seen.has(k)) continue;
        seen.add(k);
        names.push(n.trim());
      }
      return { id: r.id, title: r.title, src: altTitlesSrc(r), names: names.slice(0, 20) };
    });
    if (!items.length) return;
    await postRecordOrThrow("/api/set-alt-titles", { items });
    // Поиск должен заработать сразу, без перезапуска: подкладываем то же
    // самое в уже загруженный список.
    for (const it of items) {
      const r = list.find((x) => x.id === it.id);
      if (!r) continue;
      r.alt_titles = { src: it.src, names: it.names };
    }
  } catch (err) {
    console.warn("alt-titles:", err?.message || err);
  } finally {
    altTitlesRunning = false;
  }
}

// Раз за запуск, когда приложение уже показано и всё нужное загружено.
document.addEventListener("site-labels-ready", () => setTimeout(altTitlesFill, 4000), { once: true });
