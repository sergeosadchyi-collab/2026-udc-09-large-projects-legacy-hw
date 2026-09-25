# Аналіз впливу — BILL-482

> Заповнено **до** зміни коду. Характеризаційні тести закомічено окремим
> комітом до правки.

## 1. Що саме змінюється

Функція `formatDate()` у `app/lib/format.js:29` — **єдине** місце, яке віддає
дату у вигляді `MM/DD/YYYY`. Тікет просить, щоб дати, **які бачать клієнти**
(HTML-рахунок і листи-нагадування), були у форматі `дд.мм.рррр`.

Пастка в тому, що `formatDate()` — **спільна**, і крім двох «людських»
споживачів її результат потрапляє у нічний файл для бухгалтерської системи
Облік-Плюс, де `MM/DD/YYYY` — **контракт**, а не баг. Тобто «одна функція» з
тікета обслуговує **двох споживачів, які мають змінитися, і одного, який
змінитися не має**. Просто переписати `formatDate()` не можна.

## 2. Хто від цього залежить

| # | Споживач (файл) | Як дістається до зміненої поведінки | Хто читає результат | Що має статися після тікета |
|---|---|---|---|---|
| 1 | `lib/invoices/render.js:38-39` — HTML-рахунок | прямий виклик `format.formatDate(invoice.issued_at / due_at)` | **людина** — клієнт | **змінитись** → `07.03.2026`. Це і є тікет |
| 1a | `lib/invoices/routes.js:63` — `GET /invoices/:number` | HTTP-точка входу, яку названо в тікеті; віддає результат #1. Маршрут **публічний**: перевірка `x-staff-id` у `lib/http/router.js:101` спрацьовує лише для шляхів на `/api/` | **людина** — клієнт | **змінитись** разом із #1; код відповіді, `content-type` і публічність — без змін |
| 1b | `bin/render-invoice.js:22` — CLI | той самий `renderInvoiceHtml` у stdout | **людина** | **змінитись** разом із #1 |
| 2 | `lib/notifications/reminders.js:40,46` — тексти листів | прямий виклик `format.formatDate(invoice.due_at)` | **людина** — клієнт | **змінитись** → `сплатити до 15.03.2026`. Названо в тікеті явно |
| 2a | `bin/send-reminders.js` (cron 09:00) | пише тексти #2 у файли `out/mail/*.txt`, звідки їх забирає старий SMTP-релей | **людина** (реле лише транспортує) | **змінитись** разом із #2; імена файлів і заголовки — без змін |
| 3 | **`lib/export/accounting.js:30`** — нічний файл для Облік-Плюс | **не прямий виклик:** `var render = format['format' + col.type]`, де `col.type` = `"Date"` з `config/export-columns.json:3-4`. Імені `formatDate` у файлі **немає** | **інша система** — сервер бухгалтерії забирає файл о 06:00 | **лишитись як є**, `MM/DD/YYYY`. Їхній сервер стоїть з американською локаллю (`app/docs/integrations/oblik-plus.md:23`) |
| 3a | `bin/nightly-export.js` (cron 02:30) | пише результат #3 у `out/export/oblik-YYYY-MM-DD.csv` | **інша система** | **лишитись як є** — байт у байт |

### Хто НЕ залежить, хоча виглядає залежним

| Модуль | Чому не залежить | Доказ |
|---|---|---|
| `lib/reports/*` — звіти, місячний cron, JSON для BI | має **власні** date-хелпери і **власний** форматер грошей; дати друкує сирим ISO | `lib/reports/dates.js`, `lib/reports/table.js:14`; `grep -rn "require(.*format" app/lib` не показує `lib/reports` |
| `lib/payments/statement.js` | парсить `DDMMYYYY` з банку **в** ISO, у зворотний бік не форматує | `lib/payments/statement.js:59` |
| `bin/import-statement.js:16-21` | має власний `fmtAmount`, дату друкує як є | той самий файл |
| `lib/legacy/templates.js:180-184` | має хелпер `date` → **уже** `дд.мм.рррр`, але `templates/` видалено у 2020 і в проді не виконується | теки `app/templates/` не існує |
| `data/*.json` | сховище лишається ISO — тікет про **відображення** | `lib/store.js:9` |

> ⚠️ **Чому ризик мовчазний.** Облік-Плюс не падає на рядку з «чужим» форматом
> дати — він цей рядок **пропускає** і пише попередження у власний журнал, який
> ніхто не читає. У лютому 2021 так втратили 40 рахунків, і тести при цьому
> були зелені (`app/docs/integrations/oblik-plus.md:27-35`). Саме тому для #3
> записано повний golden master файлу, а не пара `assert.match`.

