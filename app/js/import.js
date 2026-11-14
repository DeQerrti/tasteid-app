// ══════════════════════════════════════════════
//  IMPORT – перенос списка из чужих сервисов
//  Зависит от: utils.js, config.js, api.js, import-formats.js
//
//  Рассчитано на человека, который переезжает со своим списком в
//  несколько сотен записей. Поэтому импорт не «кнопка вслепую», а три
//  шага: загрузил файл – увидел, что нашлось, и сам решил, как его
//  оценки и статусы ложатся в твои – подтвердил. Сюрпризов быть не
//  должно: чужая выгрузка попадает в паспорт только после явного да.
//
//  Разбор форматов живёт отдельно, в js/import-formats.js: сервисов
//  много, у каждого свои причуды, и держать их вперемешку с экраном
//  было бы больно. Здесь – только то, что человек видит и решает.
// ══════════════════════════════════════════════

const IMPORT_ANILIST_ENDPOINT = "https://graphql.anilist.co";
const IMPORT_BATCH = 50; // AniList отдаёт до 50 записей за страницу

const IMPORT_TMDB_ENDPOINT = "https://api.themoviedb.org/3";
const IMPORT_TMDB_IMAGES = "https://image.tmdb.org/t/p/w500";
const IMPORT_TMDB_BATCH = 5; // у TMDB лимит по запросам в секунду, а не по пачке

// Ключ TMDB лежит в localStorage этого устройства и больше нигде.
//
// Соблазн положить его в site-settings.json велик – он бы синхронизировался
// между устройствами сам. Но репозиторий сайта открытый, и всё, что в нём
// сохраняется, немедленно становится публичным: ключ утёк бы в первый же
// коммит и остался бы в истории навсегда. Поэтому он живёт только здесь,
// ценой того, что на новом устройстве его придётся ввести заново.
const TMDB_KEY_STORAGE = "tasteid_tmdb_key";

// Служебное значение в списке статусов: «здесь и сейчас завести свой».
// Чаще всего это «Брошено» – статуса с таким смыслом у большинства нет,
// а записи под ним терять жалко. Уводить человека в другой раздел
// нельзя: разобранный файл живёт в памяти страницы и при уходе пропадёт.
const NEW_STATUS_VALUE = "__new__";

let importData = null; // разобранная выгрузка
let importStep = "file"; // file | columns | map | done
// Шаг «Что в каких столбцах» (незнакомый файл): таблица и решения по ней.
let importTable = null; // { name, kind, headers, rows } – readImportTable
let importRoles = []; // роль каждого столбца (IMPORT_COLUMN_ROLES или "")
let importTypeMap = {}; // значение из столбца типа → тип в паспорте
let importTypeAll = ""; // тип для всех записей, если столбца типа нет
let importBusy = false;
let importStatusMap = {};
let importScoreMap = {};
let importSkipExisting = true;
let importBackupCovers = true; // сохранить копии обложек новых записей на диск

// ── Умолчания для соответствий ─────────────────
// Расставляются сами, но человек их правит: смысл шага именно в этом.

function defaultStatusMap() {
  const mine = activeStatusBuckets().map((b) => b.key);
  const has = (key) => mine.includes(key);
  return {
    watching: has("current") ? "current" : mine[0] || "completed",
    completed: "completed",
    onhold: has("onhold") ? "onhold" : "completed",
    // «Брошено» у большинства нет – тогда по умолчанию не тащим вовсе,
    // чтобы чужие брошенные не засоряли паспорт молча.
    dropped: has("dropped") ? "dropped" : "",
    plantowatch: has("planning") ? "planning" : "",
  };
}

// Оценки. Шкала нигде не зашита: у MAL десятка, у Goodreads пятёрка,
// у Letterboxd половинки звёзд. Берём значения, которые реально
// встретились в файле, и раскладываем их по полкам пропорционально –
// лучшее к лучшей, худшее к худшей.
function scoresInFile() {
  const values = new Set();
  for (const item of importData.items) {
    if (item.score > 0) values.add(item.score);
  }
  return [...values].sort((a, b) => b - a);
}

function defaultScoreMap() {
  const shelves = GRADE_ORDER;
  const scores = scoresInFile();
  if (!scores.length) return {};

  // Границы берём у сервиса, а не из файла. Иначе у человека, который
  // ставил только 8, 9 и 10, восьмёрка уехала бы на худшую полку –
  // хотя по десятибалльной шкале это «хорошо».
  const max = importData.scaleMax || Math.max(...scores);
  const min = importData.scaleMin ?? Math.min(...scores);
  const span = max - min || 1;

  const map = {};
  for (const score of scores) {
    const position = Math.min(Math.max((max - score) / span, 0), 1); // 0 – лучшее
    const idx = Math.min(Math.round(position * (shelves.length - 1)), shelves.length - 1);
    map[score] = shelves[idx];
  }
  return map;
}

// ── Экран ──────────────────────────────────────

async function loadImport() {
  if (importBusy) return;
  importBusy = true;
  try {
    await fetchReviews();
    renderImport();
  } finally {
    importBusy = false;
  }
}

function renderImport() {
  const box = document.getElementById("importPanel");
  if (!box) return;
  box.innerHTML = importStyles() + (
    importStep === "map" ? importMapHtml() :
    importStep === "columns" && importTable ? importColumnsHtml() :
    importStep === "done" ? importDoneHtml() :
    importFileHtml()
  );
  bindImport();
}

// Что именно сайт принимает и откуда это берётся.
//
// Экран собран по видам (аниме, фильмы, книги, игры, любой файл), у
// каждого источника – карточка с одной строкой «что придёт» и кнопкой;
// по кнопке карточка раскрывается на всю ширину. Открыта одна за раз
// (importOpenCard), иначе с десятком источников экран снова стал бы
// простынёй – ровно от неё и уходили.
//
// Инструкции внутри – нарочно по шагам, вплоть до пункта меню и имени
// файла: «выгрузи список» – совет, по которому человек, ни разу этого не
// делавший, не сдвинется с места. Сервисы прячут экспорт по-разному, и
// половина отдаёт архив вместо файла – об этом надо сказать заранее, а не
// ошибкой разбора.
//
// planned – источник ещё не сделан: карточка видна приглушённой, без
// кнопки, чтобы было понятно, что будет дальше.

let importOpenCard = null;

function importGroups() {
  const nickSteps = (site, address) => [
    i18n("Откройте свой профиль на {site}.", { site }),
    `${i18n("Ник – последнее слово в адресе страницы:")} ${esc(address)}<strong>${i18n("ник")}</strong>`,
    i18n("Список должен быть открыт – если в настройках профиля он закрыт, снаружи его не видно."),
  ];
  return [
    {
      title: i18n("Аниме и манга"),
      cards: [
        {
          id: "anilist",
          name: "AniList",
          kind: "nick",
          what: i18n("Список со статусами, оценками и датами. И «Любимое» профиля – персонажи и люди с галочками."),
          steps: nickSteps("anilist.co", "anilist.co/user/"),
          placeholder: i18n("ник на AniList"),
        },
        {
          id: "shiki",
          name: i18n("Шикимори"),
          kind: "nick",
          what: i18n("Список со статусами и оценками. И «Любимое» профиля – персонажи и люди с галочками."),
          steps: [
            ...nickSteps("shikimori.io", "shikimori.io/"),
            i18n("Можно вставить и ссылку на профиль целиком – ник из неё возьмётся сам."),
          ],
          note: i18n("Личных дат начала и конца Шикимори по нику не отдаёт – если они нужны, загрузите файл выгрузки."),
          placeholder: i18n("ник на Шикимори"),
        },
        {
          id: "mal",
          name: "MyAnimeList",
          kind: "nick",
          what: i18n("Список со статусами, оценками и датами."),
          steps: nickSteps("myanimelist.net", "myanimelist.net/profile/"),
          placeholder: i18n("ник на MyAnimeList"),
        },
        {
          id: "malfile",
          name: `MyAnimeList · ${i18n("Шикимори")}`,
          kind: "file",
          what: i18n("Файлом выгрузки – если профиль закрыт или нужны личные даты с Шикимори."),
          groups: [
            {
              label: "MyAnimeList",
              steps: [
                i18n("Войдите на myanimelist.net."),
                i18n("Значок профиля вверху справа → Export."),
                i18n("Выберите Anime List или Manga List и нажмите Export My List."),
                i18n("Скачается архив .xml.gz – распакуйте его: нужен файл .xml изнутри."),
                i18n("Выберите этот .xml кнопкой ниже. Для второго списка – повторите."),
              ],
            },
            {
              label: i18n("Шикимори"),
              steps: [
                i18n("Войдите на shikimori.io."),
                i18n("Настройки → Списки → Экспорт."),
                i18n("Выберите формат MyAnimeList – аниме и манга скачаются двумя отдельными файлами."),
                i18n("Загрузите их кнопкой ниже по очереди."),
              ],
            },
          ],
        },
      ],
    },
    {
      title: i18n("Фильмы и сериалы"),
      note: i18n("Постеры к фильмам приходят только с ключом TMDB – он бесплатный."),
      cards: [
        {
          id: "letterboxd",
          name: "Letterboxd",
          kind: "file",
          what: i18n("Оценки, просмотренное и список «посмотреть»."),
          groups: [
            {
              steps: [
                i18n("Войдите на letterboxd.com и откройте letterboxd.com/settings/data."),
                i18n("Нажмите Export Your Data – скачается архив .zip."),
                i18n("Распакуйте его. Внутри нужны три файла: ratings.csv (что оценено), watched.csv (что просмотрено) и watchlist.csv (что в планах)."),
                i18n("Выберите их кнопкой ниже – по одному за раз."),
              ],
            },
          ],
        },
        {
          id: "imdb",
          name: "IMDb",
          kind: "file",
          what: i18n("Оценки и список «посмотреть», фильмы и сериалы. Постер находится точно – по номеру фильма, а не по названию."),
          groups: [
            {
              steps: [
                i18n("Войдите на imdb.com, нажмите на своё имя вверху справа → Your ratings."),
                i18n("Над списком нажмите ⋮ (три точки) → Export – IMDb соберёт файл и пришлёт ссылку на странице imdb.com/exports."),
                i18n("Скачайте оттуда ratings.csv. Для списка «посмотреть» сделайте то же на странице Your watchlist – получится второй файл."),
                i18n("Выберите их кнопкой ниже – по одному за раз. Дата оценки ляжет как дата просмотра: другой у IMDb нет."),
              ],
            },
          ],
        },
        {
          id: "tmdb",
          name: "TMDB",
          kind: "key",
          what: i18n("Не список, а постеры, год и номер фильма – для любого источника выше."),
        },
      ],
    },
    {
      title: i18n("Книги"),
      cards: [
        {
          id: "goodreads",
          name: "Goodreads",
          kind: "file",
          what: i18n("Полки «прочитано», «читаю», «хочу прочитать», оценки и даты прочтения."),
          groups: [
            {
              steps: [
                i18n("Войдите на goodreads.com и откройте goodreads.com/review/import."),
                i18n("Нажмите кнопку Export Library."),
                i18n("Через минуту там же появится ссылка на goodreads_library_export.csv – скачайте файл."),
                i18n("Выберите его кнопкой ниже."),
              ],
            },
          ],
        },
        {
          id: "storygraph",
          name: "StoryGraph",
          kind: "file",
          what: i18n("Прочитанное, читаю, хочу прочитать и брошенное – с оценками, отзывами и датами."),
          groups: [
            {
              steps: [
                i18n("Войдите на app.thestorygraph.com, нажмите на значок профиля → Manage Account."),
                i18n("Внизу страницы нажмите Export StoryGraph Library, а затем Generate export."),
                i18n("Через минуту на той же странице появится ссылка на файл .csv – скачайте его."),
                i18n("Выберите его кнопкой ниже. Тексты отзывов перенесутся только в новые записи – свои уже написанные отзывы импорт не трогает."),
              ],
            },
          ],
        },
      ],
    },
    {
      title: i18n("Игры"),
      cards: [
        {
          id: "steam",
          name: "Steam",
          kind: "key",
          what: i18n("Игры из библиотеки, с обложками. Оценок и статусов у Steam нет – на шаге проверки решите, куда лягут запущенные и нетронутые."),
          steps: [
            i18n("Войдите в Steam в браузере и откройте steamcommunity.com/dev/apikey."),
            i18n("В поле Domain Name впишите что угодно, например tasteid.local, отметьте согласие с условиями и нажмите Register."),
            i18n("Скопируйте ключ из строки Key (32 знака) в поле ниже."),
            i18n("Профиль → Редактировать профиль → Приватность: у «Игровой информации» должно стоять «Открытая»."),
            i18n("Вставьте ссылку на свой профиль – steamcommunity.com/id/… или steamcommunity.com/profiles/…"),
          ],
        },
      ],
    },
    {
      title: i18n("Любое другое приложение"),
      cards: [
        {
          id: "anyfile",
          name: i18n("Файл из любого приложения"),
          kind: "file",
          what: i18n("CSV или JSON из любого приложения – таблицы, заметок, трекера. Знакомые столбцы узнаются сами, остальные покажете вы."),
          groups: [
            {
              steps: [
                i18n("Найдите в своём приложении выгрузку: обычно Настройки → Экспорт, «Резервная копия» или «Скачать данные»."),
                i18n("Если можно выбрать формат – берите CSV (таблица). Excel и Google Таблицы: Файл → Скачать → CSV."),
                i18n("Выберите файл кнопкой ниже."),
                i18n("На следующем шаге покажите, в каком столбце название, в каком оценка и статус – остальное можно не трогать."),
              ],
            },
          ],
        },
      ],
    },
  ];
}

