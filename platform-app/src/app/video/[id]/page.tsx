"use client";

import { use } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { VideoWorkspace } from "@/components/video/VideoWorkspace";

interface VideoPageProps {
    params: Promise<{ id: string }>;
}

export default function VideoPage({ params }: VideoPageProps) {
    const { id } = use(params);
    return (
        <AppShell>
            <VideoWorkspace projectId={id} />
        </AppShell>
    );
}
