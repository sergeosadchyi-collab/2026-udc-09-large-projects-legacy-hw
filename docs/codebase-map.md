# Карта кодової бази — `app/`

## 1. Як агент будував карту

- **Інструмент / модель:** GitHub Copilot (agent mode) у JetBrains IDEA, Claude
  Sonnet 4.5.
- **Промпт (стисло):** «Склади карту `app/`: точки входу (HTTP, cron, CLI),
  модулі і що вони роблять, як зберігаються дані, які є зовнішні інтеграції, де
  форматуються дати й гроші. Потім перевір щонайменше 10 тверджень карти по
  коду з доказами файл:рядок».
- **Вартість навігації:**

  | Метрика | Значення |
  |---|---|
  | Викликів інструментів | 19 (8 × `read_file`, 11 × термінал) |
  | Файлів прочитано (повністю або частково) | ~40 із 86 (~46 %) |
  | Файлів прочитано повністю | 22 |
  | Запусків `npm test` | 1 (106 тестів, усі зелені) |
  | Порядок величини токенів | ~45–55 тис. (переважно вихід `grep`/`cat` у терміналі) |

- **Він читав усе підряд чи шукав?** **Шукав, а не читав усе підряд.** Стратегія
  була така:
  1. спершу «скелет» — `server.js`, `package.json`, `config/*.json`,
     `lib/store.js`, `lib/format.js` (точка, довкола якої тікет);
  2. далі **граф залежностей одним `grep`** по всіх `require('./…')` — це
     відразу показало, які модулі ніхто не імпортує (мертві), без читання їх
     самих;
  3. далі **шапки всіх 40 файлів `lib/`** одним циклом
     (`sed -n 1,14p` + `grep` по коментарях) — дешевий спосіб отримати
     «відповідальність модуля» без повного читання;
  4. повністю читалися лише файли на шляху тікета
     (`format.js` → `invoices/render.js`, `notifications/reminders.js`,
     `export/accounting.js`) і ті, де карта могла збрехати (`legacy/*`,
     `docs/ARCHITECTURE.md`).

  Повністю **не читалися**: `data/*.json`, `test/**` (крім `grep`),
  `lib/catalog/*`, `lib/customers/*`, `lib/orders/*`, `lib/payments/matcher.js`
  — для карти вистачило шапок і списку маршрутів.

---

## 2. Карта

### Точки входу

| Точка входу | Що запускає | Файл |
|---|---|---|
| **HTTP** `npm start` → `:8080` | піднімає `http.createServer`, збирає маршрути з 7 модулів | `app/server.js:20-42` |
| HTTP `GET /health` | єдиний маршрут, зареєстрований не з модуля | `app/server.js:29-31` |
| HTTP `GET /api/invoices`, `/api/invoices/:id`, `POST /api/orders/:id/invoice`, `GET /invoices/:number` | рахунки + HTML-рахунок | `lib/invoices/routes.js:59-64` |
| HTTP 5 маршрутів `/api/customers…` | клієнти, CRUD + рахунки клієнта | `lib/customers/routes.js:89-95` |
| HTTP 4 маршрути `/api/products…`, `/api/stock/low` | каталог, імпорт цін, низькі залишки | `lib/catalog/routes.js:89-94` |
| HTTP 4 маршрути `/api/orders…` | замовлення і зміна статусу | `lib/orders/routes.js:93-98` |
| HTTP 3 маршрути `/api/payments…` | оплати, імпорт виписки | `lib/payments/routes.js:59-63` |
| HTTP 4 маршрути `/api/reports/…` | revenue / aging / top-customers / vat | `lib/reports/routes.js:87-92` |
| HTTP `GET /api/audit` | читання журналу змін | `lib/audit/routes.js:41` |
| **cron 02:30** | нічний файл для бухгалтерії → `out/export/oblik-YYYY-MM-DD.csv` | `bin/nightly-export.js` |
| **cron 09:00** (робочі дні) | нагадування про оплату → файли в `out/mail/` | `bin/send-reminders.js` |
| **cron 07:00 1-го числа** | місячний звіт у stdout → пошта директору | `bin/monthly-report.js` |
| **cron 03:10** | ретеншн журналу аудиту | `lib/audit/retention.js:5` |
| **CLI** | рендер одного рахунку в HTML у stdout | `bin/render-invoice.js` |
| **CLI** | імпорт банківської виписки (dry-run за замовчуванням; cron вимкнено у 2022) | `bin/import-statement.js:8-10` |
| **CLI, одноразовий** | злиття дублікатів клієнтів; **уже застосовано на проді 2022-08-09** | `bin/fix-2022-duplicate-customers.js:3-6` |
| **CLI, одноразовий** | міграція Mongo → `data/*.json`, виконано 2020-11 | `lib/legacy/mongo-migrate.js:2-3` |

