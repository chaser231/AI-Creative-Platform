"use client";

import { Sidebar } from "./Sidebar";

interface AppShellProps {
    children: React.ReactNode;
    /** Скрыть глобальный сайдбар — для полноэкранных workspace (видео, редактор). */
    hideSidebar?: boolean;
}

export function AppShell({ children, hideSidebar }: AppShellProps) {
    return (
        <div className="flex h-screen overflow-hidden bg-bg-primary">
            {!hideSidebar && <Sidebar />}
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {children}
            </main>
        </div>
    );
}