const IMPORT_KIND_LABELS = () => ({ nick: i18n("по нику"), file: i18n("файл"), key: i18n("ключ") });

// steps – строки; в nickSteps одна из них уже размечена (<strong>), поэтому
// остальные экранируются здесь, а размеченная собирается с esc() внутри.
function importStepsHtml(steps) {
  return `<ol class="imp-steps">${steps.map((s) => `<li>${/<strong>/.test(s) ? s : esc(s)}</li>`).join("")}</ol>`;
}

function importCardBodyHtml(card) {
  if (card.id === "steam") return importSteamHtml(card);
  if (card.kind === "key") return importKeysHtml();
  if (card.kind === "nick") {
    return `
      ${importStepsHtml(card.steps)}
      ${card.note ? `<p class="imp-note imp-card-note">${esc(card.note)}</p>` : ""}
      <div class="imp-actions">
        <input type="text" id="imp-${card.id}-user" placeholder="${esc(card.placeholder)}"
               autocomplete="off" spellcheck="false">
        <button class="btn btn-ghost" id="imp-${card.id}-go" type="button">${i18n("Забрать список")}</button>
      </div>
      <div class="status-msg" id="imp-${card.id}-status"></div>`;
  }
  // Файл: формат узнаётся сам, поэтому поле выбора одно и то же у всех
  // файловых карточек – а открыта всегда одна, так что id не повторяется.
  return `
    ${(card.groups || [])
      .map((g) => `${g.label ? `<div class="imp-steps-label">${esc(g.label)}</div>` : ""}${importStepsHtml(g.steps)}`)
      .join("")}
    <div class="imp-actions">
      <label class="btn btn-ghost file-btn">
        <input type="file" id="imp-file" accept=".xml,.csv,.tsv,.txt,.json,application/xml,text/xml,text/csv,application/json">
        <span>${i18n("Выбрать файл")}</span>
      </label>
    </div>
    <div class="status-msg" id="imp-status"></div>`;
}

// Steam: ключ Web API и ссылка на профиль. Ключ живёт в localStorage
// этого устройства (как ключ TMDB) – запоминается после первой удачной
// загрузки, чтобы не вставлять его каждый раз.
const STEAM_KEY_STORAGE = "tasteid_steam_key";

function steamKey() {
  try {
    return localStorage.getItem(STEAM_KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

function importSteamHtml(card) {
  return `
    ${importStepsHtml(card.steps)}
    <div class="imp-key-row imp-steam-row">
      <input type="password" id="imp-steam-key" value="${esc(steamKey())}"
             placeholder="${i18n("ключ Steam, 32 знака")}" autocomplete="off" spellcheck="false">
    </div>
    <div class="imp-actions">
      <input type="text" id="imp-steam-user" placeholder="${i18n("ссылка на профиль Steam")}"
             autocomplete="off" spellcheck="false">
      <button class="btn btn-ghost" id="imp-steam-go" type="button">${i18n("Забрать библиотеку")}</button>
    </div>
    <div class="status-msg" id="imp-steam-status"></div>
    <p class="imp-note">${i18n("Ключ хранится только на этом устройстве и уходит только в Steam – как ключ TMDB.")}</p>`;
}

function bindSteamUser() {
  const keyInput = document.getElementById("imp-steam-key");
  const input = document.getElementById("imp-steam-user");
  const btn = document.getElementById("imp-steam-go");
  const status = document.getElementById("imp-steam-status");
  if (!input || !btn || !keyInput) return;

  const go = async () => {
    const key = keyInput.value.trim();
    const profile = input.value.trim();
    if (!key) { keyInput.focus(); return; }
    if (!profile) { input.focus(); return; }
    if (importBusy) return;
    importBusy = true;
    btn.disabled = true;
    status.className = "status-msg";
    status.textContent = i18n("Спрашиваем Steam…");
    try {
      const res = await fetch("/api/steam-library", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, profile }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) throw new Error(data?.error || i18n("Steam ответил {status}", { status: res.status }));
      try {
        localStorage.setItem(STEAM_KEY_STORAGE, key);
      } catch {
        // приватный режим – ключ придётся вставить ещё раз
      }
      const parsed = parseSteamLibrary(data.games);
      parsed.byName = true; // не файл: экран соответствий говорит об этом иначе
      if (!parsed.items.length) throw new Error(i18n("В библиотеке этого профиля нет ни одной игры."));
      await startMapping(parsed);
    } catch (err) {
      status.className = "status-msg err";
      status.textContent = err.message;
    } finally {
      importBusy = false;
      btn.disabled = false;
    }
  };

  btn.addEventListener("click", go);
  for (const el of [keyInput, input]) {
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      go();
    });
  }
}

function importCardHtml(card) {
  const open = importOpenCard === card.id && !card.planned;
  const keyOn = card.id === "tmdb" && tmdbKey();
  const kinds = IMPORT_KIND_LABELS();
  return `<article class="imp-card${open ? " is-open" : ""}${card.planned ? " is-planned" : ""}" data-imp-card="${card.id}">
    <div class="imp-card-head">
      <span class="imp-card-name">${esc(card.name)}</span>
      <span class="imp-card-kind">${esc(kinds[card.kind] || "")}</span>
      ${card.planned ? `<span class="imp-card-badge">${i18n("в планах")}</span>` : ""}
      ${keyOn ? `<span class="imp-card-badge is-on">${i18n("подключён")}</span>` : ""}
    </div>
    <p class="imp-card-what">${esc(card.what)}</p>
    ${
      card.planned
        ? ""
        : `<button class="btn btn-ghost imp-card-open" type="button" data-imp-open="${card.id}" aria-expanded="${open}">${
            open ? i18n("Свернуть") : card.id === "tmdb" ? i18n("Ключ") : i18n("Импорт")
          }</button>`
    }
    ${open ? `<div class="imp-card-body">${importCardBodyHtml(card)}</div>` : ""}
  </article>`;
}

function importFileHtml() {
  return `
    <p class="panel-intro">
      ${i18n("Перенесите в паспорт то, что уже ведёте где-то ещё. Откройте нужный сервис – внутри по шагам написано, куда нажать и что выбрать.")}
    </p>
    ${importGroups()
      .map(
        (group) => `
      <h2 class="section-h imp-group">${esc(group.title)}</h2>
      <div class="imp-cards"><div class="imp-cards-grid">${group.cards.map(importCardHtml).join("")}</div></div>
      ${group.note ? `<p class="imp-note imp-group-note">${esc(group.note)}</p>` : ""}`
      )
      .join("")}
    <p class="imp-note imp-foot">
      ${i18n("Ничего не сохранится, пока вы не подтвердите: сначала покажем, что нашлось, и как чужие оценки и статусы лягут на ваши. Что уже есть в паспорте, по умолчанию пропускается – без дублей и перезаписи. Файл разбирается прямо здесь, на этом устройстве, и никуда не отправляется.")}
    </p>`;
}

// ── Ключи сервисов ─────────────────────────────
// Ключ нужен ровно один и ровно для одного: обложек к фильмам. Всё
// остальное сайт добирает бесплатно и молча – см. блок «Обложки» ниже.

