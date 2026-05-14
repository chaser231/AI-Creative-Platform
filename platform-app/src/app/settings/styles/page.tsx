"use client";

/**
 * /settings/styles — AI Style Presets Management
 *
 * Workspace-scoped CRUD for custom image and text generation styles.
 * System presets are displayed (non-editable), custom presets can be
 * created, edited, and deleted.
 *
 * Visibility:
 *  - "personal"  → only visible to the creator
 *  - "workspace" → visible to all workspace members
 *                  (workspace ADMIN or SUPER_ADMIN can set)
 *  - "global"    → visible to every authenticated user across all workspaces
 *                  (SUPER_ADMIN only — behaves like a system preset)
 */

import { useState, useRef, useMemo } from "react";
import {
  Plus, Trash2, Pencil, Type as TypeIcon,
  Loader2, X, ImageIcon, Save, User, Users,
  Globe, Lock, Upload, Sparkles, RotateCcw, ShieldCheck, RefreshCw,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import {
  SYSTEM_IMAGE_PRESETS,
  SYSTEM_TEXT_PRESETS,
  IMAGE_CATEGORY_LABELS,
  TEXT_CATEGORY_LABELS,
  isSystemPresetId,
} from "@/lib/stylePresets";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { compressImageFile, uploadForAI } from "@/utils/imageUpload";
import type { DBPresetConfig } from "@/lib/stylePresets";

type PresetTab = "image" | "text";
type Visibility = "personal" | "workspace" | "global";
/**
 * `custom` — regular user-created preset (CRUD via createPreset/updatePreset).
 * `system` — super-admin override of a baked-in system preset (CRUD via
 *            upsertSystemPresetOverride / resetSystemPresetOverride). The id
 *            of a system preset matches its hardcoded id (e.g. "product").
 */
type EditingKind = "custom" | "system";

interface EditingPreset {
  id?: string;             // undefined = new preset; for system kind = systemId
  name: string;
  description: string;
  promptSuffix: string;    // for image
  instruction: string;     // for text
  category: string;
  icon: string;
  type: PresetTab;
  visibility: Visibility;
  thumbnailUrl?: string;
  kind: EditingKind;
  /** True iff a DB override for this system preset already exists. */
  hasExistingOverride?: boolean;
}

const EMPTY_IMAGE_PRESET: EditingPreset = {
  name: "", description: "", promptSuffix: "", instruction: "",
  category: "custom", icon: "🎨", type: "image", visibility: "personal",
  kind: "custom",
};

const EMPTY_TEXT_PRESET: EditingPreset = {
  name: "", description: "", promptSuffix: "", instruction: "",
  category: "custom", icon: "✨", type: "text", visibility: "personal",
  kind: "custom",
};

export default function StylePresetsPage() {
  const { currentWorkspace, isAdmin, isSuperAdmin } = useWorkspace();
  const workspaceId = currentWorkspace?.id ?? "";

  const [activeTab, setActiveTab] = useState<PresetTab>("image");
  const [editing, setEditing] = useState<EditingPreset | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingThumb, setIsUploadingThumb] = useState(false);
  const [isGeneratingThumb, setIsGeneratingThumb] = useState(false);
  const [thumbError, setThumbError] = useState<string | null>(null);

  // ─── Current user ────────────────────────────────────────
  const meQuery = trpc.auth.me.useQuery(undefined, { refetchOnWindowFocus: false });
  const myUserId = meQuery.data?.id;

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
  const upsertSystemMut = trpc.ai.upsertSystemPresetOverride.useMutation({ onSuccess: refetchAll });
  const resetSystemMut = trpc.ai.resetSystemPresetOverride.useMutation({ onSuccess: refetchAll });
  const backfillMut = trpc.ai.backfillPresetThumbnails.useMutation({ onSuccess: refetchAll });
  const [backfillReport, setBackfillReport] = useState<{ repaired: number; cleared: number; scanned: number } | null>(null);

  const handleBackfillThumbs = async () => {
    setBackfillReport(null);
    const result = await backfillMut.mutateAsync({ dryRun: false });
    setBackfillReport({
      scanned: result.scanned,
      repaired: result.repaired.length,
      cleared: result.cleared.length,
    });
  };

  const isSaving = createMut.isPending || updateMut.isPending || upsertSystemMut.isPending;

  // ─── Save handler ──────────────────────────────────────────
  const handleSave = async () => {
    if (!editing || !workspaceId) return;

    const config: DBPresetConfig = editing.type === "image"
      ? { promptSuffix: editing.promptSuffix }
      : { instruction: editing.instruction, icon: editing.icon };

    try {
      if (editing.kind === "system") {
        // System override is keyed by the hardcoded system id; upsertSystemPresetOverride
        // ignores category / visibility (those are dictated by the registry).
        if (!editing.id) return;
        await upsertSystemMut.mutateAsync({
          systemId: editing.id,
          type: editing.type,
          workspaceId,
          name: editing.name.trim(),
          description: editing.description.trim(),
          config,
          thumbnailUrl: editing.thumbnailUrl ?? null,
        });
      } else if (editing.id) {
        await updateMut.mutateAsync({
          id: editing.id,
          name: editing.name.trim(),
          description: editing.description.trim(),
          config,
          category: editing.category,
          visibility: editing.visibility,
          thumbnailUrl: editing.thumbnailUrl,
        });
      } else {
        await createMut.mutateAsync({
          workspaceId,
          name: editing.name.trim(),
          description: editing.description.trim(),
          type: editing.type,
          config,
          category: editing.category,
          visibility: editing.visibility,
          thumbnailUrl: editing.thumbnailUrl,
        });
      }
      setEditing(null);
    } catch (err) {
      // The mutation hook (createMut/updateMut/upsertSystemMut) already
      // captures and exposes `.error` for the inline UI; we just need to
      // keep the editor open so the user can fix the input (e.g. expired
      // thumbnail URL) and retry.
      console.error("Failed to save preset:", err);
    }
  };

  // ─── Reset system override ──────────────────────────────────
  const handleResetSystem = async (systemId: string, type: PresetTab) => {
    await resetSystemMut.mutateAsync({ systemId, type });
    if (editing?.kind === "system" && editing.id === systemId) {
      setEditing(null);
    }
  };

  // ─── Delete handler ──────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteId) return;
    await deleteMut.mutateAsync({ id: deleteId });
    setDeleteId(null);
  };

  // ─── Thumbnail handlers ──────────────────────────────────────
  //
  // NOTE: client-side persistence is best-effort only. The tRPC mutations
  // (createPreset / updatePreset / upsertSystemPresetOverride) re-run
  // `persistThumbnailToS3` server-side and throw if the URL can't be
  // copied into our S3 bucket. That's what guarantees the thumbnail
  // never rots — the local preview just shows whatever the AI returned
  // until the user clicks "Сохранить".
  const handleThumbUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editing) return;

    setThumbError(null);
    try {
      setIsUploadingThumb(true);
      const base64 = await compressImageFile(file, 800);
      const publicUrl = await uploadForAI(base64, workspaceId || "styles");
      setEditing({ ...editing, thumbnailUrl: publicUrl });
    } catch (err) {
      console.error("Failed to upload thumbnail:", err);
      setThumbError(
        err instanceof Error
          ? `Не удалось загрузить миниатюру: ${err.message}`
          : "Не удалось загрузить миниатюру",
      );
    } finally {
      setIsUploadingThumb(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleGenerateThumb = async () => {
    if (!editing || !editing.promptSuffix.trim()) return;

    setThumbError(null);
    try {
      setIsGeneratingThumb(true);
      const basePrompt = "A visually appealing thumbnail image representing the following style:";
      const finalPrompt = `${basePrompt} ${editing.promptSuffix}`;

      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: finalPrompt,
          type: "image",
          model: "flux-schnell",
          aspectRatio: "1:1",
          count: 1,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (data.content) {
        // Show the raw URL/base64 as a live preview. The actual S3 copy
        // happens server-side inside the save mutation — that's where the
        // expiring Replicate/fal URL gets converted into a permanent
        // storage.yandexcloud.net URL. If we tried to do it here too we'd
        // double-upload (and reproduce the silent-fallback bug we just
        // fixed when the client request fails).
        setEditing({ ...editing, thumbnailUrl: data.content });
      }
    } catch (err) {
      console.error("Failed to generate thumbnail:", err);
      setThumbError(
        err instanceof Error
          ? `Генерация миниатюры не удалась: ${err.message}`
          : "Генерация миниатюры не удалась",
      );
    } finally {
      setIsGeneratingThumb(false);
    }
  };

  // ─── DB presets as typed arrays ──────────────────────────────
  type DBPreset = NonNullable<typeof imagePresetsQ.data>[0];
  const allImageDB = (imagePresetsQ.data ?? []) as DBPreset[];
  const allTextDB = (textPresetsQ.data ?? []) as DBPreset[];

  // Split DB list into "overrides of built-in system presets" (id matches a
  // system preset) and "purely custom presets". Overrides are rendered inside
  // the system section (they replace the default), so they should NOT also
  // appear in the custom section — that would duplicate the same logical row.
  const imageSystemOverrides = useMemo(() => {
    const map = new Map<string, DBPreset>();
    for (const p of allImageDB) if (isSystemPresetId(p.id, "image")) map.set(p.id, p);
    return map;
  }, [allImageDB]);
  const textSystemOverrides = useMemo(() => {
    const map = new Map<string, DBPreset>();
    for (const p of allTextDB) if (isSystemPresetId(p.id, "text")) map.set(p.id, p);
    return map;
  }, [allTextDB]);

  const customImagePresets = useMemo(
    () => allImageDB.filter((p) => !isSystemPresetId(p.id, "image")),
    [allImageDB],
  );
  const customTextPresets = useMemo(
    () => allTextDB.filter((p) => !isSystemPresetId(p.id, "text")),
    [allTextDB],
  );

  // ─── Edit from DB row (custom preset) ────────────────────────
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
      visibility: (p.visibility as Visibility) || "workspace",
      thumbnailUrl: p.thumbnailUrl || undefined,
      kind: "custom",
    });
  };

  // ─── Edit a built-in system preset (super-admin only) ────────
  // Pre-fills the form with the active definition: DB override if it exists,
  // otherwise the hardcoded default from `stylePresets.ts`.
  const editSystem = (
    type: PresetTab,
    sys:
      | (typeof SYSTEM_IMAGE_PRESETS)[number]
      | (typeof SYSTEM_TEXT_PRESETS)[number],
  ) => {
    const overrideMap = type === "image" ? imageSystemOverrides : textSystemOverrides;
    const override = overrideMap.get(sys.id);
    const cfg = (override?.config as DBPresetConfig | undefined) ?? null;

    const isImage = type === "image";
    const sysImage = isImage ? (sys as (typeof SYSTEM_IMAGE_PRESETS)[number]) : null;
    const sysText = !isImage ? (sys as (typeof SYSTEM_TEXT_PRESETS)[number]) : null;

    setEditing({
      id: sys.id,
      type,
      kind: "system",
      hasExistingOverride: !!override,
      name: override?.name ?? sys.label,
      description: override?.description ?? sys.description,
      promptSuffix: cfg?.promptSuffix ?? sysImage?.promptSuffix ?? "",
      instruction: cfg?.instruction ?? sysText?.instruction ?? "",
      icon: cfg?.icon ?? sysText?.icon ?? "🎨",
      category: sys.category,
      visibility: "global",
      thumbnailUrl:
        override?.thumbnailUrl ?? sysImage?.thumbnailUrl ?? undefined,
    });
  };

  // Can user edit/delete this preset?
  // Author always can; workspace admin can manage presets in their workspace;
  // SUPER_ADMIN can manage any preset (incl. global ones from other workspaces).
  const canManagePreset = (preset: DBPreset) => {
    if (preset.createdById === myUserId) return true;
    if (isSuperAdmin) return true;
    if (preset.visibility === "global") return false;
    return isAdmin && preset.workspaceId === workspaceId;
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
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-text-primary mb-1">AI Стили генерации</h1>
              <p className="text-sm text-text-secondary">
                Настройте стили генерации. Личные стили видны только вам, командные — всем
                участникам воркспейса, глобальные — всем пользователям платформы.
              </p>
            </div>
            {isSuperAdmin && (
              <div className="flex flex-col items-end gap-1.5">
                <button
                  onClick={handleBackfillThumbs}
                  disabled={backfillMut.isPending}
                  className="h-9 px-3 flex items-center gap-1.5 text-xs font-medium rounded-[var(--radius-md)] border border-border-primary bg-bg-surface text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-50 cursor-pointer"
                  title="Перезалить миниатюры, у которых ссылка ведёт во временное хранилище провайдера"
                >
                  {backfillMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  Починить миниатюры
                </button>
                {backfillReport && (
                  <p className="text-[10px] text-text-tertiary text-right max-w-[260px]">
                    Проверено {backfillReport.scanned}, восстановлено {backfillReport.repaired}, очищено {backfillReport.cleared}.
                  </p>
                )}
                {backfillMut.error && (
                  <p className="text-[10px] text-red-500 text-right max-w-[260px]">
                    {backfillMut.error.message}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Tabs */}
          <SegmentedControl
            value={activeTab}
            onChange={(val) => { setActiveTab(val as PresetTab); setEditing(null); }}
            options={tabs.map((t) => ({ value: t.id, label: t.label, icon: t.icon }))}
          />

          {/* ── System Presets (overridable by super-admin) ── */}
          <section>
            <h2 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
              Системные стили
              <span className="text-[10px] font-normal text-text-tertiary">
                Доступны всегда
                {isSuperAdmin && " · можно редактировать"}
              </span>
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {activeTab === "image" &&
                SYSTEM_IMAGE_PRESETS.filter((p) => p.id !== "none").map((preset) => {
                  const override = imageSystemOverrides.get(preset.id);
                  // Apply override (if any) on top of the hardcoded defaults.
                  const displayName = override?.name ?? preset.label;
                  const displayDesc = override?.description ?? preset.description;
                  const displayThumb = override?.thumbnailUrl ?? preset.thumbnailUrl;
                  const isOverridden = !!override;
                  return (
                    <div
                      key={preset.id}
                      className={`group relative rounded-[var(--radius-md)] border bg-bg-surface p-3 space-y-1.5 transition-colors ${
                        isOverridden ? "border-amber-500/40" : "border-border-primary"
                      }`}
                    >
                      <div className="w-full aspect-video rounded-[var(--radius-sm)] overflow-hidden bg-bg-secondary">
                        <img src={displayThumb} alt={displayName} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-medium text-text-primary truncate flex-1">{displayName}</p>
                        {isOverridden && (
                          <span
                            className="flex items-center gap-0.5 text-[9px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full shrink-0"
                            title="Изменён супер-админом"
                          >
                            <ShieldCheck size={8} /> Изменён
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-text-tertiary line-clamp-2">{displayDesc}</p>
                      <span className="inline-block text-[9px] font-medium text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded-full">
                        {IMAGE_CATEGORY_LABELS[preset.category] || preset.category}
                      </span>
                      {isSuperAdmin && (
                        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {isOverridden && (
                            <button
                              onClick={() => handleResetSystem(preset.id, "image")}
                              disabled={resetSystemMut.isPending}
                              className="p-1.5 rounded-[var(--radius-sm)] bg-bg-surface/90 backdrop-blur hover:bg-bg-tertiary text-text-tertiary hover:text-amber-500 transition-colors cursor-pointer disabled:opacity-50"
                              title="Сбросить к дефолту"
                            >
                              <RotateCcw size={13} />
                            </button>
                          )}
                          <button
                            onClick={() => editSystem("image", preset)}
                            className="p-1.5 rounded-[var(--radius-sm)] bg-bg-surface/90 backdrop-blur hover:bg-bg-tertiary text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                            title="Редактировать (доступно супер-админу)"
                          >
                            <Pencil size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              {activeTab === "text" &&
                SYSTEM_TEXT_PRESETS.map((preset) => {
                  const override = textSystemOverrides.get(preset.id);
                  const cfg = override?.config as DBPresetConfig | undefined;
                  const displayName = override?.name ?? preset.label;
                  const displayDesc = override?.description ?? preset.description;
                  const displayIcon = cfg?.icon ?? preset.icon;
                  const isOverridden = !!override;
                  return (
                    <div
                      key={preset.id}
                      className={`group relative rounded-[var(--radius-md)] border bg-bg-surface p-3 space-y-1.5 transition-colors ${
                        isOverridden ? "border-amber-500/40" : "border-border-primary"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{displayIcon}</span>
                        <p className="text-xs font-medium text-text-primary flex-1 truncate">{displayName}</p>
                        {isOverridden && (
                          <span
                            className="flex items-center gap-0.5 text-[9px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full shrink-0"
                            title="Изменён супер-админом"
                          >
                            <ShieldCheck size={8} /> Изменён
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-text-tertiary line-clamp-2">{displayDesc}</p>
                      <span className="inline-block text-[9px] font-medium text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded-full">
                        {TEXT_CATEGORY_LABELS[preset.category] || preset.category}
                      </span>
                      {isSuperAdmin && (
                        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {isOverridden && (
                            <button
                              onClick={() => handleResetSystem(preset.id, "text")}
                              disabled={resetSystemMut.isPending}
                              className="p-1.5 rounded-[var(--radius-sm)] bg-bg-surface/90 backdrop-blur hover:bg-bg-tertiary text-text-tertiary hover:text-amber-500 transition-colors cursor-pointer disabled:opacity-50"
                              title="Сбросить к дефолту"
                            >
                              <RotateCcw size={13} />
                            </button>
                          )}
                          <button
                            onClick={() => editSystem("text", preset)}
                            className="p-1.5 rounded-[var(--radius-sm)] bg-bg-surface/90 backdrop-blur hover:bg-bg-tertiary text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                            title="Редактировать (доступно супер-админу)"
                          >
                            <Pencil size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
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
              {/* Everyone can create styles (personal by default) */}
              <button
                onClick={() => setEditing(activeTab === "image" ? { ...EMPTY_IMAGE_PRESET } : { ...EMPTY_TEXT_PRESET })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-medium text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20 transition-colors cursor-pointer"
              >
                <Plus size={14} />
                Добавить стиль
              </button>
            </div>

            {/* List of custom presets */}
            <div className="space-y-2">
              {(activeTab === "image" ? customImagePresets : customTextPresets).map((preset) => {
                const cfg = preset.config as DBPresetConfig;
                const visibility = preset.visibility as Visibility;
                const authorName = (preset as unknown as { createdBy?: { name: string } }).createdBy?.name;
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
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-text-primary truncate">{preset.name}</p>
                        {/* Visibility badge */}
                        {visibility === "personal" && (
                          <span className="flex items-center gap-0.5 text-[9px] font-medium text-violet-500 bg-violet-500/10 px-1.5 py-0.5 rounded-full shrink-0">
                            <User size={8} /> Личный
                          </span>
                        )}
                        {visibility === "workspace" && (
                          <span className="flex items-center gap-0.5 text-[9px] font-medium text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded-full shrink-0">
                            <Users size={8} /> Команда
                          </span>
                        )}
                        {visibility === "global" && (
                          <span className="flex items-center gap-0.5 text-[9px] font-medium text-sky-500 bg-sky-500/10 px-1.5 py-0.5 rounded-full shrink-0">
                            <Globe size={8} /> Для всех
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[10px] text-text-tertiary truncate">
                          {activeTab === "image" ? cfg?.promptSuffix : cfg?.instruction}
                        </p>
                        {authorName && (
                          <span className="text-[9px] text-text-tertiary/60 shrink-0">
                            · {authorName}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions — visible to author or admin */}
                    {canManagePreset(preset) && (
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
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-text-primary">
                    {editing.kind === "system"
                      ? `Редактировать системный стиль · ${editing.id}`
                      : editing.id
                        ? "Редактировать стиль"
                        : "Новый стиль"}
                  </h2>
                  {editing.kind === "system" && (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-sky-600 dark:text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded-full">
                      <ShieldCheck size={10} /> Супер-админ
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setEditing(null)}
                  className="p-1 rounded hover:bg-bg-tertiary text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {editing.kind === "system" && (
                <p className="text-[11px] text-text-tertiary -mt-1">
                  Изменения видны всем пользователям платформы. Категория и видимость
                  системного стиля заблокированы. Используйте «Сбросить к дефолту»,
                  чтобы вернуть встроенные значения.
                </p>
              )}

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
                    {editing.kind === "system" && (
                      <span className="ml-1 normal-case tracking-normal font-normal text-text-tertiary/60">
                        · фиксирована
                      </span>
                    )}
                  </label>
                  <Select
                    value={editing.category}
                    onChange={(val) => setEditing({ ...editing, category: val })}
                    disabled={editing.kind === "system"}
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

              {/* Visibility selector — hidden for system overrides (always global by definition) */}
              {editing.kind !== "system" && (
              <div>
                <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                  Видимость
                </label>
                <div className="flex flex-wrap gap-2">
                  {/* Personal — anyone */}
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

                  {/* Workspace — workspace ADMIN or SUPER_ADMIN */}
                  <button
                    onClick={() => {
                      if (isAdmin) {
                        setEditing({ ...editing, visibility: "workspace" });
                      }
                    }}
                    disabled={!isAdmin}
                    title={!isAdmin ? "Только админы воркспейса могут делать стили доступными всей команде" : ""}
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

                  {/* Global — SUPER_ADMIN only */}
                  <button
                    onClick={() => {
                      if (isSuperAdmin) {
                        setEditing({ ...editing, visibility: "global" });
                      }
                    }}
                    disabled={!isSuperAdmin}
                    title={!isSuperAdmin ? "Только супер-админы могут делать стили доступными всем пользователям платформы" : ""}
                    className={`flex items-center gap-2 px-4 py-2 rounded-[var(--radius-lg)] border text-xs font-medium transition-all ${
                      editing.visibility === "global"
                        ? "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400 cursor-pointer"
                        : !isSuperAdmin
                          ? "border-border-primary bg-bg-secondary text-text-tertiary opacity-50 cursor-not-allowed"
                          : "border-border-primary bg-bg-secondary text-text-secondary hover:border-border-secondary cursor-pointer"
                    }`}
                  >
                    <Globe size={13} />
                    Для всех пользователей
                    {!isSuperAdmin && <Lock size={10} className="text-text-tertiary" />}
                  </button>
                </div>
              </div>
              )}

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
                <>
                  {/* Thumbnail Upload/Generate Section */}
                  <div className="flex gap-4 p-4 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary/50">
                    <div className="w-24 h-24 shrink-0 rounded-[var(--radius-md)] border border-border-primary overflow-hidden bg-bg-tertiary flex items-center justify-center relative group">
                      {editing.thumbnailUrl ? (
                        <img src={editing.thumbnailUrl} alt="Thumbnail" className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon size={24} className="text-text-tertiary" />
                      )}
                      
                      {(isUploadingThumb || isGeneratingThumb) && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg-secondary/80 backdrop-blur-sm">
                          <Loader2 size={18} className="animate-spin text-accent-primary" />
                          <span className="text-[9px] font-medium text-text-primary mt-1">
                            {isGeneratingThumb ? "Создаём..." : "Загрузка..."}
                          </span>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-1 space-y-2.5 flex flex-col justify-center">
                      <p className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Миниатюра стиля</p>
                      
                      <div className="flex flex-wrap gap-2">
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="hidden" 
                          ref={fileInputRef} 
                          onChange={handleThumbUpload} 
                        />
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isUploadingThumb || isGeneratingThumb}
                          className="h-8 px-3 flex items-center gap-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-bg-surface border border-border-primary text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          <Upload size={14} className="text-text-secondary" /> Загрузить
                        </button>
                        
                        <button
                          onClick={handleGenerateThumb}
                          disabled={isGeneratingThumb || isUploadingThumb || !editing.promptSuffix.trim()}
                          className="h-8 px-3 flex items-center gap-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-accent-lime/10 border border-accent-lime text-accent-lime-text hover:bg-accent-lime/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                          title={!editing.promptSuffix.trim() ? "Сначала заполните Промпт-суффикс" : ""}
                        >
                          <Sparkles size={14} /> Сгенерировать AI
                        </button>
                      </div>
                      {thumbError && (
                        <p className="text-[11px] font-medium leading-snug text-red-500">
                          {thumbError}
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">
                      Промпт-суффикс
                      <span className="ml-1 text-text-tertiary/50 normal-case tracking-normal font-normal">
                        Добавляется к промпту пользователя
                      </span>
                    </label>
                    <Textarea
                      value={editing.promptSuffix}
                      onChange={(e) => setEditing({ ...editing, promptSuffix: e.target.value })}
                      placeholder="Professional studio photography, soft lighting, clean background..."
                      rows={3}
                    />
                  </div>
                </>
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
                      <Textarea
                        value={editing.instruction}
                        onChange={(e) => setEditing({ ...editing, instruction: e.target.value })}
                        placeholder="Пиши в таком-то стиле..."
                        rows={3}
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
                  className="h-10 px-6 flex items-center gap-2 bg-accent-primary text-text-inverse rounded-[var(--radius-lg)] text-sm font-medium hover:bg-accent-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {editing.kind === "system" || editing.id ? "Сохранить" : "Создать"}
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="h-10 px-4 text-xs text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                >
                  Отмена
                </button>
                {editing.kind === "system" && editing.hasExistingOverride && editing.id && (
                  <button
                    onClick={() => handleResetSystem(editing.id!, editing.type)}
                    disabled={resetSystemMut.isPending}
                    className="h-10 px-4 ml-auto flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 rounded-[var(--radius-lg)] transition-colors disabled:opacity-50 cursor-pointer"
                    title="Удалить override, вернуть встроенные значения"
                  >
                    <RotateCcw size={13} /> Сбросить к дефолту
                  </button>
                )}
                {(createMut.error || updateMut.error || upsertSystemMut.error || resetSystemMut.error) && (
                  <span className="text-xs text-red-400">
                    {createMut.error?.message ||
                      updateMut.error?.message ||
                      upsertSystemMut.error?.message ||
                      resetSystemMut.error?.message}
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
