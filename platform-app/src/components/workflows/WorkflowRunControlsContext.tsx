"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface WorkflowRunControlsContextValue {
    runNode: (nodeId: string) => void | Promise<void>;
    runNodeWithCachedInputs: (nodeId: string) => void | Promise<void>;
    getNodeRunDisabledReason: (nodeId: string) => string | undefined;
    getNodeCachedRunDisabledReason: (nodeId: string) => string | undefined;
    isRunning: boolean;
}

const WorkflowRunControlsContext =
    createContext<WorkflowRunControlsContextValue | null>(null);

export function WorkflowRunControlsProvider({
    value,
    children,
}: {
    value: WorkflowRunControlsContextValue;
    children: ReactNode;
}) {
    return (
        <WorkflowRunControlsContext.Provider value={value}>
            {children}
        </WorkflowRunControlsContext.Provider>
    );
}

export function useWorkflowRunControls() {
    return useContext(WorkflowRunControlsContext);
}
