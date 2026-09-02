// ══════════════════════════════════════════════
//  АНГЛИЙСКИЙ СЛОВАРЬ
//  Подключать сразу после i18n.js.
//
//  Ключ – русский текст ровно в том виде, в каком он стоит в коде
//  (см. шапку i18n.js). Строки без записи здесь остаются русскими и
//  ничего не ломают; найти такие помогает scripts/check-i18n.js.
//
//  Названия тегов – отдельный случай. Ключ тега в TAGS_MAP это сам
//  русский текст, и он же лежит в reviews.json у каждого отзыва.
//  Переводить его как данные нельзя – развалится связь с отзывами.
//  Поэтому здесь перевод только для показа: i18n(имяТега) на экране,
//  а в данных и в ключах всё остаётся как было.
// ══════════════════════════════════════════════

i18nRegister({
  // ── Общее ────────────────────────────────────
  Сохранить: "Save",
  Отмена: "Cancel",
  Удалить: "Delete",
  Показать: "Show",
  Скрыть: "Hide",
  Переименовать: "Rename",
  Добавить: "Add",
  Готово: "Done",
  Дальше: "Next",
  Назад: "Back",
  "← Назад": "← Back",
  Открыть: "Open",
  Создать: "Create",
  Выбрать: "Choose",
  Загрузить: "Upload",
  Восстановить: "Restore",
  Обновить: "Refresh",
  Сохранено: "Saved",
  "Сохраняю...": "Saving…",
  "Загружаем…": "Loading…",
  Ошибка: "Error",
  "Пока пусто": "Nothing here yet",
  "Список пуст": "The list is empty",
  "Ничего не найдено": "Nothing found",
  "Отзывов пока нет.": "No reviews yet.",
  Все: "All",
  Поиск: "Search",
  Тип: "Type",
  Оценка: "Rating",
  Ссылки: "Links",
  Другое: "Other",
  "На главную": "Home",
  Настройки: "Settings",

  // ── Вкладки ──────────────────────────────────
  Статусы: "Statuses",
  Любимое: "Favorites",
  Отзывы: "Reviews",
  Статистика: "Statistics",
  "Тир-лист": "Tier list",

  // ── Разделы и статусы ────────────────────────
  "В процессе": "In progress",
  Отложено: "On hold",
  Планирую: "Planned",
  Архив: "Archive",
  Тайтлы: "Titles",
  Персонажи: "Characters",
  Персоны: "People",
  Брошено: "Dropped",

  // ── Полки оценок (GRADES_DEF) ────────────────
  Резонанс: "Resonance",
  "Личный фаворит. То, что откликнулось": "A personal favourite – the one that struck a chord",
  Эталон: "Benchmark",
  "Почти безупречное исполнение": "Almost flawless execution",
  Отлично: "Excellent",
  "Достойная работа с посылом": "A solid work with something to say",
  Аттракцион: "Ride",
  "Ярко, бодро, на один вечер": "Loud, brisk, good for one evening",
  "Фоновый шум": "Background noise",
  "Стерильно и вторично": "Sterile and derivative",
  Брак: "Defective",
  "Технически или сценарно несостоятельно": "Falls apart technically or in the writing",
  Разочарование: "Letdown",
  "Хороший старт, перечеркнутый бездарным финалом": "A good start ruined by a wasted ending",

  // ── Типы медиа ───────────────────────────────
  Аниме: "Anime",
  Манга: "Manga",
  Манхва: "Manhwa",
  Маньхуа: "Manhua",
  Ранобэ: "Light novel",
  Фильм: "Movie",
  Сериал: "Series",
  Дорама: "Drama",
  Книга: "Book",
  Игра: "Game",
  Гача: "Gacha",

  // ── Категории тегов ──────────────────────────
  "Визуал / звук": "Visuals / sound",
  "Сюжет / нарратив": "Plot / narrative",
  "Персонажи / мир": "Characters / world",
  "Атмосфера / эмоции": "Mood / emotion",
  Жанр: "Genre",

  // ── Роли персон ──────────────────────────────
  Актёр: "Actor",
  Режиссёр: "Director",
  Автор: "Author",
  Сэйю: "Voice actor",
  Художник: "Artist",
  Композитор: "Composer",

  // ── Единица коллекции ────────────────────────
  тайтл: "title",
  тайтла: "titles",
  тайтлов: "titles",
  запись: "entry",
  записи: "entries",
  записей: "entries",

  // ══ ТЕГИ – только для показа, ключ остаётся русским ══
  // Визуал / звук
  "Визуальный нарратив": "Visual storytelling",
  "История рассказывается без слов – через образы и детали":
    "The story is told without words – through images and detail",

  // Сюжет / нарратив
  "Затягивает сразу": "Hooks you instantly",
  "Бодрый старт, невозможно оторваться": "A brisk start you can’t put down",
  "Долгая раскачка": "Slow to get going",
  "Нужно перетерпеть начало, чтобы стало интересно":
    "You have to sit through the opening before it gets good",
  "Сюжетные дыры": "Plot holes",
  "Много логических нестыковок": "Plenty of things that don’t add up",
  "Рояли в кустах": "Deus ex machina",
  "Внезапные спасения и нелепые совпадения": "Convenient rescues and absurd coincidences",
  Стеклище: "Heartbreak",
  "Автор беспощаден к героям и вашим нервам":
    "The author spares neither the characters nor your nerves",
  "Чеховские ружья": "Chekhov’s guns",
  "Детали из первых глав выстреливают спустя 100 выпусков":
    "Details from the first chapters pay off a hundred issues later",
  "Слитый финал": "Botched ending",
  "Концовка портит всё": "The ending ruins it",
  "Сильный финальный акт": "Strong final act",
  "Концовка вытягивает или венчает всё": "The ending either saves it or crowns it",
  "Открытый финал": "Open ending",
  "Намеренно без ответов, додумай сам": "Deliberately unresolved – finish it yourself",
  "До титров": "Gripping to the credits",
  "Держит в напряжении до конца": "Keeps the tension to the very end",
  Проседает: "Sags in the middle",
  "Темп провисает в середине": "The pacing slumps midway",
  "Ненадёжный рассказчик": "Unreliable narrator",
  "Не факт что рассказчику можно верить": "The narrator may not be telling the truth",
  "Поток сознания": "Stream of consciousness",
  "Нелинейное субъективное изложение": "Non-linear, deeply subjective telling",
  "Документальный стиль": "Documentary style",
  "Хроники, дневники, письма – эффект реальности":
    "Chronicles, diaries, letters – the feel of something real",
  "Медленный нарратив": "Slow narrative",
  "Атмосфера и детали важнее событий": "Mood and detail matter more than events",
  "Эпический масштаб": "Epic scope",
  "История через поколения, эпохи или целые миры":
    "A story spanning generations, eras or entire worlds",
  Саспенс: "Suspense",
  "Напряжение нагнетается без экшена": "Tension builds without any action",
  "Затянутый монтаж": "Overlong edit",
  "Мог быть короче – есть лишние сцены": "Could be shorter – there are scenes to spare",
  "Сюжет удивил": "The plot surprised me",
  "Ожидания были ниже результата": "It turned out better than expected",

  // Персонажи / мир
  "Живые герои": "Believable characters",
  "Персонажи с душой, которым веришь и сопереживаешь":
    "Characters with a soul, ones you believe and root for",
  "Картонные чары": "Cardboard cast",
  "Пустые герои-функции без внятной мотивации":
    "Hollow plot devices with no real motivation",
  "Крутой протагонист": "Great protagonist",
  "Главный герой тащит на себе весь тайтл": "The lead carries the whole thing",
  "Слабый ГГ": "Weak lead",
  "Главный герой скучный, глупый или раздражающий":
    "The lead is dull, dim or plain annoying",
  "Топ антагонист": "Great antagonist",
  "Злодей интереснее или харизматичнее героев":
    "The villain is more interesting than the heroes",
  "Актёр тащит": "Carried by the performance",
  "Харизма исполнителя вытягивает весь материал":
    "The performer’s charisma lifts the whole material",
  "Оригинальный сеттинг": "Original setting",
  "Необычный мир, который интересно изучать": "An unusual world that rewards exploring",
  "Дырявый сеттинг": "Threadbare setting",
  "Декорации без внятного лора и истории": "Scenery with no lore or history behind it",
  "Лор важнее сюжета": "Lore over plot",
  "Мир интереснее происходящих событий": "The world is more interesting than the events",
  "Нарратив через окружение": "Environmental storytelling",
  "Лор спрятан в деталях мира, а не в диалогах":
    "The lore hides in the world’s details rather than the dialogue",

  // Атмосфера / эмоции / качество
  "Без кринжа": "No cringe",
  "Выдержанный тон, без неловкого пафоса": "A steady tone, free of awkward grandstanding",
  "Почти без кринжа": "Almost no cringe",
  "Почти выдержанный тон": "A mostly steady tone",
  "Много кринжа": "Lots of cringe",
  "Неловкие моменты, пафос или странный юмор":
    "Awkward moments, grandstanding or odd humour",
  Жесть: "Brutal",
  "Много насилия, крови или безумных поворотов":
    "Plenty of violence, blood or unhinged turns",
  Философия: "Philosophy",
  "Размышления о смысле бытия и прочего": "Musings on the meaning of it all",
  "Чистый кайф": "Pure pleasure",
  "Читается легко, идеально для расслабления": "An easy read, perfect for unwinding",
  "Серая мораль": "Grey morality",
  "Нет чёткого деления на добро и зло": "No clean split between good and evil",
  "Хорни вайб": "Horny vibe",
  "Много фансервиса, акцент на сексуальности": "Heavy fanservice, sexuality up front",
  Переоценён: "Overrated",
  "Хайп не соответствует реальному качеству": "The hype outruns the actual quality",
  Недооценён: "Underrated",
  "Прошло мимо незаслуженно": "Undeservedly overlooked",
  "Тяжело смотреть повторно": "Hard to revisit",
  "Слишком больно или скучно при пересмотре": "Too painful or too dull the second time",
  "Лучше в оригинале": "Better in the original",
  "Перевод или локализация убивают часть смысла":
    "Translation or localisation loses part of the meaning",
  "Слабая режиссура": "Weak direction",
  "Важные моменты не вызывают эмоций": "The big moments land flat",
  "Абсолют синема": "Absolute cinema",
  "Постановка, катсцены и подача на высоком уровне":
    "Staging, cutscenes and delivery all at a high level",

  // Игры
  Автобой: "Auto-battle",
  "Игра сама играет в игру лучше вас": "The game plays itself better than you do",
  "Душный гринд": "Stifling grind",
  "Слишком много однообразной рутины": "Far too much repetitive busywork",
  "Мета-дрочево": "Meta slavery",
  "Без изучения актуальной меты жить тяжело":
    "Life is hard unless you keep up with the current meta",
  "Топ боёвка": "Great combat",
  "Драки приносят удовольствие даже спустя десятки часов":
    "The fighting still feels good dozens of hours in",
  Вайфугейминг: "Waifu gaming",
  "Персонажи запоминаются дизайном и харизмой":
    "The characters stick with you through design and charisma",
  "Скипал диалоги": "Skipped the dialogue",
  "История не смогла удержать внимание": "The story never held my attention",
  "Идеальный геймфил": "Perfect game feel",
  "Управление само по себе приносит удовольствие":
    "The controls are a pleasure in their own right",
  "Переусложнённые системы": "Overcomplicated systems",
  "Слишком много механик, легко потеряться": "Too many mechanics, easy to get lost",
  "Короткая и ёмкая": "Short and dense",
  "Прошёл за вечер – и не пожалел": "Finished it in an evening and didn’t regret it",
  "Слабый финальный босс": "Weak final boss",
  "Финальный босс разочаровал геймплейно или сюжетно":
    "The final boss disappoints in play or in story",

  // Жанры
  Комедия: "Comedy",
  "Юмор – основа или важная часть": "Humour is the point, or a large part of it",
  Хоррор: "Horror",
  "Страх, напряжение, атмосфера ужаса": "Fear, tension, an atmosphere of dread",
  Триллер: "Thriller",
  "Саспенс и непредсказуемые повороты": "Suspense and turns you don’t see coming",
  Детектив: "Mystery",
  "Расследование и разгадка тайны в центре": "An investigation and its solution at the centre",
  Романтика: "Romance",
  "Любовная линия как основа сюжета": "The love story carries the plot",
  Драма: "Drama",
  "Акцент на эмоциях и человеческих конфликтах":
    "Focused on emotion and human conflict",
  Экшен: "Action",
  "Динамика, сражения, адреналин": "Momentum, fights, adrenaline",
  Фэнтези: "Fantasy",
  "Магия, мифология, выдуманные миры": "Magic, mythology, invented worlds",
  "Наука, технологии, будущее как основа мира":
    "Science, technology and the future as the foundation",
  Киберпанк: "Cyberpunk",
  "Высокие технологии, низкий уровень жизни": "High tech, low life",
  Постапокалипсис: "Post-apocalyptic",
  "Мир после катастрофы": "A world after the catastrophe",
  Исторический: "Historical",
  "Реальная историческая эпоха как сеттинг": "A real historical era as the setting",
  Психологический: "Psychological",
  "Акцент на психике, восприятии, манипуляции":
    "Focused on the mind, perception and manipulation",
  Военный: "War",
  "Война как основной контекст": "War as the main context",
  Спокон: "Sports",
  "Спорт и путь к вершине": "Sport and the climb to the top",
  Меха: "Mecha",
  "Гигантские роботы и пилоты": "Giant robots and their pilots",
  Сэйнэн: "Seinen",
  "Для взрослой аудитории, сложные темы": "For an adult audience, difficult subjects",
  Сёнэн: "Shonen",
  "Приключения, дружба, сила воли": "Adventure, friendship, force of will",
  Иммерсивный: "Immersive",
  "Полностью погружает в свой мир и атмосферу":
    "Pulls you completely into its world and mood",
  "Роуд-муви": "Road movie",
  "Путешествие как метафора или буквальный сюжет":
    "A journey, literal or metaphorical",
  Биография: "Biography",
  "Реальный человек или основано на реальных событиях":
    "A real person, or based on real events",
});

