"use client";

/**
 * AI Chat Panel — Conversational Agent Interface
 *
 * Full chat interface with:
 * - Message input for natural language requests
 * - Agent orchestration (interprets → plans → executes)
 * - Plan steps with progress indicators
 * - Text/image results with "add to canvas" actions
 */

import { useState, useRef, useEffect } from "react";
import { useCanvasStore } from "@/store/canvasStore";
import { getModelsForCaps } from "@/lib/ai-models";
import { Button } from "@/components/ui/Button";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import type { Layer, MasterComponent } from "@/types";
import type { TemplatePackV2 } from "@/services/templateService";
import {
    Copy, Plus, X, Send, Loader2, Bot, User, Sparkles,
    CheckCircle, AlertCircle, ChevronRight, Zap, LayoutTemplate, Search,
    Image as ImageIcon, Type, Settings2, ChevronDown, Repeat
} from "lucide-react";
import type { AIChatMessage } from "./types";
import { MessageBubble } from "./MessageBubble";

export type { AIChatMessage };

interface AIChatPanelProps {
    open: boolean;
    onClose: () => void;
    messages: AIChatMessage[];
    /** Callback to add new messages */
    onAddMessages?: (msgs: AIChatMessage[]) => void;
    /** Current project ID */
    projectId?: string;
}

