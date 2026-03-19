"use client";

import { useRef, useState, use, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Download, Share2, Wand2, PenTool, Copy, Check, HelpCircle, Settings } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { LayersPanel } from "@/components/editor/LayersPanel";
import { PropertiesPanel } from "@/components/editor/PropertiesPanel";
import { Toolbar } from "@/components/editor/Toolbar";
import { ExportModal } from "@/components/editor/ExportModal";
import { ResizePanel } from "@/components/editor/ResizePanel";
import { TemplatePanel } from "@/components/editor/TemplatePanel";
import { AIPromptBar } from "@/components/editor/AIPromptBar";
import { AIChatPanel, AIChatMessage } from "@/components/editor/AIChatPanel";
import { WizardFlow } from "@/components/wizard/WizardFlow";
import { useProjectStore } from "@/store/projectStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { loadAllCustomFonts } from "@/lib/customFonts";
import Konva from "konva";

// Dynamic import for Canvas (Konva needs client-only, no SSR)
const Canvas = dynamic(
    () => import("@/components/editor/Canvas").then((mod) => mod.Canvas),
    { ssr: false }
);

interface EditorPageProps {
    params: Promise<{ id: string }>;
}

export default function EditorPage({ params }: EditorPageProps) {
    const { id } = use(params);
    const stageRef = useRef<Konva.Stage | null>(null);
    const [exportOpen, setExportOpen] = useState(false);
    const [templatesOpen, setTemplatesOpen] = useState(false);
    const [aiPanelOpen, setAiPanelOpen] = useState(false);
    const [aiChatOpen, setAiChatOpen] = useState(false);
    const [aiMessages, setAiMessages] = useState<AIChatMessage[]>([]);
    const [shareOpen, setShareOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [linkCopied, setLinkCopied] = useState(false);
    const projects = useProjectStore((s) => s.projects);
    const updateProject = useProjectStore((s) => s.updateProject);
    const { editorMode, setEditorMode, undo, redo, history, future, artboardProps, updateArtboardProps } = useCanvasStore();
    useKeyboardShortcuts();
    const searchParams = useSearchParams();

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

    return (
        <div className="flex flex-col h-screen overflow-hidden bg-bg-canvas">
            {/* Top Bar with border */}
            <div className="border-b border-border-primary bg-bg-surface">
                <TopBar
                    breadcrumbs={[
                        { label: project?.name || "Без названия" },
                    ]}
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
                            <Button
                                variant="secondary"
                                size="sm"
                                icon={<Share2 size={14} />}
                                onClick={() => setShareOpen(true)}
                            >
                                Поделиться
                            </Button>
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
                    <div className={`absolute left-1/2 -translate-x-1/2 transition-all duration-300 z-10 ${aiPanelOpen ? "bottom-56" : "bottom-3"}`}>
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
                                onResult={(res) => setAiMessages(prev => [...prev, {
                                    id: Date.now().toString(),
                                    role: "user",
                                    content: res.prompt,
                                    type: "text",
                                    timestamp: Date.now()
                                }, {
                                    id: (Date.now() + 1).toString(),
                                    role: "assistant",
                                    content: res.content,
                                    type: res.type as any,
                                    timestamp: Date.now()
                                }])}
                            />
                        </div>
                    )}

                    {/* AI Chat Panel — Right Sidebar */}
                    <AIChatPanel
                        open={aiChatOpen && aiPanelOpen}
                        onClose={() => setAiChatOpen(false)}
                        messages={aiMessages}
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
        </div>
    );
}