// ── Склонения типов (формы для plural) ────────
// В английском форм две, поэтому вторая и третья совпадают –
// i18nPlural() для en берёт первую при 1 и третью в остальных случаях.
i18nRegister({
  аниме: "anime",
  манга: "manga",
  манги: "manga",
  манг: "manga",
  манхва: "manhwa",
  манхвы: "manhwa",
  манхв: "manhwa",
  маньхуа: "manhua",
  ранобэ: "light novel",
  фильм: "movie",
  фильма: "movies",
  фильмов: "movies",
  сериал: "series",
  сериала: "series",
  сериалов: "series",
  дорама: "drama",
  дорамы: "dramas",
  дорам: "dramas",
  книга: "book",
  книги: "books",
  книг: "books",
  игра: "game",
  игры: "games",
  игр: "games",
  гача: "gacha",
  гачи: "gachas",
  гач: "gachas",
});

// ── Названия тем ──────────────────────────────
i18nRegister({
  Классический: "Classic",
  "Классический светлый": "Classic light",
  "Мягкий ботанический": "Soft botanical",
  "Мягкий ботанический тёмный": "Soft botanical dark",
  Брутализм: "Brutalist",
  "Брутализм тёмный": "Brutalist dark",
  Неоморфизм: "Neumorphism",
  "Неоморфизм тёмный": "Neumorphism dark",
  Рисованный: "Hand-drawn",
  "Рисованный тёмный": "Hand-drawn dark",
});

// ── Палитра темы ──────────────────────────────
i18nRegister({
  "Фон страницы": "Page background",
  "Самый нижний слой": "The bottom-most layer",
  "Фон второго уровня": "Secondary background",
  "Поля ввода, вложенные подложки": "Input fields, nested surfaces",
  "Блоки и карточки": "Blocks and cards",
  "Карточки, панели, модалки": "Cards, panels, dialogs",
  "Блоки второго уровня": "Secondary blocks",
  "Вкладки, чипы, поле поиска": "Tabs, chips, the search field",
  Границы: "Borders",
  "Тонкие разделители": "Thin dividers",
  "Границы заметные": "Prominent borders",
  "Рамки кнопок и полей": "Button and field outlines",
  "Основной текст": "Body text",
  "Тело отзывов и подписи": "Review text and captions",
  "Приглушённый текст": "Muted text",
  "Даты, вторичные пометки": "Dates, secondary notes",
  Заголовки: "Headings",
  "Названия, яркий текст": "Titles, bright text",
  Акцент: "Accent",
  "Активные кнопки, ссылки, подсветки": "Active buttons, links, highlights",
});