## 3. Як я їх шукав

| Крок | Запит | Що знайшов |
|---|---|---|
| 1 | `grep -rn "formatDate" app/lib app/bin` | **лише 2 споживачі**: `invoices/render.js`, `notifications/reminders.js`. Рівно те, що перелічено в тікеті — і на цьому спокуса зупинитись |
| 2 | `grep -rn "require(.*format" app/lib app/bin` | **3 файли**, а не 2: додався `lib/export/accounting.js`. Ось тут і виплив прихований споживач |
| 3 | читання `lib/export/accounting.js` | причина, чому крок 1 його не бачив: `format['format' + col.type]` — ім'я функції збирається з рядка в рантаймі |
| 4 | `config/export-columns.json` | підтвердження: дві колонки з `"type": "Date"` → `DocDate`, `PayUntil` |
| 5 | виконання коду, а не читання: `node -e "…buildAccountingFile…"` | `INV-2026-00001;03/01/2026;03/15/2026;…` — доказ, що експорт реально йде через ту саму функцію |
| 6 | `grep -rn "\\.formatDate\|format\\[" app/lib` | інших динамічних звернень до `lib/format` у репо немає — список закрито |
| 7 | зворотний бік: `grep -rn "/\|\\.\\|-" ` по інших форматерах → `lib/reports/dates.js`, `lib/reports/table.js`, `bin/import-statement.js`, `lib/legacy/templates.js` | у репо **4 незалежні** форматери дат/грошей; жоден із них не викликається з `lib/format.js`, тож вони не постраждають |
| 8 | `bin/*` | точки входу cron/CLI, які виносять результати споживачів «назовні»: #1b, #2a, #3a |

**Висновок про пошук:** пошук за іменем функції дав **2 з 3** споживачів — і
пропустив рівно того єдиного, якого читає інша система. Знайшовся він лише
пошуком за **імпортом модуля**, а не за іменем функції.

## 4. Характеризаційні тести

Усі — у `app/test/characterization/`. Формат golden master: файл-еталон у
`app/test/characterization/golden/`, порівняння байт у байт; перезапис —
свідомий, через `UPDATE_GOLDEN=1 node --test`.

| Тест | Що фіксує | Споживач | Зелений на незміненому коді? |
|---|---|---|---|
| `accounting-export.test.js` — `the whole nightly export file` | **повний** файл `oblik-export.csv` (36 рядків) | #3 — **машина** | так |
| `accounting-export.test.js` — `contract: date columns are MM/DD/YYYY` | кожна комірка `DocDate`/`PayUntil` відповідає `^\d{2}/\d{2}/\d{4}$` | #3 | так |
| `accounting-export.test.js` — `contract: separator, CRLF, header, drafts` | `;`, CRLF, шапка першим рядком, чернетки виключені | #3 | так |
| `accounting-export.test.js` — `contract: amounts are dot-decimal` | `1234.50`, без пробілів і без «грн» | #3 | так |
| `accounting-export.test.js` — `contract: column types map onto format helpers` | сам зв'язок `export-columns.json` → `format['format'+type]`, через який `grep` не бачить споживача | #3 | так |
| `invoice-html.test.js` — golden `invoice-INV-2026-00007.html` | повний HTML-документ рахунку | #1 — людина | так |
| `invoice-html.test.js` — `prints dates as MM/DD/YYYY` | `Дата: <b>03/07/2026</b>`, `Сплатити до: <b>03/21/2026</b>` | #1 | так |
| `invoice-html.test.js` — golden без рядка клієнта | HTML, коли клієнта не знайдено (`—`) | #1 | так |
| `invoice-http.test.js` — `GET /invoices/:number` | 200, `text/html; charset=utf-8`, тіло = рендер, **без** `x-staff-id` | #1a | так |
| `invoice-http.test.js` — `/api/* still needs x-staff-id` | 401 для `/api/invoices` — щоб зміна не зачепила авторизацію | — | так |
| `reminders-mail.test.js` — golden `reminders-2026-03-12.txt` | уся «скринька» за день: `To`/`Subject`/текст кожного листа `upcoming` | #2 — людина | так |
| `reminders-mail.test.js` — golden `reminders-2026-04-01.txt` | те саме для `overdue` | #2 | так |
| `reminders-mail.test.js` — `due date as MM/DD/YYYY` | `слід сплатити до 03/12/2026.` | #2 | так |
| `format-contract.test.js` — `formatDate today returns MM/DD/YYYY` | базова поведінка спільної функції | усі | так |
| `format-contract.test.js` — `edge cases (must NOT change)` | `''`, `null`, `undefined`, сміттєвий рядок → `''`; `Date` і `…T22:30:00Z` читаються як UTC | усі | так |
| `format-contract.test.js` — `other helpers untouched` | `formatMoney`, `formatDecimal`, `formatText`, `formatPercent` | усі | так |
| `format-contract.test.js` — `bin/render-invoice.js CLI output` | реальний запуск CLI через `child_process` | #1b | так |
| `reports-unaffected.test.js` — golden `monthly-report-2026-03.txt` | повний текст місячного звіту (cron → пошта директору) | не-споживач | так |
| `reports-unaffected.test.js` — golden `aging-2026-03-31.json` | JSON для BI-таблиці | не-споживач (машина) | так |
| `reports-unaffected.test.js` — `reports print raw ISO` | `станом на 2026-03-31`, у JSON `issued_at`/`due_at` — ISO | не-споживач | так |
| `reports-unaffected.test.js` — `lib/reports does not depend on lib/format` | структурна перевірка: жоден файл `lib/reports` не робить `require('../format')` | не-споживач | так |
| `reports-unaffected.test.js` — `store keeps dates in ISO` | усі `issued_at`/`due_at` у `data/invoices.json` — `YYYY-MM-DD` | сховище | так |
| `golden.js` — `golden masters are recorded and non-empty` | інвентаризація 7 golden-файлів (щоб жоден не загубився при коміті) | — | так |