function tmdbKey() {
  try {
    return localStorage.getItem(TMDB_KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

function saveTmdbKey(value) {
  try {
    if (value) localStorage.setItem(TMDB_KEY_STORAGE, value);
    else localStorage.removeItem(TMDB_KEY_STORAGE);
  } catch {
    // Приватный режим – ключ проживёт до перезагрузки страницы, и ладно.
  }
}

// Ключ проверяем сразу, а не в момент импорта: узнать об опечатке через
// двести запросов и список без обложек – худший из возможных вариантов.
async function checkTmdbKey(key) {
  const res = await fetch(`${IMPORT_TMDB_ENDPOINT}/configuration?api_key=${encodeURIComponent(key)}`);
  if (res.status === 401) throw new Error(i18n("TMDB не узнал этот ключ. Проверьте, что скопирован он целиком."));
  if (!res.ok) {
    throw new Error(i18n("TMDB ответил {status}. Попробуйте ещё раз через минуту.", { status: res.status }));
  }
  return true;
}

// Тело карточки TMDB (раньше – раскрывашка «Ключи сервисов»).
function importKeysHtml() {
  const key = tmdbKey();
  return `
    <p class="imp-note">
      ${i18n("Без всяких ключей сайт уже достаёт обложки аниме и манги (у AniList) и обложки книг (у Open Library) – там их отдают всем. Ключ нужен только для фильмов: единственная открытая база с постерами, TMDB, пускает по ключу. Ключ бесплатный и выдаётся сразу.")}
    </p>
    <ol class="imp-steps">
      <li>${i18n("Заведите аккаунт на themoviedb.org и подтвердите почту.")}</li>
      <li>${i18n("Настройки профиля → раздел API → Request an API Key.")}</li>
      <li>${i18n("Выберите тип Developer, примите условия и заполните короткую анкету (в поле о цели использования достаточно написать, что ведёшь личный список просмотренного).")}</li>
      <li>${i18n("Ключ появится тут же, в строке API Key (v3 auth) – скопируйте его сюда целиком.")}</li>
    </ol>
    <div class="imp-key-row">
      <input type="password" id="imp-tmdb-key" value="${esc(key)}"
             placeholder="${i18n("ключ v3, 32 знака")}" autocomplete="off" spellcheck="false">
      <button class="btn btn-ghost" id="imp-tmdb-save" type="button">${i18n("Проверить и сохранить")}</button>
      ${key ? `<button class="btn btn-ghost" id="imp-tmdb-clear" type="button">${i18n("Убрать")}</button>` : ""}
    </div>
    <div class="status-msg" id="imp-key-status"></div>
    <p class="imp-note imp-key-warn">
      ${i18n("Ключ хранится только на этом устройстве и никуда не уходит: ни на сервер сайта, ни в его файлы. Причина простая – репозиторий сайта открытый, и всё, что сохраняется в настройках, видно любому. Обратная сторона: на другом устройстве ключ придётся ввести заново.")}
    </p>`;
}

// Что из выгрузки уже есть в паспорте.
//
// Сначала по номерам – это не ошибается никогда. Но у Letterboxd
// номеров нет вовсе, так что для фильмов остаётся название с годом.
// Для фильма это приемлемо: у него одно каноническое название и один
// год выхода, в отличие от аниме, где под одним именем идут три
// сезона (см. историю с «Jujutsu Kaisen» в js/passports.js).
function importMatchKeys(item) {
  const keys = [];
  for (const [base, value] of Object.entries(item.ids || {})) {
    if (value) keys.push(`${base}:${value}`);
  }
  const year = item.year ? String(item.year).slice(0, 4) : "";
  keys.push(`t:${normTitle(item.title)}|${item.type || ""}|${year}`);
  return keys;
}

function splitImportItems() {
  // Индекс своих отзывов. Неоднозначные ключи выбрасываем: лучше
  // посчитать запись новой, чем приписать чужую оценку не тому тайтлу.
  const index = new Map();
  const ambiguous = new Set();
  for (const r of cache.reviews || []) {
    for (const key of importMatchKeys(r)) {
      if (index.has(key) && index.get(key) !== r) ambiguous.add(key);
      else index.set(key, r);
    }
  }
  for (const key of ambiguous) index.delete(key);

  const fresh = [];
  const existing = [];
  for (const item of importData.items) {
    const hit = importMatchKeys(item).some((k) => index.has(k));
    (hit ? existing : fresh).push(item);
  }
  return { fresh, existing };
}

function importMapHtml() {
  const { fresh, existing } = splitImportItems();
  const byStatus = {};
  for (const item of importData.items) {
    const key = item.status || "–";
    byStatus[key] = (byStatus[key] || 0) + 1;
  }
  const scored = importData.items.filter((i) => i.score > 0).length;

  // У «любого файла» статусы – значения из самого файла (statusKeys),
  // у остальных источников – общие пять.
  const statusRows = (importData.statusKeys || Object.keys(IMPORT_STATUS_KEYS))
    .filter((key) => byStatus[key])
    .map((key) => `
      <div class="imp-row" id="imp-statusrow-${key}">
        <div class="imp-from">${esc(importData.statusLabels?.[key] || IMPORT_STATUS_KEYS[key])} <span class="imp-count">${byStatus[key]}</span></div>
        <div class="imp-arrow">→</div>
        <select class="imp-select" data-status="${key}">
          <option value="">${i18n("не импортировать")}</option>
          <option value="completed"${importStatusMap[key] === "completed" ? " selected" : ""}>${esc(siteLabel("statuses", "archive", i18n("Архив")))}</option>
          ${activeStatusBuckets().map((b) =>
            `<option value="${esc(b.key)}"${importStatusMap[key] === b.key ? " selected" : ""}>${esc(b.label)}</option>`
          ).join("")}
          <option value="${NEW_STATUS_VALUE}">${i18n("+ завести свой статус…")}</option>
        </select>
      </div>
      <div class="imp-newstatus hidden" id="imp-newstatus-${key}">
        <input type="text" id="imp-newstatus-name-${key}" placeholder="${i18n("Например: Брошено")}" maxlength="40">
        <button class="btn btn-ghost" data-create-status="${key}" type="button">${i18n("Завести")}</button>
        <button class="btn btn-ghost" data-cancel-status="${key}" type="button">${i18n("Отмена")}</button>
      </div>`).join("");

  const scoreRows = scoresInFile().map((score) => {
    const n = importData.items.filter((i) => i.score === score).length;
    return `
      <div class="imp-row">
        <div class="imp-from">${esc(String(score))} <span class="imp-count">${n}</span></div>
        <div class="imp-arrow">→</div>
        <select class="imp-select" data-score="${esc(String(score))}">
          <option value="">${i18n("без оценки")}</option>
          ${GRADE_ORDER.map((key) =>
            `<option value="${esc(key)}"${importScoreMap[score] === key ? " selected" : ""}>${esc(GRADES[key]?.name || key)}</option>`
          ).join("")}
        </select>
      </div>`;
  });

  const hasMovies = importData.items.some((i) => i.type === "movie");
  const hasKey = !!tmdbKey();

  const sourceKindLabel = importData.byName ? i18n("Список") : i18n("Узнан формат");
  const itemsKindLabel = importData.byName ? i18n("в списке") : i18n("в выгрузке");

  return `
    <p class="imp-source-line">${sourceKindLabel}: <strong>${esc(importData.source)}</strong></p>
    <div class="imp-summary">
      ${impStat(importData.items.length, itemsKindLabel)}
      ${impStat(fresh.length, i18n("новых"))}
      ${impStat(existing.length, i18n("уже есть"))}
      ${impStat(scored, i18n("с оценкой"))}
    </div>
    ${
      importData.skipped
        ? `<p class="imp-note">${
            importData.statusKeys || importTable
              ? i18n("{v0} записей пропущено – у них нет названия или не выбран тип.", { v0: importData.skipped })
              : i18n("{v0} записей пропущено – у них нет названия.", { v0: importData.skipped })
          }</p>`
        : ""
    }
    ${importData.truncatedNote ? `<p class="imp-note">${esc(importData.truncatedNote)}</p>` : ""}
    ${hasMovies && hasKey ? `<p class="imp-note">${i18n("Постеры к фильмам возьмём у TMDB по названию и году – ключ подключён.")}</p>` : ""}
    ${hasMovies && !hasKey ? `
      <p class="imp-note">
        ${i18n("Обложек у фильмов в выгрузке нет. Без ключа TMDB они приедут без картинок – это не страшно, ключ можно добавить и потом, а обложки подтянуть повторным импортом того же файла. Аниме, манга и книги обложки получат в любом случае.")}
      </p>
      <div class="imp-map-key"><div class="imp-steps-label">${i18n("Ключ TMDB")}</div>${importKeysHtml()}</div>` : ""}

    <h2 class="section-h">${i18n("Статусы")}</h2>
    <p class="panel-intro">${i18n("Слева то, что стоит {v0}, справа – куда это ляжет у вас.", { v0: itemsKindLabel })}</p>
    ${statusRows}

    <h2 class="section-h">${i18n("Оценки")}</h2>
    <p class="panel-intro">
      ${i18n("Шкала сервиса (от {v0} до {v1}) разложена на ваши полки поровну. Поправьте, если у вас другое представление о том, что такое «восьмёрка».", { v0: String(importData.scaleMin ?? 1), v1: String(importData.scaleMax ?? 10) })}
    </p>
    ${scoreRows.join("") || `<p class="imp-note">${i18n("В выгрузке нет ни одной оценки.")}</p>`}

    <h2 class="section-h">${i18n("Что уже есть в паспорте")}</h2>
    <div class="imp-row imp-row-plain">
      <label><input type="checkbox" id="imp-skip" ${importSkipExisting ? "checked" : ""}> ${i18n("Не трогать {v0} {v1}, которые уже заведены", { v0: existing.length, v1: plural(existing.length, [i18n("запись"), i18n("записи"), i18n("записей")]) })}</label>
    </div>
    <p class="panel-intro">
      ${i18n("Снятая галочка перезапишет у них статус и оценку значениями из выгрузки. Тексты отзывов не пострадают в любом случае.")}
    </p>

    ${
      fresh.length
        ? `<h2 class="section-h">${i18n("Обложки")}</h2>
    <div class="imp-row imp-row-plain">
      <label><input type="checkbox" id="imp-backup-covers" ${importBackupCovers ? "checked" : ""}> ${i18n("Сохранить копии обложек на этом устройстве")}</label>
    </div>
    <p class="panel-intro">${i18n("Без копий у новых записей останутся только ссылки на чужой сайт – сменит он адреса картинок, обложки пропадут. Копии скачиваются после переноса, по несколько за раз; на сотни записей это займёт несколько минут.")}</p>`
        : ""
    }

    ${importFavHtml()}

    <div class="imp-actions">
      <button class="btn-save" id="imp-run" type="button">${i18n("Перенести в паспорт")}</button>
      <button class="btn btn-ghost" id="imp-cancel" type="button">${i18n("Отмена")}</button>
    </div>
    <div class="status-msg" id="imp-status"></div>`;
}

function importDoneHtml() {
  return `
    <p class="panel-intro">${i18n("Готово.")}</p>
    <div class="imp-summary">
      ${impStat(importData.added, i18n("добавлено"))}
      ${impStat(importData.updated, i18n("обновлено"))}
      ${impStat(importData.untouched, i18n("не тронуто"))}
    </div>
    ${
      importData.coverResult && (importData.coverResult.saved || importData.coverResult.failed)
        ? `<div class="imp-summary">
        ${impStat(importData.coverResult.saved, i18n("копий обложек"))}
        ${importData.coverResult.failed ? impStat(importData.coverResult.failed, i18n("обложек не скачалось")) : ""}
      </div>`
        : ""
    }
    ${
      importData.favResult
        ? `<div class="imp-summary">
        ${impStat(importData.favResult.added, i18n("в «Любимое»"))}
        ${impStat(importData.favResult.hearts, i18n("отмечено ♥"))}
        ${importData.favResult.failed ? impStat(importData.favResult.failed, i18n("не получилось")) : ""}
      </div>`
        : ""
    }
    <div class="imp-actions">
      <button class="btn btn-ghost" id="imp-again" type="button">${i18n("Импортировать ещё файл")}</button>
    </div>`;
}

function impStat(value, label) {
  return `<div class="imp-stat">
    <div class="imp-stat-value">${value}</div>
    <div class="imp-stat-label">${esc(label)}</div>
  </div>`;
}

// ── Заведение статуса на месте ─────────────────

async function createStatusFromImport(malKey) {
  const input = document.getElementById(`imp-newstatus-name-${malKey}`);
  const status = document.getElementById("imp-status");
  const name = input.value.trim();
  if (!name) { input.focus(); return; }

  const existing = activeStatusBuckets().find(
    (b) => b.label.toLowerCase() === name.toLowerCase()
  );
  if (existing) {
    // Такой статус уже есть – просто выбираем его, а не плодим двойник.
    importStatusMap[malKey] = existing.key;
    renderImport();
    return;
  }

  // Ключ строится так же, как в панели «Оценки и статусы», чтобы
  // заведённое отсюда ничем не отличалось от заведённого там.
  const key =
    "status_" +
    name.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "_").slice(0, 30) +
    "_" + Date.now().toString(36).slice(-4);

  status.className = "status-msg";
  status.textContent = `Заводим статус «${name}»…`;
  try {
    const saved = await patchSiteSettings((settings) => {
      const current = settings.statusBuckets?.length
        ? settings.statusBuckets
        : DEFAULT_STATUS_BUCKETS.map((b) => ({ ...b, removable: false }));
      settings.statusBuckets = [...current, { key, label: name, removable: true }];
    });

    // Статус должен появиться сразу и здесь, и на самом сайте.
    window.SITE_STATUS_BUCKETS = saved.statusBuckets;
    // Панель «Оценки и статусы» держит свою копию списка, и её
    // сохранение затёрло бы новый статус. Даём ей знать.
    if (typeof onStatusBucketsChanged === "function") {
      onStatusBucketsChanged(saved.statusBuckets);
    }

    importStatusMap[malKey] = key;
    status.textContent = `Статус «${name}» заведён.`;
    renderImport();
  } catch (err) {
    status.className = "status-msg err";
    status.textContent = `Не получилось завести статус: ${err.message}`;
  }
}

// ── Обложки ────────────────────────────────────
// В выгрузках их нет ни у кого. Что можно достать без ключей:
//
//   аниме и манга – у AniList по номеру MAL, тем же способом, что и
//   scripts/enrich-ids.js; заодно приезжает номер AniList и год;
//
//   книги – прямой ссылкой на Open Library по ISBN, даже без запроса:
//   ?default=false заставляет её отдать 404 вместо пустой картинки,
//   а с битой ссылкой сайт и так умеет (см. imgFallbackAttrs);
//
//   фильмы – только с ключом TMDB. У Letterboxd – по названию с годом:
//   в его выгрузке нет ни номера фильма, ни ссылки на базу. У IMDb –
//   точно, по номеру (tt…), и не только фильмы, но и сериалы. Без
//   ключа приедут без обложек, и это честно сказано на экране.

function openLibraryCover(isbn13) {
  return `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg?default=false`;
}

function tmdbPoster(path) {
  return `${IMPORT_TMDB_IMAGES}${path}`;
}

// Ключ, под которым найденный фильм ждёт своей записи. Название с годом –
// единственное, чем фильм из выгрузки себя называет, так что и здесь то же.
function tmdbCacheKey(item) {
  if (item.ids?.imdb) return `imdb:${item.ids.imdb}`;
  return `${normTitle(item.title)}|${item.year ? String(item.year).slice(0, 4) : ""}`;
}

// Кому искать постер у TMDB: фильмам (по названию) и всему, что пришло
// с номером IMDb (по номеру – там и сериалы).
function wantsTmdb(item) {
  return item.type === "movie" || !!item.ids?.imdb;
}

// Поиск по названию с годом. Год важен: «Дюна» без него – это и 1984-й,
// и 2021-й, и первый в выдаче окажется не тот. Берём первый результат:
// TMDB сортирует по популярности, и при совпадении года это почти всегда
// именно тот фильм.
async function fetchTmdbMeta(items, onProgress) {
  const key = tmdbKey();
  const found = new Map();
  if (!key) return found;

  for (let i = 0; i < items.length; i += IMPORT_TMDB_BATCH) {
    const chunk = items.slice(i, i + IMPORT_TMDB_BATCH);
    onProgress?.(Math.min(i + chunk.length, items.length), items.length);

    await Promise.all(chunk.map(async (item) => {
      try {
        // С номером IMDb – /find: ответ ровно про этот тайтл, фильм это
        // или сериал. Без номера – поиск фильма по названию с годом.
        let hit;
        if (item.ids?.imdb) {
          const params = new URLSearchParams({ api_key: key, external_source: "imdb_id", language: "ru-RU" });
          const res = await fetch(`${IMPORT_TMDB_ENDPOINT}/find/${encodeURIComponent(item.ids.imdb)}?${params}`);
          if (!res.ok) return;
          const body = await res.json();
          hit = body?.movie_results?.[0] || body?.tv_results?.[0];
        } else {
          const params = new URLSearchParams({ api_key: key, query: item.title, language: "ru-RU" });
          const year = item.year ? String(item.year).slice(0, 4) : "";
          if (year) params.set("year", year);
          const res = await fetch(`${IMPORT_TMDB_ENDPOINT}/search/movie?${params}`);
          if (!res.ok) return;
          const body = await res.json();
          hit = body?.results?.[0];
        }
        if (hit) found.set(tmdbCacheKey(item), hit);
      } catch {
        // Сеть отвалилась – этот фильм приедет без постера, остальные нет.
      }
    }));

    // У TMDB лимит около сорока запросов в секунду; пятёрка с паузой в
    // четверть секунды и близко к нему не подходит.
    if (i + IMPORT_TMDB_BATCH < items.length) await new Promise((r) => setTimeout(r, 250));
  }
  return found;
}

async function fetchAnilistMeta(malIds, onProgress) {
  const query = `
    query ($ids: [Int]) {
      Page(perPage: 50) {
        media(idMal_in: $ids) {
          id
          idMal
          coverImage { large }
          startDate { year }
        }
      }
    }`;

  const byMal = new Map();
  for (let i = 0; i < malIds.length; i += IMPORT_BATCH) {
    const chunk = malIds.slice(i, i + IMPORT_BATCH);
    onProgress?.(Math.min(i + chunk.length, malIds.length), malIds.length);
    try {
      const res = await fetch(IMPORT_ANILIST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { ids: chunk } }),
      });
      if (!res.ok) continue;
      const body = await res.json();
      for (const m of body?.data?.Page?.media || []) {
        if (m.idMal) byMal.set(m.idMal, m);
      }
    } catch {
      // Сеть отвалилась – идём дальше без обложек для этой пачки.
    }
    if (i + IMPORT_BATCH < malIds.length) await new Promise((r) => setTimeout(r, 1200));
  }
  return byMal;
}