// ── Подписи интерфейса (DEFAULT_LABELS) ───────
i18nRegister({
  "Цифровой паспорт интересов": "A digital passport of taste",
  Всего: "Total",
  завершено: "completed",
  "Разбивка по типам": "Breakdown by type",
  "Шкала послевкусия": "Aftertaste scale",
  Пересмотры: "Rewatches",
  "Частые теги в отзывах": "Frequent tags in reviews",
  "По годам просмотра": "By year watched",
  "По годам выхода": "By release year",
  "тайтл пересмотрен": "title rewatched",
  "тайтла пересмотрено": "titles rewatched",
  "тайтлов пересмотрено": "titles rewatched",
  "Тайтл {year} года": "Title of {year}",
  "Тайтлы {year} года": "Titles of {year}",
  "За {year} год пока нет завершённых с оценкой":
    "Nothing finished and rated for {year} yet",
});

// ── Прочее ────────────────────────────────────
i18nRegister({
  "Удалить «{name}»?": "Delete “{name}”?",
  "Например: Брошено": "For example: Dropped",
  // Подсказки тегов, до которых не дошла первая партия
  "Авторский почерк, к которому нужно привыкнуть":
    "A distinctive style that takes getting used to",
  "Бюджетно, криво или слишком упрощённо": "Cheap, clumsy or overly simplified",
  "Красивая картинка, операторская работа, постановка":
    "Beautiful imagery, camerawork and staging",
  "Музыка усиливает сцены": "The music lifts the scenes",
  "Ощущение непрерывной съёмки, без склеек":
    "The feel of one unbroken take, no cuts",
  "Эстетическое наслаждение, детализация на высоте":
    "A pleasure to look at, detail everywhere",
});

// ── Экран приветствия ─────────────────────────
i18nRegister({
  "Язык интерфейса": "Interface language",
  "Создать новый TasteID": "Create new TasteID",
  "Создайте новый TasteID внутри указанной папки": "Create a new TasteID inside a folder you pick",
  "Открыть существующий TasteID": "Open existing TasteID",
  "Если папка с TasteID уже есть": "If you already have a TasteID folder",
  "Другая папка": "Another folder",
  "Выбор темы": "Choose a theme",
  "Система оценивания": "Rating system",
  "Добавить полку": "Add shelf",
  Названия: "Names",
  Числа: "Numbers",
  Звёзды: "Stars",
  "Сколько звёзд": "How many stars",
  Максимум: "Maximum",
  "Новая полка": "New shelf",
  Название: "Name",
  от: "from",
  до: "to",
  "Создать паспорт": "Create passport",
  "Готовим паспорт…": "Preparing the passport…",
  "Удалить полку «{name}»?": "Delete the “{name}” shelf?",
});

// ── Панель «Приложение» ───────────────────────
i18nRegister({
  Язык: "Language",
  Масштаб: "Zoom",
  Приложение: "App",
  "Папка с данными": "Data folder",
  "Открыть в проводнике": "Show in file manager",
  "Сменить папку…": "Change folder…",
  "Хранится во внутренней области приложения – её не видят другие приложения, и она исчезнет вместе с удалением TasteID. Чтобы перенести данные на другое устройство – резервная копия ниже.":
    "Stored inside the app's private storage – other apps can't see it, and it's deleted along with TasteID. To move your data to another device, use the backup below.",
  "Резервная копия": "Backup",
  "Отзывы, любимое, тир-листы, настройки и загруженные вручную картинки – одним файлом, для себя.":
    "Reviews, favorites, tier lists, settings and manually uploaded pictures – in one file, for yourself.",
  "Скачать резервную копию": "Download backup",
  "Восстановить из файла…": "Restore from file…",
  "Текущие отзывы, любимое, тир-листы и настройки будут заменены содержимым файла. Отменить это можно только другой резервной копией. Продолжить?":
    "Current reviews, favorites, tier lists and settings will be replaced with the file's contents. The only way to undo this is another backup. Continue?",
  "Это не похоже на файл резервной копии – внутри не JSON.":
    "This doesn't look like a backup file – there's no JSON inside.",
  "Восстановлено. Обновляем страницу…": "Restored. Reloading the page…",
  Мельче: "Smaller",
  Крупнее: "Larger",
  Сбросить: "Reset",
  "О программе": "About",
  "не выбрана": "not selected",
});

// ── Панель «Хранилища» ────────────────────────
i18nRegister({
  Хранилища: "Vaults",
  "Несколько независимых хранилищ на одном устройстве – со своими отзывами, тир-листами и синхронизацией у каждого. Переключение между ними ничего не стирает: данные остаются каждое в своей папке.":
    "Several independent vaults on one device – each with its own reviews, tier lists and sync. Switching between them doesn't erase anything: each vault's data stays in its own folder.",
  "Создать новое хранилище…": "Create a new vault…",
  "Открыть существующее…": "Open an existing one…",
  "Добавить хранилище…": "Add a vault…",
  текущее: "current",
  "Убрать из списка": "Remove from list",
  "Имя нового хранилища:": "Name for the new vault:",
  "Новое хранилище": "New vault",
  "Имя для этого хранилища:": "Name for this vault:",
  Хранилище: "Vault",
  "Хранилище будет убрано из списка. Сама папка на диске никуда не денется – её можно будет открыть заново через «Открыть существующее».":
    "The vault will be removed from the list. The folder itself stays right where it is on disk – you can open it again later via “Open an existing one”.",
  "Хранилище и все его данные будут стёрты с телефона. Продолжить?":
    "The vault and all of its data will be erased from the phone. Continue?",
});

