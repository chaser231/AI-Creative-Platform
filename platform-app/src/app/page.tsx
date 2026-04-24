"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, ImageIcon, Type, Camera, Video, Search, HelpCircle, LayoutTemplate, ArrowRight, Star, Loader2, X, FolderKanban, Image as ImageLibIcon, Workflow } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { ProjectCard } from "@/components/dashboard/ProjectCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { NewProjectModal } from "@/components/dashboard/NewProjectModal";
import { WorkspaceAssetGrid } from "@/components/dashboard/WorkspaceAssetGrid";
import { useProjectStore } from "@/store/projectStore";
import { useProjectListSync } from "@/hooks/useProjectSync";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { WorkspaceOnboarding } from "@/components/workspace/WorkspaceOnboarding";

function RecentTemplates({ workspaceId }: { workspaceId: string | null }) {
  const recentQuery = trpc.template.recent.useQuery(
    { workspaceId: workspaceId!, limit: 4 },
    { enabled: !!workspaceId, refetchOnWindowFocus: false }
  );

  if (!workspaceId || recentQuery.isLoading) return null;
  const templates = recentQuery.data ?? [];
  if (templates.length === 0) return null;

  return (
    <div className="px-6 pt-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <LayoutTemplate size={16} className="text-accent-primary" />
          <h2 className="text-sm font-semibold text-text-primary">Последние шаблоны</h2>
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
        {templates.map((tmpl: { id: string; name: string; isOfficial: boolean; resizes: unknown[]; categories: string[] }) => (
          <Link
            key={tmpl.id}
            href="/templates"
            className="flex items-center gap-3 p-3 rounded-xl border border-border-primary bg-bg-surface hover:border-accent-primary/30 hover:shadow-sm transition-all group"
          >
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent-primary/10 to-accent-primary/20 flex items-center justify-center shrink-0">
              <LayoutTemplate size={18} className="text-accent-primary/70" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-text-primary truncate">{tmpl.name}</span>
                {tmpl.isOfficial && (
                  <Star size={8} className="text-amber-500 fill-amber-500 shrink-0" />
                )}
              </div>
              <span className="text-[10px] text-text-tertiary">
                {tmpl.resizes.length} форматов · {tmpl.categories[0] || "visual"}
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
  {
    id: "workflows" as const,
    icon: <Workflow size={20} strokeWidth={1.5} />,
    label: "AI\nWorkflows",
    gradient: "gradient-card-pink",
    iconBg: "bg-pink-100 text-pink-600 dark:bg-pink-500/20 dark:text-pink-400",
    image: "/cards/workflows.png",
  },
];

type ProjectTab = "all" | "banner" | "photo" | "video" | "assets";

export default function DashboardPage() {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ProjectTab>("all");
  const searchInputRef = useRef<HTMLInputElement>(null);
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

  // Create project — routes to the right workspace based on goal
  const createProjectMutation = trpc.project.create.useMutation({
    onSuccess: (data) => {
      const goal = (data as { goal?: string }).goal;
      if (goal === "photo") {
        router.push(`/photo/${data.id}`);
      } else {
        router.push(`/editor/${data.id}`);
      }
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
            goal: "photo",
            workspaceId,
          });
        }
        break;
      case "workflows":
        // Workflows is workspace-scoped (not per-project), so the card jumps
        // straight to the list page where the user picks/creates one.
        router.push("/workflows");
        break;
    }
  }, [workspaceId, createProjectMutation, router]);

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
      goal: (bp.goal || "banner") as "banner" | "text" | "video" | "photo",
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

  // Client-side search + tab filter (instant, no debounce)
  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return projects.filter((p) => {
      if (activeTab !== "all" && activeTab !== "assets" && p.goal !== activeTab) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [projects, searchQuery, activeTab]);

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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
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
                  <span className="text-base font-semibold text-text-primary text-left whitespace-pre-line leading-snug">
                    {type.label}
                  </span>
                </div>
                {/* Decorative illustration — bottom right */}
                <img
                  src={type.image}
                  alt=""
                  aria-hidden
                  className="absolute -bottom-3 -right-3 w-[120px] h-[120px] object-contain opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-300 select-none pointer-events-none"
                />
              </button>
            ))}
          </div>
        </div>

        {/* Recent templates — dynamic per-user section */}
        <RecentTemplates workspaceId={workspaceId} />

        {/* Projects section */}
        <div className="px-6 pt-8">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl text-text-primary">Мои проекты</h1>
            <div className="flex items-center gap-3">
              {/* Search */}
              <div className={`flex items-center gap-2 px-4 py-2.5 rounded-[var(--radius-full)] bg-bg-surface border transition-colors ${
                searchOpen ? "border-accent-primary/50 shadow-sm" : "border-border-primary hover:border-border-secondary"
              }`}>
                <Search size={14} className="text-text-tertiary shrink-0" />
                {searchOpen ? (
                  <>
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onBlur={() => { if (!searchQuery) setSearchOpen(false); }}
                      onKeyDown={(e) => { if (e.key === "Escape") { setSearchQuery(""); setSearchOpen(false); } }}
                      placeholder="Найти проект..."
                      className="bg-transparent text-[13px] text-text-primary placeholder:text-text-tertiary outline-none w-[160px]"
                      autoFocus
                    />
                    {searchQuery && (
                      <button
                        onClick={() => { setSearchQuery(""); searchInputRef.current?.focus(); }}
                        className="text-text-tertiary hover:text-text-primary transition-colors"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    onClick={() => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 50); }}
                    className="text-[13px] font-light text-text-tertiary cursor-pointer"
                  >
                    Найти проект...
                  </button>
                )}
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

          {/* Project type tabs */}
          <div className="flex items-center gap-1 mb-5 border-b border-border-primary">
            <ProjectTabBtn active={activeTab === "all"} onClick={() => setActiveTab("all")} icon={<FolderKanban size={13} />}>
              Все
            </ProjectTabBtn>
            <ProjectTabBtn active={activeTab === "banner"} onClick={() => setActiveTab("banner")} icon={<ImageIcon size={13} />}>
              Баннеры
            </ProjectTabBtn>
            <ProjectTabBtn active={activeTab === "photo"} onClick={() => setActiveTab("photo")} icon={<Camera size={13} />}>
              Фото
            </ProjectTabBtn>
            <ProjectTabBtn active={activeTab === "video"} onClick={() => setActiveTab("video")} icon={<Video size={13} />}>
              Видео
            </ProjectTabBtn>
            <ProjectTabBtn active={activeTab === "assets"} onClick={() => setActiveTab("assets")} icon={<ImageLibIcon size={13} />}>
              Ассеты
            </ProjectTabBtn>
          </div>

          {activeTab === "assets" ? (
            <WorkspaceAssetGrid workspaceId={workspaceId} />
          ) : isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin text-text-tertiary" />
            </div>
          ) : filteredProjects.length === 0 ? (
            searchQuery ? (
              <div className="flex flex-col items-center justify-center py-20 text-text-tertiary">
                <Search size={32} className="mb-3 opacity-40" />
                <p className="text-sm">Ничего не найдено по запросу «{searchQuery}»</p>
                <button
                  onClick={() => { setSearchQuery(""); setSearchOpen(false); }}
                  className="mt-2 text-xs text-accent-primary hover:underline cursor-pointer"
                >
                  Сбросить поиск
                </button>
              </div>
            ) : activeTab !== "all" ? (
              <div className="flex flex-col items-center justify-center py-20 text-text-tertiary">
                <FolderKanban size={32} className="mb-3 opacity-40" />
                <p className="text-sm">В этой категории проектов пока нет</p>
                <button
                  onClick={() => setActiveTab("all")}
                  className="mt-2 text-xs text-accent-primary hover:underline cursor-pointer"
                >
                  Показать все
                </button>
              </div>
            ) : (
              <EmptyState onCreateProject={() => setModalOpen(true)} />
            )
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {filteredProjects.map((project) => (
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

function ProjectTabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors cursor-pointer border-b-2 -mb-px ${
        active
          ? "text-text-primary border-accent-primary"
          : "text-text-tertiary hover:text-text-primary border-transparent"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
