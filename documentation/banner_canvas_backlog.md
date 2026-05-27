- Унифицировать основной canvas, PreviewCanvas и export renderer.
- Проверить экспорт слоев с внешними изображениями и прозрачностью.

Backend-зависимости:

- Для MVP можно клиентский экспорт.
- Для production нужен серверный export job.
- Нужна выдача ссылки на готовый архив.
- Нужен offscreen или headless renderer.
- Нужна история export artifacts, если пользователь должен вернуться к файлам позже.

## 5. Интеграции с другими частями платформы

- Проекты и дашборд.
- Project status.
- Workspace.
- Пользователи и роли.
- Project assets.
- Workspace asset library.
- S3 / Yandex Object Storage.
- AI models registry.
- AI provider gateway.
- AI text generation.
- AI image generation.
- AI image edit.
- Workflow / AI сценарии.
- Workflow run history.
- Template catalog.
- Template editor mode.
- Custom fonts.
- Missing fonts replacement.
- Figma import, если оставляем его в общем контуре канваса.
- Figma metadata на слоях.
- Project versions.
- Share project.
- Export pipeline.
- Local drafts.
- Cross-tab coordination.
- Auth / workspace access.

## 6. Backend-heavy блок

- Модель проекта.
- Модель canvas state.
- Версионирование схемы canvas state.
- Валидация canvas state на сервере.
- Миграции canvas state.
- Сохранение и загрузка canvas state.
- Версионирование canvas state.
- Optimistic locking по версии проекта.
- Экран и API для конфликтов версий.
- Beacon-save при выходе со страницы.
- Local draft fallback.
- Recovery UI для rejected local drafts.
- Синхронизация открытых вкладок.
- Хранение ассетов.
- Загрузка ассетов в S3.
- Связь canvas layer с assetId.
- Регистрация ассетов в проекте.
- Регистрация ассетов в workspace.
- Сохранение AI-generated ассетов.
- Очистка неиспользуемых S3-файлов.
- Предупреждение перед удалением используемого ассета.
- Хранение шаблонов.
- Права доступа к шаблонам.
- Копирование ассетов шаблона в проект.
- Хранение workflow-графов.
- Запуск workflow-узлов.
- История запусков workflow.
- Очередь для долгих workflow и AI-задач.
- Привязка workflow-сценариев к surface `banner`.
- AI provider gateway.
- Учет стоимости AI-запросов.
- Серверный export job.
- Генерация export artifact.
- История export artifacts.
- Права доступа к проектам, ассетам, шаблонам и workflow.

## 7. Формат описания эпиков

Для каждого крупного эпика дальше используем один формат:

- Что должно работать.
- Задачи.
- Что важно не сломать.
- Backend-зависимости.
- MVP.
- Можно отложить.

## 8. Открытые решения

- Оставляем ли две модели форматов одновременно или мигрируем к одной основной модели.
- Должен ли фон артборда быть общим для всех форматов или отдельным для каждого формата.
- Реализуем ли `verticalTrim` полноценно или убираем из UI до реализации.
- Делаем ли PreviewCanvas полноценным зеркалом основного canvas или отказываемся от отдельного preview-renderer.
- Когда переносим batch export с клиентского рендера на серверный job.
- Нужна ли очередь для всех долгих AI / workflow операций или достаточно run history на первом этапе.
- Какие Figma auto-layout режимы поддерживаем, а какие честно показываем как unsupported.
- Связываем ли image-слои с assetId в первой итерации или оставляем только URL до отдельной миграции.
- Какой минимальный набор bulk editing нужен для мультиселекта.

## 9. Кодовые зоны, с которыми сверяем документ

- `src/app/editor/[id]/page.tsx` - сборка интерфейса редактора.
- `src/components/editor/canvas/Canvas.tsx` - основной canvas, рендер и interaction.
- `src/components/editor/canvas/InlineTextEditor.tsx` - редактирование текста на холсте.
- `src/components/editor/LayersPanel.tsx` - дерево слоев и вложенность.
- `src/components/editor/properties/*` - панель свойств.
- `src/components/editor/ResizePanel.tsx` - форматы.
- `src/components/editor/swatches/SwatchesPanel.tsx` - палитра.
- `src/components/editor/AIPromptBar.tsx` - AI-инструменты.
- `src/components/editor/AssetLibraryModal.tsx` - проектные ассеты.
- `src/components/workflows/AIScenariosModal.tsx` - AI сценарии.
- `src/store/canvas/*` - состояние канваса.
- `src/utils/layoutEngine.ts` - автолейаут и измерение текста.
- `src/services/snapService.ts` - snapping и guides.
- `src/hooks/useProjectSync.ts` - автосохранение и загрузка canvas state.
- `src/server/routers/project.ts` - backend проекта и версий.
- `src/server/routers/asset.ts` - backend ассетов.
- `src/server/routers/workflow.ts` - backend workflow.
- `prisma/schema.prisma` - модели Project, Asset, Template, AIWorkflow и ProjectVersion.