// ── Разметка страниц ──────────────────────────
i18nRegister({
  "(необязательно)": "(optional)",
  "↺ Восстановить": "↺ Restore",
  "✎ Изменить": "✎ Edit",
  "⤓ Скачать": "⤓ Download",
  "⬆ Загрузить с компьютера": "⬆ Upload from computer",
  "1 штука": "1 item",
  "Без цвета": "No colour",
  "Бэкап и восстановление": "Backup and restore",
  "Ввести URL вручную": "Enter a URL by hand",
  "Вернуть все цвета темы": "Reset all theme colours",
  Вкладки: "Tabs",
  "Пустое поле означает «оставить как есть» – под ним написано значение по умолчанию.":
    "An empty field means “leave as is” – the default is shown underneath.",
  "Выберите тайтл слева или создайте новый": "Pick a title on the left, or create a new one",
  "Выбрать файл": "Choose file",
  Год: "Year",
  "Год выхода": "Release year",
  Даты: "Dates",
  Диапазон: "Range",
  "Добавить в Любимое": "Add to favorites",
  "Добавить дату": "Add a date",
  "Добавить ещё один источник": "Add another source",
  "Добавить источник": "Add source",
  "Добавить категорию": "Add category",
  "Добавить коллекцию": "Add collection",
  "Добавить обложку": "Add cover",
  "Добавить отзыв": "Add review",
  "Добавить оценку и теги": "Add a rating and tags",
  "Добавить персонажа": "Add character",
  "Добавить раздел": "Add section",
  "Добавить роль": "Add role",
  "Добавить тег": "Add tag",
  "Добавить текст отзыва": "Add review text",
  "Добавить тип": "Add type",
  "Добавить тир": "Add tier",
  "Если смотрел один день – заполните только «Завершил» или укажите одинаковые даты, на карточке покажется одна дата.":
    "If it took a single day, fill in only “Finished” (or use the same date twice) – the card will show one date.",
  Завершено: "Finished",
  Завершил: "Finished",
  "Загрузить как обложку": "Upload as cover",
  "Запись пропадёт из отзывов, «Любимого» и тир-листа. Вернуть можно через «Историю версий».":
    "The entry disappears from reviews, favorites and the tier list. You can bring it back from “Version history”.",
  "Здесь появится превью…": "The preview will appear here…",
  "Из какого произведения": "Which title it is from",
  "Или загрузите файл – сожмётся и сконвертируется в WebP автоматически.":
    "Or upload a file – it will be compressed and converted to WebP automatically.",
  "Или загрузить с компьютера": "Or upload from your computer",
  Импорт: "Import",
  Имя: "Name",
  "Имя *": "Name *",
  "Имя персонажа": "Character name",
  "Имя персонажа *": "Character name *",
  "имя-папки": "folder-name",
  "История версий": "Version history",
  "Каждая полка – диапазон значений с названием и цветом. Именно эти полки станут строками тир-листа.":
    "Each shelf is a range of values with a name and a colour. These shelves become the rows of the tier list.",
  "Каждое сохранение файла – это отдельная версия, которая навсегда остаётся здесь, даже если текущая версия сломается. Выберите файл, найдите нужную дату и либо скачайте эту версию как JSON, либо восстановите её – тогда она станет текущей.":
    "Every save of a file is a separate version kept here for good, even if the current one breaks. Pick a file, find the date you need, and either download that version as JSON or restore it – then it becomes the current one.",
  Категории: "Categories",
  Категория: "Category",
  Коллекции: "Collections",
  "Короткое пояснение, что значит тег": "A short note on what the tag means",
  "Название *": "Title *",
  "Название категории": "Category name",
  "Название нового тира": "New tier name",
  "Название тайтла *": "Title *",
  "Название тега": "Tag name",
  "Например: 12 серий": "For example: 12 episodes",
  "Например: Артбук": "For example: Artbook",
  "Например: Дзен": "For example: Zen",
  "Например: Крутой саундтрек": "For example: Great soundtrack",
  "Например: Локации": "For example: Locations",
  "Например: Опенинги": "For example: Openings",
  "Например: Пейринги": "For example: Pairings",
  "Например: Перечитываю": "For example: Rereading",
  "Например: Продюсер": "For example: Producer",
  "Например: Технические детали": "For example: Technical details",
  Начал: "Started",
  "Новая запись": "New entry",
  "Новая коллекция": "New collection",
  "Новый отзыв": "New review",
  "Новый раздел": "New section",
  "Новый тайтл": "New title",
  "Новый тег": "New tag",
  "Новый тир-лист": "New tier list",
  "Обложка (URL)": "Cover (URL)",
  Ок: "OK",
  "Описание – показывается подсказкой при наведении":
    "Description – shown as a tooltip on hover",
  Основное: "Basics",
  "Откуда (необязательно)": "Where from (optional)",
  "Отметьте тайтлы в редакторе отзыва.": "Mark titles in the review editor.",
  Оформление: "Appearance",
  "Оценка и теги": "Rating and tags",
  "Оценки и статусы": "Ratings and statuses",
  Палитра: "Palette",
  "Размер шрифта": "Text size",
  "Только текст – иконки и отступы не меняются. Чтобы увеличить вообще всё, используйте «Масштаб» на вкладке «Приложение».":
    "Text only – icons and spacing stay the same. To scale up everything, use “Zoom” on the App tab.",
  "Папка (источник)": "Folder (source)",
  "Папка по умолчанию в chars/ *": "Default folder inside chars/ *",
  "Папки не найдены": "No folders found",
  "Пара предложений – что это и о чём…": "A couple of sentences – what it is and what it’s about…",
  Паспорта: "Passports",
  "Переименуйте, перекрасьте, удалите или добавьте свою.":
    "Rename, recolour, delete, or add your own.",
  "Пересмотров (не считая первого раза)": "Rewatches (not counting the first time)",
  "Перетащите за ⠿, чтобы изменить порядок, затем нажмите «Сохранить порядок»":
    "Drag by ⠿ to reorder, then press “Save order”",
  "Перетащите карточки, чтобы изменить порядок. Нажмите «Сохранить», когда готово.":
    "Drag the cards to reorder them. Press “Save” when you’re done.",
  Персона: "Person",
  Персонаж: "Character",
  "Персонажи и персоны": "Characters and people",
  Подписи: "Labels",
  "Подсказка (необязательно)": "Tooltip (optional)",
  "Пока нет истории для этого файла.": "No history for this file yet.",
  Полки: "Shelves",
  "Полки (от лучшей к худшей)": "Shelves (best to worst)",
  "Полный текст – необязательно": "Full text – optional",
  "Превью – показывается на карточке": "Preview – shown on the card",
  "Развёрнутый отзыв – откроется по клику на карточку. Если оставить пустым, при клике покажется превью со ссылкой на источник.":
    "The full review – opens when the card is clicked. If left empty, the click shows the preview with a link to the source.",
  "Разделы вкладки «Любимое»": "Sections of the “Favorites” tab",
  "Скрыть тип «{name}» из списка?\n\nУже добавленные персонажи и персоны останутся на вкладке «Любимое» как есть – пропадёт только возможность выбрать этот тип для новой или редактируемой записи. Вернуть можно здесь же.":
    "Hide the “{name}” type from the list?\n\nCharacters and people already added stay on the “Favorites” tab as is – only the ability to pick this type for a new or edited entry disappears. You can bring it back the same way.",
  "Разделы вкладки «Статусы»": "Sections of the “Statuses” tab",
  "Редактор порядка": "Order editor",
  "Редактор тир-листов персонажей": "Character tier list editor",
  "Роль персоны": "Person’s role",
  Светлая: "Light",
  "Склонение подставилось автоматически (чёрн­овик) – поправьте, если неточно.":
    "The plural was filled in automatically (a rough draft) – correct it if it’s off.",
  "Создать список": "Create list",
  "Сохранить всё": "Save all",
  "Сохранить отзыв": "Save review",
  "Сохранить порядок": "Save order",
  "Ссылка на изображение": "Image link",
  "Ссылка на обложку": "Cover link",
  "Ссылка на публикацию отзыва на стороне – например, на Teletype.":
    "A link to the review published elsewhere – on Teletype, for instance.",
  Статус: "Status",
  "Существующие теги": "Existing tags",
  Тег: "Tag",
  Теги: "Tags",
  "Текст отзыва": "Review text",
  текущая: "current",
  Тёмная: "Dark",
  "Тип шкалы влияет на то, как выглядит поле оценки в форме добавления и как тайтлы раскладываются по тир-листу.":
    "The scale type decides how the rating field looks in the editor and how titles are laid out in the tier list.",
  "Тир-листы": "Tier lists",
  "Переименовать тир-лист": "Rename tier list",
  "Удалить тир-лист": "Delete tier list",
  "Удалить список": "Delete list",
  "Удалить этот отзыв": "Delete this review",
  "Формат (доп.)": "Format (extra)",
  Цвет: "Colour",
  "Цвет не задан – теги будут нейтральными": "No colour set – tags will look neutral",
  "Цвет темы": "Theme colour",
  'Что показывать на вкладке "Статистика".': "What to show on the “Statistics” tab.",
  "ID (латиница, без пробелов) *": "ID (latin letters, no spaces) *",
  "ID нельзя менять у существующего тайтла – на него уже могут ссылаться сохранённые данные.":
    "The ID of an existing title can’t be changed – saved data may already point at it.",
  "URL картинки": "Image URL",
});