// ── Список с AniList по нику ───────────────────
// Ключа не нужно: открытый список отдаётся кому угодно. Запроса ровно
// два – на аниме и на мангу; MediaListCollection не разбит на страницы и
// приезжает целиком (у него свой потолок в 11 тысяч записей, до которого
// живому человеку далеко).

const ANILIST_LIST_QUERY = `
  query ($userName: String, $type: MediaType) {
    MediaListCollection(userName: $userName, type: $type) {
      lists {
        isCustomList
        entries {
          status
          score(format: POINT_10)
          repeat
          startedAt { year month day }
          completedAt { year month day }
          media {
            id
            idMal
            type
            format
            countryOfOrigin
            title { romaji english native }
            startDate { year }
            coverImage { large }
          }
        }
      }
    }
  }`;

async function fetchAnilistUserList(userName, onProgress) {
  const collections = [];
  const types = ["ANIME", "MANGA"];

  for (const type of types) {
    onProgress?.(type);
    let res;
    try {
      res = await fetch(IMPORT_ANILIST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: ANILIST_LIST_QUERY, variables: { userName, type } }),
      });
    } catch {
      // Здесь ловится и настоящий обрыв сети, и блокировка браузером
      // из-за CORS – а её отдаёт сам AniList, когда у них на стороне
      // проблема (например, временное отключение API): в такой момент
      // ответ идёт без заголовков CORS, и fetch() в браузере считает
      // это сетевой ошибкой, хотя интернет ни при чём. Различить эти
      // два случая с клиента нельзя – формулировка ниже честно
      // допускает оба, а не сваливает всё на интернет пользователя.
      throw new Error(
        i18n(
          "Не получилось достучаться до AniList. Проверьте интернет и попробуйте ещё раз – или дело в самом AniList: у них тоже случаются перебои и временные отключения API."
        )
      );
    }

    if (res.status === 429) {
      throw new Error(i18n("AniList просит подождать – слишком много запросов подряд. Попробуйте через минуту."));
    }

    const body = await res.json().catch(() => null);
    const message = body?.errors?.[0]?.message;

    if (message && /not found/i.test(message)) {
      throw new Error(`AniList не знает пользователя «${userName}». Ник нужен тот, что в адресе профиля.`);
    }
    if (message && /private/i.test(message)) {
      throw new Error(`Список у «${userName}» закрыт настройками профиля – снаружи его не видно.`);
    }
    if (message) throw new Error(`AniList ответил: ${message}`);
    if (!res.ok) throw new Error(`AniList ответил ${res.status}. Попробуйте ещё раз через минуту.`);

    collections.push(body?.data?.MediaListCollection);
  }

  return collections;
}

// ── Список и избранное с Шикимори по нику ──────
// Ключа не нужно, CORS открыт – спрашиваем прямо отсюда, как AniList.
// Разбор списка – parseShikimoriRates в js/import-formats.js.
//
// У Шикимори жёсткий предел: 5 запросов в секунду и 90 в минуту. Список
// – это два-три запроса, а вот избранное – по запросу на каждого
// персонажа и человека (в общем ответе нет ни тайтлов, ни сэйю, а без
// них не к чему привязывать). Поэтому между запросами пауза, а на 429
// – подождать и повторить, а не сдаться.

const SHIKIMORI_API = `${SHIKIMORI_ORIGIN}/api`;
const SHIKIMORI_PAGE = 5000; // больше за страницу Шикимори не отдаёт
const SHIKIMORI_MAX_PAGES = 10; // 50 тысяч записей – живому человеку хватит
const SHIKIMORI_GAP_MS = 700; // ≈85 запросов в минуту – под пределом в 90

const shikimoriPause = (ms = SHIKIMORI_GAP_MS) => new Promise((r) => setTimeout(r, ms));

