"use client";

import { use } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PhotoWorkspace } from "@/components/photo/PhotoWorkspace";

interface PhotoPageProps {
    params: Promise<{ id: string }>;
}

export default function PhotoPage({ params }: PhotoPageProps) {
    const { id } = use(params);
    return (
        <AppShell>
            <PhotoWorkspace projectId={id} />
        </AppShell>
    );
}
