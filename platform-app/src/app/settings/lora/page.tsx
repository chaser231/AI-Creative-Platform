"use client";

/**
 * /settings/lora — LoRA Presets Management
 *
 * Workspace-scoped CRUD for custom LoRA `.safetensors` URLs that show up in
 * `LoraSelectorPicker` next to system catalogue entries. System catalogue
 * (from `lib/lora-catalog.ts`) is rendered read-only at the top of every
 * family tab; workspace + personal presets follow below in a list.
 *
 * Visibility:
 *  - "personal"  → only the creator sees it (any workspace member may create).
 *  - "workspace" → all members of the workspace see it
 *                  (workspace ADMIN or SUPER_ADMIN only).
 *
 * Permissions mirror `loraPreset` tRPC router exactly — buttons hidden /
 * disabled for actions the server would reject.
 */

import { useMemo, useRef, useState } from "react";
import {
  Plus, Trash2, Pencil, Loader2, X, Save, Upload, ImageIcon,
  User, Users, Lock, ShieldCheck, Layers, Copy, Check, Link as LinkIcon,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { compressImageFile, uploadForAI } from "@/utils/imageUpload";
import type { LoraPickerEntry } from "@/server/routers/loraPreset";
import type { LoraSpec } from "@/lib/ai-models";

type LoraFamily = LoraSpec["family"];
type Visibility = "personal" | "workspace";

interface EditingPreset {
  id?: string; // undefined = new preset
  name: string;
  description: string;
  family: LoraFamily;
  path: string;
  defaultScale: number;
  previewUrl?: string;
  triggerWords: string[];
  visibility: Visibility;
}

const EMPTY_PRESET = (family: LoraFamily): EditingPreset => ({
  name: "",
  description: "",
  family,
  path: "",
  defaultScale: 1.0,
  triggerWords: [],
  visibility: "personal",
});

const FAMILY_TABS: { id: LoraFamily; label: string }[] = [
  { id: "flux-1", label: "FLUX.1" },
  { id: "flux-2", label: "FLUX.2" },
  { id: "qwen", label: "Qwen" },
  { id: "flux-kontext", label: "FLUX.1 Kontext" },
];

const FAMILY_LABEL: Record<LoraFamily, string> = {
  "flux-1": "FLUX.1",
  "flux-2": "FLUX.2",
  qwen: "Qwen",
  "flux-kontext": "FLUX.1 Kontext",
};

export default function LoraPresetsPage() {
  const { currentWorkspace, isAdmin } = useWorkspace();
  const workspaceId = currentWorkspace?.id ?? "";

  const [activeFamily, setActiveFamily] = useState<LoraFamily>("flux-1");
  const [editing, setEditing] = useState<EditingPreset | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingPreview, setIsUploadingPreview] = useState(false);

  // ─── tRPC queries ─────────────────────────────────────────
  // Single query without family filter, then split by family on the client —
  // saves three round-trips when switching tabs.
  const presetsQ = trpc.loraPreset.list.useQuery(
    { workspaceId },
    { enabled: !!workspaceId },
  );

  const utils = trpc.useUtils();
  const refetchAll = () => {
    utils.loraPreset.list.invalidate();
  };

  // ─── Mutations ──────────────────────────────────────────────
  const createMut = trpc.loraPreset.create.useMutation({ onSuccess: refetchAll });
  const updateMut = trpc.loraPreset.update.useMutation({ onSuccess: refetchAll });
  const deleteMut = trpc.loraPreset.delete.useMutation({ onSuccess: refetchAll });

  const isSaving = createMut.isPending || updateMut.isPending;
  const saveError =
    createMut.error?.message ?? updateMut.error?.message ?? null;

  // ─── Split presets by source / family ────────────────────────
  const familyPresets = useMemo(() => {
    const all = (presetsQ.data ?? []) as LoraPickerEntry[];
    return all.filter((p) => p.family === activeFamily);
  }, [presetsQ.data, activeFamily]);

  const systemPresets = useMemo(
    () => familyPresets.filter((p) => p.source === "system"),
    [familyPresets],
  );
  const workspacePresets = useMemo(
    () => familyPresets.filter((p) => p.source === "workspace"),
    [familyPresets],
  );

  // ─── Handlers ────────────────────────────────────────────────
  const handleStartCreate = () => {
    setEditing(EMPTY_PRESET(activeFamily));
  };

  const handleStartEdit = (entry: LoraPickerEntry) => {
    setEditing({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      family: entry.family,
      path: entry.path,
      defaultScale: entry.defaultScale,
      previewUrl: entry.previewUrl || undefined,
      triggerWords: entry.triggerWords ?? [],
      visibility: entry.visibility === "workspace" ? "workspace" : "personal",
    });
  };

  const handleSave = async () => {
    if (!editing || !workspaceId) return;

    const trimmedName = editing.name.trim();
    const trimmedPath = editing.path.trim();
    if (!trimmedName || !trimmedPath) return;

    if (editing.id) {
      await updateMut.mutateAsync({
        id: editing.id,
        name: trimmedName,
        description: editing.description.trim(),
        path: trimmedPath,
        defaultScale: editing.defaultScale,
        previewUrl: editing.previewUrl ?? null,
        triggerWords: editing.triggerWords,
        visibility: editing.visibility,
      });
    } else {
      await createMut.mutateAsync({
        workspaceId,
        name: trimmedName,
        description: editing.description.trim(),
        family: editing.family,
        path: trimmedPath,
        defaultScale: editing.defaultScale,
        previewUrl: editing.previewUrl,
        triggerWords: editing.triggerWords,
        visibility: editing.visibility,
      });
    }
    setEditing(null);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await deleteMut.mutateAsync({ id: deleteId });
    setDeleteId(null);
  };

  const handlePreviewUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editing) return;
    try {
      setIsUploadingPreview(true);
      const base64 = await compressImageFile(file, 512);
      const publicUrl = await uploadForAI(base64, workspaceId || "lora-previews");
      setEditing({ ...editing, previewUrl: publicUrl });
    } catch (err) {
      console.error("Failed to upload LoRA preview:", err);
    } finally {
      setIsUploadingPreview(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCopyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 1200);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — silently no-op.
    }
  };

  // ─── No-workspace / loading guards ───────────────────────────
  if (!currentWorkspace) {
    return (
      <AppShell>
        <TopBar
          breadcrumbs={[{ label: "Настройки" }, { label: "LoRA пресеты" }]}
          showBackToProjects={false}
          showHistoryNavigation={true}
        />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-text-tertiary" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <TopBar
        breadcrumbs={[{ label: "Настройки" }, { label: "LoRA пресеты" }]}
        showBackToProjects={false}
        showHistoryNavigation={true}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
          {/* ── Header ── */}
          <div>
            <h1 className="text-2xl font-bold text-text-primary mb-1 flex items-center gap-2">
              <Layers size={22} className="text-amber-500" />
              LoRA пресеты
            </h1>
            <p className="text-sm text-text-secondary">
              Кастомные LoRA-веса для ваших фото- и арт-моделей. Личные
              пресеты видны только вам, командные — всем участникам
              воркспейса{" "}
              {!isAdmin && (
                <span className="text-text-tertiary">
                  (публикация для команды доступна только админам)
                </span>
              )}
              .
            </p>
          </div>

          {/* ── Family tabs ── */}
          <SegmentedControl
            value={activeFamily}
            onChange={(val) => {
              setActiveFamily(val as LoraFamily);
              setEditing(null);
            }}
            options={FAMILY_TABS.map((t) => ({ value: t.id, label: t.label }))}
          />

          {/* ── System Presets (read-only) ── */}
          <section>
            <h2 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
              Системный каталог
              <span className="text-[10px] font-normal text-text-tertiary">
                Доступен всегда
              </span>
            </h2>

            {presetsQ.isLoading ? (
              <SystemSkeletonGrid />
            ) : systemPresets.length === 0 ? (
              <p className="text-xs text-text-tertiary py-3">
                Нет системных пресетов для {FAMILY_LABEL[activeFamily]}.
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {systemPresets.map((preset) => (
                  <SystemPresetCard
                    key={preset.id}
                    preset={preset}
                    onCopyPath={handleCopyPath}
                    isCopied={copiedPath === preset.path}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ── Custom Presets ── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-text-primary">
                Пресеты воркспейса
                <span className="ml-2 text-[10px] font-normal text-text-tertiary">
                  {workspacePresets.length} шт.
                </span>
              </h2>
              <button
                onClick={handleStartCreate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-medium text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20 transition-colors cursor-pointer"
              >
                <Plus size={14} />
                Добавить LoRA
              </button>
            </div>

            <div className="space-y-2">
              {presetsQ.isLoading ? (
                <CustomListSkeleton />
              ) : workspacePresets.length === 0 ? (
                <EmptyCustomState onCreate={handleStartCreate} />
              ) : (
                workspacePresets.map((preset) => (
                  <CustomPresetRow
                    key={preset.id}
                    preset={preset}
                    onEdit={() => handleStartEdit(preset)}
                    onDelete={() => setDeleteId(preset.id)}
                    onCopyPath={() => handleCopyPath(preset.path)}
                    isCopied={copiedPath === preset.path}
                  />
                ))
              )}
            </div>
          </section>

          {/* ── Edit / Create Form ── */}
          {editing && (
            <section className="bg-bg-surface border border-accent-primary/30 rounded-[var(--radius-xl)] p-5 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary">
                  {editing.id ? "Редактировать LoRA" : "Новый LoRA-пресет"}
                </h2>
                <button
                  onClick={() => setEditing(null)}
                  className="p-1 rounded hover:bg-bg-tertiary text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                  aria-label="Закрыть"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Name + family */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                    Название
                  </label>
                  <input
                    type="text"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="Например: Studio Product Shot"
                    maxLength={120}
                    className="w-full h-10 px-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                    Семейство модели
                    {editing.id && (
                      <span className="ml-1 normal-case tracking-normal font-normal text-text-tertiary/60">
                        · фиксировано
                      </span>
                    )}
                  </label>
                  <SegmentedControl
                    value={editing.family}
                    onChange={(val) =>
                      // Family is immutable on update — only honour change for
                      // brand-new presets so existing rows can't drift.
                      !editing.id && setEditing({ ...editing, family: val as LoraFamily })
                    }
                    options={FAMILY_TABS.map((t) => ({ value: t.id, label: t.label }))}
                    fullWidth
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                  Описание
                </label>
                <input
                  type="text"
                  value={editing.description}
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value })
                  }
                  placeholder="Когда применять этот LoRA"
                  maxLength={500}
                  className="w-full h-10 px-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
              </div>

              {/* Preview upload + .safetensors path */}
              <div className="flex gap-4 p-4 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary/50">
                <div className="w-24 h-24 shrink-0 rounded-[var(--radius-md)] border border-border-primary overflow-hidden bg-bg-tertiary flex items-center justify-center relative">
                  {editing.previewUrl ? (
                    <img
                      src={editing.previewUrl}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImageIcon size={24} className="text-text-tertiary" />
                  )}
                  {isUploadingPreview && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg-secondary/80 backdrop-blur-sm">
                      <Loader2 size={18} className="animate-spin text-accent-primary" />
                      <span className="text-[9px] font-medium text-text-primary mt-1">
                        Загрузка…
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-2.5 flex flex-col justify-center">
                  <p className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">
                    Превью (опционально)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      ref={fileInputRef}
                      onChange={handlePreviewUpload}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploadingPreview}
                      className="h-8 px-3 flex items-center gap-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-bg-surface border border-border-primary text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <Upload size={14} className="text-text-secondary" /> Загрузить
                    </button>
                    {editing.previewUrl && (
                      <button
                        onClick={() => setEditing({ ...editing, previewUrl: undefined })}
                        disabled={isUploadingPreview}
                        className="h-8 px-3 flex items-center gap-1.5 text-xs font-medium rounded-[var(--radius-md)] text-text-tertiary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                      >
                        <X size={13} /> Удалить
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-text-tertiary">
                    Квадрат, до 512px. Пережимается в WebP перед загрузкой.
                  </p>
                </div>
              </div>

              {/* .safetensors path */}
              <div>
                <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                  URL файла .safetensors
                </label>
                <div className="relative">
                  <LinkIcon
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
                  />
                  <input
                    type="url"
                    value={editing.path}
                    onChange={(e) => setEditing({ ...editing, path: e.target.value })}
                    placeholder="https://huggingface.co/.../lora.safetensors"
                    className="w-full h-10 pl-9 pr-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus font-mono"
                  />
                </div>
                <p className="text-[10px] text-text-tertiary mt-1.5">
                  Только HTTPS с разрешённых хостов (huggingface.co, civitai.com,
                  и др.). Перед сохранением URL валидируется на сервере.
                </p>
              </div>

              {/* Default scale */}
              <div>
                <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 flex items-center justify-between">
                  <span>Сила по умолчанию</span>
                  <span className="tabular-nums text-text-secondary normal-case tracking-normal">
                    {editing.defaultScale.toFixed(2)}
                  </span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={editing.defaultScale}
                  onChange={(e) =>
                    setEditing({ ...editing, defaultScale: parseFloat(e.target.value) })
                  }
                  className="w-full accent-amber-400 h-1"
                />
              </div>

              {/* Trigger words */}
              <div>
                <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                  Триггер-слова
                  <span className="ml-1 text-text-tertiary/50 normal-case tracking-normal font-normal">
                    {editing.triggerWords.length}/10 · автоматически добавятся к промпту
                  </span>
                </label>
                <TriggerWordsInput
                  value={editing.triggerWords}
                  onChange={(words) => setEditing({ ...editing, triggerWords: words })}
                  max={10}
                />
              </div>

              {/* Visibility */}
              <div>
                <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                  Видимость
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setEditing({ ...editing, visibility: "personal" })}
                    className={`flex items-center gap-2 px-4 py-2 rounded-[var(--radius-lg)] border text-xs font-medium transition-all cursor-pointer ${
                      editing.visibility === "personal"
                        ? "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400"
                        : "border-border-primary bg-bg-secondary text-text-secondary hover:border-border-secondary"
                    }`}
                  >
                    <User size={13} />
                    Только для меня
                  </button>

                  <button
                    onClick={() => {
                      if (isAdmin) {
                        setEditing({ ...editing, visibility: "workspace" });
                      }
                    }}
                    disabled={!isAdmin}
                    title={
                      !isAdmin
                        ? "Только админы воркспейса могут публиковать LoRA для всей команды"
                        : ""
                    }
                    className={`flex items-center gap-2 px-4 py-2 rounded-[var(--radius-lg)] border text-xs font-medium transition-all ${
                      editing.visibility === "workspace"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 cursor-pointer"
                        : !isAdmin
                          ? "border-border-primary bg-bg-secondary text-text-tertiary opacity-50 cursor-not-allowed"
                          : "border-border-primary bg-bg-secondary text-text-secondary hover:border-border-secondary cursor-pointer"
                    }`}
                  >
                    <Users size={13} />
                    Для всей команды
                    {!isAdmin && <Lock size={10} className="text-text-tertiary" />}
                  </button>
                </div>
              </div>

              {/* Save / Cancel */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={
                    isSaving ||
                    !editing.name.trim() ||
                    !editing.path.trim() ||
                    isUploadingPreview
                  }
                  className="h-10 px-6 flex items-center gap-2 bg-accent-primary text-text-inverse rounded-[var(--radius-lg)] text-sm font-medium hover:bg-accent-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSaving ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Save size={14} />
                  )}
                  {editing.id ? "Сохранить" : "Создать"}
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="h-10 px-4 text-xs text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                >
                  Отмена
                </button>
                {saveError && (
                  <span className="text-xs text-red-400 flex-1 truncate" title={saveError}>
                    {saveError}
                  </span>
                )}
              </div>
            </section>
          )}

          {/* ── Delete Confirmation ── */}
          {deleteId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-150">
              <div className="bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] p-6 w-[380px] shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
                <h3 className="text-sm font-semibold text-text-primary">Удалить LoRA-пресет?</h3>
                <p className="text-xs text-text-secondary">
                  Это действие необратимо. Пресет исчезнет из всех промпт-баров,
                  но уже выбранные в проектах LoRA продолжат работать (пути
                  сохраняются в промптах).
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
                    {deleteMut.isPending ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Trash2 size={12} />
                    )}
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

// ─── Sub-components ──────────────────────────────────────────

function SystemPresetCard({
  preset,
  onCopyPath,
  isCopied,
}: {
  preset: LoraPickerEntry;
  onCopyPath: (path: string) => void;
  isCopied: boolean;
}) {
  return (
    <div className="group relative rounded-[var(--radius-md)] border border-border-primary bg-bg-surface p-3 space-y-1.5 transition-colors">
      <div className="w-full aspect-square rounded-[var(--radius-sm)] overflow-hidden bg-bg-secondary">
        {preset.previewUrl ? (
          <img
            src={preset.previewUrl}
            alt={preset.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-tertiary">
            <Layers size={24} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <p className="text-xs font-medium text-text-primary truncate flex-1">
          {preset.name}
        </p>
        <span
          className="flex items-center gap-0.5 text-[9px] font-medium text-sky-600 dark:text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded-full shrink-0"
          title="Системный пресет"
        >
          <ShieldCheck size={8} /> Системный
        </span>
      </div>

      <p className="text-[10px] text-text-tertiary line-clamp-2">
        {preset.description}
      </p>

      {preset.triggerWords && preset.triggerWords.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {preset.triggerWords.slice(0, 3).map((w) => (
            <span
              key={w}
              className="text-[9px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full"
            >
              {w}
            </span>
          ))}
          {preset.triggerWords.length > 3 && (
            <span className="text-[9px] text-text-tertiary">
              +{preset.triggerWords.length - 3}
            </span>
          )}
        </div>
      )}

      <button
        onClick={() => onCopyPath(preset.path)}
        className="absolute top-2 right-2 p-1.5 rounded-[var(--radius-sm)] bg-bg-surface/90 backdrop-blur hover:bg-bg-tertiary text-text-tertiary hover:text-text-primary transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
        title="Скопировать URL"
      >
        {isCopied ? (
          <Check size={12} className="text-emerald-500" />
        ) : (
          <Copy size={12} />
        )}
      </button>
    </div>
  );
}

function CustomPresetRow({
  preset,
  onEdit,
  onDelete,
  onCopyPath,
  isCopied,
}: {
  preset: LoraPickerEntry;
  onEdit: () => void;
  onDelete: () => void;
  onCopyPath: () => void;
  isCopied: boolean;
}) {
  const isWorkspaceShared = preset.visibility === "workspace";
  return (
    <div className="flex items-center gap-3 p-3 bg-bg-surface border border-border-primary rounded-[var(--radius-md)] group hover:border-border-secondary transition-colors">
      {/* Preview / fallback icon */}
      {preset.previewUrl ? (
        <div className="w-12 h-12 rounded-[var(--radius-sm)] overflow-hidden bg-bg-secondary shrink-0">
          <img
            src={preset.previewUrl}
            alt={preset.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="w-12 h-12 rounded-[var(--radius-sm)] bg-bg-tertiary flex items-center justify-center shrink-0 text-text-tertiary">
          <Layers size={20} />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-text-primary truncate">
            {preset.name}
          </p>
          {isWorkspaceShared ? (
            <span className="flex items-center gap-0.5 text-[9px] font-medium text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded-full shrink-0">
              <Users size={8} /> Команда
            </span>
          ) : (
            <span className="flex items-center gap-0.5 text-[9px] font-medium text-violet-500 bg-violet-500/10 px-1.5 py-0.5 rounded-full shrink-0">
              <User size={8} /> Личный
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-[10px] text-text-tertiary truncate font-mono" title={preset.path}>
            {preset.path}
          </p>
          {preset.authorName && (
            <span className="text-[9px] text-text-tertiary/60 shrink-0">
              · {preset.authorName}
            </span>
          )}
        </div>

        {preset.triggerWords && preset.triggerWords.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {preset.triggerWords.map((w) => (
              <span
                key={w}
                className="text-[9px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full"
              >
                {w}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onCopyPath}
          className="p-1.5 rounded-[var(--radius-sm)] hover:bg-bg-tertiary text-text-tertiary hover:text-text-primary transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
          title="Скопировать URL"
        >
          {isCopied ? (
            <Check size={13} className="text-emerald-500" />
          ) : (
            <Copy size={13} />
          )}
        </button>
        {preset.canEdit && (
          <>
            <button
              onClick={onEdit}
              className="p-1.5 rounded-[var(--radius-sm)] hover:bg-bg-tertiary text-text-tertiary hover:text-text-primary transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
              title="Редактировать"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded-[var(--radius-sm)] hover:bg-red-50 dark:hover:bg-red-950/30 text-text-tertiary hover:text-red-500 transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
              title="Удалить"
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function TriggerWordsInput({
  value,
  onChange,
  max,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  max: number;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const word = draft.trim();
    if (!word) return;
    if (word.length > 60) return;
    if (value.includes(word)) {
      setDraft("");
      return;
    }
    if (value.length >= max) return;
    onChange([...value, word]);
    setDraft("");
  };

  const remove = (word: string) => {
    onChange(value.filter((w) => w !== word));
  };

  return (
    <div className="rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary p-2 flex flex-wrap items-center gap-1.5 min-h-10">
      {value.map((word) => (
        <span
          key={word}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300 bg-amber-500/15 border border-amber-500/30 rounded-full pl-2 pr-1 py-0.5"
        >
          {word}
          <button
            onClick={() => remove(word)}
            className="text-amber-700/70 dark:text-amber-300/70 hover:text-red-500 cursor-pointer rounded-full"
            aria-label={`Удалить ${word}`}
            type="button"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      {value.length < max && (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !draft && value.length > 0) {
              // Quick backspace removes the last chip — mirrors the standard
              // tag-input pattern in the rest of the app.
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={commit}
          placeholder={
            value.length === 0
              ? "studio lighting, clean background…"
              : "Добавить ещё"
          }
          maxLength={60}
          className="flex-1 min-w-[140px] bg-transparent text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none px-1.5 h-6"
        />
      )}
    </div>
  );
}

function SystemSkeletonGrid() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-[var(--radius-md)] border border-border-primary bg-bg-surface p-3 space-y-1.5 animate-pulse"
        >
          <div className="w-full aspect-square rounded-[var(--radius-sm)] bg-bg-tertiary" />
          <div className="h-3 w-2/3 rounded bg-bg-tertiary" />
          <div className="h-2 w-full rounded bg-bg-tertiary" />
        </div>
      ))}
    </div>
  );
}

function CustomListSkeleton() {
  return (
    <>
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 bg-bg-surface border border-border-primary rounded-[var(--radius-md)] animate-pulse"
        >
          <div className="w-12 h-12 rounded-[var(--radius-sm)] bg-bg-tertiary shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded bg-bg-tertiary" />
            <div className="h-2 w-2/3 rounded bg-bg-tertiary" />
          </div>
        </div>
      ))}
    </>
  );
}

function EmptyCustomState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="text-center py-10 border border-dashed border-border-primary rounded-[var(--radius-lg)]">
      <div className="w-12 h-12 mx-auto rounded-full bg-bg-tertiary flex items-center justify-center text-text-tertiary mb-3">
        <Layers size={20} />
      </div>
      <p className="text-sm text-text-secondary">
        Кастомных LoRA в воркспейсе пока нет
      </p>
      <p className="text-[11px] text-text-tertiary/70 mt-1 mb-4">
        Добавьте свой первый LoRA — он появится в LoRA-пикере промпт-бара.
      </p>
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[var(--radius-md)] text-xs font-medium text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20 transition-colors cursor-pointer"
      >
        <Plus size={14} />
        Добавить первый LoRA
      </button>
    </div>
  );
}
