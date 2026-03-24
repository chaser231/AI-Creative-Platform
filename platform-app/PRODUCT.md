# AI Creative Platform — Product Vision & UX (To-Be)

> **Purpose:** Defines what the platform does, who uses it, and how. Any development agent should read this before implementing features.

---

## Product Concept

**AI Creative Platform** — внутренняя платформа для команд маркетинга и дизайна, которая автоматизирует создание рекламных креативов с помощью AI. Платформа сочетает визуальный редактор (канвас) с искусственным интеллектом, обеспечивая быстрое создание баннеров, постов для соцсетей и рекламных материалов в рамках бренд-гайдлайнов.

### Core Value Proposition
**Из 4 часов на креатив → 15 минут.** AI генерирует тексты и изображения, применяет шаблоны, адаптирует под форматы — человек утверждает и корректирует.

---

## User Roles & Personas

### Platform Roles

| Роль | Персона | Действия |
|------|---------|----------|
| **SUPER_ADMIN** | Владелец платформы | Управление всей платформой, пользователями, глобальными шаблонами, аналитика |
| **ADMIN** (workspace) | Руководитель команды | Управление воркспейсом, участниками, бренд-китом, настройками |
| **CREATOR** (workspace) | Дизайнер / маркетолог | Создание и редактирование проектов, шаблонов, AI-генерация |
| **USER** (workspace) | Менеджер / стейкхолдер | Просмотр, комментирование (будущее) |
| **VIEWER** (workspace) | Внешний наблюдатель | Только просмотр |

### Key Persona: Creator
Маркетолог, который не дизайнер. Хочет быстро создать баннер для рекламной кампании. Не должен думать о пикселях — AI и шаблоны делают это за него.

---

## Core User Flows

### Flow 1: Создание проекта через Wizard
```
Dashboard → «Новый проект» → Wizard Mode
  1. Выбор шаблона из каталога
  2. Ввод текстов (AI генерирует 3 варианта)
  3. Загрузка / генерация изображений
  4. Предпросмотр
  5. → Переход в Studio для доработки
```

### Flow 2: Работа в Studio (Canvas Editor)
```
Проект → Studio Mode
  1. Визуальное редактирование на канвасе
  2. Добавление слоёв (текст, изображение, фрейм, бейдж)
  3. AI Chat Panel — чат с AI для генерации контента
  4. Smart Resize — адаптация под разные форматы
  5. Экспорт (PNG/JPEG/PDF/SVG)
```

### Flow 3: Командная работа
```
Dashboard → Команда (или Sidebar → переключение воркспейса)
  1. Управление участниками (invite, роли)
  2. Общий Brand Kit (цвета, шрифты, TOV)
  3. Общие шаблоны и проекты
  4. Обзор команд → присоединение / заявка
```

### Flow 4: Администрирование (SUPER_ADMIN)
```
Sidebar → Админ-панель
  1. KPI: пользователи, воркспейсы, проекты, шаблоны, AI-сессии
  2. Управление пользователями (смена глобальной роли)
  3. Просмотр всех воркспейсов
  4. Управление глобальными шаблонами
```

---

## Page Map

```
/                          Dashboard — мои проекты в текущем воркспейсе
/projects                  Все проекты воркспейса
/templates                 Каталог шаблонов (фильтры: категория, BU, тип)
/team                      Управление командой (участники, роли, инвайты)
/editor/[id]               Редактор (Wizard + Studio)
/settings                  Общие настройки
/settings/brand-kit        Бренд-кит воркспейса
/settings/workspace        Настройки воркспейса (видимость, политика, удаление)
/admin                     Админ-панель (SUPER_ADMIN)
/admin/templates           Управление шаблонами (SUPER_ADMIN)
/invite/[slug]             Страница приглашения (публичная)
/auth/signin               Авторизация (Yandex OAuth)
```

---

## Design Principles

### 1. «Invisible UI» (Невидимый интерфейс)
Интерфейс не должен конкурировать с контентом. Панели минимальны, фокус на канвасе.

### 2. «Outcome over Output» (Результат важнее процесса)
Пользователь оценивает финальный креатив, а не количество фичей. Один клик — готовый баннер.

### 3. «Safe by Default» (Безопасно по умолчанию)
Трудно нарушить бренд-гайдлайны. Brand Kit инжектится в AI-промпты скрыто.

### 4. «Human in the Loop» (Человек решает)
AI предлагает, человек утверждает. Все AI-действия — это предложения, не автоматические замены.

### 5. «Non-Destructive» (Без потерь)
Все изменения — это слои или версии. Undo/redo, история версий, возврат к предыдущим состояниям.

---

## Template System

### TemplatePack Structure
```typescript
interface TemplatePack {
    meta: {
        name: string;
        description: string;
        tags: string[];
        category: TemplateCategory;
    };
    artboard: ArtboardConfig;
    layers: SerializedLayerNode[];
    masterComponents: MasterComponent[];
    resizes: ResizeFormat[];
    componentInstances: ComponentInstance[];
}
```

### Template Lifecycle
1. **Создание** — через Studio (Save as Template) или Admin
2. **Каталогизация** — категории, теги, BU, contentType, occasion
3. **Применение** — Wizard или drag-and-drop в Studio
4. **Версионирование** — шаблон обновляется, проекты на его основе не затрагиваются

---

## Multi-Format (Smart Resize)

Каждый проект содержит набор **форматов** (resizes). Один мастер-дизайн адаптируется под все форматы:

| Формат | Размер | Назначение |
|--------|--------|-----------|
| Instagram Post | 1080×1080 | Соцсети |
| Instagram Story | 1080×1920 | Соцсети |
| Facebook Cover | 1200×628 | Соцсети |
| Display Banner | 300×250 | Реклама |
| Billboard | 970×250 | Реклама |
| Full HD | 1920×1080 | Видео |

Система constraints позволяет задать поведение каждого элемента при изменении размера: stretch, pin to edge, center, scale.

---

## AI Capabilities

| Функция | Описание | Где используется |
|---------|----------|-----------------|
| **Генерация текста** | 3 варианта для каждого слота (selling, info, emotional) | Wizard, AI Chat |
| **Генерация изображений** | Flux, SDXL, DALL-E | Wizard, AI Chat, Studio |
| **Редактирование изображений** | Inpainting, outpainting, remove BG, upscale | Image Editor Modal |
| **AI Agent** | Чат-бот с доступом к канвасу (tool-calling) | AI Chat Panel |
| **Context-aware prompts** | Brand Kit автоматически инжектится в промпты | Везде прозрачно |
