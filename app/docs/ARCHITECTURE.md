# Billing — архітектура

_Версія документа: 2.0, травень 2019._

## Загальна схема

Billing — це Express-застосунок із шаблонами Handlebars. Усі сторінки й
документи рендеряться з `templates/`. Дані лежать у MongoDB (колекції
`customers`, `orders`, `invoices`, `payments`).

```
браузер ──> Express (server.js) ──> lib/* ──> MongoDB
                                     └──> templates/*.hbs ──> HTML/PDF
```

## Модулі

- `lib/customers` — клієнти, контакти, ЄДРПОУ.
- `lib/orders` — замовлення та позиції.
- `lib/invoices` — виставлення рахунків і PDF через сервіс `pdf-render`.
- `lib/payments` — зарахування оплат із банківської виписки.
- `lib/export/csv.js` — вивантаження для бухгалтерії.
- `lib/mail` — SMTP.

## Домовленості

- **Усі дати в системі зберігаються й передаються в ISO 8601** (`YYYY-MM-DD`).
  Форматування для людей — лише в шаблонах.
- Гроші — цілі копійки.
- Зовнішні інтеграції: тільки SMTP. Бухгалтерія забирає CSV вручну.

## Запуск

```
npm install
npm start   # http://localhost:3000
```

Потрібні Node 8+ і MongoDB 3.6.
