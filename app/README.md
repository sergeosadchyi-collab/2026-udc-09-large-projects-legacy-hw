# prykladpostach-billing

Бек-офіс для рахунків ТОВ «Приклад Постач»: клієнти, замовлення, рахунки,
оплати, нагадування, вивантаження для бухгалтерії.

> Архітектура: див. `docs/ARCHITECTURE.md`.

## Швидкий старт

```bash
npm start              # http://localhost:8080
npm test
npm run export         # нічний файл для бухгалтерії → out/export/
npm run reminders      # нагадування про оплату → out/mail/
```

Залежностей немає — лише Node.

## Структура

```
bin/        cron-скрипти та утиліти командного рядка
config/     налаштування (default.json, колонки експорту)
data/       JSON-«база»: customers, products, orders, invoices, payments
lib/        уся логіка
test/       тести (node --test)
docs/       документація
out/        згенеровані файли (не комітити)
```

## Хто що знає

Стас пішов у 2022, Сергій — у 2023. Питання — в чат #billing, хтось та й
відповість.