async function shikimoriGet(path) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${SHIKIMORI_API}${path}`, { headers: { Accept: "application/json" } });
    } catch {
      // Как и у AniList: обрыв сети и сбой на их стороне (ответ без
      // заголовков CORS) отсюда неразличимы – говорим честно про оба.
      throw new Error(
        i18n(
          "Не получилось достучаться до Шикимори. Проверьте интернет и попробуйте ещё раз – или дело в самом Шикимори: у них тоже случаются перебои."
        )
      );
    }
    if (res.status === 429 && attempt < 3) {
      await shikimoriPause(2000 * (attempt + 1));
      continue;
    }
    if (res.status === 429) {
      throw new Error(i18n("Шикимори просит подождать – слишком много запросов подряд. Попробуйте через минуту."));
    }
    return res;
  }
}

// Ник → номер профиля: список и избранное спрашиваются по номеру.
async function fetchShikimoriUser(userName) {
  const res = await shikimoriGet(`/users/${encodeURIComponent(userName)}?is_nickname=1`);
  if (res.status === 404) {
    throw new Error(
      i18n("Шикимори не знает пользователя «{name}». Ник нужен тот, что в адресе профиля.", { name: userName })
    );
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.id) {
    throw new Error(i18n("Шикимори ответил {status}. Попробуйте ещё раз через минуту.", { status: res.status }));
  }
  return body;
}

async function fetchShikimoriUserList(user, onProgress) {
  const out = { anime: [], manga: [], truncated: false };
  for (const kind of ["anime", "manga"]) {
    onProgress?.(kind);
    for (let page = 1; ; page++) {
      if (page > SHIKIMORI_MAX_PAGES) {
        out.truncated = true;
        break;
      }
      const res = await shikimoriGet(`/users/${user.id}/${kind}_rates?limit=${SHIKIMORI_PAGE}&page=${page}`);
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          i18n("Список у «{name}» закрыт настройками профиля – снаружи его не видно.", { name: user.nickname })
        );
      }
      const body = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(body)) {
        throw new Error(i18n("Шикимори ответил {status}. Попробуйте ещё раз через минуту.", { status: res.status }));
      }
      out[kind].push(...body);
      if (body.length < SHIKIMORI_PAGE) break;
      await shikimoriPause();
    }
    await shikimoriPause();
  }
  return out;
}

// Тайтл из ответа Шикимори → вид, понятный importFavReviewsFor. Номер
// Шикимори – это номер MAL; в id (номер AniList) его класть нельзя, иначе
// он совпал бы с чужим тайтлом по номеру AniList. Русское название тоже
// в счёт: в паспорте отзывы бывают и под ним.
function shikimoriFavMedia(m) {
  return { id: null, idMal: m.id || null, titles: [m.name, m.russian].filter(Boolean) };
}

// Избранное профиля – в том же виде, что у fetchAnilistFavourites, чтобы
// экран проверки и перенос (importFavHtml, runImportFavourites) были
// общими. Люди у Шикимори лежат по корзинам – из корзины и берём роль.
async function fetchShikimoriFavourites(user, onProgress) {
  const res = await shikimoriGet(`/users/${user.id}/favourites`);
  const f = res.ok ? await res.json().catch(() => null) : null;
  if (!f) return null;

  const PEOPLE_BUCKETS = [
    ["seyu", "seiyuu"],
    ["mangakas", "author"],
    ["producers", "director"],
    ["people", null],
  ];
  const people = [];
  const seenPeople = new Set();
  for (const [bucket, role] of PEOPLE_BUCKETS) {
    for (const p of f[bucket] || []) {
      if (seenPeople.has(p.id)) continue;
      seenPeople.add(p.id);
      people.push({ ...p, role });
    }
  }
  const chars = f.characters || [];

  // Подробности – по одному запросу на запись. Не ответил один – карточка
  // всё равно будет, просто без привязки к тайтлам.
  const total = chars.length + people.length;
  let done = 0;
  const details = async (path) => {
    onProgress?.(++done, total);
    await shikimoriPause();
    try {
      const r = await shikimoriGet(path);
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  };
  // Картинка в общем ответе – крошечная (x64); полноразмерная лежит
  // рядом под /original/.
  const bigImage = (d, x) => shikimoriImage(d?.image?.original) || shikimoriImage((x.image || "").replace("/x64/", "/original/"));

  const outChars = [];
  for (const c of chars) {
    const d = await details(`/characters/${c.id}`);
    const media = [...(d?.animes || []), ...(d?.mangas || [])];
    outChars.push({
      key: `c:${c.id}`,
      name: c.name || c.russian || "",
      alt: c.russian || "",
      image: bigImage(d, c),
      from: media[0]?.name || media[0]?.russian || null,
      media: media.map(shikimoriFavMedia),
      voices: (d?.seyu || []).map((s) => s.name).filter(Boolean),
    });
  }

  const outPeople = [];
  for (const p of people) {
    const d = await details(`/people/${p.id}`);
    const media = [
      ...(d?.works || []).map((w) => w.anime || w.manga).filter(Boolean),
      ...(d?.roles || []).flatMap((r) => [...(r.animes || []), ...(r.mangas || [])]),
    ];
    // Из общей корзины «люди» роль не видна – тогда по флагам профиля.
    const role = p.role || (d?.seyu ? "seiyuu" : d?.mangaka ? "author" : d?.producer ? "director" : null);
    outPeople.push({
      key: `p:${p.id}`,
      name: p.name || p.russian || "",
      alt: p.russian || "",
      image: bigImage(d, p),
      role,
      media: media.map(shikimoriFavMedia),
    });
  }

  return {
    chars: outChars,
    people: outPeople,
    titles: [...(f.animes || []), ...(f.mangas || []), ...(f.ranobe || [])].map(shikimoriFavMedia),
  };
}

// ── Перенос ────────────────────────────────────

async function runImport() {
  const status = document.getElementById("imp-status");
  const btn = document.getElementById("imp-run");
  btn.disabled = true;

  const { fresh, existing } = splitImportItems();
  const toWrite = importSkipExisting ? fresh : [...fresh, ...existing];

  // Не импортируем то, чей статус человек оставил пустым.
  const selected = toWrite.filter((i) => i.status && importStatusMap[i.status]);
  // Можно перенести и одно «Любимое» без тайтлов (все статусы –
  // «не импортировать»): тогда ошибка «нечего переносить» не к месту.
  const favWanted = importData.favourites && (importFavPicked.size || importFavHearts);
  if (!selected.length && favWanted) {
    btn.disabled = true;
    status.className = "status-msg";
    const fav = await runImportFavourites(status);
    importData.added = 0;
    importData.updated = 0;
    importData.untouched = importData.items.length;
    importData.favResult = fav;
    importStep = "done";
    refreshOpenReviewsTab();
    renderImport();
    return;
  }
  if (!selected.length) {
    status.className = "status-msg err";
    status.textContent = i18n("Нечего переносить: у всех записей статус помечен как «не импортировать».");
    btn.disabled = false;
    return;
  }

  status.className = "status-msg";

  // Обложки. Аниме и манга – у AniList по номеру MAL, книгам хватит
  // прямой ссылки по ISBN, фильмы – у TMDB и только если есть ключ.
  //
  // У списка, взятого с AniList по нику, обложка уже своя – за ней в
  // AniList ходить незачем, и такие записи в запрос не попадают.
  const malIds = selected.filter((i) => !i.cover).map((i) => i.ids?.mal).filter(Boolean);
  let meta = new Map();
  if (malIds.length) {
    meta = await fetchAnilistMeta(malIds, (done, total) => {
      status.textContent = `Спрашиваем обложки у AniList… ${done} из ${total}`;
    });
  }

  const movies = selected.filter((i) => !i.cover && wantsTmdb(i));
  let films = new Map();
  if (movies.length && tmdbKey()) {
    films = await fetchTmdbMeta(movies, (done, total) => {
      status.textContent = `Спрашиваем постеры у TMDB… ${done} из ${total}`;
    });
  }

  const payload = selected.map((item) => {
    const extra = item.ids?.mal ? meta.get(item.ids.mal) : null;
    const film = wantsTmdb(item) ? films.get(tmdbCacheKey(item)) : null;
    const ids = { ...(item.ids || {}) };
    if (extra?.id) ids.anilist = extra.id;
    if (film?.id) ids.tmdb = film.id;

    const cover =
      item.cover ||
      extra?.coverImage?.large ||
      (film?.poster_path ? tmdbPoster(film.poster_path) : null) ||
      (ids.isbn13 ? openLibraryCover(ids.isbn13) : null);

    return {
      title: item.title,
      type: item.type,
      status: importStatusMap[item.status],
      grade: item.score ? importScoreMap[item.score] || null : null,
      year:
        item.year ||
        (extra?.startDate?.year ? String(extra.startDate.year) : null) ||
        (film?.release_date ? film.release_date.slice(0, 4) : null) ||
        // у сериала из /find (tv_results) вместо release_date – first_air_date
        (film?.first_air_date ? film.first_air_date.slice(0, 4) : null),
      cover,
      rewatch_count: item.rewatch || 0,
      date_start: item.dateStart,
      date_end: item.dateEnd,
      // Текст отзыва (пока он есть только у StoryGraph) – сервер кладёт
      // его только в новые записи, свой написанный не перезаписывает.
      review: item.review || undefined,
      ids: Object.keys(ids).length ? ids : undefined,
    };
  });

  status.textContent = `Записываем ${payload.length} записей…`;
  try {
    const res = await fetch("/api/import-reviews", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: payload, overwrite: !importSkipExisting }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Сервер ответил ${res.status}`);

    importData.added = data.added ?? 0;
    importData.updated = data.updated ?? 0;
    importData.untouched = importData.items.length - (data.added ?? 0) - (data.updated ?? 0);
    if (importBackupCovers && data.added_ids?.length) {
      importData.coverResult = await runImportCoverBackups(status, data.added_ids);
    }
    if (favWanted) importData.favResult = await runImportFavourites(status);
    importStep = "done";
    refreshOpenReviewsTab(); // /settings-edit «Импорт» – та же спрятанная-не-разобранная вкладка, что и в js/api.js
    renderImport();
  } catch (err) {
    status.className = "status-msg err";
    status.textContent = `Не получилось: ${err.message}`;
    btn.disabled = false;
  }
}

// ── Любимое из профиля AniList ─────────────────
// Вместе со списком по нику забираем и «избранное» профиля: персонажей,
// людей (сэйю, режиссёры, авторы…) и любимые тайтлы. На экране проверки –
// отдельный раздел с галочкой у каждой карточки; уже заведённые в
// «Любимом» (по имени) приглушены и не отмечены. При переносе сначала
// пишутся тайтлы, потом записи «Любимого» – так они привязываются и к
// только что импортированным отзывам; в конце ставится ♥ тем отзывам,
// которые в профиле лежат в избранном. Избранное не обязательно: если
// AniList его не отдал, импорт списка идёт как раньше.

const IMPORT_ANILIST_FAV_QUERY = `
  query ($userName: String) {
    User(name: $userName) {
      favourites {
        characters(perPage: 50) {
          nodes {
            id
            name { full native }
            image { large }
            media(perPage: 5, sort: POPULARITY_DESC) {
              nodes { id idMal title { romaji english } }
              edges { voiceActors(language: JAPANESE) { name { full } } }
            }
          }
        }
        staff(perPage: 50) {
          nodes {
            id
            name { full native }
            image { large }
            primaryOccupations
            staffMedia(perPage: 15, sort: POPULARITY_DESC) { nodes { id idMal title { romaji english } } }
            characterMedia(perPage: 15, sort: POPULARITY_DESC) { nodes { id idMal title { romaji english } } }
          }
        }
        anime(perPage: 50) { nodes { id idMal title { romaji english } } }
        manga(perPage: 50) { nodes { id idMal title { romaji english } } }
      }
    }
  }`;

// Отмеченные карточки: «c:<id AniList>» – персонаж, «p:<id>» – человек.
let importFavPicked = new Set();
// Ставить ли ♥ отзывам на тайтлы из избранного профиля.
let importFavHearts = true;

// Занятия на AniList → роль персоны (та же логика, что у поиска в
// редакторе записи, feLookupSubtype в favorites-edit.js).
function importFavRole(occupations) {
  const occ = (occupations || []).map((o) => o.toLowerCase());
  const has = (...words) => occ.some((o) => words.some((w) => o.includes(w)));
  if (has("voice")) return "seiyuu";
  if (has("director")) return "director";
  if (has("composer", "music")) return "composer";
  if (has("mangaka", "author", "writer", "novelist", "original creator", "story")) return "author";
  if (has("illustrator", "artist", "character design", "animator")) return "artist";
  if (has("actor", "actress")) return "actor";
  return null;
}

// Имя без учёта порядка слов и знаков: «Koyama Rikiya» = «Rikiya Koyama».
function importFavNameKey(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

async function fetchAnilistFavourites(userName) {
  const res = await fetch(IMPORT_ANILIST_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: IMPORT_ANILIST_FAV_QUERY, variables: { userName } }),
  });
  const data = await res.json().catch(() => ({}));
  const f = data.data?.User?.favourites;
  if (!res.ok || !f) return null;
  const media = (n) => ({ id: n.id, idMal: n.idMal, titles: [n.title?.romaji, n.title?.english].filter(Boolean) });
  return {
    chars: (f.characters?.nodes || []).map((c) => ({
      key: `c:${c.id}`,
      name: c.name?.full || c.name?.native || "",
      alt: c.name?.native || "",
      image: c.image?.large || null,
      from: c.media?.nodes?.[0]?.title?.romaji || c.media?.nodes?.[0]?.title?.english || null,
      media: (c.media?.nodes || []).map(media),
      voices: (c.media?.edges || []).flatMap((e) => (e.voiceActors || []).map((v) => v.name?.full)).filter(Boolean),
    })),
    people: (f.staff?.nodes || []).map((s) => ({
      key: `p:${s.id}`,
      name: s.name?.full || s.name?.native || "",
      alt: s.name?.native || "",
      image: s.image?.large || null,
      role: importFavRole(s.primaryOccupations),
      media: [...(s.staffMedia?.nodes || []), ...(s.characterMedia?.nodes || [])].map(media),
    })),
    titles: [...(f.anime?.nodes || []), ...(f.manga?.nodes || [])].map(media),
  };
}

// Свои отзывы на эти тайтлы – по номеру AniList/MAL, иначе по названию.
function importFavReviewsFor(mediaList, reviews) {
  const out = new Set();
  for (const m of mediaList) {
    const names = m.titles.map(normTitle);
    for (const r of reviews) {
      if (
        (m.id && r.ids?.anilist === m.id) ||
        (m.idMal && r.ids?.mal === m.idMal) ||
        names.includes(normTitle(r.title))
      ) {
        out.add(r);
      }
    }
  }
  return [...out];
}

function importFavExists(item, favData) {
  const keys = new Set(favData.map((e) => importFavNameKey(e.name)));
  return keys.has(importFavNameKey(item.name)) || (item.alt && keys.has(importFavNameKey(item.alt)));
}

function importFavCardHtml(item, kind) {
  const exists = importFavExists(item, importData.favExisting || []);
  const linked = importFavReviewsFor(item.media, cache.reviews || []);
  const sub =
    kind === "person"
      ? [SUBTYPE_LABELS[item.role] || i18n("Персона"), item.alt && item.alt !== item.name ? item.alt : ""]
      : [item.from, item.alt && item.alt !== item.name ? item.alt : ""];
  const subText = sub.filter(Boolean).join(" · ");
  return `<label class="imp-fav-card${exists ? " is-dup" : ""}">
    <input type="checkbox" data-fav-key="${esc(item.key)}" ${importFavPicked.has(item.key) ? "checked" : ""} ${exists ? "disabled" : ""}>
    <img src="${esc(item.image || PH_SQ)}" alt="" loading="lazy">
    <span class="imp-fav-name">${esc(item.name)}</span>
    ${subText ? `<span class="imp-fav-sub">${esc(subText)}</span>` : ""}
    ${exists ? `<span class="imp-fav-badge">${i18n("уже в «Любимом»")}</span>` : ""}
    ${linked.length ? `<span class="imp-fav-link">↳ ${esc(linked.slice(0, 2).map((r) => r.title).join(", "))}${linked.length > 2 ? ` +${linked.length - 2}` : ""}</span>` : ""}
  </label>`;
}

