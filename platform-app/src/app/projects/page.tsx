"use client";

/**
 * /projects — "Все проекты" page
 *
 * Shows ALL projects in the current workspace (not filtered by user).
 */

import { useState, useMemo, useCallback } from "react";
import { Plus, Search, Loader2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { ProjectCard } from "@/components/dashboard/ProjectCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { NewProjectModal } from "@/components/dashboard/NewProjectModal";
import { useProjectListSync } from "@/hooks/useProjectSync";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { WorkspaceOnboarding } from "@/components/workspace/WorkspaceOnboarding";

export default function AllProjectsPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const { projects: backendProjects, isLoading, workspaceId, refetch } = useProjectListSync();
  const { currentWorkspace, needsOnboarding } = useWorkspace();

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

  type BackendProject = { id: string; name: string; status: string; goal: string | null; createdAt: Date; updatedAt: Date; thumbnail: string | null; createdBy?: { id: string; name: string; avatarUrl: string | null } };
  const projects = useMemo(() => {
    return ((backendProjects || []) as BackendProject[]).map((bp) => ({
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
      createdBy: bp.createdBy ?? undefined,
    }));
  }, [backendProjects]);

  return (
    <AppShell>
      <TopBar
        breadcrumbs={[{ label: currentWorkspace?.name || "AI Creative" }, { label: "Все проекты" }]}
        showBackToProjects={false}
        showHistoryNavigation={true}
      />
      <div className="flex-1 overflow-y-auto">
        {/* Projects section */}
        <div className="px-6 pt-6">
          <div className="flex items-center justify-between mb-5">
            <h1 className="text-3xl text-text-primary">Все проекты команды</h1>
            <div className="flex items-center gap-3">
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
      {needsOnboarding && <WorkspaceOnboarding />}
    </AppShell>
  );
}
