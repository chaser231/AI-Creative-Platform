"use client";

import { useRef, useState, use, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Download, Share2, Wand2, PenTool, Copy, Check, HelpCircle, Settings, History, AlertTriangle, FolderOpen, Save } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Modal } from "@/components/ui/Modal";
import { LayersPanel } from "@/components/editor/LayersPanel";
import { PropertiesPanel } from "@/components/editor/properties";
import { Toolbar } from "@/components/editor/Toolbar";
import { ExportModal } from "@/components/editor/ExportModal";
import { ResizePanel } from "@/components/editor/ResizePanel";
import { TemplatePanel } from "@/components/editor/TemplatePanel";
import { AIPromptBar } from "@/components/editor/AIPromptBar";
import { AIChatPanel } from "@/components/editor/ai-chat";
import { VersionHistoryPanel } from "@/components/editor/VersionHistoryPanel";
import { AssetLibraryModal } from "@/components/editor/AssetLibraryModal";
import { TemplateSettingsModal } from "@/components/editor/TemplateSettingsModal";
import { WizardFlow } from "@/components/wizard/WizardFlow";
import { useProjectStore } from "@/store/projectStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useCanvasAutoSave, useLoadCanvasState } from "@/hooks/useProjectSync";
import { useAISessionSync } from "@/hooks/useAISessionSync";
import { getModelById } from "@/lib/ai-models";
import { trpc } from "@/lib/trpc";
import { loadAllCustomFonts } from "@/lib/customFonts";
import { hydrateTemplate } from "@/services/templateService";
import Konva from "konva";

// Dynamic import for Canvas (Konva needs client-only, no SSR)
const Canvas = dynamic(
    () => import("@/components/editor/canvas").then((mod) => mod.Canvas),
    { ssr: false }
);

interface EditorPageProps {
    params: Promise<{ id: string }>;
}