Разом **26 HTTP-маршрутів** (25 із модулів + `/health`).

### Модулі

| Модуль | Відповідальність | Живий / мертвий |
|---|---|---|
| `lib/store.js` | JSON-«БД»: лінива загрузка `data/<name>.json`, кеш у памʼяті, `save()` на запис. Колбеки | **живий**, вісь усієї системи |
| `lib/format.js` | `formatDate`, `formatMoney`, `formatDecimal`, `formatText`, `formatPercent` | **живий**, спільний для 3 споживачів |
| `lib/http/router.js` | мінімальний роутер (`:param`), авторизація за `x-staff-id` | **живий** |
| `lib/invoices/` | `index.js` — виставлення з замовлення, нумерація, `isOverdue`; `render.js` — HTML-рахунок; `routes.js` | **живий** |
| `lib/customers/` | CRUD, `search.js` (толерантний до апострофів), `validate.js`, `merge.js` (чистий `planMerge`, нічого не пише) | **живий**; `merge.js` — без застосовувача (`TODO(2021)`) |
| `lib/orders/` | замовлення, `lines.js` (валідація позицій), `status.js` (машина станів) | **живий** |
| `lib/catalog/` | товари, `stock.js` (залишки), `price-import.js` (`sku;ціна[;нотатка]`) | **живий** |
| `lib/payments/` | `statement.js` (KB-2 fixed-width парсер), `matcher.js` (3 правила зіставлення), `index.js` (`prepareImport`/`apply`) | **живий** |
| `lib/reports/` | `index.js` (чисті функції), `dates.js` (**власні** date-хелпери), `table.js` (**власний** `fmtAmount`), `render.js` (text + JSON) | **живий** |
| `lib/notifications/reminders.js` | листи «скоро оплата» / «прострочено» | **живий** (cron) |
| `lib/export/accounting.js` | файл для Облік-Плюс; колонки з `config/export-columns.json`, рендер через **динамічний** `format['format' + col.type]` | **живий** (cron) |
| `lib/audit/` | `index.js` — `record()` у `out/audit.log`; `retention.js` — архівація; `routes.js` — читання | **напівмертвий**: `record()` не викликає **жоден** модуль у `lib/` чи `bin/`, лише тести |
| `lib/discounts/` | знижки лояльності, `tiers.js` | **мертвий**: ніхто не імпортує, фіча-флаг `loyaltyDiscounts: false` |
| `lib/legacy/pdf-client.js` | клієнт сервісу `pdf-render` | **мертвий**: сервіс вимкнено у 2020, ніхто не імпортує |
| `lib/legacy/templates.js` | власний міні-Handlebars, має хелпер `date` у форматі `дд.мм.рррр` | **мертвий** у проді (`templates/` не існує), живий лише в `test/legacy/templates.test.js` |
| `lib/legacy/mongo-migrate.js` | одноразова міграція з Mongo | **мертвий** (довідково) |

### Дані

