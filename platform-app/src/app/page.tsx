"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { Plus, ImageIcon, Type, Camera, Video, Search, HelpCircle, LayoutTemplate, ArrowRight, Star, Loader2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { ProjectCard } from "@/components/dashboard/ProjectCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { NewProjectModal } from "@/components/dashboard/NewProjectModal";
import { useProjectStore } from "@/store/projectStore";
import { useProjectListSync } from "@/hooks/useProjectSync";
import { useTemplateStore } from "@/store/templateStore";
import { trpc } from "@/lib/trpc";
import { getRecommendedPacks } from "@/services/templateCatalogService";
import type { TemplatePackV2 } from "@/services/templateService";

function RecommendedTemplates() {
  const { savedPacks } = useTemplateStore();
  // TODO: Use actual user BU from profile/auth context
  const userBU = "yandex-market" as const;

  const recommended = useMemo(
    () => getRecommendedPacks(userBU, savedPacks, 4),
    [savedPacks]
  );

  if (recommended.length === 0) return null;

  return (
    <div className="px-6 pt-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <LayoutTemplate size={16} className="text-accent-primary" />
          <h2 className="text-sm font-semibold text-text-primary">Готовые наборы</h2>
        </div>
        <Link
          href="/templates"
          className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-accent-primary transition-colors"
        >
          Все шаблоны
          <ArrowRight size={12} />
        </Link>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {recommended.map(pack => (
          <Link
            key={pack.id}
            href="/templates"
            className="flex items-center gap-3 p-3 rounded-xl border border-border-primary bg-bg-surface hover:border-accent-primary/30 hover:shadow-sm transition-all group"
          >
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent-primary/10 to-accent-primary/20 flex items-center justify-center shrink-0">
              <LayoutTemplate size={18} className="text-accent-primary/70" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-text-primary truncate">{pack.name}</span>
                {pack.isOfficial && (
                  <Star size={8} className="text-amber-500 fill-amber-500 shrink-0" />
                )}
              </div>
              <span className="text-[10px] text-text-tertiary">
                {pack.resizes.length} форматов · {pack.categories[0] || "visual"}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
const generationTypes = [
  {
    icon: <ImageIcon size={28} strokeWidth={1.5} />,
    label: "Генерация\nбаннеров",
    gradient: "gradient-card-yellow",
  },
  {
    icon: <Type size={28} strokeWidth={1.5} />,
    label: "Генерация\nтекстов",
    gradient: "gradient-card-blue",
  },
  {
    icon: <Camera size={28} strokeWidth={1.5} />,
    label: "Генерация\nфото",
    gradient: "gradient-card-green",
  },
  {
    icon: <Video size={28} strokeWidth={1.5} />,
    label: "Генерация\nвидео",
    gradient: "gradient-card-pink",
  },
];

export default function DashboardPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const localProjects = useProjectStore((s) => s.projects);
  const { projects: backendProjects, isLoading, workspaceId, refetch } = useProjectListSync();

  // tRPC mutations for project management
  const updateMutation = trpc.project.update.useMutation({
    onSuccess: () => { refetch(); },
  });
  const deleteMutation = trpc.project.delete.useMutation({
    onSuccess: () => { refetch(); },
  });

  const handleProjectUpdate = useCallback((id: string, data: { name?: string; status?: "DRAFT" | "IN_PROGRESS" | "REVIEW" | "PUBLISHED" | "ARCHIVED" }) => {
    updateMutation.mutate({ id, ...data });
  }, [updateMutation]);

  const handleProjectDelete = useCallback((id: string) => {
    deleteMutation.mutate({ id });
  }, [deleteMutation]);

  // Merge: show local projects + backend projects (deduplicated)
  const projects = useMemo(() => {
    const localIds = new Set(localProjects.map(p => p.id));
    // Backend projects that aren't in local store
    type BackendProject = { id: string; name: string; status: string; goal: string | null; createdAt: Date; updatedAt: Date; thumbnail: string | null };
    const backendOnly = ((backendProjects || []) as BackendProject[]).map((bp: BackendProject) => ({
      id: bp.id,
      name: bp.name,
      status: bp.status.toLowerCase() as "draft" | "in-progress" | "review" | "published",
      goal: (bp.goal || "banner") as "banner" | "text" | "video",
      businessUnit: "yandex-market" as const,
      createdAt: new Date(bp.createdAt),
      updatedAt: new Date(bp.updatedAt),
      thumbnail: bp.thumbnail ?? undefined,
      resizes: [],
      activeResizeId: "master",
    })).filter((bp: { id: string }) => !localIds.has(bp.id));
    return [...localProjects, ...backendOnly];
  }, [localProjects, backendProjects]);

  return (
    <AppShell>
      <TopBar
        breadcrumbs={[{ label: "Yandex Market" }, { label: "Последние проекты" }]}
        showBackToProjects={false}
        showHistoryNavigation={true}
        actions={
          <Button
            variant="ghost"
            size="sm"
            icon={<HelpCircle size={16} />}
            onClick={() => alert("Здесь будет онбординг!")}
          >
            Помощь
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {/* Generation type cards */}
        <div className="px-6 pt-6 pb-2">
          <div className="grid grid-cols-4 gap-4">
            {generationTypes.map((type) => (
              <button
                key={type.label}
                className={`flex flex-col items-center justify-center gap-3 p-6 rounded-[var(--radius-2xl)] border border-border-primary ${type.gradient} hover:shadow-[var(--shadow-lg)] hover:border-border-secondary transition-all duration-[var(--transition-base)] cursor-pointer group`}
              >
                <div className="flex items-center justify-center w-14 h-14 rounded-[var(--radius-xl)] bg-bg-surface/80 text-text-primary group-hover:scale-105 transition-transform shadow-[var(--shadow-sm)]">
                  {type.icon}
                </div>
                <span className="text-[13px] font-medium text-text-primary text-center whitespace-pre-line leading-tight">
                  {type.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Recommended templates — compact, extensible section */}
        <RecommendedTemplates />

        {/* Projects section */}
        <div className="px-6 pt-8">
          <div className="flex items-center justify-between mb-5">
            <h1 className="text-3xl text-text-primary">Проекты</h1>
            <div className="flex items-center gap-3">
              {/* Search */}
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-[var(--radius-full)] bg-bg-surface border border-border-primary text-text-tertiary hover:border-border-secondary transition-colors cursor-pointer">
                <Search size={14} />
                <span className="text-[13px] font-light">Найти проект...</span>
              </div>
              <Button
                onClick={() => setModalOpen(true)}
                icon={<Plus size={16} />}
                size="lg"
              >
                Новый проект
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin text-text-tertiary" />
            </div>
          ) : projects.length === 0 ? (
            <EmptyState onCreateProject={() => setModalOpen(true)} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onUpdate={handleProjectUpdate}
                  onDelete={handleProjectDelete}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <NewProjectModal open={modalOpen} onClose={() => setModalOpen(false)} workspaceId={workspaceId} />
    </AppShell>
  );
}
