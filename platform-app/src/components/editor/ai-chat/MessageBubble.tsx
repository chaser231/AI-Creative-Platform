"use client";

import {
    Copy, Plus, X, Bot, User, Sparkles,
    CheckCircle, AlertCircle, ChevronRight, Zap, LayoutTemplate, Search,
    Loader2, Repeat,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { AIChatMessage } from "./types";

export function MessageBubble({
    msg,
    onAddToCanvas,
    onTemplateSelect,
    onFallbackAction,
    onVariantSelect,
    isThinking,
}: {
    msg: AIChatMessage;
    onAddToCanvas: () => void;
    onTemplateSelect?: (templateId: string, templateName: string, topic: string) => void;
    onFallbackAction?: (actionId: string, topic: string) => void;
    onVariantSelect?: (msgId: string, variantIndex: number, variant: { title: string; subtitle: string }) => void;
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

    // Fallback actions — no templates found, show alternatives
    if (msg.type === "fallback_actions" && msg.fallbackActions) {
        const iconMap: Record<string, React.ReactNode> = {
            plus: <Plus size={14} className="text-violet-400" />,
            search: <Search size={14} className="text-blue-400" />,
        };
        return (
            <div className="flex items-start gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center shrink-0">
                    <AlertCircle size={14} className="text-amber-400" />
                </div>
                <div className="flex-1 space-y-2 min-w-0">
                    <p className="text-xs text-text-secondary">{msg.content}</p>
                    <div className="flex gap-2">
                        {msg.fallbackActions.map((action) => (
                            <button
                                key={action.id}
                                onClick={() => onFallbackAction?.(action.id, msg.templateTopic || "")}
                                disabled={isThinking}
                                className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border border-border-primary hover:border-violet-500/30 bg-bg-tertiary/50 hover:bg-violet-500/10 transition-all cursor-pointer disabled:opacity-50"
                            >
                                {iconMap[action.icon] || <ChevronRight size={14} />}
                                {action.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // Text variants — Market template title+subtitle options
    if (msg.type === "text_variants" && msg.textVariants) {
        const activeIdx = msg.activeVariantIndex ?? 0;
        return (
            <div className="flex items-start gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center shrink-0">
                    <Repeat size={14} className="text-emerald-400" />
                </div>
                <div className="flex-1 space-y-2 min-w-0">
                    <p className="text-xs text-text-secondary">{msg.content}</p>
                    <div className="space-y-1.5">
                        {msg.textVariants.map((variant, idx) => (
                            <button
                                key={idx}
                                onClick={() => onVariantSelect?.(msg.id, idx, variant)}
                                className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                                    idx === activeIdx
                                        ? "bg-emerald-500/10 border-emerald-500/40 ring-1 ring-emerald-500/20"
                                        : "bg-bg-tertiary/50 border-border-primary hover:border-emerald-500/30 hover:bg-emerald-500/5"
                                }`}
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <span className={`text-[10px] font-medium ${
                                        idx === activeIdx ? "text-emerald-400" : "text-text-tertiary"
                                    }`}>
                                        Вариант {idx + 1}{idx === activeIdx ? " ✓" : ""}
                                    </span>
                                    <span className="text-[9px] text-text-tertiary">
                                        {variant.title.length} / {variant.subtitle.length} симв.
                                    </span>
                                </div>
                                <p className={`text-xs font-bold leading-tight ${
                                    idx === activeIdx ? "text-text-primary" : "text-text-secondary"
                                }`}>
                                    {variant.title}
                                </p>
                                <p className={`text-[11px] mt-0.5 leading-tight ${
                                    idx === activeIdx ? "text-text-secondary" : "text-text-tertiary"
                                }`}>
                                    {variant.subtitle}
                                </p>
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
