/**
 * VersionHistoryPanel
 *
 * Slide-out panel showing version snapshots for the current project.
 * Users can create new versions and restore previous ones.
 */

"use client";

import { useState } from "react";
import { History, Plus, RotateCcw, X, Tag, Clock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  useProjectVersions,
  useCreateVersion,
  useRestoreVersion,
} from "@/hooks/useProjectVersions";

interface VersionHistoryPanelProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onVersionRestored?: () => void;
}

function timeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "только что";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин. назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч. назад`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} дн. назад`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function VersionHistoryPanel({
  projectId,
  isOpen,
  onClose,
  onVersionRestored,
}: VersionHistoryPanelProps) {
  const { versions, isLoading, refetch } = useProjectVersions(
    isOpen ? projectId : null
  );
  const { createVersion, isPending: isCreating } = useCreateVersion();
  const { restoreVersion, isPending: isRestoring } = useRestoreVersion();
  const [showLabelInput, setShowLabelInput] = useState(false);
  const [versionLabel, setVersionLabel] = useState("");
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  const handleCreateVersion = async () => {
    const label = versionLabel.trim() || undefined;
    const version = await createVersion(projectId, label);
    if (version) {
      setVersionLabel("");
      setShowLabelInput(false);
      refetch();
    }
  };

  const handleRestore = async (versionId: string) => {
    const success = await restoreVersion(projectId, versionId);
    if (success) {
      setConfirmRestore(null);
      onVersionRestored?.();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Panel */}
      <div className="fixed top-0 right-0 w-[340px] h-full bg-bg-surface border-l border-border-primary shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-border-primary shrink-0">
          <div className="flex items-center gap-2">
            <History size={16} className="text-accent-primary" />
            <h3 className="text-sm font-semibold text-text-primary">
              История версий
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary transition-colors cursor-pointer"
          >
            <X size={14} className="text-text-tertiary" />
          </button>
        </div>

        {/* Create version */}
        <div className="px-4 py-3 border-b border-border-primary shrink-0">
          {showLabelInput ? (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={versionLabel}
                onChange={(e) => setVersionLabel(e.target.value)}
                placeholder="Название версии (необязательно)"
                className="w-full h-9 px-3 rounded-lg border border-border-primary bg-bg-primary text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/20"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateVersion();
                  if (e.key === "Escape") {
                    setShowLabelInput(false);
                    setVersionLabel("");
                  }
                }}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleCreateVersion}
                  disabled={isCreating}
                  className="flex-1"
                >
                  {isCreating ? "Сохранение..." : "Сохранить"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowLabelInput(false);
                    setVersionLabel("");
                  }}
                >
                  Отмена
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              onClick={() => setShowLabelInput(true)}
              className="w-full"
            >
              <Plus size={14} />
              Сохранить версию
            </Button>
          )}
        </div>

        {/* Version list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-accent-primary/30 border-t-accent-primary rounded-full animate-spin" />
              <p className="text-xs text-text-tertiary mt-3">Загрузка…</p>
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-12 h-12 rounded-xl bg-bg-secondary flex items-center justify-center mb-3">
                <History size={20} className="text-text-tertiary" />
              </div>
              <p className="text-xs text-text-tertiary">
                Нет сохранённых версий
              </p>
              <p className="text-[10px] text-text-tertiary mt-1">
                Нажмите «Сохранить версию» для создания снапшота
              </p>
            </div>
          ) : (
            versions.map((v: { id: string; version: number; label: string | null; createdAt: Date; createdBy: string }) => (
              <div
                key={v.id}
                className="group flex items-start justify-between p-3 rounded-xl border border-border-primary hover:border-border-secondary hover:bg-bg-secondary/50 transition-all"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded">
                      v{v.version}
                    </span>
                    {v.label && (
                      <span className="flex items-center gap-0.5 text-[10px] text-accent-primary">
                        <Tag size={8} />
                        {v.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-1.5">
                    <Clock size={10} className="text-text-tertiary" />
                    <span className="text-[10px] text-text-tertiary">
                      {timeAgo(v.createdAt)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setConfirmRestore(v.id)}
                  className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-accent-primary rounded-md hover:bg-bg-tertiary transition-all cursor-pointer"
                  title="Восстановить эту версию"
                >
                  <RotateCcw size={10} />
                  Восстановить
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Restore confirmation modal */}
      <Modal
        open={!!confirmRestore}
        onClose={() => setConfirmRestore(null)}
        title="Восстановить версию?"
        maxWidth="max-w-sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRestore(null)}>
              Отмена
            </Button>
            <Button
              onClick={() => confirmRestore && handleRestore(confirmRestore)}
              disabled={isRestoring}
            >
              {isRestoring ? "Восстановление..." : "Восстановить"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          Текущее состояние проекта будет заменено выбранной версией. Это
          действие необратимо — сохраните текущую версию перед восстановлением.
        </p>
      </Modal>
    </>
  );
}