export default function EditorPage({ params }: EditorPageProps) {
    const { id } = use(params);
    const stageRef = useRef<Konva.Stage | null>(null);
    const searchParams = useSearchParams();
    const router = useRouter();

    // ─── Template mode detection ───
    const isTemplateMode = searchParams.get("source") === "template";

    const [exportOpen, setExportOpen] = useState(false);
    const [templatesOpen, setTemplatesOpen] = useState(false);
    const [aiPanelOpen, setAiPanelOpen] = useState(false);
    const [aiChatOpen, setAiChatOpen] = useState(false);
    const { messages: aiMessages, addMessages: addAiMessages } = useAISessionSync(id, !isTemplateMode);
    const [shareOpen, setShareOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [templateSettingsOpen, setTemplateSettingsOpen] = useState(false);
    const [linkCopied, setLinkCopied] = useState(false);
    const [versionPanelOpen, setVersionPanelOpen] = useState(false);
    const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
    const [templateSaveStatus, setTemplateSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const projects = useProjectStore((s) => s.projects);
    const updateProject = useProjectStore((s) => s.updateProject);
    const { editorMode, setEditorMode, undo, redo, history, future, artboardProps, updateArtboardProps } = useCanvasStore(useShallow((s) => ({
        editorMode: s.editorMode, setEditorMode: s.setEditorMode,
        undo: s.undo, redo: s.redo, history: s.history, future: s.future,
        artboardProps: s.artboardProps, updateArtboardProps: s.updateArtboardProps,
    })));
    useKeyboardShortcuts();

    // ─── Template mode: load & save ───
    const templateQuery = trpc.template.loadState.useQuery(
        { id },
        { enabled: isTemplateMode, retry: false, refetchOnWindowFocus: false }
    );
    const templateSaveMutation = trpc.template.saveState.useMutation({
        onSuccess: () => {
            setTemplateSaveStatus("saved");
            setTimeout(() => setTemplateSaveStatus("idle"), 2000);
        },
        onError: () => setTemplateSaveStatus("error"),
    });

    // Load template data into canvas on first load
    useEffect(() => {
        if (!isTemplateMode || !templateQuery.data?.data) return;
        const data = templateQuery.data.data as any;
        if (!data.layers && !data.masterComponents && !data.layerTree) return;

        // If data has canvas state format (layers, masterComponents, etc.), load directly
        if (data.layers && Array.isArray(data.layers)) {
            useCanvasStore.setState({
                layers: data.layers,
                masterComponents: data.masterComponents ?? [],
                componentInstances: data.componentInstances ?? [],
                resizes: data.resizes ?? useCanvasStore.getState().resizes,
                artboardProps: data.artboardProps ?? useCanvasStore.getState().artboardProps,
                canvasWidth: data.canvasWidth ?? data.baseWidth ?? useCanvasStore.getState().canvasWidth,
                canvasHeight: data.canvasHeight ?? data.baseHeight ?? useCanvasStore.getState().canvasHeight,
            });
        } else {
            // It's a TemplatePack format — hydrate it
            try {
                const hydrated = hydrateTemplate(data);
                useCanvasStore.setState({
                    layers: hydrated.layers ?? [],
                    masterComponents: hydrated.masterComponents,
                    componentInstances: hydrated.componentInstances,
                    resizes: hydrated.resizes.length > 0 ? hydrated.resizes : useCanvasStore.getState().resizes,
                    canvasWidth: hydrated.baseWidth || useCanvasStore.getState().canvasWidth,
                    canvasHeight: hydrated.baseHeight || useCanvasStore.getState().canvasHeight,
                });
            } catch (err) {
                console.error("Failed to hydrate template:", err);
            }
        }
    }, [isTemplateMode, templateQuery.data]);

    // Manual save for template mode
    const handleTemplateSave = useCallback(() => {
        if (!isTemplateMode) return;
        setTemplateSaveStatus("saving");
        const store = useCanvasStore.getState();
        const canvasState = {
            layers: store.layers,
            masterComponents: store.masterComponents,
            componentInstances: store.componentInstances,
            resizes: store.resizes,
            artboardProps: store.artboardProps,
            canvasWidth: store.canvasWidth,
            canvasHeight: store.canvasHeight,
        };
        templateSaveMutation.mutate({ id, data: canvasState });
    }, [isTemplateMode, id, templateSaveMutation]);

    // ─── Project mode: load & auto-save ───
    // IMPORTANT: Load canvas state FIRST, then enable auto-save AFTER load completes.
    // This prevents the canvas-clear-on-mount from triggering an empty save.
    const { isLoaded: canvasLoaded } = useLoadCanvasState(isTemplateMode ? "__skip__" : id);
    const { isSaving, getUnsavedState, saveNowSync } = useCanvasAutoSave(isTemplateMode ? "__skip__" : id, !isTemplateMode && canvasLoaded, stageRef);

    const [showExitWarning, setShowExitWarning] = useState(false);

    const handleBackRequest = useCallback(() => {
        if (getUnsavedState && getUnsavedState()) {
            setShowExitWarning(true);
        } else {
            router.push("/");
        }
    }, [getUnsavedState, router]);

    const handleForceExit = useCallback(() => {
        if (saveNowSync) saveNowSync();
        router.push("/");
    }, [saveNowSync, router]);

    // Set editor mode from URL query parameters
    useEffect(() => {
        const queryMode = searchParams.get("mode");
        if (queryMode === "wizard" || queryMode === "studio") {
            setEditorMode(queryMode);
        }
    }, [searchParams, setEditorMode]);

    // Load custom fonts once on app load
    useEffect(() => {
        loadAllCustomFonts();
    }, []);

    const project = projects.find((p) => p.id === id);

    // Fetch project from backend (always, to stay in sync)
    const projectQuery = trpc.project.getById.useQuery(
        { id },
        { retry: false, refetchOnWindowFocus: false }
    );
    const projectName = isTemplateMode
        ? (templateQuery.data?.name || "Шаблон")
        : (project?.name || projectQuery.data?.name || "Без названия");
    const projectStatus = (projectQuery.data?.status || project?.status || "DRAFT").toUpperCase();

    // Inline rename state
    const [isRenaming, setIsRenaming] = useState(false);
    const [editName, setEditName] = useState(projectName);
    const nameInputRef = useRef<HTMLInputElement>(null);

    // Status dropdown
    const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // Update mutation
    const updateMutation = trpc.project.update.useMutation({
        onSuccess: () => { projectQuery.refetch(); },
    });
    const deleteMutation = trpc.project.delete.useMutation({
        onSuccess: () => { window.location.href = "/"; },
    });

    useEffect(() => {
        if (isRenaming && nameInputRef.current) {
            nameInputRef.current.focus();
            nameInputRef.current.select();
        }
    }, [isRenaming]);

    // Keep editName in sync with loaded name
    useEffect(() => {
        setEditName(projectName);
    }, [projectName]);

    const handleRenameSubmit = useCallback(() => {
        const trimmed = editName.trim();
        if (trimmed && trimmed !== projectName) {
            updateMutation.mutate({ id, name: trimmed });
        }
        setIsRenaming(false);
    }, [editName, projectName, id, updateMutation]);

    const statusOptions = [
        { value: "DRAFT", label: "Черновик" },
        { value: "IN_PROGRESS", label: "В работе" },
        { value: "REVIEW", label: "На ревью" },
        { value: "PUBLISHED", label: "Опубликован" },
        { value: "ARCHIVED", label: "Архив" },
    ];

    const statusColors: Record<string, string> = {
        DRAFT: "bg-gray-500/20 text-gray-400",
        IN_PROGRESS: "bg-blue-500/20 text-blue-400",
        REVIEW: "bg-amber-500/20 text-amber-400",
        PUBLISHED: "bg-green-500/20 text-green-400",
        ARCHIVED: "bg-gray-500/20 text-gray-500",
    };

    const currentStatusLabel = statusOptions.find(o => o.value === projectStatus)?.label || projectStatus;

    return (
        <div className="flex flex-col h-screen overflow-hidden bg-bg-canvas">
            {/* Top Bar with border */}
            <div className="border-b border-border-primary bg-bg-surface">
                <TopBar
                    breadcrumbs={[
                        { label: "" }, // We'll use custom left content instead
                    ]}
                    onBackRequest={handleBackRequest}
                    customLeftContent={
                        <div className="flex items-center gap-2">
                            {/* Editable project name */}
                            {isRenaming ? (
                                <input
                                    ref={nameInputRef}
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    onBlur={handleRenameSubmit}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") handleRenameSubmit();
                                        if (e.key === "Escape") { setEditName(projectName); setIsRenaming(false); }
                                    }}
                                    className="text-sm font-semibold text-text-primary bg-bg-tertiary border border-border-focus rounded-[var(--radius-md)] px-2 py-0.5 outline-none min-w-[120px]"
                                />
                            ) : (
                                <button
                                    onClick={() => setIsRenaming(true)}
                                    className="text-sm font-semibold text-text-primary hover:text-accent-primary transition-colors cursor-pointer"
                                    title="Нажмите, чтобы переименовать"
                                >
                                    {projectName}
                                </button>
                            )}

                            {/* Status badge dropdown */}
                            <div className="relative">
                                <button
                                    onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
                                    className={`px-2 py-0.5 rounded-[var(--radius-full)] text-[10px] font-medium cursor-pointer transition-opacity hover:opacity-80 ${statusColors[projectStatus] || statusColors.DRAFT}`}
                                >
                                    {currentStatusLabel}
                                </button>
                                {statusDropdownOpen && (
                                    <div className="absolute top-full mt-1 left-0 z-50 w-40 bg-bg-surface border border-border-primary rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)] py-1">
                                        {statusOptions.map((opt) => (
                                            <button
                                                key={opt.value}
                                                onClick={() => {
                                                    updateMutation.mutate({ id, status: opt.value as "DRAFT" | "IN_PROGRESS" | "REVIEW" | "PUBLISHED" | "ARCHIVED" });
                                                    setStatusDropdownOpen(false);
                                                }}
                                                className={`w-full px-3 py-1.5 text-xs text-left cursor-pointer transition-colors ${
                                                    projectStatus === opt.value
                                                        ? "text-accent-primary bg-bg-tertiary font-medium"
                                                        : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
                                                }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                        <div className="my-1 border-t border-border-primary" />
                                        <button
                                            onClick={() => {
                                                setStatusDropdownOpen(false);
                                                setShowDeleteConfirm(true);
                                            }}
                                            className="w-full px-3 py-1.5 text-xs text-left text-red-400 hover:text-red-300 hover:bg-red-500/10 cursor-pointer transition-colors"
                                        >
                                            Удалить проект
                                        </button>
                                    </div>
                                )}
                            </div>

                            {isTemplateMode ? (
                                <>
                                    {templateSaveStatus === "saving" && <span className="text-[10px] text-text-tertiary">💾 Сохранение...</span>}
                                    {templateSaveStatus === "saved" && <span className="text-[10px] text-green-500">✓ Сохранено</span>}
                                    {templateSaveStatus === "error" && <span className="text-[10px] text-red-400">✗ Ошибка</span>}
                                    {!templateQuery.data?.canEdit && <span className="text-[10px] text-amber-400">🔒 Только просмотр</span>}
                                </>
                            ) : (
                                isSaving && <span className="text-[10px] text-text-tertiary">💾 Сохранение...</span>
                            )}
                        </div>
                    }
                    onUndo={undo}
                    onRedo={redo}
                    canUndo={history.length > 0}
                    canRedo={future.length > 0}
                    centerContent={
                        <div className="flex items-center bg-bg-tertiary rounded-[var(--radius-full)] p-1">
                            <button
                                onClick={() => setEditorMode("wizard")}
                                title="Wizard Mode"
                                className={`
                                    flex items-center gap-1.5 px-4 py-1.5 rounded-[var(--radius-full)] text-xs font-medium
                                    transition-all cursor-pointer
                                    ${editorMode === "wizard"
                                        ? "bg-bg-surface text-text-primary shadow-[var(--shadow-sm)]"
                                        : "text-text-secondary hover:text-text-primary"
                                    }
                                `}
                            >
                                <Wand2 size={13} />
                                Мастер
                            </button>
                            <button
                                onClick={() => setEditorMode("studio")}
                                title="Studio Mode"
                                className={`
                                    flex items-center gap-1.5 px-4 py-1.5 rounded-[var(--radius-full)] text-xs font-medium
                                    transition-all cursor-pointer
                                    ${editorMode === "studio"
                                        ? "bg-bg-surface text-text-primary shadow-[var(--shadow-sm)]"
                                        : "text-text-secondary hover:text-text-primary"
                                    }
                                `}
                            >
                                <PenTool size={13} />
                                Студия
                            </button>
                        </div>
                    }
                    actions={
                        <div className="flex items-center gap-2">
                            {isTemplateMode && templateQuery.data?.canEdit && (
                                <Button
                                    variant="primary"
                                    size="sm"
                                    icon={<Save size={14} />}
                                    onClick={handleTemplateSave}
                                    disabled={templateSaveMutation.isPending}
                                >
                                    {templateSaveMutation.isPending ? "Сохранение..." : "Сохранить"}
                                </Button>
                            )}
                            {isTemplateMode && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon={<Settings size={14} />}
                                    onClick={() => setTemplateSettingsOpen(true)}
                                >
                                    Настройки
                                </Button>
                            )}
                            {!isTemplateMode && (
                                <>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        icon={<FolderOpen size={14} />}
                                        onClick={() => setAssetLibraryOpen(true)}
                                    >
                                        Ассеты
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        icon={<History size={14} />}
                                        onClick={() => setVersionPanelOpen(true)}
                                    >
                                        Версии
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        icon={<Share2 size={14} />}
                                        onClick={() => setShareOpen(true)}
                                    >
                                        Поделиться
                                    </Button>
                                </>
                            )}
                            <Button
                                size="sm"
                                icon={<Download size={14} />}
                                onClick={() => setExportOpen(true)}
                            >
                                Экспорт
                            </Button>
                        </div>
                    }
                />
            </div>

            {/* Content — Wizard or Studio */}
            {editorMode === "wizard" ? (
                <WizardFlow
                    projectId={id}
                    onSwitchToStudio={() => setEditorMode("studio")}
                    initialTemplateId={searchParams.get("templateId") || null}
                />
            ) : (
                <div className="relative flex-1 min-h-0">
                    {/* Canvas fills the entire area */}
                    <Canvas stageRef={stageRef} />

                    {/* Floating Layers Panel — left */}
                    <div className="absolute top-3 left-3 bottom-3 z-10">
                        <LayersPanel />
                    </div>

                    {/* Floating Properties Panel — top center (Always visible now) */}
                    <PropertiesPanel />

                    {/* Floating Toolbar — moves up when AI is open */}
                    <div className={`absolute left-1/2 -translate-x-1/2 transition-all duration-300 z-10 ${aiPanelOpen ? "bottom-52" : "bottom-3"}`}>
                        <Toolbar
                            onOpenTemplates={() => setTemplatesOpen(true)}
                            onToggleAI={() => setAiPanelOpen(!aiPanelOpen)}
                            aiActive={aiPanelOpen}
                        />
                    </div>

                    {/* AI Prompt Bar — Bottom Center */}
                    {aiPanelOpen && (
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20">
                            <AIPromptBar
                                open={true}
                                onClose={() => setAiPanelOpen(false)}
                                onToggleChat={() => setAiChatOpen(!aiChatOpen)}
                                isChatOpen={aiChatOpen}
                                projectId={id}
                                onResult={(res) => addAiMessages([{
                                    id: Date.now().toString(),
                                    role: "user",
                                    content: res.prompt,
                                    type: "text",
                                    timestamp: Date.now()
                                }, {
                                    id: (Date.now() + 1).toString(),
                                    role: "assistant",
                                    content: res.content,
                                    type: res.type as "text" | "image" | "outpaint",
                                    timestamp: Date.now(),
                                    model: res.model,
                                    costUnits: res.model ? (getModelById(res.model)?.costPerRun ?? 0) : undefined,
                                }])}
                            />
                        </div>
                    )}

                    {/* AI Chat Panel — Right Sidebar */}
                    <AIChatPanel
                        open={aiChatOpen && aiPanelOpen}
                        onClose={() => setAiChatOpen(false)}
                        messages={aiMessages}
                        onAddMessages={addAiMessages}
                        projectId={id}
                    />

                    {/* Floating Resize Panel — right */}
                    <div className="absolute top-3 right-3 bottom-3 z-10 flex gap-3 pointer-events-none">
                        <div className="pointer-events-auto">
                            <ResizePanel />
                        </div>
                    </div>

                    {/* Floating Help/Settings — bottom right (Shifted to left of Format panel) */}
                    <div className="absolute bottom-3 right-[256px] z-10 flex items-center gap-1">
                        <button
                            onClick={() => setHelpOpen(true)}
                            title="Горячие клавиши"
                            className="flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-full)] border border-border-primary bg-bg-surface/90 backdrop-blur-xl text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-surface shadow-[var(--shadow-sm)] transition-all cursor-pointer"
                        >
                            <HelpCircle size={13} />
                            Помощь
                        </button>
                        <button
                            onClick={() => setSettingsOpen(true)}
                            title="Настройки проекта"
                            className="p-2 rounded-[var(--radius-full)] border border-border-primary bg-bg-surface/90 backdrop-blur-xl text-text-secondary hover:text-text-primary hover:bg-bg-surface shadow-[var(--shadow-sm)] transition-all cursor-pointer"
                        >
                            <Settings size={14} />
                        </button>
                    </div>
                </div>
            )}

            {/* Modals */}
            <ExportModal
                open={exportOpen}
                onClose={() => setExportOpen(false)}
                stageRef={stageRef}
            />
            <TemplatePanel
                open={templatesOpen}
                onClose={() => setTemplatesOpen(false)}
            />

            {/* Share Dialog */}
            <Dialog open={shareOpen} onClose={() => { setShareOpen(false); setLinkCopied(false); }} title="Поделиться проектом">
                <div className="space-y-4">
                    <p className="text-[13px] text-text-secondary leading-relaxed">
                        Скопируйте ссылку на проект, чтобы поделиться с коллегами.
                    </p>
                    <div className="flex items-center gap-2">
                        <div className="flex-1 h-9 px-3 flex items-center rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[12px] text-text-primary truncate">
                            {typeof window !== "undefined" ? window.location.href : ""}
                        </div>
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(window.location.href);
                                setLinkCopied(true);
                                setTimeout(() => setLinkCopied(false), 2000);
                            }}
                            className="flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-accent-primary text-text-inverse text-[12px] font-medium hover:bg-accent-primary-hover transition-colors cursor-pointer"
                        >
                            {linkCopied ? <Check size={14} /> : <Copy size={14} />}
                            {linkCopied ? "Скопировано" : "Копировать"}
                        </button>
                    </div>
                </div>
            </Dialog>

            {/* Help Dialog */}
            <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} title="Горячие клавиши" width="max-w-lg">
                <div className="space-y-1">
                    {[
                        ["⌘ Z", "Отменить"],
                        ["⌘ ⇧ Z", "Повторить"],
                        ["⌘ D", "Дублировать"],
                        ["Delete / Backspace", "Удалить элемент"],
                        ["Escape", "Снять выделение"],
                        ["← → ↑ ↓", "Двигать на 1px"],
                        ["⇧ + стрелки", "Двигать на 10px"],
                    ].map(([key, desc]) => (
                        <div key={key} className="flex items-center justify-between py-2 px-1 border-b border-border-primary last:border-b-0">
                            <span className="text-[12px] text-text-secondary">{desc}</span>
                            <kbd className="text-[11px] px-2 py-0.5 rounded-[var(--radius-sm)] bg-bg-tertiary text-text-primary border border-border-primary font-mono">{key}</kbd>
                        </div>
                    ))}
                </div>
            </Dialog>

            {/* Settings Dialog — Project Settings */}
            <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Настройки проекта" width="max-w-md">
                <div className="space-y-5">
                    {/* Project Name */}
                    <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-text-secondary">Название проекта</label>
                        <input
                            type="text"
                            value={project?.name || ""}
                            onChange={(e) => updateProject(id, { name: e.target.value })}
                            className="w-full h-9 px-3 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[13px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary/50"
                        />
                    </div>

                    {/* Business Unit (readonly) */}
                    {project?.businessUnit && (
                        <div className="space-y-1.5">
                            <label className="text-[12px] font-medium text-text-secondary">Бизнес-юнит</label>
                            <div className="h-9 px-3 flex items-center rounded-[var(--radius-md)] border border-border-primary bg-bg-tertiary text-[13px] text-text-tertiary">
                                {project.businessUnit}
                            </div>
                        </div>
                    )}

                    {/* Status */}
                    <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-text-secondary">Статус</label>
                        <select
                            value={project?.status || "draft"}
                            onChange={(e) => updateProject(id, { status: e.target.value as "draft" | "in-progress" | "review" | "published" })}
                            className="w-full h-9 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[13px] text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent-primary/50"
                        >
                            <option value="draft">Черновик</option>
                            <option value="in-progress">В работе</option>
                            <option value="review">На проверке</option>
                            <option value="published">Опубликован</option>
                        </select>
                    </div>

                    {/* Artboard Background Color */}
                    <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-text-secondary">Цвет фона холста</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={artboardProps.fill}
                                onChange={(e) => updateArtboardProps({ fill: e.target.value })}
                                className="w-9 h-9 rounded-[var(--radius-md)] border border-border-primary cursor-pointer p-0.5"
                            />
                            <input
                                type="text"
                                value={artboardProps.fill}
                                onChange={(e) => updateArtboardProps({ fill: e.target.value })}
                                className="flex-1 h-9 px-3 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[13px] text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent-primary/50"
                            />
                        </div>
                    </div>

                    {/* Goal (readonly) */}
                    {project?.goal && (
                        <div className="space-y-1.5">
                            <label className="text-[12px] font-medium text-text-secondary">Цель проекта</label>
                            <div className="h-9 px-3 flex items-center rounded-[var(--radius-md)] border border-border-primary bg-bg-tertiary text-[13px] text-text-tertiary">
                                {project.goal}
                            </div>
                        </div>
                    )}
                </div>
            </Dialog>

            {/* Version History Panel */}
            <VersionHistoryPanel
                projectId={id}
                isOpen={versionPanelOpen}
                onClose={() => setVersionPanelOpen(false)}
                onVersionRestored={() => {
                    // Reload canvas state from DB after restore
                    window.location.reload();
                }}
            />

            {/* Asset Library Modal */}
            <AssetLibraryModal
                projectId={id}
                open={assetLibraryOpen}
                onClose={() => setAssetLibraryOpen(false)}
            />

            {/* Template Settings Modal */}
            {isTemplateMode && (
                <TemplateSettingsModal
                    templateId={id}
                    open={templateSettingsOpen}
                    onClose={() => setTemplateSettingsOpen(false)}
                    onSaved={() => templateQuery.refetch()}
                />
            )}

            {/* Delete confirmation dialog */}
            {showDeleteConfirm && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
                    onClick={() => setShowDeleteConfirm(false)}
                >
                    <div
                        className="bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] p-6 max-w-sm w-full mx-4 shadow-[var(--shadow-lg)]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-[var(--radius-lg)] bg-red-500/10">
                                <AlertTriangle size={20} className="text-red-400" />
                            </div>
                            <div>
                                <h3 className="text-sm font-semibold text-text-primary">Удалить проект?</h3>
                                <p className="text-xs text-text-tertiary mt-0.5">
                                    «{projectName}» будет удалён безвозвратно
                                </p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                className="px-4 py-2 text-xs font-medium text-text-secondary hover:text-text-primary bg-bg-tertiary rounded-[var(--radius-md)] transition-colors cursor-pointer"
                            >
                                Отмена
                            </button>
                            <button
                                onClick={() => {
                                    deleteMutation.mutate({ id });
                                    setShowDeleteConfirm(false);
                                }}
                                className="px-4 py-2 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-[var(--radius-md)] transition-colors cursor-pointer"
                            >
                                Удалить
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Unsaved Changes Warning Modal */}
            <Modal
                open={showExitWarning}
                onClose={() => setShowExitWarning(false)}
                title="Несохраненные изменения"
                maxWidth="max-w-sm"
            >
                <div className="flex flex-col gap-4 pt-2">
                    <div className="flex items-start gap-3 text-amber-500 bg-amber-500/10 p-3 rounded-lg border border-amber-500/20">
                        <AlertTriangle size={20} className="shrink-0 mt-0.5" />
                        <p className="text-sm">
                            Ваши последние изменения сейчас сохраняются или загружаются файлы. 
                            Если вы выйдете сейчас, некоторые данные могут быть потеряны.
                        </p>
                    </div>
                    <div className="flex justify-end gap-2 mt-2">
                        <Button variant="ghost" onClick={() => setShowExitWarning(false)}>
                            Остаться
                        </Button>
                        <Button 
                            variant="primary" 
                            className="bg-red-500 hover:bg-red-600 text-white border-none"
                            onClick={handleForceExit}
                        >
                            Всё равно выйти
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