- **Сховище — файли JSON у `app/data/`**, не база: `customers`, `products`,
  `orders`, `invoices`, `payments`, `stock`, `price_history` (+
  `data/statements/` — зразок банківської виписки). Жодного драйвера БД.
- **Дати зберігаються як рядки `YYYY-MM-DD`** (`lib/store.js:9`), напр.
  `"issued_at": "2026-03-01"`.
- **Гроші — цілі копійки** (`*_kopecks`), ніколи не float.
- Запис — тільки через `store.save(name, cb)`; до `save()` зміни живуть у кеші
  процесу.
- Генеровані файли — у `app/out/` (не комітяться): `out/export/`, `out/mail/`,
  `out/audit.log`, `out/audit-archive/`.

### Де форматуються дати й гроші (4 незалежні місця!)

| Місце | Дати | Гроші |
|---|---|---|
| `lib/format.js:29` | `formatDate` → **`MM/DD/YYYY`** | `formatMoney` → `1 234,50 грн`; `formatDecimal` → `1234.50` |
| `lib/reports/dates.js`, `lib/reports/table.js:14` | не форматує — друкує **сирий ISO**; є `monthName` → «березень 2026» | власний `fmtAmount` → `1 234,50` (без «грн») |
| `lib/legacy/templates.js:180-187` | хелпер `date` → **`дд.мм.рррр`** (вже!) | хелпер `money` → `1 234,50` |
| `bin/import-statement.js:16-21` | друкує `d.date` як є | власний `fmtAmount` |
| `lib/payments/statement.js` | парсить `DDMMYYYY` → ISO | — |
| `lib/legacy/mongo-migrate.js:62` | `toIsoDate` через `sv-SE` + `Europe/Kiev` | `toKopecks` |

### Зовнішні інтеграції

| Хто споживає | Що саме | Формат | Канал |
|---|---|---|---|
| **Облік-Плюс** (бухгалтерія) | `out/export/oblik-YYYY-MM-DD.csv` | UTF-8, роздільник `;`, CRLF, шапка, **дата `MM/DD/YYYY`**, суми `1234.50` | їхній сервер забирає з шари о 06:00 |
| **Клієнти** (люди) | HTML-рахунок `/invoices/:number` і `bin/render-invoice.js` | HTML, дата через `format.formatDate` | браузер / друк |
| **Клієнти** (люди) | листи-нагадування, `out/mail/*.txt` | текст, дата через `format.formatDate` | старий SMTP-релей забирає файли |
| **Директор і бухгалтерія** (люди) | `bin/monthly-report.js` у stdout | fixed-width текст, дати — **сирий ISO** | cron → mail |
| **BI-таблиця Олени** (машина) | `GET /api/reports/*` та `--json` | JSON, дати — **сирий ISO** | HTTP/файл (`lib/reports/render.js:2-3`) |
| **Банк** (вхід) | `data/statements/*.txt`, формат KB-2 fixed-width | дати `DDMMYYYY` | SFTP-міст, імпорт вручну |
| **Персонал** | усі `/api/*` | JSON | зворотний проксі ставить `x-staff-id` після LDAP |

> ⚠️ **Головний ризик для BILL-482.** `lib/export/accounting.js:30` викликає
> форматер **динамічно**: `format['format' + col.type]`, де `col.type` береться
> з `config/export-columns.json`. Тому **`grep formatDate` не знаходить цього
> споживача** — а це саме той, який читає інша система і якому зміна формату
> зламає імпорт (мовчки, див. `app/docs/integrations/oblik-plus.md:27-35`).

---

## 3. Перевірка — 16 тверджень

Перевірялися насамперед твердження, які агент міг узяти з `app/docs/`
(документація системи) замість коду, і твердження про «мертвість» модулів.