// ── Импорт, паспорта, статистика, тир-лист ────
i18nRegister({
  ". Список должен быть открыт – если в настройках профиля он закрыт, снаружи его не видно.":
    ". The list must be public – if it’s private in the profile settings, nobody can see it.",
  "+ завести свой статус…": "+ create your own status…",
  "Аниме и манга": "Anime and manga",
  "Без всяких ключей сайт уже достаёт обложки аниме и манги (у AniList) и обложки книг (у Open Library) – там их отдают всем. Ключ нужен только для фильмов: единственная открытая база с постерами, TMDB, пускает по ключу. Ключ бесплатный и выдаётся сразу.":
    "With no keys at all, covers for anime and manga (from AniList) and for books (from Open Library) already arrive – those are open to everyone. A key is only needed for movies: TMDB, the one open poster database, asks for one. It’s free and issued immediately.",
  "без оценки": "no rating",
  "Больше всего пересмотрено:": "Most rewatched:",
  "в выгрузке": "in the export",
  "в любимом": "in favorites",
  "В паспорте нет списка тайтлов.": "There is no list of titles in this passport.",
  "В паспорте нет шкалы оценок – показывать будет нечего.":
    "There is no rating scale in this passport – there would be nothing to show.",
  "В планах": "Planned",
  "Введите название": "Enter a name",
  "Внутри файла должен быть объект паспорта.": "The file must contain a passport object.",
  Всё: "Everything",
  "Всё время": "All time",
  "Все года": "All years",
  "Все настройки": "All settings",
  всего: "in total",
  "Выберите тип Developer, примите условия и заполните короткую анкету (в поле о цели использования достаточно написать, что ведёшь личный список просмотренного).":
    "Pick the Developer type, accept the terms and fill in the short form (for the purpose field, “keeping a personal watch list” is enough).",
  "Выбрать файл выгрузки": "Choose an export file",
  "Выгрузить свой": "Export mine",
  "Где разошлись": "Where you disagree",
  "Где сошлись": "Where you agree",
  "Готово. Сайт обновится в течение минуты.": "Done.",
  добавлено: "added",
  "Забираем мангу…": "Fetching manga…",
  "Забрать список": "Fetch the list",
  забыть: "forget",
  "Заведите аккаунт на themoviedb.org и подтвердите почту.":
    "Create an account on themoviedb.org and confirm your email.",
  Завести: "Create",
  "Загружаем историю…": "Loading history…",
  "Загрузить чужой паспорт": "Load someone’s passport",
  "заметных споров": "notable disagreements",
  "Игры пока не принимаем: у сервисов, где их ведут, нет общего формата выгрузки. Появится образец файла – разберём и его.":
    "Games aren’t accepted yet: the services that track them have no common export format. Send a sample file and it will be supported.",
  "Или по нику с AniList": "Or by AniList username",
  "Импортировать ещё файл": "Import another file",
  История: "History",
  "Ключ появится тут же, в строке API Key (v3 auth) – скопируйте его сюда целиком.":
    "The key appears right there, in the API Key (v3 auth) row – copy the whole thing here.",
  "Ключ принят. Постеры к фильмам теперь приедут вместе со списком.":
    "Key accepted. Movie posters will now arrive with the list.",
  "Ключ хранится только в этом браузере и никуда не уходит: ни на сервер сайта, ни в его файлы. Причина простая – репозиторий сайта открытый, и всё, что сохраняется в настройках, видно любому. Обратная сторона: на другом устройстве ключ придётся ввести заново.":
    "The key is kept in this browser only and goes nowhere else. The downside: on another device you’ll have to enter it again.",
  "ключ v3, 32 знака": "v3 key, 32 characters",
  Книги: "Books",
  "можно забрать себе": "worth picking up",
  "Название…": "Name…",
  "Настройки профиля → раздел API → Request an API Key.":
    "Profile settings → API section → Request an API Key.",
  "не импортировать": "don’t import",
  "Не получилось достучаться до AniList. Проверьте интернет и попробуйте ещё раз.":
    "Couldn’t reach AniList. Check your connection and try again.",
  "не тронуто": "untouched",
  "Не удалось узнать формат файла. Понимаем выгрузки: MyAnimeList и Шикимори (XML),":
    "Couldn’t recognise the file format. Supported exports: MyAnimeList and Shikimori (XML),",
  "Нет тайтлов с флагом «Любимое».": "No titles marked as favorites.",
  "Нечего переносить: у всех записей статус помечен как «не импортировать».":
    "Nothing to import: every entry’s status is set to “don’t import”.",
  ник: "username",
  "ник на AniList": "AniList username",
  "Ник тот же, что в адресе профиля: anilist.co/user/":
    "The same username as in the profile address: anilist.co/user/",
  новых: "new",
  обновлено: "updated",
  "Общих оценок не нашлось.": "No ratings in common.",
  он: "them",
  "Открыть отзыв: {v0}": "Open review: {v0}",
  Оценки: "Ratings",
  "Ошибка сохранения": "Save failed",
  "Перенести в паспорт": "Import into the passport",
  "Перенос списка из другого сервиса. Формат узнаётся сам, выбирать его не нужно. Файл разбирается прямо здесь, в браузере, и никуда не отправляется, а в паспорт попадает только после того, как вы подтвердите.":
    "Moving a list over from another service. The format is detected automatically. The file is parsed right here and sent nowhere; nothing enters the passport until you confirm.",
  "пересмотр всего": "rewatch in total",
  "пересмотра всего": "rewatches in total",
  "пересмотров всего": "rewatches in total",
  "Пересмотров: {v0}": "Rewatches: {v0}",
  Перетащить: "Drag",
  "по нику": "by username",
  Подробнее: "More",
  "Пока без текста.": "No text yet.",
  "Полное согласие – спорить не о чем.": "Complete agreement – nothing to argue about.",
  "полок в шкале": "shelves in the scale",
  "Посмотреть все сохранённые версии данных и восстановить старую при необходимости":
    "Browse every saved version of your data and restore an older one if you need to",
  "постеры, год выхода и номер фильма": "posters, release year and the film’s id",
  "Проверить и сохранить": "Check and save",
  "Пройдено / просмотрено / прочитано": "Finished / watched / read",
  Просмотр: "View",
  Пусто: "Empty",
  Размер: "Size",
  Редактировать: "Edit",
  Редактор: "Editor",
  "с оценкой": "rated",
  "смотрели оба": "both watched",
  "Смотрю / читаю / играю": "Watching / reading / playing",
  "Снятая галочка перезапишет у них статус и оценку значениями из выгрузки. Тексты отзывов не пострадают в любом случае.":
    "Unchecking this overwrites their status and rating with the values from the export. Review texts are never affected.",
  "совпадение вкусов": "taste match",
  "Сохранить как картинку": "Save as image",
  "Разделы вкладки «{name}»": "Sections of the “{name}” tab",
  "Вернуть «Персонажи»": "Restore “Characters”",
  "Новое название тир-листа:": "New tier list name:",
  "Свои тир-листы (коллекции) теперь заводятся, переименовываются и удаляются прямо на вкладке «Тир-лист» – кнопкой «Создать» и значками рядом с каждым тир-листом.":
    "Your own tier lists (collections) are now created, renamed, and deleted right on the Tier List tab – with the “Create” button and the icons next to each one.",
  "Что показать на картинке?": "What should be on the image?",
  "Только тайтлы": "Titles only",
  "Только персонажи и персоны": "Characters and persons only",
  "Всё вместе": "Everything together",
  "Нечего показывать – в этой группе пока пусто.": "Nothing to show – this group is empty.",
  "Сохраняем…": "Saving…",
  "Спрашиваем AniList…": "Asking AniList…",
  "Спрашиваем TMDB, знает ли он такой ключ…": "Asking TMDB whether it knows this key…",
  "Сравнение со своим": "Compare with mine",
  "Стоит забрать себе": "Worth picking up",
  "Считаем…": "Calculating…",
  "Тир-лист не найден": "Tier list not found",
  "Только у вас": "Only yours",
  вы: "you",
  "Удалённые коллекции:": "Deleted collections:",
  "уже есть": "already there",
  "Узнан формат": "Format recognised",
  "Фавориты:": "Favorites:",
  "Файл не нужен и выгружать ничего не надо: открытый список AniList отдаёт кому угодно, и мы просто спросим его по нику. Поле для ника ниже. Обложки приезжают сразу вместе со списком.":
    "No file and no export needed: a public AniList list is readable by anyone, so we just ask for it by username. The field is below. Covers arrive with the list.",
  "Файл не от TasteID – не тот формат.": "This file isn’t from TasteID – wrong format.",
  "Файл не читается как XML. Выгрузка иногда приходит в архиве – распакуй его сначала.":
    "The file doesn’t parse as XML. Exports sometimes arrive zipped – unpack it first.",
  "Файл пустой или это не CSV и не XML. Нужна выгрузка списка из сервиса.":
    "The file is empty, or it’s neither CSV nor XML. A list export from a service is what’s needed.",
  Фильмы: "Movies",
  "Читаем файл…": "Reading the file…",
  "Читать полностью →": "Read in full →",
  "Что и откуда принимаем": "What is accepted, and from where",
  "Что уже есть в паспорте": "What the passport already has",
  "Чужой паспорт – файл: пусть человек выгрузит свой такой же кнопкой ниже и пришлёт. Дальше его можно просто посмотреть или сравнить со своим. Всё считается прямо в браузере, никуда не отправляется.":
    "Someone else’s passport is a file: have them export theirs with the button below and send it over. Then you can view it or compare it with yours. Everything is computed right here and sent nowhere.",
  "Это не резервная копия: файл легче, чем ваши настоящие данные (без текста отзывов, без избранного, без тир-листов), и загрузка сюда чужого паспорта ничего своего не трогает и не заменяет.":
    "This isn't a backup: the file is lighter than your real data (no review text, no favorites, no tier lists), and loading someone else's passport here doesn't touch or replace anything of yours.",
  Шикимори: "Shikimori",
  "Это не похоже на файл паспорта – внутри не JSON.":
    "This doesn’t look like a passport file – it isn’t JSON inside.",
  "Это XML, но списка аниме или манги внутри нет.":
    "It is XML, but there’s no anime or manga list inside.",
  "AniList просит подождать – слишком много запросов подряд. Попробуйте через минуту.":
    "AniList is asking us to wait – too many requests in a row. Try again in a minute.",
  "Goodreads и Letterboxd (CSV). Колонки в файле:": "Goodreads and Letterboxd (CSV). Columns found:",
  "goodreads.com/review/import → кнопка Export Library, через минуту там же появится ссылка на goodreads_library_export.csv.":
    "goodreads.com/review/import → the Export Library button; a minute later a link to goodreads_library_export.csv appears there.",
  "Hardcover (издание)": "Hardcover (edition)",
  "letterboxd.com/settings/data → Export Your Data. Скачается архив; внутри нужны ratings.csv (что оценено), watched.csv (что просмотрено) и watchlist.csv (что в планах) – по одному за раз.":
    "letterboxd.com/settings/data → Export Your Data. You get an archive; inside you need ratings.csv (rated), watched.csv (watched) and watchlist.csv (planned) – one at a time.",
  "MyAnimeList / Шикимори": "MyAnimeList / Shikimori",
  "myanimelist.net → значок профиля → Export → Anime List или Manga List → Export My List. Скачается архив .xml.gz – распакуй его, нужен файл .xml изнутри.":
    "myanimelist.net → profile icon → Export → Anime List or Manga List → Export My List. You get an .xml.gz archive – unpack it, the .xml inside is what’s needed.",
  "reviews.json не найден": "reviews.json not found",
  "shikimori.one → Настройки → Списки → Экспорт → формат MyAnimeList. Аниме и манга выгружаются двумя отдельными файлами – загрузите их по очереди.":
    "shikimori.one → Settings → Lists → Export → MyAnimeList format. Anime and manga come as two separate files – load them one after another.",
  "TMDB не узнал этот ключ. Проверьте, что скопирован он целиком.":
    "TMDB doesn’t recognise this key. Check that you copied all of it.",
});

