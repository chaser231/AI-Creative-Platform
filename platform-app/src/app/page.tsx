"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { WorkspaceOnboarding } from "@/components/workspace/WorkspaceOnboarding";
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
    id: "banner" as const,
    icon: <ImageIcon size={20} strokeWidth={1.5} />,
    label: "Генерация\nбаннеров",
    gradient: "gradient-card-purple",
    iconBg: "bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400",
    image: "/cards/banner.png",
  },
  {
    id: "text" as const,
    icon: <Type size={20} strokeWidth={1.5} />,
    label: "Генерация\nтекстов",
    gradient: "gradient-card-blue",
    iconBg: "bg-sky-100 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400",
    image: "/cards/text.png",
  },
  {
    id: "photo" as const,
    icon: <Camera size={20} strokeWidth={1.5} />,
    label: "Генерация\nфото",
    gradient: "gradient-card-peach",
    iconBg: "bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400",
    image: "/cards/photo.png",
  },
  {
    id: "video" as const,
    icon: <Video size={20} strokeWidth={1.5} />,
    label: "Генерация\nвидео",
    gradient: "gradient-card-green",
    iconBg: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400",
    image: "/cards/video.png",
  },
];

export default function DashboardPage() {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const localProjects = useProjectStore((s) => s.projects);
  const { projects: backendProjects, isLoading, workspaceId, refetch } = useProjectListSync(true);
  const { currentWorkspace, needsOnboarding } = useWorkspace();

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

  // Favorites
  const favoritesQuery = trpc.project.listFavorites.useQuery(
    { workspaceId: workspaceId ?? "" },
    { enabled: !!workspaceId, refetchOnWindowFocus: false }
  );
  const favoriteIds = useMemo(
    () => new Set((favoritesQuery.data ?? []).map((f: { id: string }) => f.id)),
    [favoritesQuery.data]
  );
  const favoriteMutation = trpc.project.favorite.useMutation({ onSuccess: () => favoritesQuery.refetch() });
  const unfavoriteMutation = trpc.project.unfavorite.useMutation({ onSuccess: () => favoritesQuery.refetch() });

  const handleFavorite = useCallback((id: string) => {
    if (favoriteIds.has(id)) {
      unfavoriteMutation.mutate({ projectId: id });
    } else {
      favoriteMutation.mutate({ projectId: id });
    }
  }, [favoriteIds, favoriteMutation, unfavoriteMutation]);

  // Create project for photo shortcut
  const createProjectMutation = trpc.project.create.useMutation({
    onSuccess: (data) => {
      router.push(`/editor/${data.id}?panel=ai&tab=image`);
    },
  });

  // Tile click handlers
  const handleTileClick = useCallback((tileId: string) => {
    switch (tileId) {
      case "banner":
        setModalOpen(true);
        break;
      case "text":
      case "video":
        setToast("В разработке");
        break;
      case "photo":
        if (workspaceId) {
          createProjectMutation.mutate({
            name: "Генерация фото",
            goal: "banner",
            workspaceId,
          });
        }
        break;
    }
  }, [workspaceId, createProjectMutation]);

  // Auto-hide toast
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 2500);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // Merge: show local projects + backend projects (deduplicated)
  const projects = useMemo(() => {
    const localIds = new Set(localProjects.map(p => p.id));
    // Backend projects that aren't in local store
    type BackendProject = { id: string; name: string; status: string; goal: string | null; createdAt: Date; updatedAt: Date; thumbnail: string | null; createdBy?: { id: string; name: string; avatarUrl: string | null } };
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
      createdBy: bp.createdBy ?? undefined,
    })).filter((bp: { id: string }) => !localIds.has(bp.id));
    return [...localProjects, ...backendOnly];
  }, [localProjects, backendProjects]);

  return (
    <AppShell>
      <TopBar
        breadcrumbs={[{ label: currentWorkspace?.name || "AI Creative" }, { label: "Мои проекты" }]}
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
                key={type.id}
                onClick={() => handleTileClick(type.id)}
                className={`relative flex flex-col justify-between p-5 h-[140px] rounded-[var(--radius-2xl)] border border-border-primary ${type.gradient} hover:shadow-[var(--shadow-lg)] hover:border-border-secondary transition-all duration-[var(--transition-base)] cursor-pointer group overflow-hidden`}
              >
                {/* Icon + Title — left aligned */}
                <div className="flex flex-col items-start gap-2 z-10 relative">
                  <div className={`flex items-center justify-center w-9 h-9 rounded-[var(--radius-md)] ${type.iconBg} group-hover:scale-105 transition-transform`}>
                    {type.icon}
                  </div>
                  <span className="text-[13px] font-semibold text-text-primary text-left whitespace-pre-line leading-tight">
                    {type.label}
                  </span>
                </div>
                {/* Decorative illustration — bottom right */}
                <img
                  src={type.image}
                  alt=""
                  aria-hidden
                  className="absolute -bottom-2 -right-2 w-[100px] h-[100px] object-contain opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-300 select-none pointer-events-none"
                />
              </button>
            ))}
          </div>
        </div>

        {/* Recommended templates — compact, extensible section */}
        <RecommendedTemplates />

        {/* Projects section */}
        <div className="px-6 pt-8">
          <div className="flex items-center justify-between mb-5">
            <h1 className="text-3xl text-text-primary">Мои проекты</h1>
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
                  onFavorite={handleFavorite}
                  isFavorite={favoriteIds.has(project.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <NewProjectModal open={modalOpen} onClose={() => setModalOpen(false)} workspaceId={workspaceId} />
      {needsOnboarding && <WorkspaceOnboarding />}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] text-sm text-text-primary animate-in fade-in slide-in-from-bottom-2 duration-200">
          {toast}
        </div>
      )}
    </AppShell>
  );
}
