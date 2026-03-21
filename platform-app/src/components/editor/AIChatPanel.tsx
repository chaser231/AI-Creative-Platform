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
import { Button } from "@/components/ui/Button";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import {
    Copy, Plus, X, Send, Loader2, Bot, User, Sparkles,
    CheckCircle, AlertCircle, ChevronRight, Zap, LayoutTemplate
} from "lucide-react";

export interface AIChatMessage {
    id: string;
    role: "user" | "assistant";
    type: "text" | "image" | "outpaint" | "plan" | "error" | "template_choices";
    content: string;
    prompt?: string;
    timestamp: number;
    /** Agent plan steps (only for plan-type messages) */
    steps?: Array<{
        actionId: string;
        actionName: string;
        status: "pending" | "running" | "done" | "error";
        result?: { type: string; content: string };
    }>;
    /** Template choices (only for template_choices-type messages) */
    templateChoices?: Array<{
        id: string;
        name: string;
        description: string;
        thumbnailUrl?: string;
    }>;
    /** Original topic for template application */
    templateTopic?: string;
}

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
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

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
                        await applyTemplatePack(ca.params.templateData);
                    } else if (ca.action === "update_layer") {
                        // Find layer by slotId and update
                        const { slotId, updates } = ca.params as { slotId: string; updates: Record<string, unknown> };
                        const currentLayers = useCanvasStore.getState().layers;
                        const targetLayer = currentLayers.find((l: any) => l.slotId === slotId);
                        if (targetLayer) {
                            updateLayer(targetLayer.id, updates as any);
                        }
                        // Also check masterComponents
                        const masters = useCanvasStore.getState().masterComponents;
                        const targetMaster = masters?.find((mc: any) => mc.slotId === slotId);
                        if (targetMaster && !targetLayer) {
                            // Update via master if no direct layer found
                            const masterLayer = currentLayers.find((l: any) => l.masterId === targetMaster.id);
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
                    if (step.result?.success && step.result.type !== "error" && step.result.type !== "data" && step.result.type !== "canvas_action") {
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

    // Handle template selection — sends a follow-up to the agent
    const handleTemplateSelect = (templateId: string, templateName: string, topic: string) => {
        if (isThinking || !currentWorkspace) return;

        const followUpMsg = `Применить шаблон '${templateName}' для: ${topic}`;
        setInput("");
        setIsThinking(true);

        const userMsg: AIChatMessage = {
            id: `user-${Date.now()}`,
            role: "user",
            type: "text",
            content: followUpMsg,
            timestamp: Date.now(),
        };

        onAddMessages?.([userMsg]);

        // Directly call apply_and_fill_template via the agent mutation
        agentMutation.mutateAsync({
            message: `apply_and_fill_template templateId=${templateId} topic="${topic}"`,
            workspaceId: currentWorkspace.id,
            projectId,
            history: messages
                .filter((m) => m.type !== "plan" && m.type !== "template_choices")
                .slice(-10)
                .map((m) => ({
                    role: m.role as "user" | "assistant",
                    content: m.content,
                })),
        }).then(async (result) => {
            // Execute canvas actions
            if (result.canvasActions && result.canvasActions.length > 0) {
                for (const ca of result.canvasActions) {
                    if (ca.action === "load_template") {
                        const { applyTemplatePack } = await import("@/services/templateService");
                        await applyTemplatePack(ca.params.templateData);
                    } else if (ca.action === "update_layer") {
                        const { slotId, updates } = ca.params as { slotId: string; updates: Record<string, unknown> };
                        // Wait a tick for template to load
                        await new Promise(r => setTimeout(r, 100));
                        const currentLayers = useCanvasStore.getState().layers;
                        const targetLayer = currentLayers.find((l: any) => l.slotId === slotId);
                        if (targetLayer) {
                            updateLayer(targetLayer.id, updates as any);
                        }
                    } else if (ca.action === "add_text") {
                        addTextLayer(ca.params as any);
                    } else if (ca.action === "add_image") {
                        const p = ca.params as { src: string; width: number; height: number };
                        addImageLayer(p.src, p.width, p.height);
                    }
                }
            }

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
            } else if (result.textResponse) {
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

            {/* Input */}
            <div className="p-3 border-t border-border-primary bg-bg-secondary/30">
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
    );
}

// ─── Message Bubble Component ─────────────────────────────

function MessageBubble({
    msg,
    onAddToCanvas,
    onTemplateSelect,
    isThinking,
}: {
    msg: AIChatMessage;
    onAddToCanvas: () => void;
    onTemplateSelect?: (templateId: string, templateName: string, topic: string) => void;
    isThinking?: boolean;
}) {
    if (msg.role === "user") {
        return (
            <div className="flex items-start gap-2 justify-end">
                <div className="max-w-[85%] bg-violet-500/10 text-text-primary text-sm px-3.5 py-2.5 rounded-2xl rounded-tr-sm border border-violet-500/20">
                    {msg.content}
                </div>
                <div className="w-7 h-7 rounded-full bg-bg-tertiary flex items-center justify-center shrink-0">
                    <User size={14} className="text-text-tertiary" />
                </div>
            </div>
        );
    }

    // Plan message — show steps
    if (msg.type === "plan" && msg.steps) {
        return (
            <div className="flex items-start gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex items-center justify-center shrink-0">
                    <Zap size={14} className="text-violet-400" />
                </div>
                <div className="flex-1 space-y-2">
                    {msg.content && (
                        <p className="text-xs text-text-secondary">{msg.content}</p>
                    )}
                    <div className="bg-bg-tertiary/50 rounded-xl border border-border-primary p-2.5 space-y-1.5">
                        {msg.steps.map((step, i) => (
                            <div
                                key={`${step.actionId}-${i}`}
                                className="flex items-center gap-2 text-xs"
                            >
                                {step.status === "done" ? (
                                    <CheckCircle size={12} className="text-green-400 shrink-0" />
                                ) : step.status === "error" ? (
                                    <AlertCircle size={12} className="text-red-400 shrink-0" />
                                ) : step.status === "running" ? (
                                    <Loader2 size={12} className="animate-spin text-violet-400 shrink-0" />
                                ) : (
                                    <div className="w-3 h-3 rounded-full border border-border-primary shrink-0" />
                                )}
                                <span className={
                                    step.status === "done"
                                        ? "text-text-primary"
                                        : step.status === "error"
                                            ? "text-red-400"
                                            : "text-text-tertiary"
                                }>
                                    {step.actionName}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // Template choices — show template selection cards
    if (msg.type === "template_choices" && msg.templateChoices) {
        return (
            <div className="flex items-start gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex items-center justify-center shrink-0">
                    <LayoutTemplate size={14} className="text-violet-400" />
                </div>
                <div className="flex-1 space-y-2 min-w-0">
                    <p className="text-xs text-text-secondary">{msg.content}</p>
                    <div className="space-y-1.5">
                        {msg.templateChoices.map((tpl, i) => (
                            <button
                                key={tpl.id}
                                onClick={() => onTemplateSelect?.(tpl.id, tpl.name, msg.templateTopic || "")}
                                disabled={isThinking}
                                className="w-full text-left bg-bg-tertiary/50 hover:bg-violet-500/10 rounded-xl border border-border-primary hover:border-violet-500/30 p-2.5 transition-all cursor-pointer group disabled:opacity-50"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-text-primary group-hover:text-violet-300">
                                        {i + 1}. {tpl.name}
                                    </span>
                                    <ChevronRight size={12} className="text-text-tertiary group-hover:text-violet-400 ml-auto shrink-0" />
                                </div>
                                {tpl.description && (
                                    <p className="text-[10px] text-text-tertiary mt-0.5 line-clamp-2">{tpl.description}</p>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // Error message
    if (msg.type === "error") {
        // Show a user-friendly truncated error
        const shortError = msg.content.length > 120
            ? msg.content.slice(0, 120) + "…"
            : msg.content;

        return (
            <div className="flex items-start gap-2 min-w-0">
                <div className="w-7 h-7 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                    <AlertCircle size={14} className="text-red-400" />
                </div>
                <div className="min-w-0 flex-1 bg-red-500/10 text-red-400 text-xs px-3.5 py-2.5 rounded-2xl rounded-tl-sm border border-red-500/20 break-words overflow-hidden">
                    {shortError}
                </div>
            </div>
        );
    }

    // Image result
    if (msg.type === "image") {
        return (
            <div className="flex items-start gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex items-center justify-center shrink-0">
                    <Bot size={14} className="text-violet-400" />
                </div>
                <div className="flex-1 space-y-2">
                    <div className="rounded-xl overflow-hidden border border-border-primary">
                        <img src={msg.content} alt="Generated" className="w-full h-auto" />
                    </div>
                    <div className="flex gap-1.5">
                        <Button size="sm" variant="secondary" className="h-6 text-[10px] px-2" onClick={onAddToCanvas} icon={<Plus size={10} />}>
                            На холст
                        </Button>
                        <button
                            className="p-1 text-text-tertiary hover:text-text-primary bg-bg-secondary rounded-md transition-colors cursor-pointer"
                            onClick={() => navigator.clipboard.writeText(msg.content)}
                        >
                            <Copy size={10} />
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Text result
    return (
        <div className="flex items-start gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex items-center justify-center shrink-0">
                <Bot size={14} className="text-violet-400" />
            </div>
            <div className="flex-1 space-y-2">
                <div className="bg-bg-tertiary text-sm text-text-primary px-3.5 py-2.5 rounded-2xl rounded-tl-sm whitespace-pre-wrap">
                    {msg.content}
                </div>
                <div className="flex gap-1.5">
                    <Button size="sm" variant="secondary" className="h-6 text-[10px] px-2" onClick={onAddToCanvas} icon={<Plus size={10} />}>
                        На холст
                    </Button>
                    <button
                        className="p-1 text-text-tertiary hover:text-text-primary bg-bg-secondary rounded-md transition-colors cursor-pointer"
                        onClick={() => navigator.clipboard.writeText(msg.content)}
                    >
                        <Copy size={10} />
                    </button>
                </div>
            </div>
        </div>
    );
}