// ── Служебные сообщения и подписи настроек ────
i18nRegister({
  "– светлая": " – light",
  "– тёмная": " – dark",
  "Блок оценок": "Ratings block",
  "Блок пересмотров": "Rewatches block",
  "Блок тегов": "Tags block",
  "Блоки статистики": "Statistics blocks",
  "Введите название источника": "Enter a source name",
  "Введите название категории": "Enter a category name",
  "Введите название роли": "Enter a role name",
  "Введи название статуса": "Enter a status name",
  "Введите название тега": "Enter a tag name",
  "Введите название типа": "Enter a type name",
  "Восстановлено ✓": "Restored ✓",
  "Выберите папку выше.": "Pick a folder above.",
  "Выберите файл": "Choose a file",
  "дата неизвестна": "date unknown",
  "Две-четыре (2 …)": "Two to four (2 …)",
  "Делаю резервную копию картинки перед сохранением...": "Backing up the image before saving…",
  "Делаю резервную копию картинки...": "Backing up the image…",
  "Делаю резервную копию обложки перед сохранением...": "Backing up the cover before saving…",
  "Делаю резервную копию обложки...": "Backing up the cover…",
  "Делаю резервную копию...": "Making a backup…",
  "Дизайн & Впечатление": "Design & impression",
  "Единица коллекции (склонение)": "Collection unit (plural forms)",
  "За год ничего нет ({year} подставится)": "Nothing for the year ({year} is substituted)",
  "Заголовок общего блока": "Heading of the overall block",
  "Загружаем папки…": "Loading folders…",
  "Загружено ✓": "Uploaded ✓",
  "Загружено ✓ Обновляю список...": "Uploaded ✓ Refreshing the list…",
  "Заполните имя": "Fill in the name",
  "Заполните название": "Fill in the title",
  "Категория добавлена – можно выбрать её выше": "Category added – you can pick it above",
  "Категория обновлена": "Category updated",
  "Категория удалена": "Category deleted",
  "Кнопка «все»": "The “all” button",
  "Лучшее за год – несколько ({year})": "Best of the year – several ({year})",
  "Лучшее за год – одно ({year})": "Best of the year – one ({year})",
  "Не удалось загрузить отзыв:": "Couldn’t load the review:",
  "Не удалось сконвертировать": "Couldn’t convert",
  "Не удалось сохранить копию": "Couldn’t save the copy",
  "Не удалось удалить:": "Couldn’t delete:",
  неизвестная: "unknown",
  "Новая категория": "New category",
  "Облако тегов": "Tag cloud",
  "Обрабатываю...": "Processing…",
  "Одна штука (1 …)": "One item (1 …)",
  "Отзыв с таким ID не найден": "No review with that ID",
  "Ошибка загрузки": "Loading error",
  "Ошибка сети:": "Network error:",
  "Ошибка удаления": "Delete failed",
  "Ошибка:": "Error:",
  "Папки не найдены в chars/. Введите URL вручную.":
    "No folders found in chars/. Enter a URL by hand.",
  "Пересмотров: 1 …": "Rewatches: 1 …",
  "Пересмотров: 2–4 …": "Rewatches: 2–4 …",
  "Пересмотров: 5+ …": "Rewatches: 5+ …",
  персонажа: "the character",
  "По типам (диаграмма)": "By type (chart)",
  "По типам (цифры)": "By type (numbers)",
  "Подзаголовок под названием": "Subtitle under the name",
  "Подпись под числом за год": "Caption under the year’s number",
  "Порядок сохранён.": "Order saved.",
  "Пять и больше (5 …)": "Five and more (5 …)",
  "Распределение оценок": "Rating distribution",
  "Редактировать запись": "Edit entry",
  "Редактировать отзыв": "Edit review",
  "Резервная копия сохранена ✓": "Backup saved ✓",
  "Резервную копию сделать не удалось:": "Couldn’t make a backup:",
  Слабо: "Weak",
  "Сначала выберите папку выше": "Pick a folder above first",
  "Сохранено ✓": "Saved ✓",
  "Сохранено.": "Saved.",
  "Сохранить изменения": "Save changes",
  "Справочник обновлён, но старые отзывы поправить не удалось":
    "The reference list is updated, but the older reviews couldn’t be changed",
  Средне: "Average",
  "Такая роль уже есть": "That role already exists",
  "Такой источник уже есть": "That source already exists",
  "Такой статус уже есть": "That status already exists",
  "Такой тег уже есть": "That tag already exists",
  "Такой тип уже есть": "That type already exists",
  тег: "tag",
  "Тег удалён": "Tag deleted",
  тегов: "tags",
  "Тегов пока нет": "No tags yet",
  Топ: "Top",
  "Топ тайтлы года": "Top titles of the year",
  "Удалить раздел? Уже добавленные записи останутся в данных, но перестанут где-либо отображаться.":
    "Delete this section? Existing entries stay in the data but stop appearing anywhere.",
  "Удалить тайтл и все его тир-листы?": "Delete the title and all of its tier lists?",
  "Удалить тир? Персонажи в нём тоже удалятся.":
    "Delete this tier? The characters in it are deleted too.",
  "Удалить этот тир-лист?": "Delete this tier list?",
  "Удаляем…": "Deleting…",
  "Фильтры на вкладке «Отзывы»": "Filters on the “Reviews” tab",
  Хорошо: "Good",
  "Шапка сайта": "Site header",
  "эту запись": "this entry",
});