| # | Твердження з карти / з `app/docs/` | ✅ / ❌ | Доказ (файл:рядок або команда) |
|---|---|---|---|
| 1 | `docs/ARCHITECTURE.md`: «Billing — це **Express**-застосунок» | ❌ | Express прибрали у 2020: `lib/http/router.js:4-5`; у `package.json` **немає жодної** залежності — `grep express package.json` → порожньо |
| 2 | `docs/ARCHITECTURE.md`: «Дані лежать у **MongoDB**» | ❌ | Дані — JSON-файли: `lib/store.js:3-4`, `ls app/data/` → 7 `*.json`; міграція з Mongo відбулася 2020-11 (`lib/legacy/mongo-migrate.js:2`) |
| 3 | `docs/ARCHITECTURE.md`: «сторінки рендеряться з `templates/`» (Handlebars) | ❌ | Теки `templates/` **не існує** (`ls app/templates` → No such file); HTML будується конкатенацією рядків у `lib/invoices/render.js:32-53` |
| 4 | `docs/ARCHITECTURE.md`: «`lib/export/csv.js` — вивантаження для бухгалтерії» | ❌ | Такого файлу немає; реальний — `lib/export/accounting.js` (`find app/lib/export` → лише `accounting.js`) |
| 5 | `docs/ARCHITECTURE.md`: «`lib/mail` — SMTP» | ❌ | Теки `lib/mail` немає; листи пишуться у файли в `out/mail`, релей забирає їх звідти — `bin/send-reminders.js:3-4,21-25` |
| 6 | `docs/ARCHITECTURE.md`: «Потрібні Node 8+», «`http://localhost:3000`» | ❌ | `package.json:14` → `"node": ">=22"`; `config/default.json:7` → `"port": 8080` |
| 7 | `docs/ARCHITECTURE.md`: «Форматування для людей — **лише в шаблонах**» | ❌ | Форматування в коді у 4+ місцях: `lib/format.js:29`, `lib/reports/table.js:14`, `bin/import-statement.js:16`, `lib/legacy/templates.js:180` |
| 8 | `docs/ARCHITECTURE.md`: «Зовнішні інтеграції: **тільки SMTP**» | ❌ | Ще щонайменше: файловий експорт в Облік-Плюс (`lib/export/accounting.js:1-3`), імпорт виписки банку (`lib/payments/statement.js:1-4`), JSON для BI (`lib/reports/render.js:2-3`) |
| 9 | «Дати в сховищі — ISO `YYYY-MM-DD`» (єдине твердження старої доки, що вціліло) | ✅ | `lib/store.js:9`; `data/invoices.json` → `"issued_at": "2026-03-01"`; `lib/format.js:19-20` розраховує саме на це |
| 10 | «Гроші — цілі копійки» | ✅ | `lib/format.js:38`; поля `*_kopecks` у `data/invoices.json` |
| 11 | `formatDate` віддає `MM/DD/YYYY` (а JSDoc над нею каже «ISO format») | ✅ (код) / ❌ (JSDoc) | `lib/format.js:33` → `pad(місяць)+'/'+pad(день)+'/'+рік`; `node -e "console.log(require('./lib/format').formatDate('2026-03-09'))"` → `03/09/2026`. JSDoc на `lib/format.js:27` бреше |
| 12 | «Споживачів `formatDate` три: HTML-рахунок, нагадування, експорт» — і **третього `grep` не знаходить** | ✅ | `grep -rn formatDate app/lib` дає лише `invoices/render.js:38-39` і `notifications/reminders.js:40,46`. Третій — динамічний виклик `format['format' + col.type]` у `lib/export/accounting.js:30` + `config/export-columns.json:3-4` (`"type": "Date"`) |
| 13 | «Зміна `formatDate` змінить файл для Облік-Плюс» | ✅ | `node -e "…buildAccountingFile…"` → `INV-2026-00001;03/01/2026;03/15/2026;…` — дати в експорті беруться з тієї ж функції |
| 14 | «Звіти (`lib/reports`) від `lib/format.js` **не** залежать» | ✅ | `grep -rn "require(.*format" app/lib` → лише `invoices/render.js`, `export/accounting.js`, `notifications/reminders.js`; у `lib/reports/render.js:5-7` — власні `table.js` і `dates.js`; у `agingText` дати друкуються сирими (`lib/reports/render.js:45-46`) |
| 15 | `lib/audit/routes.js:2-3`: «записи пишуть самі модулі через `audit.record()`» | ❌ | `grep -rn "\.record(" app/lib app/bin app/server.js` → жодного виклику поза `lib/audit/` і тестами. Прод-код журнал **не** пише |
| 16 | `lib/discounts/` і `lib/legacy/pdf-client.js` — мертвий код | ✅ | Граф `require`: `lib/discounts` імпортує лише `test/discounts/*`, `pdf-client.js` — ніхто; `config/features.json:2` → `"loyaltyDiscounts": false`; сервіс вимкнено 2020 (`lib/legacy/pdf-client.js:8-9`) |
| 17 | «26 HTTP-маршрутів» | ✅ | 25 у `lib/*/routes.js` (`grep -c` по `method:`) + `/health` у `server.js:29` |
| 18 | «`/invoices/:number` доступний **без** `x-staff-id`, на відміну від `/api/*`» | ✅ | `lib/http/router.js:101` — перевірка спрацьовує лише якщо `path.indexOf('/api/') === 0` |