export function AIChatPanel({ open, onClose, messages, onAddMessages, projectId }: AIChatPanelProps) {
    const { addTextLayer, addImageLayer, layers, updateLayer } = useCanvasStore();
    const { currentWorkspace } = useWorkspace();
    const [input, setInput] = useState("");
    const [isThinking, setIsThinking] = useState(false);
    const [selectedTextModel, setSelectedTextModel] = useState("auto");
    const [selectedImageModel, setSelectedImageModel] = useState("auto");
    const [showModelSettings, setShowModelSettings] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Get available models from registry
    const textModels = getModelsForCaps("text");
    const imageModels = getModelsForCaps("generate");

    const agentMutation = trpc.workflow.interpretAndExecute.useMutation();

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isThinking]);

    // Focus input on open
    useEffect(() => {
        if (open && inputRef.current) {
            setTimeout(() => inputRef.current?.focus(), 200);
        }
    }, [open]);

    const handleAddToCanvas = (msg: AIChatMessage) => {
        if (msg.type === "text") {
            addTextLayer({
                text: msg.content,
                fontSize: 40,
                x: 100,
                y: 100,
                width: 600,
            });
        } else if (msg.type === "image") {
            addImageLayer(msg.content, 500, 500);
        }
    };

    const handleSend = async () => {
        const trimmed = input.trim();
        if (!trimmed || isThinking || !currentWorkspace) return;

        setInput("");
        setIsThinking(true);

        // Add user message
        const userMsg: AIChatMessage = {
            id: `user-${Date.now()}`,
            role: "user",
            type: "text",
            content: trimmed,
            timestamp: Date.now(),
        };

        onAddMessages?.([userMsg]);

        try {
            // Build conversation history for context
            const history = messages
                .filter((m) => m.type !== "plan")
                .slice(-10)
                .map((m) => ({
                    role: m.role as "user" | "assistant",
                    content: m.content,
                }));

            const result = await agentMutation.mutateAsync({
                message: trimmed,
                workspaceId: currentWorkspace.id,
                projectId,
                history,
                selectedTextModel: selectedTextModel !== "auto" ? selectedTextModel : undefined,
                selectedImageModel: selectedImageModel !== "auto" ? selectedImageModel : undefined,
            });

            const newMessages: AIChatMessage[] = [];

            // Execute canvas actions (place content on canvas)
            if (result.canvasActions && result.canvasActions.length > 0) {
                for (const ca of result.canvasActions) {
                    if (ca.action === "add_text") {
                        addTextLayer(ca.params as any);
                    } else if (ca.action === "add_image") {
                        const p = ca.params as { src: string; width: number; height: number };
                        addImageLayer(p.src, p.width, p.height);
                    } else if (ca.action === "load_template") {
                        // Load template onto canvas
                        const { applyTemplatePack } = await import("@/services/templateService");
                        await applyTemplatePack((ca.params as { templateData: TemplatePackV2 }).templateData);
                    } else if (ca.action === "update_layer") {
                        // Find layer by slotId and update
                        const { slotId, updates } = ca.params as { slotId: string; updates: Record<string, unknown> };
                        const currentLayers = useCanvasStore.getState().layers;
                        const targetLayer = currentLayers.find((l: Layer) => l.slotId === slotId);
                        if (targetLayer) {
                            updateLayer(targetLayer.id, updates as any);
                        }
                        // Also check masterComponents
                        const masters = useCanvasStore.getState().masterComponents;
                        const targetMaster = masters?.find((mc: MasterComponent) => mc.slotId === slotId);
                        if (targetMaster && !targetLayer) {
                            // Update via master if no direct layer found
                            const masterLayer = currentLayers.find((l: Layer) => l.masterId === targetMaster.id);
                            if (masterLayer) {
                                updateLayer(masterLayer.id, updates as any);
                            }
                        }
                    }
                }
            }

            // Add plan message if there are steps
            if (result.plan.steps.length > 0) {
                newMessages.push({
                    id: `plan-${Date.now()}`,
                    role: "assistant",
                    type: "plan",
                    content: result.textResponse,
                    timestamp: Date.now(),
                    steps: result.plan.steps.map((s) => ({
                        actionId: s.actionId,
                        actionName: s.actionName,
                        status: s.status,
                        result: s.result
                            ? { type: s.result.type, content: s.result.content }
                            : undefined,
                    })),
                });

                // Add individual results as separate messages (skip canvas_action, data, template_choices types)
                for (const step of result.plan.steps) {
                    if (step.result?.success && step.result.type !== "error" && step.result.type !== "data") {
                        // Template choices get their own special message
                        if (step.result.type === "template_choices" && step.result.templateChoices) {
                            newMessages.push({
                                id: `templates-${Date.now()}`,
                                role: "assistant",
                                type: "template_choices",
                                content: step.result.content,
                                timestamp: Date.now(),
                                templateChoices: step.result.templateChoices,
                                templateTopic: trimmed, // save original request as topic
                            });
                        } else if (step.result.type === "fallback_actions" && step.result.fallbackActions) {
                            newMessages.push({
                                id: `fallback-${Date.now()}`,
                                role: "assistant",
                                type: "fallback_actions",
                                content: step.result.content,
                                timestamp: Date.now(),
                                fallbackActions: step.result.fallbackActions,
                                templateTopic: trimmed,
                            });
                        } else if (step.result.type === "canvas_action") {
                            // Check if Market template with text variants
                            const variants = (step.result.metadata as any)?.textVariants;
                            if (variants && Array.isArray(variants) && variants.length > 1) {
                                newMessages.push({
                                    id: `variants-${Date.now()}`,
                                    role: "assistant",
                                    type: "text_variants",
                                    content: step.result.content,
                                    timestamp: Date.now(),
                                    textVariants: variants,
                                    activeVariantIndex: 0,
                                });
                            } else {
                                newMessages.push({
                                    id: `result-${step.actionId}-${Date.now()}-${Math.random()}`,
                                    role: "assistant",
                                    type: "text",
                                    content: step.result.content,
                                    timestamp: Date.now(),
                                });
                            }
                        } else {
                            newMessages.push({
                                id: `result-${step.actionId}-${Date.now()}-${Math.random()}`,
                                role: "assistant",
                                type: step.result.type as "text" | "image",
                                content: step.result.content,
                                timestamp: Date.now(),
                            });
                        }
                    }
                }
            }

            // Add text response if no steps or as summary
            if (result.plan.steps.length === 0 && result.textResponse) {
                newMessages.push({
                    id: `response-${Date.now()}`,
                    role: "assistant",
                    type: "text",
                    content: result.textResponse,
                    timestamp: Date.now(),
                });
            }

            onAddMessages?.(newMessages);
        } catch (e) {
            onAddMessages?.([{
                id: `error-${Date.now()}`,
                role: "assistant",
                type: "error",
                content: e instanceof Error ? e.message : "Ошибка агента",
                timestamp: Date.now(),
            }]);
        } finally {
            setIsThinking(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    // Handle fallback action buttons (when no templates found)
    const handleFallbackAction = (actionId: string, topic: string) => {
        if (isThinking || !currentWorkspace) return;

        if (actionId === "create_from_scratch") {
            // Send a request to create banner without templates
            setInput(`Создай баннер с нуля для: ${topic}`);
            setTimeout(() => handleSend(), 50);
        } else if (actionId === "refine_query") {
            // Focus input for user to type a refined query
            setInput("");
            inputRef.current?.focus();
        }
    };

    // Handle variant selection (Market text variants)
    const handleVariantSelect = (msgId: string, variantIndex: number, variant: { title: string; subtitle: string }) => {
        // Update canvas layers
        const currentLayers = useCanvasStore.getState().layers;
        const masters = useCanvasStore.getState().masterComponents;

        // Find and update headline
        const headlineLayer = currentLayers.find((l: Layer) => l.slotId === "headline");
        if (headlineLayer) {
            updateLayer(headlineLayer.id, { text: variant.title } as any);
        } else {
            const headlineMaster = masters?.find((mc: MasterComponent) => mc.slotId === "headline");
            if (headlineMaster) {
                const ml = currentLayers.find((l: Layer) => l.masterId === headlineMaster.id);
                if (ml) updateLayer(ml.id, { text: variant.title } as any);
            }
        }

        // Find and update subhead
        const subheadLayer = currentLayers.find((l: Layer) => l.slotId === "subhead");
        if (subheadLayer) {
            updateLayer(subheadLayer.id, { text: variant.subtitle } as any);
        } else {
            const subheadMaster = masters?.find((mc: MasterComponent) => mc.slotId === "subhead");
            if (subheadMaster) {
                const ml = currentLayers.find((l: Layer) => l.masterId === subheadMaster.id);
                if (ml) updateLayer(ml.id, { text: variant.subtitle } as any);
            }
        }

        // Update active variant in the message
        const updated = messages.map(m =>
            m.id === msgId ? { ...m, activeVariantIndex: variantIndex } : m
        );
        onAddMessages?.(updated.filter(m => !messages.some(old => old.id === m.id)));
        // Use a simple approach: mutate message in place (since messages is passed by reference)
        const targetMsg = messages.find(m => m.id === msgId);
        if (targetMsg) targetMsg.activeVariantIndex = variantIndex;
    };

    // ─── Direct template apply mutation (bypasses LLM) ────────
    const applyTemplateMutation = trpc.workflow.applyTemplate.useMutation();

    // Handle template selection — bypasses LLM, directly applies
    const handleTemplateSelect = (templateId: string, templateName: string, topic: string) => {
        if (isThinking || !currentWorkspace) return;

        setIsThinking(true);

        // Show user message
        onAddMessages?.([{
            id: `user-${Date.now()}`,
            role: "user",
            type: "text",
            content: `Применить шаблон «${templateName}»`,
            timestamp: Date.now(),
        }]);

        // Direct call — no LLM needed
        applyTemplateMutation.mutateAsync({
            templateId,
            topic,
            workspaceId: currentWorkspace.id,
            selectedImageModel: selectedImageModel !== "auto" ? selectedImageModel : undefined,
        }).then(async (result) => {
            // Execute canvas actions
            if (result.canvasActions && result.canvasActions.length > 0) {
                for (const ca of result.canvasActions) {
                    if (ca.action === "load_template") {
                        const { applyTemplatePack } = await import("@/services/templateService");
                        await applyTemplatePack((ca.params as { templateData: TemplatePackV2 }).templateData);
                    } else if (ca.action === "update_layer") {
                        const { slotId, updates } = ca.params as { slotId: string; updates: Record<string, unknown> };
                        // Wait for template to finish loading
                        await new Promise(r => setTimeout(r, 200));
                        const currentLayers = useCanvasStore.getState().layers;
                        const targetLayer = currentLayers.find((l: Layer) => l.slotId === slotId);
                        if (targetLayer) {
                            updateLayer(targetLayer.id, updates as any);
                        }
                        // Check masterComponents
                        const masters = useCanvasStore.getState().masterComponents;
                        const targetMaster = masters?.find((mc: MasterComponent) => mc.slotId === slotId);
                        if (targetMaster && !targetLayer) {
                            const masterLayer = currentLayers.find((l: Layer) => l.masterId === targetMaster.id);
                            if (masterLayer) {
                                updateLayer(masterLayer.id, updates as any);
                            }
                        }
                    } else if (ca.action === "add_text") {
                        addTextLayer(ca.params as any);
                    } else if (ca.action === "add_image") {
                        const p = ca.params as { src: string; width: number; height: number };
                        addImageLayer(p.src, p.width, p.height);
                    }
                }
            }

            // Show result
            const newMessages: AIChatMessage[] = [];
            if (result.plan.steps.length > 0) {
                newMessages.push({
                    id: `plan-${Date.now()}`,
                    role: "assistant",
                    type: "plan",
                    content: result.textResponse,
                    timestamp: Date.now(),
                    steps: result.plan.steps.map((s) => ({
                        actionId: s.actionId,
                        actionName: s.actionName,
                        status: s.status,
                        result: s.result
                            ? { type: s.result.type, content: s.result.content }
                            : undefined,
                    })),
                });
            }

            // Check for text variants (Market templates)
            const variants = (result.metadata as any)?.textVariants;
            if (variants && Array.isArray(variants) && variants.length > 1) {
                newMessages.push({
                    id: `variants-${Date.now()}`,
                    role: "assistant",
                    type: "text_variants",
                    content: result.textResponse,
                    timestamp: Date.now(),
                    textVariants: variants,
                    activeVariantIndex: 0,
                });
            } else if (!result.plan.steps.length && result.textResponse) {
                newMessages.push({
                    id: `response-${Date.now()}`,
                    role: "assistant",
                    type: "text",
                    content: result.textResponse,
                    timestamp: Date.now(),
                });
            }

            onAddMessages?.(newMessages);
        }).catch((e) => {
            onAddMessages?.([{
                id: `error-${Date.now()}`,
                role: "assistant",
                type: "error",
                content: e instanceof Error ? e.message : "Ошибка применения шаблона",
                timestamp: Date.now(),
            }]);
        }).finally(() => {
            setIsThinking(false);
        });
    };

    if (!open) return null;

    return (
        <div className="absolute top-3 bottom-3 right-3 w-[360px] bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] shadow-xl z-40 flex flex-col overflow-hidden animate-in slide-in-from-right-4 duration-300">
            {/* Header */}
            <div className="p-4 border-b border-border-primary flex justify-between items-center bg-bg-secondary/50">
                <div className="flex items-center gap-2">
                    <div className="p-1 rounded-lg bg-gradient-to-br from-violet-500/20 to-blue-500/20">
                        <Sparkles size={16} className="text-violet-400" />
                    </div>
                    <h3 className="text-sm font-semibold text-text-primary">AI Ассистент</h3>
                </div>
                <button onClick={onClose} className="text-text-tertiary hover:text-text-primary p-1 rounded-md hover:bg-bg-tertiary cursor-pointer">
                    <X size={16} />
                </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 && !isThinking ? (
                    <div className="flex flex-col items-center justify-center h-full text-center text-text-tertiary pb-10">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/10 to-blue-500/10 flex items-center justify-center mb-4">
                            <Bot size={24} className="text-violet-400" />
                        </div>
                        <p className="text-sm font-medium text-text-secondary mb-1">AI Ассистент</p>
                        <p className="text-xs max-w-[200px]">
                            Попросите меня создать баннер, сгенерировать текст, или помочь с креативом
                        </p>
                        <div className="mt-4 space-y-1.5 w-full max-w-[220px]">
                            {[
                                "Создай баннер для акции -30%",
                                "Напиши заголовок для промо",
                                "Сгенерируй фото еды",
                            ].map((hint) => (
                                <button
                                    key={hint}
                                    onClick={() => { setInput(hint); inputRef.current?.focus(); }}
                                    className="w-full text-left text-[11px] text-text-tertiary hover:text-text-primary px-3 py-2 rounded-lg bg-bg-tertiary/50 hover:bg-bg-tertiary transition-colors cursor-pointer"
                                >
                                    <ChevronRight size={10} className="inline mr-1.5 opacity-50" />
                                    {hint}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    messages.map((msg) => (
                        <MessageBubble
                            key={msg.id}
                            msg={msg}
                            onAddToCanvas={() => handleAddToCanvas(msg)}
                            onTemplateSelect={handleTemplateSelect}
                            onFallbackAction={handleFallbackAction}
                            onVariantSelect={handleVariantSelect}
                            isThinking={isThinking}
                        />
                    ))
                )}

                {/* Thinking indicator */}
                {isThinking && (
                    <div className="flex items-start gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex items-center justify-center shrink-0">
                            <Bot size={14} className="text-violet-400" />
                        </div>
                        <div className="bg-bg-tertiary rounded-2xl rounded-tl-sm px-4 py-3">
                            <div className="flex items-center gap-2">
                                <Loader2 size={14} className="animate-spin text-violet-400" />
                                <span className="text-xs text-text-tertiary">Думаю...</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Model Settings + Input */}
            <div className="border-t border-border-primary bg-bg-secondary/30">
                {/* Model selector bar */}
                <div className="px-3 pt-2">
                    <button
                        onClick={() => setShowModelSettings(!showModelSettings)}
                        className="flex items-center gap-1.5 text-[10px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
                    >
                        <Settings2 size={11} />
                        <span>Модели:</span>
                        <span className="text-text-secondary">
                            {selectedTextModel === "auto" ? "Авто" : textModels.find(m => m.id === selectedTextModel)?.label || selectedTextModel}
                            {" / "}
                            {selectedImageModel === "auto" ? "Авто" : imageModels.find(m => m.id === selectedImageModel)?.label || selectedImageModel}
                        </span>
                        <ChevronDown size={10} className={`transition-transform ${showModelSettings ? "rotate-180" : ""}`} />
                    </button>

                    {showModelSettings && (
                        <div className="mt-1.5 mb-1 p-2 bg-bg-tertiary/50 rounded-lg border border-border-primary space-y-2">
                            {/* Text model */}
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1 min-w-[56px]">
                                    <Type size={11} className="text-blue-400" />
                                    <span className="text-[10px] text-text-tertiary">Текст</span>
                                </div>
                                <div className="flex-1 flex flex-wrap gap-1">
                                    <button
                                        onClick={() => setSelectedTextModel("auto")}
                                        className={`px-2 py-0.5 text-[10px] rounded-md border transition-all cursor-pointer ${
                                            selectedTextModel === "auto"
                                                ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
                                                : "border-border-primary text-text-tertiary hover:text-text-secondary hover:border-border-secondary"
                                        }`}
                                    >
                                        Авто
                                    </button>
                                    {textModels.map(m => (
                                        <button
                                            key={m.id}
                                            onClick={() => setSelectedTextModel(m.id)}
                                            className={`px-2 py-0.5 text-[10px] rounded-md border transition-all cursor-pointer ${
                                                selectedTextModel === m.id
                                                    ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
                                                    : "border-border-primary text-text-tertiary hover:text-text-secondary hover:border-border-secondary"
                                            }`}
                                        >
                                            {m.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Image model */}
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1 min-w-[56px]">
                                    <ImageIcon size={11} className="text-violet-400" />
                                    <span className="text-[10px] text-text-tertiary">Фото</span>
                                </div>
                                <div className="flex-1 flex flex-wrap gap-1">
                                    <button
                                        onClick={() => setSelectedImageModel("auto")}
                                        className={`px-2 py-0.5 text-[10px] rounded-md border transition-all cursor-pointer ${
                                            selectedImageModel === "auto"
                                                ? "bg-violet-500/20 border-violet-500/40 text-violet-300"
                                                : "border-border-primary text-text-tertiary hover:text-text-secondary hover:border-border-secondary"
                                        }`}
                                    >
                                        Авто
                                    </button>
                                    {imageModels.map(m => (
                                        <button
                                            key={m.id}
                                            onClick={() => setSelectedImageModel(m.id)}
                                            className={`px-2 py-0.5 text-[10px] rounded-md border transition-all cursor-pointer ${
                                                selectedImageModel === m.id
                                                    ? "bg-violet-500/20 border-violet-500/40 text-violet-300"
                                                    : "border-border-primary text-text-tertiary hover:text-text-secondary hover:border-border-secondary"
                                            }`}
                                        >
                                            {m.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Input */}
                <div className="p-3 pt-1.5">
                    <div className="flex items-end gap-2">
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Спросите что-нибудь..."
                            rows={1}
                            className="flex-1 resize-none bg-bg-surface border border-border-primary rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-violet-500/50 transition-colors min-h-[40px] max-h-[100px]"
                            style={{ height: "40px" }}
                            onInput={(e) => {
                                const t = e.target as HTMLTextAreaElement;
                                t.style.height = "40px";
                                t.style.height = Math.min(t.scrollHeight, 100) + "px";
                            }}
                        />
                        <button
                            onClick={handleSend}
                            disabled={!input.trim() || isThinking}
                            className="p-2.5 bg-violet-500 hover:bg-violet-600 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl transition-colors shrink-0 cursor-pointer"
                        >
                            <Send size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

