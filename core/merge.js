// ══════════════════════════════════════════════
//  СЛИЯНИЕ ТРЁХ ВЕРСИЙ ФАЙЛА ДАННЫХ
//
//  «База» – общее состояние, от которого начали править; «моё» и
//  «оттуда» – две правки после неё. Списки записей с id (отзывы,
//  «Любимое», тир-листы) сливаются по записям, объекты (настройки) и
//  сами записи – по полям. Что поменяли только с одной стороны, берётся
//  оттуда; новое с обеих сторон сохраняется; удалённое с одной стороны и
//  нетронутое с другой – удаляется. Настоящее противоречие (одно поле
//  по-разному, удалили там, где правили, две разные новые записи с одним
//  id) – { ok: false }, решает человек.
//
//  Один источник правды для двух мест: синхронизация (app/js/sync.js,
//  через POST /api/merge-json) и сохранение экранов, открытых давно
//  (настройки, редактор тир-листа – поле _base в core/api.js): пока экран
//  был открыт, синхронизация могла записать на диск правки с другого
//  устройства, и сохранение экрана целиком их бы затёрло.
// ══════════════════════════════════════════════

// Сравнение по содержимому, без учёта порядка ключей.
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
export const sameJson = (a, b) => stableJson(a) === stableJson(b);
const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// Три версии одного значения: undefined – «нет». Возвращает
// { ok, value }; ok: false – настоящее противоречие.
function mergeValue(base, local, remote) {
  if (sameJson(local, remote)) return { ok: true, value: local };
  if (sameJson(local, base)) return { ok: true, value: remote };
  if (sameJson(remote, base)) return { ok: true, value: local };
  return { ok: false };
}

// Объект – по ключам (а значение ключа – целиком, без углубления:
// внутри поля «правка с двух сторон» почти всегда и есть противоречие).
function mergeObjects(base, local, remote) {
  const b = isPlainObject(base) ? base : {};
  const keys = [...new Set([...Object.keys(remote), ...Object.keys(local)])];
  const out = {};
  for (const k of keys) {
    const m = mergeValue(b[k], local[k], remote[k]);
    if (!m.ok) return { ok: false };
    if (m.value !== undefined) out[k] = m.value;
  }
  return { ok: true, value: out };
}

// Список записей с id: id есть у каждой и нигде не повторяется.
function idListOf(list) {
  if (!Array.isArray(list)) return null;
  const map = new Map();
  for (const r of list) {
    if (!isPlainObject(r) || r.id === undefined || r.id === null) return null;
    const key = String(r.id);
    if (map.has(key)) return null;
    map.set(key, r);
  }
  return map;
}

function mergeRecordLists(base, local, remote) {
  const b = idListOf(base);
  const l = idListOf(local);
  const r = idListOf(remote);
  if (!b || !l || !r) return { ok: false };

  const merged = new Map();
  for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
    const lb = b.get(id);
    const ll = l.get(id);
    const lr = r.get(id);
    if (sameJson(ll, lr)) {
      if (ll !== undefined) merged.set(id, ll);
      continue;
    }
    if (lb === undefined) {
      // Новая запись. С двух сторон одновременно и разная – одинаковый id
      // у двух разных записей: склеивать их нельзя.
      if (ll !== undefined && lr !== undefined) return { ok: false };
      merged.set(id, ll ?? lr);
      continue;
    }
    if (ll === undefined || lr === undefined) {
      // Удалили с одной стороны. Если другую сторону не трогали – удаляем;
      // если её там правили – противоречие.
      const other = ll === undefined ? lr : ll;
      if (sameJson(other, lb)) continue;
      return { ok: false };
    }
    const m = mergeObjects(lb, ll, lr);
    if (!m.ok) return { ok: false };
    merged.set(id, m.value);
  }

  // Порядок: если переставляли только с одной стороны – её порядок
  // («Любимое» хранит порядок самим списком), иначе – порядок
  // репозитория. Записи, которых в выбранном порядке нет (новые с другой
  // стороны), встают после той, за которой стояли у себя.
  const orderOf = (map) => [...map.keys()].filter((id) => b.has(id) && merged.has(id));
  const localMoved = !sameJson(orderOf(l), orderOf(b));
  const remoteMoved = !sameJson(orderOf(r), orderOf(b));
  const [primary, secondary] = localMoved && !remoteMoved ? [l, r] : [r, l];
  const ids = [...primary.keys()].filter((id) => merged.has(id));
  const secondaryIds = [...secondary.keys()];
  secondaryIds.forEach((id, i) => {
    if (!merged.has(id) || ids.includes(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const pos = ids.indexOf(secondaryIds[j]);
      if (pos !== -1) {
        at = pos + 1;
        break;
      }
    }
    ids.splice(at, 0, id);
  });
  return { ok: true, value: ids.map((id) => merged.get(id)) };
}

export function mergeJson(base, local, remote) {
  if (Array.isArray(local) && Array.isArray(remote)) {
    return mergeRecordLists(Array.isArray(base) ? base : [], local, remote);
  }
  if (isPlainObject(local) && isPlainObject(remote)) return mergeObjects(base, local, remote);
  return { ok: false };
}