function importFavHtml() {
  const fav = importData.favourites;
  if (!fav || (!fav.chars.length && !fav.people.length && !fav.titles.length)) return "";
  const reviews = cache.reviews || [];
  const hearts = importFavReviewsFor(fav.titles, reviews);
  const notYet = hearts.filter((r) => !r.favorite);
  const group = (title, list, kind) => {
    if (!list.length) return "";
    const fresh = list.filter((x) => !importFavExists(x, importData.favExisting || [])).length;
    return `<div class="imp-fav-sec">${esc(title)} <small>${i18n("новых {n} из {total}", { n: fresh, total: list.length })}</small></div>
      <div class="imp-fav-grid">${list.map((x) => importFavCardHtml(x, kind)).join("")}</div>`;
  };
  return `
    <h2 class="section-h">${i18n("Любимое из профиля")}</h2>
    <p class="panel-intro">${i18n("Персонажи и люди из избранного профиля – снимите галочку у тех, кто не нужен. Уже заведённые в «Любимом» пропускаются. «↳» – к каким вашим отзывам запись привяжется; привязка к тайтлам из этого же импорта появится сама.")}</p>
    <div class="imp-actions imp-fav-tools">
      <button class="btn btn-ghost" type="button" id="imp-fav-all">${i18n("Выбрать всех")}</button>
      <button class="btn btn-ghost" type="button" id="imp-fav-none">${i18n("Снять всех")}</button>
    </div>
    ${
      hearts.length
        ? `<div class="imp-row imp-row-plain"><label><input type="checkbox" id="imp-fav-hearts" ${importFavHearts && notYet.length ? "checked" : ""} ${notYet.length ? "" : "disabled"}> ${
            notYet.length
              ? i18n("Отметить ♥ «Любимое» у {n} тайтлов из избранного профиля, которые уже есть в паспорте", { n: notYet.length })
              : i18n("Тайтлы из избранного профиля, которые есть в паспорте, уже отмечены ♥")
          }</label></div>`
        : ""
    }
    ${group(i18n("Персонажи"), fav.chars, "character")}
    ${group(i18n("Люди"), fav.people, "person")}`;
}

function bindImportFav() {
  document.querySelectorAll("[data-fav-key]").forEach((box) => {
    box.addEventListener("change", () => {
      if (box.checked) importFavPicked.add(box.dataset.favKey);
      else importFavPicked.delete(box.dataset.favKey);
    });
  });
  const setAll = (on) => {
    document.querySelectorAll("[data-fav-key]:not(:disabled)").forEach((box) => {
      box.checked = on;
      if (on) importFavPicked.add(box.dataset.favKey);
      else importFavPicked.delete(box.dataset.favKey);
    });
  };
  document.getElementById("imp-fav-all")?.addEventListener("click", () => setAll(true));
  document.getElementById("imp-fav-none")?.addEventListener("click", () => setAll(false));
  document.getElementById("imp-fav-hearts")?.addEventListener("change", (e) => {
    importFavHearts = e.target.checked;
  });
}

// Имя файла резервной копии – как у редактора (backupCoverNow в
// routes/add-cover.js): название латиницей/кириллицей через дефис и
// короткий хвост, чтобы одинаковые названия не затёрли друг друга.
let importSlugSeq = 0;
function importSlug(name) {
  const base = String(name || "cover")
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  // Date.now() в одну миллисекунду совпадает у соседних копий –
  // при пачке параллельных запросов нужен ещё и счётчик.
  return `${base || "cover"}-${Date.now().toString(36).slice(-5)}${(importSlugSeq++).toString(36)}`;
}

// Резервные копии обложек только что добавленных отзывов. Картинки –
// по одной через /api/backup-cover (то же, что делает редактор), по
// IMPORT_COVER_WORKERS за раз: на телефоне сотни одновременных запросов
// вешают мост (см. CLAUDE.md про мобильный мост). Ссылки на готовые
// копии записываются пачками через /api/set-cover-backups – одна запись
// файла на IMPORT_COVER_FLUSH отзывов, а не на каждый. Прервётся посреди
// – уже записанные пачки останутся, остальные просто без копии, как было.
const IMPORT_COVER_WORKERS = 4;
const IMPORT_COVER_FLUSH = 50;

async function runImportCoverBackups(status, addedIds) {
  await fetchReviews();
  const want = new Set(addedIds.map(String));
  const todo = (cache.reviews || []).filter(
    (r) => want.has(String(r.id)) && /^https?:\/\//.test(r.cover || "") && !r.cover_backup
  );
  const result = { saved: 0, failed: 0 };
  let pending = [];
  const flush = async () => {
    if (!pending.length) return;
    const items = pending;
    pending = [];
    try {
      await postRecordOrThrow("/api/set-cover-backups", { items });
    } catch {
      result.saved -= items.length;
      result.failed += items.length;
    }
  };
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < todo.length) {
      const r = todo[next++];
      try {
        const res = await fetch("/api/backup-cover", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: r.cover, filename: importSlug(r.title) }),
        });
        const data = await res.json().catch(() => ({}));
        const url = data.ok ? data.url || (data.path ? "/" + data.path : null) : null;
        if (url) {
          pending.push({ id: r.id, cover: r.cover, cover_backup: url });
          result.saved++;
        } else {
          result.failed++;
        }
      } catch {
        result.failed++;
      }
      done++;
      status.textContent = i18n("Сохраняем копии обложек… {done} из {total}", { done, total: todo.length });
      if (pending.length >= IMPORT_COVER_FLUSH) await flush();
    }
  };
  await Promise.all(Array.from({ length: Math.min(IMPORT_COVER_WORKERS, todo.length) }, worker));
  await flush();
  return result;
}

// После того как тайтлы записаны: заводим отмеченных в «Любимом» и
// ставим ♥ тайтлам. Ошибка одной записи не останавливает остальные –
// счётчик ошибок попадает в итог.
async function runImportFavourites(status) {
  const fav = importData?.favourites;
  const result = { added: 0, failed: 0, hearts: 0 };
  if (!fav) return result;

  await fetchReviews();
  const reviews = cache.reviews || [];
  let favData = [];
  try {
    const res = await fetch("/favorites.json?_=" + Date.now());
    favData = res.ok ? await res.json() : [];
  } catch {
    favData = [];
  }

  const picked = [
    ...fav.chars.filter((c) => importFavPicked.has(c.key)).map((c) => ({ ...c, type: "character" })),
    ...fav.people.filter((p) => importFavPicked.has(p.key)).map((p) => ({ ...p, type: "person" })),
  ].filter((x) => !importFavExists(x, favData));

  const created = [];
  for (let i = 0; i < picked.length; i++) {
    const x = picked[i];
    status.textContent = i18n("Заводим «Любимое»… {done} из {total}", { done: i + 1, total: picked.length });
    // Резервная копия картинки – как в редакторе записи (/api/backup-cover):
    // без неё запись осталась бы без фото, если AniList однажды сменит адрес.
    let backup = null;
    if (x.image) {
      try {
        const res = await fetch("/api/backup-cover", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: x.image, filename: importSlug(x.name) }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.ok) backup = data.url;
      } catch {
        // без копии – остаётся ссылка, как при ручном добавлении без сети
      }
    }
    const linked = importFavReviewsFor(x.media, reviews)
      .map((r) => r.id)
      .filter((id) => typeof id === "number");
    const entry = {
      name: x.name,
      type: x.type,
      image: x.image || null,
      image_backup: backup,
      image_gallery: backup ? [backup] : null,
      from: x.type === "character" ? x.from || null : null,
      linked_review_ids: linked.length ? linked : null,
    };
    if (x.type === "person") entry.subtype = x.role || "actor";
    try {
      const data = await postRecordOrThrow("/api/save-favorite", entry);
      created.push({ ...x, id: data.id, entry });
      favData.push({ ...entry, id: data.id });
      result.added++;
    } catch {
      result.failed++;
    }
  }

  // Персонаж ↔ его сэйю, если оба теперь в «Любимом» (по имени).
  for (const c of created.filter((x) => x.type === "character" && x.voices?.length)) {
    const keys = new Set(c.voices.map(importFavNameKey));
    const vaIds = favData.filter((e) => e.type === "person" && keys.has(importFavNameKey(e.name))).map((e) => e.id);
    if (!vaIds.length) continue;
    try {
      await postRecordOrThrow("/api/save-favorite", { ...c.entry, linked_favorite_ids: vaIds, _editId: c.id });
    } catch {
      // связь не обязательна – запись уже заведена
    }
  }

  if (importFavHearts) {
    const toHeart = importFavReviewsFor(fav.titles, reviews).filter((r) => !r.favorite && r.id !== undefined);
    for (const r of toHeart) {
      try {
        await postRecordOrThrow("/api/save-review", { ...r, favorite: true, _editId: r.id });
        result.hearts++;
      } catch {
        result.failed++;
      }
    }
  }
  return result;
}

function bindImport() {
  bindImportKeys();
  bindAnilistUser();
  bindShikimoriUser();
  bindMalUser();
  bindSteamUser();
  bindImportColumns();
  bindImportFav();

  // Карточка источника: открыть (закрыв прежнюю) или свернуть. Поле ника
  // сразу в фокусе – следующее действие и так понятно.
  document.querySelectorAll("[data-imp-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (importBusy) return;
      importOpenCard = importOpenCard === btn.dataset.impOpen ? null : btn.dataset.impOpen;
      renderImport();
      const card = importOpenCard && document.querySelector(`[data-imp-card="${importOpenCard}"]`);
      if (!card) return;
      card.querySelector('input[type="text"], input[type="password"]:placeholder-shown')?.focus({ preventScroll: true });
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  });

  document.getElementById("imp-file")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const status = document.getElementById("imp-status");
    status.className = "status-msg";
    status.textContent = i18n("Читаем файл…");
    const text = await file.text();
    try {
      await startMapping(parseImportFile(text, file.name));
    } catch (err) {
      // Незнакомый формат – не тупик: читаем как таблицу и спрашиваем,
      // что в каких столбцах. Не читается и так – показываем почему.
      if (err.unknownFormat) {
        try {
          openImportTable(readImportTable(text, file.name));
          return;
        } catch (tableErr) {
          err = tableErr;
        }
      }
      status.className = "status-msg err";
      status.textContent = err.message;
    }
  });

  document.querySelectorAll("[data-status]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const malKey = sel.dataset.status;
      if (sel.value === NEW_STATUS_VALUE) {
        // Возвращаем список к прошлому выбору: служебный пункт не
        // должен остаться выбранным, если человек передумает.
        sel.value = importStatusMap[malKey] || "";
        const form = document.getElementById(`imp-newstatus-${malKey}`);
        form.classList.remove("hidden");
        document.getElementById(`imp-newstatus-name-${malKey}`).focus();
        return;
      }
      importStatusMap[malKey] = sel.value;
    });
  });

  document.querySelectorAll("[data-create-status]").forEach((btn) => {
    btn.addEventListener("click", () => createStatusFromImport(btn.dataset.createStatus));
  });
  document.querySelectorAll("[data-cancel-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById(`imp-newstatus-${btn.dataset.cancelStatus}`).classList.add("hidden");
    });
  });
  document.querySelectorAll(".imp-newstatus input").forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      createStatusFromImport(input.id.replace("imp-newstatus-name-", ""));
    });
  });
  document.querySelectorAll("[data-score]").forEach((sel) => {
    sel.addEventListener("change", () => { importScoreMap[sel.dataset.score] = sel.value; });
  });
  document.getElementById("imp-skip")?.addEventListener("change", (e) => {
    importSkipExisting = e.target.checked;
  });
  document.getElementById("imp-backup-covers")?.addEventListener("change", (e) => {
    importBackupCovers = e.target.checked;
  });

  document.getElementById("imp-run")?.addEventListener("click", runImport);
  document.getElementById("imp-cancel")?.addEventListener("click", () => {
    importData = null;
    importStep = "file";
    renderImport();
  });
  document.getElementById("imp-again")?.addEventListener("click", () => {
    importData = null;
    importStep = "file";
    renderImport();
  });
}

