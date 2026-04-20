"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { usePhotoStore } from "@/store/photoStore";
import { PhotoSidebar } from "./PhotoSidebar";
import { PhotoChatView } from "./PhotoChatView";
import { PhotoPromptBar } from "./PhotoPromptBar";
import { PhotoLibraryPanel } from "./PhotoLibraryPanel";

interface PhotoWorkspaceProps {
    projectId: string;
}

export function PhotoWorkspace({ projectId }: PhotoWorkspaceProps) {
    const router = useRouter();
    const projectQuery = trpc.project.getById.useQuery(
        { id: projectId },
        { retry: false, refetchOnWindowFocus: false }
    );
    const libraryOpen = usePhotoStore((s) => s.libraryOpen);
    const activeSessionId = usePhotoStore((s) => s.activeSessionId);
    const setActiveSession = usePhotoStore((s) => s.setActiveSession);
    // Guard against Strict-Mode double-invoke + slow network: only create one default session per mount.
    const didAutoCreateRef = useRef(false);

    const sessionsQuery = trpc.ai.listSessions.useQuery(
        { projectId },
        { enabled: !!projectId, refetchOnWindowFocus: false }
    );

    const { mutate: createSession, isPending: isCreatingSession } = trpc.ai.createSession.useMutation({
        onSuccess: (s) => {
            setActiveSession(s.id);
            sessionsQuery.refetch();
        },
    });

    // Auto-select the first available session, or auto-create one if none exist
    useEffect(() => {
        if (!sessionsQuery.data) return;
        const sessions = sessionsQuery.data as Array<{ id: string }>;
        if (activeSessionId && sessions.some((s) => s.id === activeSessionId)) return;
        if (sessions.length > 0) {
            setActiveSession(sessions[0].id);
            return;
        }
        if (!didAutoCreateRef.current && !isCreatingSession) {
            didAutoCreateRef.current = true;
            createSession({ projectId });
        }
    }, [sessionsQuery.data, activeSessionId, projectId, setActiveSession, createSession, isCreatingSession]);

    // Redirect non-photo projects to the banner editor (done in effect, not render)
    const projectGoal = (projectQuery.data as { goal?: string } | undefined)?.goal;
    useEffect(() => {
        if (projectQuery.data && projectGoal && projectGoal !== "photo") {
            router.replace(`/editor/${projectId}`);
        }
    }, [projectQuery.data, projectGoal, projectId, router]);

    // Reset active session when unmounting
    useEffect(() => {
        return () => {
            setActiveSession(null);
            usePhotoStore.getState().clearEditContext();
            usePhotoStore.getState().setLibraryOpen(false);
        };
    }, [setActiveSession]);

    if (projectQuery.isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 size={24} className="animate-spin text-text-tertiary" />
            </div>
        );
    }

    if (projectQuery.error || !projectQuery.data) {
        return (
            <div className="flex-1 flex items-center justify-center p-6">
                <div className="max-w-md text-center space-y-3">
                    <AlertTriangle size={32} className="mx-auto text-amber-500" />
                    <p className="text-sm text-text-secondary">Проект не найден или у вас нет к нему доступа.</p>
                    <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-accent-primary hover:underline">
                        <ArrowLeft size={12} /> К проектам
                    </Link>
                </div>
            </div>
        );
    }

    const project = projectQuery.data as { id: string; name: string; goal: string | null };
    if (project.goal !== "photo") {
        // Redirect is handled in a useEffect; render a lightweight fallback while it takes effect.
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-text-tertiary" />
            </div>
        );
    }

    return (
        <div className="flex-1 flex min-h-0">
            <PhotoSidebar projectId={projectId} projectName={project.name} />

            <div className="flex-1 flex min-w-0">
                <div className="flex-1 flex flex-col min-w-0 relative">
                    <PhotoChatView projectId={projectId} />
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
                        <PhotoPromptBar projectId={projectId} />
                    </div>
                </div>

                {libraryOpen && (
                    <aside className="w-[360px] shrink-0 border-l border-border-primary bg-bg-surface flex flex-col min-h-0">
                        <PhotoLibraryPanel projectId={projectId} />
                    </aside>
                )}
            </div>
        </div>
    );
}
