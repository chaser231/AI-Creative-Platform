"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { useVideoStore } from "@/store/videoStore";
import { useVideoJobPolling } from "@/hooks/useVideoJobPolling";
import { VideoSidebar } from "./VideoSidebar";
import { VideoSettingsPanel } from "./VideoSettingsPanel";
import { VideoFeed } from "./VideoFeed";
import { VideoPromptBar } from "./VideoPromptBar";
import type { VideoMode } from "@/lib/video-models";

interface VideoWorkspaceProps {
    projectId: string;
}

export function VideoWorkspace({ projectId }: VideoWorkspaceProps) {
    const router = useRouter();
    const projectQuery = trpc.project.getById.useQuery(
        { id: projectId },
        { retry: false, refetchOnWindowFocus: false }
    );
    const activeSessionId = useVideoStore((s) => s.activeSessionId);
    const setActiveSession = useVideoStore((s) => s.setActiveSession);
    const didAutoCreateRef = useRef(false);
    const didRestoreJobsRef = useRef(false);

    useVideoJobPolling(projectId);

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

    // Restore pending jobs after a reload — the polling hook resumes them.
    const jobsQuery = trpc.video.listJobs.useQuery(
        { projectId },
        { enabled: !!projectId, refetchOnWindowFocus: false }
    );
    useEffect(() => {
        if (!jobsQuery.data || didRestoreJobsRef.current) return;
        didRestoreJobsRef.current = true;
        const { addActiveJob } = useVideoStore.getState();
        for (const job of jobsQuery.data) {
            if (job.status !== "QUEUED" && job.status !== "RUNNING") continue;
            addActiveJob({
                id: job.id,
                sessionId: job.sessionId,
                prompt: job.params.prompt ?? "",
                modelId: job.modelId,
                mode: (job.mode === "i2v" ? "i2v" : "t2v") as VideoMode,
                status: job.status,
                aspectRatio: job.params.aspectRatio,
                createdAt: new Date(job.createdAt).getTime(),
            });
        }
    }, [jobsQuery.data]);

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

    // Redirect non-video projects to the right surface
    const projectGoal = (projectQuery.data as { goal?: string } | undefined)?.goal;
    useEffect(() => {
        if (!projectQuery.data || !projectGoal || projectGoal === "video") return;
        router.replace(projectGoal === "photo" ? `/photo/${projectId}` : `/editor/${projectId}`);
    }, [projectQuery.data, projectGoal, projectId, router]);

    // Reset session selection on unmount
    useEffect(() => {
        return () => {
            setActiveSession(null);
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

    const project = projectQuery.data as { id: string; name: string; goal: string | null; workspaceId: string };
    if (project.goal !== "video") {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-text-tertiary" />
            </div>
        );
    }

    return (
        <div className="flex-1 flex min-h-0">
            <VideoSidebar projectId={projectId} projectName={project.name} />
            <VideoSettingsPanel projectId={projectId} />

            <div className="flex-1 flex flex-col min-w-0 relative">
                <VideoFeed projectId={projectId} />
                <div className="absolute bottom-4 inset-x-0 z-20 flex justify-center px-6 pointer-events-none">
                    <div className="w-full max-w-[680px] pointer-events-auto">
                        <VideoPromptBar projectId={projectId} workspaceId={project.workspaceId} />
                    </div>
                </div>
            </div>
        </div>
    );
}
