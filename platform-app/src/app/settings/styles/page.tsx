"use client";

/**
 * /settings/styles — AI Style Presets Management
 *
 * Workspace-scoped CRUD for custom image and text generation styles.
 * System presets are displayed (non-editable), custom presets can be
 * created, edited, and deleted.
 */

import { useState, useEffect } from "react";
import {
  Plus, Trash2, Pencil, Palette, Type as TypeIcon,
  Loader2, Check, X, ImageIcon, Save,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { SYSTEM_IMAGE_PRESETS, SYSTEM_TEXT_PRESETS, IMAGE_CATEGORY_LABELS, TEXT_CATEGORY_LABELS } from "@/lib/stylePresets";
import { Select } from "@/components/ui/Select";
import type { ImageStylePreset, TextStylePreset, DBPresetConfig } from "@/lib/stylePresets";

type PresetTab = "image" | "text";

interface EditingPreset {
  id?: string;           // undefined = new preset
  name: string;
  description: string;
  promptSuffix: string;  // for image
  instruction: string;   // for text
  category: string;
  icon: string;
  type: PresetTab;
}

const EMPTY_IMAGE_PRESET: EditingPreset = {
  name: "", description: "", promptSuffix: "", instruction: "",
  category: "custom", icon: "🎨", type: "image",
};

const EMPTY_TEXT_PRESET: EditingPreset = {
  name: "", description: "", promptSuffix: "", instruction: "",
  category: "custom", icon: "✨", type: "text",
};

export default function StylePresetsPage() {
  const { currentWorkspace, isAdmin } = useWorkspace();
  const workspaceId = currentWorkspace?.id ?? "";

  const [activeTab, setActiveTab] = useState<PresetTab>("image");
  const [editing, setEditing] = useState<EditingPreset | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // ─── tRPC queries ─────────────────────────────────────────
  const imagePresetsQ = trpc.ai.listPresets.useQuery(
    { workspaceId, type: "image" },
    { enabled: !!workspaceId },
  );
  const textPresetsQ = trpc.ai.listPresets.useQuery(
    { workspaceId, type: "text" },
    { enabled: !!workspaceId },
  );

  const utils = trpc.useUtils();
  const refetchAll = () => {
    utils.ai.listPresets.invalidate();
  };

  // ─── Mutations ──────────────────────────────────────────────
  const createMut = trpc.ai.createPreset.useMutation({ onSuccess: refetchAll });
  const updateMut = trpc.ai.updatePreset.useMutation({ onSuccess: refetchAll });
  const deleteMut = trpc.ai.deletePreset.useMutation({ onSuccess: refetchAll });

  const isSaving = createMut.isPending || updateMut.isPending;

  // ─── Save handler ──────────────────────────────────────────
  const handleSave = async () => {
    if (!editing || !workspaceId) return;

    const config: DBPresetConfig = editing.type === "image"
      ? { promptSuffix: editing.promptSuffix }
      : { instruction: editing.instruction, icon: editing.icon };

    if (editing.id) {
      // Update existing
      await updateMut.mutateAsync({
        id: editing.id,
        name: editing.name.trim(),
        description: editing.description.trim(),
        config,
        category: editing.category,
      });
    } else {
      // Create new
      await createMut.mutateAsync({
        workspaceId,
        name: editing.name.trim(),
        description: editing.description.trim(),
        type: editing.type,
        config,
        category: editing.category,
      });
    }
    setEditing(null);
  };

  // ─── Delete handler ──────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteId) return;
    await deleteMut.mutateAsync({ id: deleteId });
    setDeleteId(null);
  };

  // ─── DB presets as typed arrays ──────────────────────────────
  type DBPreset = NonNullable<typeof imagePresetsQ.data>[0];
  const customImagePresets = (imagePresetsQ.data ?? []) as DBPreset[];
  const customTextPresets = (textPresetsQ.data ?? []) as DBPreset[];

  // ─── Edit from DB row ────────────────────────────────────────
  const editFromDB = (p: DBPreset) => {
    const cfg = p.config as DBPresetConfig;
    setEditing({
      id: p.id,
      name: p.name,
      description: p.description,
      promptSuffix: cfg?.promptSuffix ?? "",
      instruction: cfg?.instruction ?? "",
      category: p.category,
      icon: cfg?.icon ?? "🎨",
      type: p.type as PresetTab,
    });
  };

  const tabs: { id: PresetTab; label: string; icon: React.ReactNode }[] = [
    { id: "image", label: "Изображения", icon: <ImageIcon size={14} /> },
    { id: "text", label: "Текст", icon: <TypeIcon size={14} /> },
  ];

  if (!currentWorkspace) {
    return (
      <AppShell>
        <TopBar breadcrumbs={[{ label: "Настройки" }, { label: "AI Стили" }]} showBackToProjects={false} showHistoryNavigation={true} />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-text-tertiary" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <TopBar breadcrumbs={[{ label: "Настройки" }, { label: "AI Стили" }]} showBackToProjects={false} showHistoryNavigation={true} />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary mb-1">AI Стили генерации</h1>
            <p className="text-sm text-text-secondary">
              Настройте стили генерации для вашего воркспейса. Кастомные стили доступны во всех
              AI-инструментах: баре, мастере и AI-редакторе.
            </p>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 bg-bg-secondary rounded-[var(--radius-md)] p-1 w-fit">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setEditing(null); }}
                className={`
                  flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] text-xs font-medium
                  transition-all cursor-pointer
                  ${activeTab === tab.id
                    ? "bg-bg-primary text-text-primary shadow-[var(--shadow-sm)]"
                    : "text-text-secondary hover:text-text-primary"
                  }
                `}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── System Presets (read-only) ── */}
          <section>
            <h2 className="text-sm font-semibold text-text-primary mb-3">
              Системные стили
              <span className="ml-2 text-[10px] font-normal text-text-tertiary">Доступны всегда</span>
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {(activeTab === "image" ? SYSTEM_IMAGE_PRESETS : []).filter(p => p.id !== "none").map((preset) => (
                <div
                  key={preset.id}
                  className="relative rounded-[var(--radius-md)] border border-border-primary bg-bg-surface p-3 space-y-1.5 opacity-80"
                >
                  {/* Thumbnail */}
                  <div className="w-full aspect-video rounded-[var(--radius-sm)] overflow-hidden bg-bg-secondary">
                    <img src={preset.thumbnailUrl} alt={preset.label} className="w-full h-full object-cover" />
                  </div>
                  <p className="text-xs font-medium text-text-primary truncate">{preset.label}</p>
                  <p className="text-[10px] text-text-tertiary line-clamp-2">{preset.description}</p>
                  <span className="inline-block text-[9px] font-medium text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded-full">
                    {IMAGE_CATEGORY_LABELS[preset.category] || preset.category}
                  </span>
                </div>
              ))}
              {(activeTab === "text" ? SYSTEM_TEXT_PRESETS : []).map((preset) => (
                <div
                  key={preset.id}
                  className="rounded-[var(--radius-md)] border border-border-primary bg-bg-surface p-3 space-y-1.5 opacity-80"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{preset.icon}</span>
                    <p className="text-xs font-medium text-text-primary">{preset.label}</p>
                  </div>
                  <p className="text-[10px] text-text-tertiary line-clamp-2">{preset.description}</p>
                  <span className="inline-block text-[9px] font-medium text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded-full">
                    {TEXT_CATEGORY_LABELS[preset.category] || preset.category}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* ── Custom Presets (editable) ── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-text-primary">
                Кастомные стили
                <span className="ml-2 text-[10px] font-normal text-text-tertiary">
                  {activeTab === "image" ? customImagePresets.length : customTextPresets.length} шт.
                </span>
              </h2>
              {isAdmin && (
                <button
                  onClick={() => setEditing(activeTab === "image" ? { ...EMPTY_IMAGE_PRESET } : { ...EMPTY_TEXT_PRESET })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-medium text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20 transition-colors cursor-pointer"
                >
                  <Plus size={14} />
                  Добавить стиль
                </button>
              )}
            </div>

            {/* List of custom presets */}
            <div className="space-y-2">
              {(activeTab === "image" ? customImagePresets : customTextPresets).map((preset) => {
                const cfg = preset.config as DBPresetConfig;
                return (
                  <div
                    key={preset.id}
                    className="flex items-center gap-3 p-3 bg-bg-surface border border-border-primary rounded-[var(--radius-md)] group hover:border-border-secondary transition-colors"
                  >
                    {/* Icon / thumbnail */}
                    {activeTab === "image" && preset.thumbnailUrl ? (
                      <div className="w-10 h-10 rounded-[var(--radius-sm)] overflow-hidden bg-bg-secondary shrink-0">
                        <img src={preset.thumbnailUrl} alt={preset.name} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded-[var(--radius-sm)] bg-bg-tertiary flex items-center justify-center shrink-0">
                        <span className="text-lg">{cfg?.icon || (activeTab === "image" ? "🎨" : "✨")}</span>
                      </div>
                    )}

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{preset.name}</p>
                      <p className="text-[10px] text-text-tertiary truncate">
                        {activeTab === "image" ? cfg?.promptSuffix : cfg?.instruction}
                      </p>
                    </div>

                    {/* Actions */}
                    {isAdmin && (
                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => editFromDB(preset)}
                          className="p-1.5 rounded-[var(--radius-sm)] hover:bg-bg-tertiary text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                          title="Редактировать"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => setDeleteId(preset.id)}
                          className="p-1.5 rounded-[var(--radius-sm)] hover:bg-red-50 text-text-tertiary hover:text-red-500 transition-colors cursor-pointer"
                          title="Удалить"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {(activeTab === "image" ? customImagePresets : customTextPresets).length === 0 && !editing && (
                <div className="text-center py-8">
                  <p className="text-sm text-text-tertiary">Нет кастомных стилей</p>
                  <p className="text-[11px] text-text-tertiary/60 mt-1">
                    Нажмите «Добавить стиль», чтобы создать первый
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* ── Edit / Create Form ── */}
          {editing && (
            <section className="bg-bg-surface border border-accent-primary/30 rounded-[var(--radius-xl)] p-5 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary">
                  {editing.id ? "Редактировать стиль" : "Новый стиль"}
                </h2>
                <button
                  onClick={() => setEditing(null)}
                  className="p-1 rounded hover:bg-bg-tertiary text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                    Название
                  </label>
                  <input
                    type="text"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="Например: Пастельная фотография"
                    className="w-full h-10 px-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                    Категория
                  </label>
                  <Select
                    value={editing.category}
                    onChange={(val) => setEditing({ ...editing, category: val })}
                    options={
                      editing.type === "image"
                        ? [
                            { value: "custom", label: "🎨 Свои стили" },
                            { value: "photography", label: "📸 Фото" },
                            { value: "digital", label: "🎭 Цифровые" },
                            { value: "artistic", label: "✨ Художественные" },
                          ]
                        : [
                            { value: "custom", label: "🎨 Свои стили" },
                            { value: "tone", label: "🎯 Тон" },
                            { value: "length", label: "📏 Длина" },
                          ]
                    }
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                  Описание
                </label>
                <input
                  type="text"
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="Краткое описание стиля"
                  className="w-full h-10 px-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
              </div>

              {editing.type === "image" ? (
                <div>
                  <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                    Промпт-суффикс
                    <span className="ml-1 text-text-tertiary/50 normal-case tracking-normal font-normal">
                      Добавляется к промпту пользователя
                    </span>
                  </label>
                  <textarea
                    value={editing.promptSuffix}
                    onChange={(e) => setEditing({ ...editing, promptSuffix: e.target.value })}
                    placeholder="Professional studio photography, soft lighting, clean background..."
                    rows={3}
                    className="w-full px-3 py-2 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-sm text-text-primary resize-none focus:outline-none focus:ring-1 focus:ring-border-focus"
                  />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-[auto_1fr] gap-4">
                    <div>
                      <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                        Иконка
                      </label>
                      <input
                        type="text"
                        value={editing.icon}
                        onChange={(e) => setEditing({ ...editing, icon: e.target.value })}
                        className="w-14 h-10 px-2 text-center text-lg rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary focus:outline-none focus:ring-1 focus:ring-border-focus"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                        Инструкция для AI
                        <span className="ml-1 text-text-tertiary/50 normal-case tracking-normal font-normal">
                          Системный промпт для генерации текста
                        </span>
                      </label>
                      <textarea
                        value={editing.instruction}
                        onChange={(e) => setEditing({ ...editing, instruction: e.target.value })}
                        placeholder="Пиши в таком-то стиле..."
                        rows={3}
                        className="w-full px-3 py-2 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-sm text-text-primary resize-none focus:outline-none focus:ring-1 focus:ring-border-focus"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Save / Cancel */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={isSaving || !editing.name.trim()}
                  className="h-10 px-6 flex items-center gap-2 bg-accent-primary text-white rounded-[var(--radius-lg)] text-sm font-medium hover:bg-accent-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {editing.id ? "Сохранить" : "Создать"}
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="h-10 px-4 text-xs text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                >
                  Отмена
                </button>
                {(createMut.error || updateMut.error) && (
                  <span className="text-xs text-red-400">
                    {createMut.error?.message || updateMut.error?.message}
                  </span>
                )}
              </div>
            </section>
          )}

          {/* ── Delete Confirmation ── */}
          {deleteId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-150">
              <div className="bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] p-6 w-[380px] shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
                <h3 className="text-sm font-semibold text-text-primary">Удалить стиль?</h3>
                <p className="text-xs text-text-secondary">
                  Это действие необратимо. Стиль будет удалён из всех AI-поверхностей.
                </p>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={() => setDeleteId(null)}
                    className="h-9 px-4 text-xs text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                  >
                    Отмена
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleteMut.isPending}
                    className="h-9 px-4 flex items-center gap-2 bg-red-500 text-white rounded-[var(--radius-lg)] text-xs font-medium hover:bg-red-600 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {deleteMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    Удалить
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