// ── Шаг «Что в каких столбцах» ─────────────────
// Для файла незнакомого формата (см. readImportTable / buildImportFromTable
// в js/import-formats.js). Столбцы – карточками (на телефоне в одну
// колонку): заголовок, три первых значения и выбор роли. Роли угаданы по
// заголовкам; обязательно только название. Дальше – обычный экран
// соответствий, где статусы из файла показаны как есть.

const IMPORT_ROLE_LABELS = () => ({
  title: i18n("Название"),
  type: i18n("Тип (аниме, книга…)"),
  status: i18n("Статус"),
  score: i18n("Оценка"),
  year: i18n("Год выхода"),
  dateStart: i18n("Дата начала"),
  dateEnd: i18n("Дата окончания"),
  cover: i18n("Обложка (ссылка)"),
});

function openImportTable(table) {
  importTable = table;
  importRoles = guessImportColumns(table.headers);
  importTypeMap = {};
  importTypeAll = "";
  importGuessTypeValues();
  importStep = "columns";
  renderImport();
}

function importColumnValues(index) {
  return [...new Set(importTable.rows.map((r) => r[index]).filter(Boolean))];
}

// Значения столбца типа, для которых ещё не выбрано, – угадываем.
function importGuessTypeValues() {
  const tc = importRoles.indexOf("type");
  if (tc < 0) return;
  for (const value of importColumnValues(tc)) {
    if (importTypeMap[value] === undefined) {
      const guess = guessImportType(value);
      importTypeMap[value] = TYPE_LABELS[guess] !== undefined ? guess : "";
    }
  }
}

function importTypeOptions(selected) {
  return (
    `<option value="">${i18n("— выберите —")}</option>` +
    Object.entries(TYPE_LABELS)
      .map(([key, label]) => `<option value="${esc(key)}"${selected === key ? " selected" : ""}>${esc(label)}</option>`)
      .join("")
  );
}

function importColumnsHtml() {
  const t = importTable;
  const labels = IMPORT_ROLE_LABELS();
  const tc = importRoles.indexOf("type");
  const noTitle = importRoles.indexOf("title") < 0;
  const typeBlock =
    tc >= 0
      ? `<p class="panel-intro">${i18n("В столбце «{name}» нашлись такие значения – чем каждое будет в паспорте:", { name: t.headers[tc] })}</p>
         ${importColumnValues(tc)
           .slice(0, 40)
           .map(
             (v) => `<div class="imp-row"><div class="imp-from">${esc(v)}</div><div class="imp-arrow">→</div>
               <select class="imp-select" data-imp-typeval="${esc(v)}">${importTypeOptions(importTypeMap[v])}</select></div>`
           )
           .join("")}`
      : `<div class="imp-row"><div class="imp-from">${i18n("Все записи из файла – это")}</div><div class="imp-arrow">→</div>
           <select class="imp-select" id="imp-typeall">${importTypeOptions(importTypeAll)}</select></div>
         <p class="imp-note">${i18n("Столбца с типом нет. Если в файле вперемешку фильмы и книги – укажите выше, в каком столбце тип.")}</p>`;
  return `
    <p class="imp-source-line">${i18n("Файл")}: <strong>${esc(t.name)}</strong> · ${esc(t.kind)} · ${t.rows.length} ${plural(t.rows.length, [i18n("запись"), i18n("записи"), i18n("записей")])}</p>
    <h2 class="section-h">${i18n("Что в каких столбцах")}</h2>
    <p class="panel-intro">${i18n("Формат этого файла нам незнаком, поэтому покажите, где что лежит. Мы уже угадали по заголовкам – проверьте. Обязательно только название; ненужные столбцы оставьте «не брать».")}</p>
    <div class="imp-cards"><div class="imp-cards-grid imp-cols">
      ${t.headers
        .map(
          (h, i) => `<div class="imp-card${importRoles[i] ? " is-picked" : ""}">
            <div class="imp-card-head"><span class="imp-card-name">${esc(h || i18n("Столбец {n}", { n: i + 1 }))}</span></div>
            <div class="imp-col-samples">${t.rows
              .slice(0, 3)
              .map((r) => `<span>${esc(r[i] || "—")}</span>`)
              .join("")}</div>
            <select class="imp-select" data-imp-col="${i}" aria-label="${esc(h)}">
              <option value="">${i18n("не брать")}</option>
              ${IMPORT_COLUMN_ROLES.map((role) => `<option value="${role}"${importRoles[i] === role ? " selected" : ""}>${esc(labels[role])}</option>`).join("")}
            </select>
          </div>`
        )
        .join("")}
    </div></div>
    ${noTitle ? `<p class="status-msg err">${i18n("Отметьте столбец с названием – без него записи не завести.")}</p>` : ""}
    <h2 class="section-h">${i18n("Тип записей")}</h2>
    ${typeBlock}
    <div class="imp-actions">
      <button class="btn-save" id="imp-columns-next" type="button"${noTitle ? " disabled" : ""}>${i18n("Дальше – статусы и оценки")}</button>
      <button class="btn btn-ghost" id="imp-cancel" type="button">${i18n("Отмена")}</button>
    </div>
    <div class="status-msg" id="imp-status"></div>`;
}

function bindImportColumns() {
  document.querySelectorAll("[data-imp-col]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const i = Number(sel.dataset.impCol);
      // Одна роль – один столбец: у прежнего столбца она снимается.
      if (sel.value) importRoles = importRoles.map((r, j) => (j !== i && r === sel.value ? "" : r));
      importRoles[i] = sel.value;
      importGuessTypeValues();
      renderImport();
    });
  });
  document.querySelectorAll("[data-imp-typeval]").forEach((sel) => {
    sel.addEventListener("change", () => (importTypeMap[sel.dataset.impTypeval] = sel.value));
  });
  document.getElementById("imp-typeall")?.addEventListener("change", (e) => (importTypeAll = e.target.value));
  document.getElementById("imp-columns-next")?.addEventListener("click", async () => {
    const status = document.getElementById("imp-status");
    const tc = importRoles.indexOf("type");
    if (tc < 0 && !importTypeAll) {
      status.className = "status-msg err";
      status.textContent = i18n("Выберите, что это за записи – фильмы, книги…");
      return;
    }
    const parsed = buildImportFromTable(importTable, importRoles, { typeMap: importTypeMap, typeAll: importTypeAll });
    if (!parsed.items.length) {
      status.className = "status-msg err";
      status.textContent =
        tc >= 0
          ? i18n("Ни одной записи: у всех значений типа стоит «— выберите —» или пустое название.")
          : i18n("Ни одной записи: в столбце названия пусто.");
      return;
    }
    await startMapping(parsed);
  });
}

// Разобранный список – из файла ли, из сети ли – дальше идёт одним путём.
async function startMapping(parsed) {
  // Перечитываем свои отзывы перед разбором: fetchReviews() не кэширует,
  // так что это всегда актуальный список – без этого «уже есть»
  // посчиталось бы по устаревшим данным и вторая пачка приехала бы дублями.
  await fetchReviews();
  importData = parsed;
  importStatusMap = defaultStatusMap();
  // Статусы из файла («Пройдено», «Хочу»): угаданный общий смысл → ваш
  // статус тем же путём, что у любого сервиса.
  for (const [key, generic] of Object.entries(parsed.statusGuess || {})) {
    importStatusMap[key] = generic ? importStatusMap[generic] || "" : "";
  }
  importScoreMap = defaultScoreMap();
  importStep = "map";
  renderImport();
}

// Избранное профиля (AniList или Шикимори) – к разобранному списку: что
// уже заведено в «Любимом» и какие карточки отмечены по умолчанию (все
// новые). Возвращает, сколько в избранном персонажей и людей.
async function attachImportFavourites(parsed, favourites) {
  parsed.favourites = favourites;
  try {
    const res = await fetch("/favorites.json?_=" + Date.now());
    parsed.favExisting = res.ok ? await res.json() : [];
  } catch {
    parsed.favExisting = [];
  }
  importFavHearts = true;
  importFavPicked = new Set(
    [...(favourites?.chars || []), ...(favourites?.people || [])]
      .filter((x) => !importFavExists(x, parsed.favExisting))
      .map((x) => x.key)
  );
  return (favourites?.chars.length || 0) + (favourites?.people.length || 0);
}

function bindShikimoriUser() {
  const input = document.getElementById("imp-shiki-user");
  const btn = document.getElementById("imp-shiki-go");
  const status = document.getElementById("imp-shiki-status");
  if (!input || !btn) return;

  const go = async () => {
    // Вставили ссылку на профиль целиком – берём из неё ник.
    const userName = input.value
      .trim()
      .replace(/^https?:\/\/(www\.)?shikimori\.[a-z]+\//i, "")
      .replace(/^@/, "")
      .replace(/\/.*$/, "");
    if (!userName) { input.focus(); return; }
    if (importBusy) return;
    importBusy = true;
    btn.disabled = true;
    status.className = "status-msg";
    status.textContent = i18n("Спрашиваем Шикимори…");
    try {
      const user = await fetchShikimoriUser(userName);
      const lists = await fetchShikimoriUserList(user, (kind) => {
        status.textContent = kind === "anime" ? i18n("Забираем аниме…") : i18n("Забираем мангу…");
      });
      const parsed = parseShikimoriRates(lists);
      parsed.source = `${i18n("Шикимори")} – ${user.nickname || userName}`;
      parsed.byName = true; // не файл: экран соответствий говорит об этом иначе
      if (lists.truncated) {
        parsed.truncatedNote = i18n("Список мог получиться неполным – в нём больше записей, чем импорт забирает за раз.");
      }
      // Избранное не обязательно: не ответил Шикимори – импорт списка
      // идёт как раньше, без раздела «Любимое из профиля».
      status.textContent = i18n("Забираем избранное профиля…");
      const favourites = await fetchShikimoriFavourites(user, (done, total) => {
        status.textContent = i18n("Забираем избранное профиля… {done} из {total}", { done, total });
      }).catch(() => null);
      const favCount = await attachImportFavourites(parsed, favourites);
      if (!parsed.items.length && !favCount) {
        throw new Error(
          i18n("У «{name}» в списке ничего нет – ни аниме, ни манги. Или список закрыт настройками профиля.", {
            name: user.nickname || userName,
          })
        );
      }
      await startMapping(parsed);
    } catch (err) {
      status.className = "status-msg err";
      status.textContent = err.message;
    } finally {
      importBusy = false;
      btn.disabled = false;
    }
  };

  btn.addEventListener("click", go);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    go();
  });
}

function bindAnilistUser() {
  const input = document.getElementById("imp-anilist-user");
  const btn = document.getElementById("imp-anilist-go");
  const status = document.getElementById("imp-anilist-status");
  if (!input || !btn) return;

  const go = async () => {
    const userName = input.value.trim().replace(/^@/, "");
    if (!userName) { input.focus(); return; }
    if (importBusy) return;
    importBusy = true;
    btn.disabled = true;
    status.className = "status-msg";
    status.textContent = i18n("Спрашиваем AniList…");
    try {
      const collections = await fetchAnilistUserList(userName, (type) => {
        status.textContent = type === "ANIME" ? i18n("Забираем аниме…") : i18n("Забираем мангу…");
      });
      const parsed = parseAnilistLists(collections);
      parsed.source = `AniList – ${userName}`;
      parsed.byName = true; // не файл: экран соответствий говорит об этом иначе
      // Избранное профиля – не обязательно: не ответил AniList – импорт
      // списка идёт как раньше, просто без раздела «Любимое из профиля».
      status.textContent = i18n("Забираем избранное профиля…");
      const favCount = await attachImportFavourites(parsed, await fetchAnilistFavourites(userName).catch(() => null));
      if (!parsed.items.length && !favCount) {
        throw new Error(`У «${userName}» в списке ничего нет – ни аниме, ни манги.`);
      }
      await startMapping(parsed);
    } catch (err) {
      status.className = "status-msg err";
      status.textContent = err.message;
    } finally {
      importBusy = false;
      btn.disabled = false;
    }
  };

  btn.addEventListener("click", go);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    go();
  });
}

