"use client";

import { useState } from "react";
import { Plus, ImageIcon, Type, Camera, Video, Search, HelpCircle } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { ProjectCard } from "@/components/dashboard/ProjectCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { NewProjectModal } from "@/components/dashboard/NewProjectModal";
import { useProjectStore } from "@/store/projectStore";

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
  const projects = useProjectStore((s) => s.projects);

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

          {projects.length === 0 ? (
            <EmptyState onCreateProject={() => setModalOpen(true)} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </div>
      </div>

      <NewProjectModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </AppShell>
  );
}