// ── Подтверждения удаления (с подстановками) ──
i18nRegister({
  "Удалить «{name}»?": "Delete “{name}”?",
  "Удалить полку «{name}»?": "Delete the “{name}” shelf?",
  "Удалить роль «{name}»?": "Delete the “{name}” role?",
  "Удалить статус «{name}»?": "Delete the “{name}” status?",
  "Удалить тип «{name}»?": "Delete the “{name}” type?",
  "Удалить источник «{name}»?": "Delete the “{name}” source?",
  "Удалить категорию «{name}»?": "Delete the “{name}” category?",
  "Удалить раздел «{name}»?": "Delete the “{name}” section?",
  "Удалить «{name}» из тир-листа?": "Remove “{name}” from the tier list?",
  "Удалить тег «{name}»?\n\nОн пропадёт и из уже сохранённых отзывов.":
    "Delete the “{name}” tag?\n\nIt disappears from already saved reviews too.",
  "Удалить «{name}»?\n\nЗапись пропадёт из отзывов, «Любимого» и тир-листа.\nВернуть её можно будет только откатом в «Истории версий».":
    "Delete “{name}”?\n\nThe entry disappears from reviews, favorites and the tier list.\nThe only way back is a rollback in “Version history”.",
  "Удалить раздел «{name}»?\n\nЗаписи останутся в данных, но перестанут показываться. Вернуть раздел можно здесь же.":
    "Delete the “{name}” section?\n\nEntries stay in the data but stop being shown. You can bring the section back right here.",
  "Удалить коллекцию «{name}»?\n\nСам тир-лист останется лежать в {file}, вместе с картинками, – пропадёт только кнопка на вкладке.":
    "Delete the “{name}” collection?\n\nThe tier list itself stays in {file}, images and all – only the button on the tab disappears.",
  "Восстановить «{file}» до версии от {date}?\n\nЭто заменит текущий файл – все изменения после этой версии будут потеряны (но останутся в истории, их тоже можно будет восстановить обратно).":
    "Restore “{file}” to the version from {date}?\n\nThis replaces the current file – everything changed after that version is lost (though it stays in the history and can be restored back).",
});

// ── Синхронизация ──────────────────────────────
i18nRegister({
  Синхронизация: "Sync",
  "Свободно и без своего сервера: приватный репозиторий на GitHub как общее хранилище для всех ваших устройств – телефона, компьютера, ещё одного компьютера. GitHub здесь единственный сервер, а токен и служебные данные синхронизации остаются только на этом устройстве.":
    "Free, no server of our own: a private GitHub repository works as shared storage for all your devices – phone, computer, another computer. GitHub is the only server involved, and the token and sync bookkeeping stay only on this device.",
  "После подключения синхронизация запускается сама – через какое-то время после того, как что-то сохранено, и при открытии приложения. Кнопка «Синхронизировать сейчас» останется – на случай, если не хочется ждать.":
    "Once connected, sync runs on its own – a while after something is saved, and when the app opens. The “Sync now” button stays too, for when you don't want to wait.",
  "Заведите аккаунт на github.com, если его ещё нет – бесплатно.":
    "Create a github.com account if you don't have one – it's free.",
  "Создайте токен доступа –": "Create an access token –",
  "по этой ссылке": "using this link",
  ", галочка «repo» уже отмечена. Внизу страницы – «Generate token».":
    ", the “repo” checkbox is already ticked. At the bottom of the page – “Generate token”.",
  "Скопируйте токен (он показывается один раз) и вставьте сюда.":
    "Copy the token (it's shown only once) and paste it here.",
  "Токен доступа": "Access token",
  "Название репозитория": "Repository name",
  "Если такого репозитория ещё нет на вашем GitHub – создадим сами, приватным. Если уже есть (например, второе устройство его уже завело) – подключимся к нему.":
    "If you don't have this repository on GitHub yet, we'll create it, as private. If it already exists (say, another device already set it up), we'll connect to it.",
  "Галочка «repo» даёт токену доступ ко всем вашим репозиториям на GitHub, не только к этому. Если репозиторий для синка уже создан и хочется ограничить токен только им – заведите вместо этого fine-grained-токен (Settings → Developer settings → Personal access tokens → Fine-grained tokens на github.com) с доступом к одному этому репозиторию и правом Contents: Read and write.":
    "The “repo” checkbox gives the token access to all your repositories on GitHub, not just this one. If the sync repository already exists and you'd rather limit the token to just it – create a fine-grained token instead (Settings → Developer settings → Personal access tokens → Fine-grained tokens on github.com), scoped to that one repository with Contents: Read and write.",
  Подключить: "Connect",
  "Заполните токен и название репозитория.": "Fill in the token and repository name.",
  "Проверяем токен…": "Checking the token…",
  "Проверяем репозиторий…": "Checking the repository…",
  "Репозитория ещё нет – создаём…": "The repository doesn't exist yet – creating it…",
  "Подключено к": "Connected to",
  "Последняя синхронизация: {when}.": "Last synced: {when}.",
  "ещё не было": "never",
  "Синхронизировать сейчас": "Sync now",
  Отключить: "Disconnect",
  "Приложение забудет токен и репозиторий на этом устройстве. Сами данные – здесь и в репозитории – никуда не денутся, подключиться заново можно в любой момент.":
    "The app forgets the token and repository on this device. The data itself – here and in the repository – stays put; you can reconnect any time.",
  "Синхронизируем…": "Syncing…",
  "Готово, но {n} файл(ов) изменились и здесь, и в репозитории – выберите, что оставить.":
    "Done, but {n} file(s) changed both here and in the repository – pick what to keep.",
  "Готово: отправлено {pushed}, забрано {pulled}, без изменений {skipped}.":
    "Done: sent {pushed}, pulled {pulled}, unchanged {skipped}.",
  "Оставить моё": "Keep mine",
  "Взять оттуда": "Take theirs",
  "Конфликты решены.": "Conflicts resolved.",
});

// Тексты ошибок из app/js/sync.js – тоже через i18n(), поэтому словарь
// им нужен здесь же.
i18nRegister({
  "Не получилось достучаться до GitHub – проверьте соединение с интернетом.":
    "Couldn't reach GitHub – check your internet connection.",
  "GitHub не принял токен – проверьте, что он не истёк и не отозван.":
    "GitHub rejected the token – check that it hasn't expired or been revoked.",
  "GitHub временно ограничил число запросов – попробуйте через несколько минут.":
    "GitHub temporarily rate-limited requests – try again in a few minutes.",
  "У токена не хватает прав на этот репозиторий.": "The token doesn't have enough rights for this repository.",
  "Не получилось проверить токен.": "Couldn't verify the token.",
  "Не получилось проверить репозиторий.": "Couldn't check the repository.",
  "Хранилище TasteID для синхронизации между устройствами": "TasteID storage for syncing between devices",
  "Не получилось создать репозиторий.": "Couldn't create the repository.",
  "Не получилось прочитать файл из репозитория: {path}": "Couldn't read the file from the repository: {path}",
  "Синхронизация TasteID": "TasteID sync",
  "Не получилось отправить файл: {path}": "Couldn't send the file: {path}",
});

// ── Забрать чужой тайтл себе (паспорта) ────────
i18nRegister({
  "Добавить себе": "Add to my list",
});

// ── Название сайта в настройках («Подписи») ────
i18nRegister({
  "Название вместо TasteID": "Name instead of TasteID",
});

// ── Поиск по тегам (фильтры на вкладке «Отзывы») ──
i18nRegister({
  Теги: "Tags",
  "Название тега…": "Tag name…",
});