Базовий стан: `cd app && npm test` → **106 pass / 0 fail**.

---

## 4. Висновок

**Де «агент» помилився б і чому.** Усі ❌ вище — це твердження, які легко взяти з
`app/docs/ARCHITECTURE.md`: він виглядає авторитетно (версія 2.0, схема,
розділ «Домовленості»), але датований **травнем 2019** і описує систему до двох
міграцій — Express → власний роутер (2020) і MongoDB → JSON-файли (2020-11).
Із восьми його тверджень, які я перевірив, **сім виявилися хибними**, вціліли
лише «дати — ISO» і «гроші — копійки». Тому головний висновок: у цьому репо
`app/docs/` — це не карта, а **історична довідка**; єдине джерело правди — код.

**Які твердження я вважаю найризикованішими і чому перевіряв саме їх:**

1. **Твердження зі старої доки** (#1–#8) — бо агент тягне їх у карту як факт,
   і вони звучать переконливо.
2. **Твердження «споживачів рівно стільки, скільки показав `grep`»** (#12) —
   найнебезпечніше для BILL-482. Експорт у бухгалтерію дістає форматер
   **динамічно** через рядок із JSON-конфігу, тож текстовий пошук за іменем
   функції його не бачить. Якщо довіритись `grep`, тікет «на пів години»
   мовчки зламає імпорт в Облік-Плюс: за `app/docs/integrations/oblik-plus.md:27-35`
   їхній сервер не падає, а **пропускає** рядки з «чужим» форматом дати — так
   у лютому 2021 втратили 40 рахунків, і тести при цьому були зелені.
3. **«Мертвий» код** (#15, #16) — бо тут легко помилитись в обидва боки:
   `lib/audit` має маршрут, тести і вигляд робочої підсистеми, але `record()`
   ніхто не викликає; а `lib/legacy/templates.js` виглядає мертвим, і в проді
   так і є — проте він містить готовий `дд.мм.рррр`-форматер
   (`lib/legacy/templates.js:180-184`) і **покритий живими тестами**, тому
   «прибрати заразом» його не можна.
4. **Твердження, що звіти залежать від `lib/format.js`** (#14) — правдоподібна
   вигадка (звіти ж «форматують»), але насправді в репо **чотири незалежні**
   форматери, і зміна спільного не зачепить звіти. Це рівно так само важливо
   знати, як і список тих, кого зачепить.

**Що з цього йде в Task B:** реальних споживачів `format.formatDate` три —
HTML-рахунок (людина, **має** змінитися), листи-нагадування (людина, **має**
змінитися) і нічний експорт в Облік-Плюс (машина, **не має** змінитися).

