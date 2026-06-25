# Sneckin

Небольшой сайт магазина снеков: витрина, корзина, Telegram-авторизация, кабинет владельца и отправка заказов в Telegram-группу.

## Запуск

```bash
cp .env.example .env
node server.js
```

Сайт откроется на `http://localhost:3000`.

## Telegram

1. Создайте бота через `@BotFather`.
2. В `@BotFather` выполните `/setdomain` для домена, где будет открыт сайт. Telegram Login Widget работает только на настроенном домене и HTTPS.
3. В `.env` заполните:

```bash
TELEGRAM_BOT_USERNAME=your_bot_username_without_at
TELEGRAM_BOT_TOKEN=123456:bot-token
TELEGRAM_OWNER_IDS=123456789
```

`TELEGRAM_OWNER_IDS` - это numeric ID владельца Telegram. Можно узнать через ботов вроде `@userinfobot`.

## Группа заказов

Ссылка `https://t.me/+RE21y_qYc1dkNTg6` нужна для входа в группу, но Bot API не отправляет сообщения по invite-ссылке. Нужно:

1. Добавить вашего бота в группу.
2. Написать любое сообщение в группе.
3. Получить numeric `chat_id` группы. Обычно он выглядит как `-1001234567890`.
4. Заполнить в `.env`:

```bash
TELEGRAM_GROUP_CHAT_ID=-1001234567890
```

После этого новые заказы будут сохраняться в `data/store.json` и отправляться в группу.

## Кабинет владельца

Откройте `/admin`. В продакшене вход владельца идет через Telegram: пользователь получит роль владельца, если его Telegram ID есть в `TELEGRAM_OWNER_IDS`.

Для локальной проверки можно временно задать:

```bash
DEV_ADMIN_CODE=your-local-code
```

После этого на странице входа появится поле для локального кода. Не используйте `DEV_ADMIN_CODE` в продакшене.
