"use client";

/**
 * /workflows — список workflow'ов текущего workspace.
 *
 * Показываем и новые graph-workflow'ы, и старые chat/steps workflow'ы,
 * чтобы после перехода на node editor сохранённые записи не выглядели
 * потерянными.
 */

import Link from "next/link";
import { Plus, Loader2, Workflow as WorkflowIcon } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { WorkspaceOnboarding } from "@/components/workspace/WorkspaceOnboarding";

export default function WorkflowsListPage() {
    const { currentWorkspace, needsOnboarding, isLoading: wsLoading } = useWorkspace();

    const workspaceId = currentWorkspace?.id;
    const listQuery = trpc.workflow.list.useQuery(
        { workspaceId: workspaceId ?? "", includeLegacy: true },
        { enabled: Boolean(workspaceId) },
    );

    if (needsOnboarding) {
        return <WorkspaceOnboarding />;
    }

    return (
        <AppShell>
            <TopBar breadcrumbs={[{ label: "Workflows" }]} />
            <div className="flex-1 overflow-y-auto p-6">
                <div className="mx-auto max-w-6xl">
                    <div className="mb-6 flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
                                Workflow&rsquo;ы
                            </h1>
                            <p className="mt-1 text-sm text-neutral-500">
                                Сценарии автоматизации на основе AI-нод
                            </p>
                        </div>
                        <Link href="/workflows/new">
                            <Button>
                                <Plus className="mr-2 h-4 w-4" />
                                Создать workflow
                            </Button>
                        </Link>
                    </div>

                    {wsLoading || listQuery.isLoading ? (
                        <div className="flex items-center justify-center py-24 text-neutral-400">
                            <Loader2 className="h-6 w-6 animate-spin" />
                        </div>
                    ) : listQuery.error ? (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-300">
                            Не удалось загрузить список: {listQuery.error.message}
                        </div>
                    ) : !listQuery.data || listQuery.data.length === 0 ? (
                        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 py-16 text-center dark:border-neutral-700 dark:bg-neutral-900/40">
                            <WorkflowIcon className="mb-4 h-10 w-10 text-neutral-400" />
                            <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
                                Пока нет ни одного workflow&rsquo;а
                            </h2>
                            <p className="mt-2 max-w-sm text-sm text-neutral-500">
                                Создайте первый сценарий, чтобы автоматизировать повторяющиеся задачи.
                            </p>
                            <Link href="/workflows/new" className="mt-6">
                                <Button>
                                    <Plus className="mr-2 h-4 w-4" />
                                    Создать workflow
                                </Button>
                            </Link>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {listQuery.data.map((wf) => {
                                const isLegacy = wf.graph === null;
                                return (
                                    <Link
                                        key={wf.id}
                                        href={`/workflows/${wf.id}`}
                                        className="group flex flex-col rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-400 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-600"
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 group-hover:bg-neutral-200 dark:bg-neutral-800 dark:group-hover:bg-neutral-700">
                                                <WorkflowIcon className="h-5 w-5 text-neutral-600 dark:text-neutral-300" />
                                            </div>
                                            <div className="flex flex-wrap justify-end gap-1.5">
                                                {isLegacy && (
                                                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                                        Старый формат
                                                    </span>
                                                )}
                                                {wf.isTemplate && (
                                                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                                                        Шаблон
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <h3 className="mt-3 truncate text-base font-medium text-neutral-900 dark:text-neutral-100">
                                            {wf.name}
                                        </h3>
                                        <p className="mt-1 line-clamp-2 text-sm text-neutral-500">
                                            {wf.description || (isLegacy
                                                ? "Сохранён в старом AI-chat формате; новый node editor откроет предупреждение."
                                                : "Graph workflow")}
                                        </p>
                                        <div className="mt-4 text-xs text-neutral-400">
                                            {new Date(wf.updatedAt).toLocaleDateString("ru-RU", {
                                                day: "numeric",
                                                month: "short",
                                                year: "numeric",
                                            })}
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </AppShell>
    );
}
