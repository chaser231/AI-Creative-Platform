import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { Project, ProjectGoal, BusinessUnit, ResizeFormat } from "@/types";

const DEFAULT_RESIZES: ResizeFormat[] = [
    { id: "master", name: "Master", width: 1080, height: 1080, label: "1080 × 1080", instancesEnabled: false },
];

interface ProjectStore {
    projects: Project[];
    activeProjectId: string | null;

    createProject: (data: {
        name: string;
        businessUnit: BusinessUnit;
        goal: ProjectGoal;
    }) => Project;
    deleteProject: (id: string) => void;
    setActiveProject: (id: string | null) => void;
    updateProjectStatus: (id: string, status: Project["status"]) => void;
    updateProject: (id: string, updates: Partial<Omit<Project, "id" | "createdAt">>) => void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
    projects: [],
    activeProjectId: null,

    createProject: (data) => {
        const project: Project = {
            id: uuid(),
            name: data.name,
            businessUnit: data.businessUnit,
            goal: data.goal,
            status: "draft",
            createdAt: new Date(),
            updatedAt: new Date(),
            resizes: [...DEFAULT_RESIZES],
            activeResizeId: "master",
        };
        set((state) => ({ projects: [...state.projects, project] }));
        return project;
    },

    deleteProject: (id) => {
        set((state) => ({
            projects: state.projects.filter((p) => p.id !== id),
            activeProjectId:
                state.activeProjectId === id ? null : state.activeProjectId,
        }));
    },

    setActiveProject: (id) => {
        set({ activeProjectId: id });
    },

    updateProjectStatus: (id, status) => {
        set((state) => ({
            projects: state.projects.map((p) =>
                p.id === id ? { ...p, status, updatedAt: new Date() } : p
            ),
        }));
    },

    updateProject: (id, updates) => {
        set((state) => ({
            projects: state.projects.map((p) =>
                p.id === id ? { ...p, ...updates, updatedAt: new Date() } : p
            ),
        }));
    },
}));