// ── Какие теги показывать на карточке (add.html) ──
i18nRegister({
  "Какие теги показывать на карточке": "Which tags to show on the card",
  "На карточке помещается немного – выберите, какие из выбранных тегов важнее. Остальные останутся видны внутри отзыва.":
    "The card only fits a few – pick which of the selected tags matter most. The rest stay visible inside the review.",
  "Выбрано: {n}/{max}": "Selected: {n}/{max}",
  "Ничего не выбрано – покажутся первые теги по порядку.": "Nothing selected – the first tags in order will show.",
  "Не показывать теги на карточке": "Don't show tags on the card",
  "Теги не будут показаны на карточке – только внутри отзыва.": "Tags won't show on the card – only inside the review.",
  "Теги на карточках": "Tags on cards",
  "Ставит «Не показывать теги на карточке» сразу во всех отзывах – то же самое, что открыть каждый и отметить эту галочку вручную. Сами теги никуда не пропадают, они по-прежнему видны внутри отзыва. Выключение возвращает теги на карточки всех отзывов разом, включая те, где галочку поставили вручную в редакторе конкретного отзыва.":
    "Turns on \"Don't show tags on the card\" for every review at once – the same as opening each one and checking that box by hand. The tags themselves aren't lost, they're still visible inside the review. Turning it off brings tags back on every card at once, including ones where the box was checked by hand in that review's own editor.",
  "Скрыть теги на всех карточках": "Hide tags on all cards",
  "Теги скрыты на всех карточках": "Tags hidden on all cards",
  "Готово – теги скрыты на {n} карточках.": "Done – tags hidden on {n} cards.",
  "Готово – теги возвращены на {n} карточках.": "Done – tags brought back on {n} cards.",
  "У всех отзывов теги на карточке уже были скрыты.": "Every review already had its card tags hidden.",
  "У всех отзывов теги на карточке уже были видны.": "Every review already had its card tags visible.",
});

// ── Массовое удаление тегов (add.html) ─────────
i18nRegister({
  "Ничего не выбрано": "Nothing selected",
  "Выбрано: {n}": "Selected: {n}",
  "Удалить выбранное": "Delete selected",
  "Удалить выбранные теги ({n})?\n\nОни пропадут и из уже сохранённых отзывов.":
    "Delete the selected tags ({n})?\n\nThey'll disappear from saved reviews too.",
  "Удаляем {i} из {n}…": "Deleting {i} of {n}…",
  "Удалено тегов: {n}": "Deleted {n} tags",
});

// ── Удаление категории с тегами внутри (add.html) ──
i18nRegister({
  "Перенести теги в категорию": "Move tags to category",
  "Перенести и удалить категорию": "Move and delete category",
  "Удалить категорию вместе с тегами": "Delete category with its tags",
  "В категории ещё {n} {word}. Перенести их в другую категорию или удалить вместе с категорией?":
    "The category still has {n} {word}. Move them to another category, or delete them along with the category?",
  "Переносим…": "Moving…",
  "Перенести теги категории «{from}» в «{to}» и удалить «{from}»?":
    "Move the tags from “{from}” to “{to}” and delete “{from}”?",
  "Удалить категорию «{name}» вместе со всеми тегами ({n})?\n\nОни пропадут и из уже сохранённых отзывов.":
    "Delete the category “{name}” along with all its tags ({n})?\n\nThey'll disappear from saved reviews too.",
});

// ── Цвета по типам (Статистика) ────────────────
i18nRegister({
  "Цвета по типам": "Colours by type",
  "Красят разбивку по типам и годам – диаграмму, столбики и цифры.":
    "Colours the breakdown by type and by year – the chart, the bars and the numbers.",
  "Цвет по умолчанию": "Default colour",
});

// ── Горячие клавиши (index.html, панель настроек) ──
i18nRegister({
  "Горячие клавиши": "Keyboard shortcuts",
  "Работают на главной странице – везде, кроме полей ввода и открытых окон.":
    "Work on the main page – everywhere except text fields and open windows.",
  "Переключить вкладку": "Switch tab",
  "Поиск в «Отзывах»": "Search in “Reviews”",
  "Список горячих клавиш": "List of keyboard shortcuts",
  "Закрыть окно": "Close window",
});

// ── Ограничения: должен остаться хотя бы один ──
i18nRegister({
  "Переименовать": "Rename",
  "Должен остаться хотя бы один тип": "At least one type must remain",
  "Должен остаться хотя бы один источник": "At least one source must remain",
  "Должна остаться хотя бы одна роль": "At least one role must remain",
});

// ── Поддержать автора (App panel) ──────────────
i18nRegister({
  "Поддержать автора": "Support the author",
  "Поддержать на Boosty": "Support on Boosty",
});

// ── Ручная проверка обновлений (App panel) ─────
i18nRegister({
  "Проверить обновления": "Check for updates",
  "Проверяем…": "Checking…",
  "У вас последняя версия.": "You're on the latest version.",
  "Не удалось проверить обновления.": "Couldn't check for updates.",
  "Найдена версия {v} – качаем, предложим установить.":
    "Found version {v} – downloading, we'll offer to install it.",
  "Запущено из исходников – обновления не проверяются.":
    "Running from source – updates aren't checked.",
});

// ── Настоящая «текущая» версия в истории ───────
i18nRegister({
  сейчас: "now",
});

// ── Возрастная чистка истории версий ───────────
i18nRegister({
  "Автоматически удалять версии старше:": "Automatically delete versions older than:",
  "Почистить сейчас": "Clean up now",
  "Применить выбранный срок прямо сейчас, не дожидаясь автоматической чистки – по всем файлам сразу":
    "Apply the selected age threshold right now instead of waiting for the automatic cleanup – across all files at once",
  "Не удалять автоматически": "Don't delete automatically",
  "Старше недели": "Older than a week",
  "Старше месяца": "Older than a month",
  "Старше полугода": "Older than six months",
  "Сначала выберите, версии старше какого срока чистить.": "Pick an age threshold first.",
  "Удалено версий: {n}": "Deleted {n} versions",
  "Не удалось почистить: {msg}": "Couldn't clean up: {msg}",
  "Удалить всю историю": "Delete all history",
  "Стереть все прошлые версии этого файла целиком, независимо от возраста – не только старые":
    "Wipe every past version of this file entirely, regardless of age – not just the old ones",
  "Удалить всю историю файла «{file}»?\n\nТекущая версия не пострадает – удалятся только прошлые.":
    "Delete all history for “{file}”?\n\nThe current version is untouched – only past ones are removed.",
  "История очищена ✓": "History cleared ✓",
  "Не удалось удалить: {msg}": "Couldn't delete: {msg}",
  "Версий: {n}": "Versions: {n}",
});

// ── Перебиндинг горячих клавиш (панель настроек) ─
i18nRegister({
  "Изменить": "Change",
  "Нажмите клавишу…": "Press a key…",
});

// ── Своя клавиша/кнопка мыши на вкладку (панель настроек) ─
i18nRegister({
  "Переключение вкладок": "Tab switching",
  "Цифры 1–5 переключают вкладки по порядку и сами подстраиваются, если какую-то скрыть.":
    "Digits 1–5 switch tabs in order and adjust automatically when one is hidden.",
  "не задано": "not set",
  "Очистить": "Clear",
  "Нажмите клавишу или кнопку мыши…": "Press a key or mouse button…",
  "Цифры 1–5 уже переключают вкладки по порядку.": "Digits 1–5 already switch tabs in order.",
  "Эта клавиша уже занята: {what}.": "That key is already taken by: {what}.",
  "Эта клавиша уже занята вкладкой «{tab}».": "That key is already taken by the “{tab}” tab.",
  "Средняя кнопка": "Middle button",
  "Кнопка «Назад»": "Back button",
  "Кнопка «Вперёд»": "Forward button",
  "Кнопка мыши {n}": "Mouse button {n}",
});

// ── Строки, добавленные аудитом перед релизом ─
i18nRegister({
  Убрать: "Remove",
  Порядок: "Order",
  "Ошибка:": "Error:",
  "Готово.": "Done.",
  "Итоги {year}": "{year} in review",
  "Ознакомился:": "Finished:",
  "с {date}": "since {date}",
  "выгружен {date}": "exported {date}",
  "Загружен чужой паспорт: {count}&nbsp;{unit}": "Someone else’s passport loaded: {count}&nbsp;{unit}",
  "«{name}» удалена.": "“{name}” deleted.",
  "Название нового тир-листа:": "Name for the new tier list:",
  "Развёрнутый текст сюда не перенесён – полный отзыв можно почитать по ссылке ниже.":
    "The full text hasn’t been moved here – the complete review is available at the link below.",
});

// ── Предупреждение о несохранённых изменениях ──
i18nRegister({
  "Отзыв не сохранён – закрыть и потерять правки?": "This review isn’t saved – close and lose your changes?",
  "Закрыть без сохранения": "Close without saving",
  Остаться: "Stay",
  "Есть несохранённые изменения.": "You have unsaved changes.",
  "Без сохранения": "Without saving",
  "Отзыв не сохранён.": "This review isn’t saved.",
});