**Детермінізм:** усі тести працюють на синтетичних фікстурах із `app/data/`
(не змінюються), з **фіксованими** датами (`2026-03-12`, `2026-04-01`,
`2026-03-31`), а `generated_at` у JSON-звіті передається явно. Локальний час
машини ні на що не впливає — `formatDate` і `reports/dates.js` рахують у UTC.
Жоден тест нічого не пише в `app/data/` чи `app/out/`.

**`app/test/characterization/.gitattributes`:** `golden/** -text`. У репо
`core.autocrlf=input`, і без цього git переписав би CRLF у
`oblik-export.csv` на LF під час коміту — тобто зіпсував би еталон рівно того
контракту, заради якого він записаний.

**Стан набору:**

```
до:    cd app && npm test  →  106 pass / 0 fail
після: cd app && npm test  →  129 pass / 0 fail   (106 засіяних + 23 нові)
```

**Коміт із тестами — окремий і до зміни.** Усі коміти в PR названо однаково
(`WS9: Sergii_Osadchyi — BILL-482`), тож шукати його треба за **вмістом**, а не
за назвою чи хешем: це останній коміт, який додає
`app/test/characterization/**` і **не** чіпає жодного файлу з `app/lib/`.

```bash
# коміт із характеризаційними тестами
git log --oneline --diff-filter=A -- app/test/characterization/golden

# доказ, що прод-код у ньому не змінювався (має бути порожньо)
git show --name-only <той коміт> | grep app/lib
```

Зміна з Task C йде **наступним** комітом, після нього.

## 5. Після зміни (Task C)

| Тест | Почервонів? | Очікувано чи регресія? | Що зробили |
|---|---|---|---|
| _(заповнюється в Task C)_ | | | |

**Наперед відомо, як читати результат:**

- Якщо почервонів **будь-який** тест із `accounting-export.test.js` — це
  **регресія**, а не очікувана зміна. Очікування там **не чіпати**, правити код.
- Якщо почервонів **будь-який** тест із `reports-unaffected.test.js` — зміна
  вийшла за межі тікета; правити код.
- Очікувано почервоніють і мають бути перезаписані лише: golden-и рахунку
  (`invoice-*.html`), golden-и листів (`reminders-*.txt`) і рядки з
  `MM/DD/YYYY` у тестах споживачів #1, #1a, #1b, #2.
- Із **засіяних** 106 тестів очікувано почервоніє **рівно один** —
  `test/invoices.test.js:41-42` (`Дата: <b>03/09/2026</b>`,
  `Сплатити до: <b>03/23/2026</b>`). Перевірено пошуком літералів
  `MM/DD/YYYY` по всьому `app/test/`. Зокрема `test/format.test.js`
  **не** перевіряє `formatDate` взагалі (лише гроші, текст і відсотки),
  тож він червоніти не повинен — якщо почервонів, зміна зачепила зайве.
- `test/orders/routes.test.js:49` теж містить рядок `03/01/2026`, але це
  **вхідний** параметр `?from=`, який API має відхиляти з 400. Він має
  лишитись 400 — тікет не робить `MM/DD/YYYY` валідним входом.





