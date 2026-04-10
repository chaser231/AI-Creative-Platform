"use client";

import { useState, useEffect } from "react";
import { Lock, Globe, Users, Check, X, Shield } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { trpc } from "@/lib/trpc";
import type { TemplateVisibility, TemplateEditPermission } from "@/types";

interface TemplateSettingsModalProps {
    open: boolean;
    onClose: () => void;
    templateId: string;
    /** Called after successful settings save */
    onSaved?: () => void;
}

export function TemplateSettingsModal({ open, templateId, onClose, onSaved }: TemplateSettingsModalProps) {
    const templateQuery = trpc.template.loadState.useQuery(
        { id: templateId },
        { enabled: open && !!templateId, refetchOnWindowFocus: false }
    );

    const updateMutation = trpc.template.update.useMutation({
        onSuccess: () => {
            onSaved?.();
            onClose();
        },
    });

    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [visibility, setVisibility] = useState<TemplateVisibility>("WORKSPACE");
    const [editPermission, setEditPermission] = useState<TemplateEditPermission>("AUTHOR_ONLY");

    // Populate form from query data
    useEffect(() => {
        if (templateQuery.data) {
            setName(templateQuery.data.name);
            setDescription(templateQuery.data.description);
            setVisibility((templateQuery.data.visibility as TemplateVisibility) || "WORKSPACE");
            setEditPermission((templateQuery.data.editPermission as TemplateEditPermission) || "AUTHOR_ONLY");
        }
    }, [templateQuery.data]);

    const isAuthor = templateQuery.data?.isAuthor ?? false;
    const canEdit = templateQuery.data?.canEdit ?? false;

    const handleSave = () => {
        const payload: Record<string, unknown> = { id: templateId };
        if (name !== templateQuery.data?.name) payload.name = name;
        if (description !== templateQuery.data?.description) payload.description = description;
        if (isAuthor) {
            payload.visibility = visibility;
            payload.editPermission = editPermission;
        }
        updateMutation.mutate(payload as any);
    };

    const visibilityOptions: { value: TemplateVisibility; label: string; icon: React.ReactNode; desc: string }[] = [
        { value: "PRIVATE", label: "Только я", icon: <Lock size={14} />, desc: "Виден только автору" },
        { value: "WORKSPACE", label: "Моя команда", icon: <Users size={14} />, desc: "Все участники воркспейса" },
        { value: "PUBLIC", label: "Все пользователи", icon: <Globe size={14} />, desc: "Все воркспейсы на платформе" },
    ];

    const editPermissionOptions: { value: TemplateEditPermission; label: string; icon: React.ReactNode; desc: string }[] = [
        { value: "AUTHOR_ONLY", label: "Только я", icon: <Lock size={14} />, desc: "Редактировать может только автор" },
        { value: "WORKSPACE", label: "Вся команда", icon: <Users size={14} />, desc: "Любой участник воркспейса" },
    ];

    if (!open) return null;

    return (
        <Modal open={open} onClose={onClose} title="Настройки шаблона" maxWidth="max-w-md">
            {templateQuery.isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <div className="w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                </div>
            ) : (
                <div className="space-y-5 pt-1">
                    {/* Name */}
                    <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-text-secondary">Название</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={!canEdit}
                            className="w-full h-9 px-3 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[13px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary/50 disabled:opacity-50"
                        />
                    </div>

                    {/* Description */}
                    <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-text-secondary">Описание</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            disabled={!canEdit}
                            rows={2}
                            className="w-full px-3 py-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[13px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary/50 resize-none disabled:opacity-50"
                        />
                    </div>

                    {/* Visibility */}
                    <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5">
                            <Globe size={13} className="text-text-tertiary" />
                            <label className="text-[12px] font-medium text-text-secondary">Видимость</label>
                        </div>
                        <div className="flex flex-col gap-1">
                            {visibilityOptions.map((opt) => {
                                const disabled = !isAuthor;
                                return (
                                    <button
                                        key={opt.value}
                                        onClick={() => !disabled && setVisibility(opt.value)}
                                        disabled={disabled}
                                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition-all border cursor-pointer ${
                                            visibility === opt.value
                                                ? "bg-accent-primary/10 border-accent-primary/30 text-accent-primary"
                                                : "bg-bg-surface border-border-primary text-text-secondary hover:border-border-secondary"
                                        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                                    >
                                        <span className={visibility === opt.value ? "text-accent-primary" : "text-text-tertiary"}>{opt.icon}</span>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[11px] font-medium">{opt.label}</div>
                                            <div className="text-[9px] text-text-tertiary">{opt.desc}</div>
                                        </div>
                                        {visibility === opt.value && <Check size={14} />}
                                    </button>
                                );
                            })}
                        </div>
                        {!isAuthor && (
                            <p className="text-[9px] text-text-tertiary mt-1 flex items-center gap-1">
                                <Shield size={9} /> Только автор может менять видимость
                            </p>
                        )}
                    </div>

                    {/* Edit Permission */}
                    <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5">
                            <Shield size={13} className="text-text-tertiary" />
                            <label className="text-[12px] font-medium text-text-secondary">Кто может редактировать</label>
                        </div>
                        <div className="flex flex-col gap-1">
                            {editPermissionOptions.map((opt) => {
                                const disabled = !isAuthor;
                                return (
                                    <button
                                        key={opt.value}
                                        onClick={() => !disabled && setEditPermission(opt.value)}
                                        disabled={disabled}
                                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition-all border cursor-pointer ${
                                            editPermission === opt.value
                                                ? "bg-accent-primary/10 border-accent-primary/30 text-accent-primary"
                                                : "bg-bg-surface border-border-primary text-text-secondary hover:border-border-secondary"
                                        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                                    >
                                        <span className={editPermission === opt.value ? "text-accent-primary" : "text-text-tertiary"}>{opt.icon}</span>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[11px] font-medium">{opt.label}</div>
                                            <div className="text-[9px] text-text-tertiary">{opt.desc}</div>
                                        </div>
                                        {editPermission === opt.value && <Check size={14} />}
                                    </button>
                                );
                            })}
                        </div>
                        {!isAuthor && (
                            <p className="text-[9px] text-text-tertiary mt-1 flex items-center gap-1">
                                <Shield size={9} /> Только автор может менять права
                            </p>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-2 pt-2 border-t border-border-primary">
                        <Button variant="ghost" size="sm" onClick={onClose}>
                            Отмена
                        </Button>
                        <Button
                            size="sm"
                            onClick={handleSave}
                            disabled={!canEdit || updateMutation.isPending || !name.trim()}
                        >
                            {updateMutation.isPending ? "Сохранение..." : "Сохранить"}
                        </Button>
                    </div>

                    {updateMutation.isError && (
                        <p className="text-[10px] text-red-400 flex items-center gap-1">
                            <X size={10} /> {updateMutation.error?.message || "Ошибка сохранения"}
                        </p>
                    )}
                </div>
            )}
        </Modal>
    );
}
