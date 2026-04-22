# Prisma migrations

Этот каталог появился впервые в **MF-3 (optimistic locking)**. До этого проект
жил без директории `prisma/migrations` — схема каталога в БД (prod Yandex Managed
PostgreSQL) совпадала с `schema.prisma`, но Prisma про это «не знает» и не имеет
baseline-записи в служебной таблице `_prisma_migrations`.

Поэтому миграцию `20260422150000_add_project_version` **нельзя просто катить
через `prisma migrate deploy`** — команда начнёт с нуля и попытается применить
`20260422150000_add_project_version` поверх «пустой» базы, что в prod'е
приведёт либо к ошибке (колонка существует), либо, что хуже, к рассинхрону.

## Что нужно сделать владельцу БД

Один раз при первом применении (локально/stage/prod):

### Вариант A — «правильный» Prisma-путь (рекомендуется)

1. Локально сгенерировать **baseline** миграции из текущей prod-схемы:
  ```bash
   cd platform-app
   npx prisma migrate diff \
     --from-empty \
     --to-schema-datamodel prisma/schema.prisma \
     --script > prisma/migrations/20260101000000_baseline/migration.sql
  ```
  > Замените `20260101000000` на любой timestamp **раньше** чем
  > `20260422150000` — важен только порядок.
2. На каждой среде (dev / stage / prod) — пометить baseline как уже применённую:
  ```bash
   DATABASE_URL=... npx prisma migrate resolve --applied 20260101000000_baseline
  ```
   После этого в `_prisma_migrations` появится строка baseline, и Prisma
   перестанет пытаться его накатить.
3. Применить новую миграцию как обычно:
  ```bash
   DATABASE_URL=... npx prisma migrate deploy
  ```
   Это применит только `20260422150000_add_project_version` (и все будущие).

### Вариант B — «быстрый», без baseline

Применить SQL напрямую + вручную отметить в служебной таблице:

1. Выполнить SQL на БД:
  ```sql
   ALTER TABLE "Project" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
  ```
2. Вставить запись в `_prisma_migrations`, чтобы Prisma считал миграцию
  применённой:
   Этот путь проще, но оставляет проект без baseline-миграции. Следующие
   миграции придётся также катить руками, пока не сделан вариант A.

## Чего делать НЕ надо

- **Не запускать `prisma migrate dev`** — он попытается создать baseline
автоматически, и в prod это приведёт к попытке пересоздать всю схему.
- **Не пушить этот каталог на prod с ожиданием, что CI сам всё накатит** —
текущий CI (`.github/workflows/deploy.yml`) только билдит образ, миграции
руками.

