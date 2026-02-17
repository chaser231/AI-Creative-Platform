"use client";

import { Sidebar } from "./Sidebar";

interface AppShellProps {
    children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
    return (
        <div className="flex h-screen overflow-hidden bg-bg-primary">
            <Sidebar />
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {children}
            </main>
        </div>
    );
}