// Сам запрос идёт не отсюда: у списка на MyAnimeList нет CORS,
// поэтому его спрашивает свой же сервер (core/api.js, fetchMalUserList) –
// на компьютере он выполняется в Node, на телефоне уходит через
// нативный мост (mobile/src/main.js, CapacitorHttp). Разбор ответа –
// здесь же, тем же путём, что и у AniList выше.
function bindMalUser() {
  const input = document.getElementById("imp-mal-user");
  const btn = document.getElementById("imp-mal-go");
  const status = document.getElementById("imp-mal-status");
  if (!input || !btn) return;

  const go = async () => {
    const userName = input.value.trim().replace(/^@/, "");
    if (!userName) { input.focus(); return; }
    if (importBusy) return;
    importBusy = true;
    btn.disabled = true;
    status.className = "status-msg";
    status.textContent = i18n("Спрашиваем MyAnimeList…");
    try {
      const res = await fetch("/api/fetch-mal-list", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: userName }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `MyAnimeList ответил ${res.status}`);

      const parsed = parseMalJsonLists(data);
      parsed.source = `MyAnimeList – ${userName}`;
      parsed.byName = true; // не файл: экран соответствий говорит об этом иначе
      if (!parsed.items.length) {
        throw new Error(`У «${userName}» в списке ничего нет – ни аниме, ни манги.`);
      }
      // truncated (core/api.js, fetchMalUserList) – список этого вида
      // мог оборваться раньше времени (реальная ошибка на середине
      // пагинации, а не штатный конец списка) или упереться в свой же
      // потолок страниц. Молчать об этом – значит дать человеку
      // подумать, что список полный, когда это не так.
      const truncatedKinds = ["anime", "manga"].filter((k) => data.truncated?.[k]);
      if (truncatedKinds.length) {
        const labels = truncatedKinds.map((k) => (k === "anime" ? i18n("аниме") : i18n("манга")));
        parsed.truncatedNote = i18n(
          "Список ({v0}) мог получиться неполным – MyAnimeList прервал ответ на середине. Стоит попробовать ещё раз чуть позже.",
          { v0: labels.join(", ") }
        );
      }
      await startMapping(parsed);
    } catch (err) {
      status.className = "status-msg err";
      status.textContent = err.message;
    } finally {
      importBusy = false;
      btn.disabled = false;
    }
  };

  btn.addEventListener("click", go);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    go();
  });
}

function bindImportKeys() {
  const input = document.getElementById("imp-tmdb-key");
  const status = document.getElementById("imp-key-status");

  const save = async () => {
    const key = input.value.trim();
    if (!key) { input.focus(); return; }
    status.className = "status-msg";
    status.textContent = i18n("Спрашиваем TMDB, знает ли он такой ключ…");
    try {
      await checkTmdbKey(key);
      saveTmdbKey(key);
      renderImport(); // карточка TMDB остаётся открытой (importOpenCard)
      const fresh = document.getElementById("imp-key-status");
      if (fresh) fresh.textContent = i18n("Ключ принят. Постеры к фильмам теперь приедут вместе со списком.");
    } catch (err) {
      status.className = "status-msg err";
      status.textContent = err.message;
    }
  };

  document.getElementById("imp-tmdb-save")?.addEventListener("click", save);
  input?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    save();
  });

  document.getElementById("imp-tmdb-clear")?.addEventListener("click", () => {
    saveTmdbKey("");
    renderImport();
  });
}

function importStyles() {
  return `<style>
    .imp-actions { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; margin: 1.2rem 0 .6rem; }
    .imp-actions input[type="text"] { width: auto; flex: 1; min-width: 11rem; }
    .imp-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
      gap: 1px; background: var(--border);
      border: 1px solid var(--border); border-radius: 2px;
      overflow: hidden; margin-bottom: 1rem;
    }
    .imp-stat { background: var(--surface); padding: .85rem .7rem; text-align: center; }
    .imp-stat-value {
      font-family: 'Playfair Display', serif;
      font-weight: 700; font-size: 1.5rem; color: var(--text-hi); line-height: 1;
    }
    .imp-stat-label {
      font-family: 'DM Sans', sans-serif;
      font-size: .57rem; letter-spacing: .1em; text-transform: uppercase;
      color: var(--text-dim); margin-top: .4rem;
    }
    .imp-note {
      font-family: 'DM Sans', sans-serif;
      font-size: .75rem; color: var(--text-dim); margin: 0 0 1.5rem;
    }

    .imp-row {
      display: flex; align-items: center; gap: .7rem;
      padding: .5rem 0;
      border-bottom: 1px solid var(--border);
    }
    .imp-row-plain { border-bottom: none; }
    .imp-from {
      flex: 1; min-width: 0;
      font-family: 'Cormorant Garamond', serif;
      font-size: .98rem; color: var(--text-hi);
    }
    .imp-count {
      font-family: 'DM Sans', sans-serif;
      font-size: .62rem; color: var(--text-dim); margin-left: .4rem;
    }
    .imp-arrow { color: var(--text-dim); flex-shrink: 0; }
    .imp-select { width: auto; min-width: 11rem; flex-shrink: 0; }

    /* Карточки источников. Линии между ними – их собственные правая и
       нижняя рамки, а крайние прячутся под overflow (сетка сдвинута на
       1px). Линии фоном-через-gap оставляли бы серый блок в пустой ячейке
       последней строки – та же грабля, что была у старого .imp-sources. */
    .imp-group { margin-top: 2.2rem; }
    .imp-cards {
      border: 1px solid var(--border); border-radius: 2px;
      overflow: hidden; background: var(--surface);
    }
    .imp-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
      margin: 0 -1px -1px 0;
    }
    .imp-card {
      background: var(--surface);
      border-right: 1px solid var(--border); border-bottom: 1px solid var(--border);
      padding: 1rem 1.05rem 1.05rem;
      display: flex; flex-direction: column; gap: .45rem; min-width: 0;
    }
    /* Открытая – на всю строку: поле ника и шаги не жмутся в колонку. */
    .imp-card.is-open { grid-column: 1 / -1; background: var(--surface2); }
    .imp-card.is-planned .imp-card-name,
    .imp-card.is-planned .imp-card-what { opacity: .55; }
    .imp-card-head { display: flex; align-items: baseline; gap: .55rem; flex-wrap: wrap; }
    .imp-card-name {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.15rem; font-weight: 600; color: var(--text-hi);
    }
    .imp-card-kind, .imp-card-badge {
      font-family: 'DM Sans', sans-serif;
      font-size: .55rem; letter-spacing: .12em; text-transform: uppercase;
      color: var(--text-dim);
    }
    .imp-card-badge {
      border: 1px solid var(--border2); border-radius: 2px;
      padding: .1rem .35rem; margin-left: auto;
    }
    .imp-card-badge.is-on { color: var(--text-hi); }
    .imp-card-what {
      font-family: 'DM Sans', sans-serif;
      font-size: .78rem; line-height: 1.5; color: var(--text-dim);
      margin: 0; flex: 1;
    }
    .imp-card-open { align-self: flex-start; margin-top: .35rem; }
    .imp-card-body { border-top: 1px solid var(--border); margin-top: .6rem; padding-top: .3rem; }
    .imp-card-body .imp-actions { margin: .8rem 0 .4rem; }
    .imp-card-body .imp-note { margin: .8rem 0 0; }
    .imp-card-note { margin-top: .2rem !important; }
    .imp-group-note { margin: .6rem 0 0; }
    .imp-foot { margin: 2.4rem 0 1rem; }
    .imp-steps-label {
      font-family: 'DM Sans', sans-serif;
      font-size: .58rem; letter-spacing: .1em; text-transform: uppercase;
      color: var(--text-hi); margin-top: .9rem;
    }
    .imp-steps {
      font-family: 'DM Sans', sans-serif;
      font-size: .76rem; line-height: 1.6; color: var(--text-dim);
      margin: .6rem 0 0; padding-left: 1.2rem;
    }
    .imp-steps li { margin-bottom: .2rem; }
    .imp-steps strong { color: var(--text-hi); font-weight: 500; }
    .imp-steam-row { margin-top: .8rem; }
    /* Шаг «Что в каких столбцах»: столбец – карточка. Выбранная роль
       делает карточку заметнее, «не брать» – приглушает. */
    .imp-cols { grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); }
    .imp-cols .imp-card { gap: .55rem; }
    .imp-cols .imp-select { width: 100%; min-width: 0; }
    .imp-col-samples { display: flex; flex-direction: column; gap: .15rem; min-width: 0; flex: 1; }
    .imp-col-samples span {
      font-family: 'DM Sans', sans-serif;
      font-size: .74rem; color: var(--text-dim);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .imp-cols .imp-card:not(.is-picked) .imp-card-name,
    .imp-cols .imp-card:not(.is-picked) .imp-col-samples { opacity: .6; }
    .imp-cols .imp-card.is-picked { background: var(--surface2); }
    .imp-map-key { border: 1px solid var(--border); border-radius: 2px; padding: .2rem .95rem .95rem; margin-bottom: 1.2rem; }
    .imp-key-row { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
    .imp-key-row input { width: auto; flex: 1; min-width: 12rem; }
    .imp-key-warn { margin: 1.1rem 0 0; }
    .imp-source-line {
      font-family: 'DM Sans', sans-serif;
      font-size: .78rem; color: var(--text-dim); margin: 0 0 1rem;
    }
    .imp-source-line strong { color: var(--text-hi); font-weight: 500; }

    .imp-newstatus {
      display: flex; gap: .5rem; align-items: center;
      padding: .6rem 0 .8rem; flex-wrap: wrap;
    }
    .imp-newstatus.hidden { display: none; }
    .imp-newstatus input { width: auto; flex: 1; min-width: 10rem; }

    @media (max-width: 520px) {
      .imp-row { flex-wrap: wrap; }
      .imp-arrow { display: none; }
      .imp-select { width: 100%; min-width: 0; }
    }
    /* Любимое из профиля AniList (importFavHtml) */
    .imp-fav-tools { margin-top: .4rem; }
    .imp-fav-sec { margin: 1.3rem 0 .7rem; font-family: 'Playfair Display', serif; font-style: italic; font-size: 1.1rem; color: var(--text-hi); }
    .imp-fav-sec small { margin-left: .5rem; font-family: 'DM Sans', sans-serif; font-style: normal; font-size: .75rem; color: var(--text-dim); }
    .imp-fav-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: .7rem; }
    .imp-fav-card { position: relative; display: flex; flex-direction: column; gap: .2rem; padding: 0 0 .55rem; overflow: hidden; cursor: pointer; background: var(--surface); border: 1px solid var(--border); border-radius: 3px; transition: border-color .15s; text-transform: none; letter-spacing: 0; }
    .imp-fav-card:has(input:checked) { border-color: var(--red-hi); }
    .imp-fav-card.is-dup { opacity: .55; cursor: default; }
    .imp-fav-card input { position: absolute; top: 6px; left: 6px; width: 16px; height: 16px; accent-color: var(--red-hi); z-index: 1; }
    .imp-fav-card img { width: 100%; aspect-ratio: 1/1; object-fit: cover; object-position: 50% 20%; display: block; background: var(--surface2); }
    .imp-fav-name { padding: 0 .5rem; font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: .9rem; line-height: 1.2; color: var(--text-hi); }
    .imp-fav-sub { padding: 0 .5rem; font-family: 'DM Sans', sans-serif; font-size: .66rem; line-height: 1.3; color: var(--text-dim); }
    .imp-fav-badge { margin: .15rem .5rem 0; align-self: flex-start; padding: .1rem .4rem; border: 1px dashed var(--border2); border-radius: 99px; font-family: 'DM Sans', sans-serif; font-size: .6rem; color: var(--text-dim); }
    .imp-fav-link { padding: 0 .5rem; font-family: 'DM Sans', sans-serif; font-size: .64rem; line-height: 1.3; color: var(--ok); }
  </style>`;
}
