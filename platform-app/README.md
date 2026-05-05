# AI Creative Platform — приложение

Это рабочее Next.js-приложение AI Creative Platform. Общее описание сервиса, пользовательских сценариев и актуальных возможностей лежит в корневом [README.md](../README.md).

## Локальный запуск

```bash
npm install
cp .env.example .env.local
npm run db:push
npm run dev
```

После запуска откройте `http://localhost:3000`.

Для полной работы нужны PostgreSQL, Yandex Object Storage, настройки авторизации и ключи AI-сервисов. Figma-импорт включается отдельно через переменные `AUTH_FIGMA_ID`, `AUTH_FIGMA_SECRET` и `AUTH_FIGMA_REDIRECT_URI`.

## Команды

```bash
npm run dev        # локальный запуск
npm run build      # сборка
npm run start      # запуск собранного приложения
npm run lint       # проверка кода
npm run test       # тесты
npm run db:push    # применить Prisma-схему к базе
npm run db:seed    # заполнить базовые данные
```
