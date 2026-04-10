"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
    Users, Building2, FolderKanban, LayoutTemplate, Sparkles, DollarSign,
    Search, Shield, ShieldCheck, ChevronDown, MoreHorizontal, ShieldX,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { trpc } from "@/lib/trpc";

/* ─── KPI Card ──────────────────────────────────────── */

function KPICard({ label, value, icon: Icon, color }: {
    label: string;
    value: number | string;
    icon: React.ElementType;
    color: string;
}) {
    return (
        <div className="flex items-center gap-4 p-5 rounded-2xl bg-bg-surface border border-border-primary">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
                <Icon size={20} />
            </div>
            <div>
                <p className="text-2xl font-bold text-text-primary">{value}</p>
                <p className="text-xs text-text-tertiary mt-0.5">{label}</p>
            </div>
        </div>
    );
}

/* ─── Role Badge ──────────────────────────────────────── */

function RoleBadge({ role }: { role: string }) {
    if (role === "SUPER_ADMIN") {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/25 text-amber-500 text-[10px] font-semibold">
                <ShieldCheck size={10} />
                Super Admin
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-bg-secondary border border-border-primary text-text-tertiary text-[10px] font-medium">
            <Shield size={10} />
            User
        </span>
    );
}

/* ─── Cost Analytics Tabs ──────────────────────────────── */

type CostTab = "users" | "models" | "projects" | "workspaces";
type PeriodKey = "today" | "week" | "month" | "year" | "all" | "custom";

function getDateRange(key: PeriodKey): { from?: string; to?: string } {
    const now = new Date();
    const toISO = (d: Date) => d.toISOString().slice(0, 10);
    switch (key) {
        case "today": {
            return { from: toISO(now), to: toISO(now) };
        }
        case "week": {
            const d = new Date(now);
            d.setDate(d.getDate() - 7);
            return { from: toISO(d), to: toISO(now) };
        }
        case "month": {
            const d = new Date(now);
            d.setMonth(d.getMonth() - 1);
            return { from: toISO(d), to: toISO(now) };
        }
        case "year": {
            const d = new Date(now);
            d.setFullYear(d.getFullYear() - 1);
            return { from: toISO(d), to: toISO(now) };
        }
        case "all":
            return {};
        case "custom":
            return {}; // handled externally
    }
}

const PERIOD_LABELS: { id: PeriodKey; label: string }[] = [
    { id: "today", label: "Сегодня" },
    { id: "week", label: "Неделя" },
    { id: "month", label: "Месяц" },
    { id: "year", label: "Год" },
    { id: "all", label: "Всё время" },
    { id: "custom", label: "Произвольный" },
];

function CostAnalyticsSection({ data, period, onPeriodChange, customFrom, customTo, onCustomFromChange, onCustomToChange }: {
    data: {
        byModel: { model: string; count: number; cost: number }[];
        byUser: { id: string; name: string; email: string; count: number; cost: number }[];
        byProject: { id: string; name: string; workspaceName: string; count: number; cost: number }[];
        byWorkspace: { id: string; name: string; count: number; cost: number }[];
    };
    period: PeriodKey;
    onPeriodChange: (p: PeriodKey) => void;
    customFrom: string;
    customTo: string;
    onCustomFromChange: (v: string) => void;
    onCustomToChange: (v: string) => void;
}) {
    const [tab, setTab] = useState<CostTab>("users");

    const tabs: { id: CostTab; label: string }[] = [
        { id: "users", label: "По пользователям" },
        { id: "models", label: "По моделям" },
        { id: "projects", label: "По проектам" },
        { id: "workspaces", label: "По воркспейсам" },
    ];

    // Summary totals
    const totalCost = data.byModel.reduce((sum, m) => sum + m.cost, 0);
    const totalGens = data.byModel.reduce((sum, m) => sum + m.count, 0);

    return (
        <section>
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-text-primary">Аналитика AI-затрат</h2>
                <div className="flex items-center gap-2 text-xs">
                    <span className="text-text-tertiary">Генераций:</span>
                    <span className="font-semibold text-text-primary">{totalGens}</span>
                    <span className="text-text-tertiary ml-2">Затраты:</span>
                    <span className="font-semibold text-green-400">${totalCost.toFixed(2)}</span>
                </div>
            </div>

            {/* Period selector */}
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {PERIOD_LABELS.map(p => (
                    <button
                        key={p.id}
                        onClick={() => onPeriodChange(p.id)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                            period === p.id
                                ? "bg-accent-primary/15 text-accent-primary border border-accent-primary/30"
                                : "bg-bg-secondary text-text-tertiary hover:text-text-primary border border-transparent"
                        }`}
                    >
                        {p.label}
                    </button>
                ))}
                {period === "custom" && (
                    <div className="flex items-center gap-1.5 ml-2">
                        <input
                            type="date"
                            value={customFrom}
                            onChange={e => onCustomFromChange(e.target.value)}
                            className="h-7 px-2 text-[11px] rounded-lg border border-border-primary bg-bg-surface text-text-primary"
                        />
                        <span className="text-text-tertiary text-[11px]">—</span>
                        <input
                            type="date"
                            value={customTo}
                            onChange={e => onCustomToChange(e.target.value)}
                            className="h-7 px-2 text-[11px] rounded-lg border border-border-primary bg-bg-surface text-text-primary"
                        />
                    </div>
                )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-4">
                {tabs.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                            tab === t.id
                                ? "bg-accent-primary text-white"
                                : "bg-bg-secondary text-text-tertiary hover:text-text-primary"
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Table */}
            <div className="bg-bg-surface border border-border-primary rounded-2xl overflow-hidden">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="border-b border-border-primary bg-bg-secondary/50">
                            {tab === "users" && (
                                <>
                                    <th className="text-left px-4 py-3 font-medium text-text-tertiary">Пользователь</th>
                                    <th className="text-left px-4 py-3 font-medium text-text-tertiary">Email</th>
                                    <th className="text-center px-4 py-3 font-medium text-text-tertiary">Генерации</th>
                                    <th className="text-right px-4 py-3 font-medium text-text-tertiary">Затраты ($)</th>
                                </>
                            )}
                            {tab === "models" && (
                                <>
                                    <th className="text-left px-4 py-3 font-medium text-text-tertiary">Модель</th>
                                    <th className="text-center px-4 py-3 font-medium text-text-tertiary">Генерации</th>
                                    <th className="text-right px-4 py-3 font-medium text-text-tertiary">Затраты ($)</th>
                                </>
                            )}
                            {tab === "projects" && (
                                <>
                                    <th className="text-left px-4 py-3 font-medium text-text-tertiary">Проект</th>
                                    <th className="text-left px-4 py-3 font-medium text-text-tertiary">Воркспейс</th>
                                    <th className="text-center px-4 py-3 font-medium text-text-tertiary">Генерации</th>
                                    <th className="text-right px-4 py-3 font-medium text-text-tertiary">Затраты ($)</th>
                                </>
                            )}
                            {tab === "workspaces" && (
                                <>
                                    <th className="text-left px-4 py-3 font-medium text-text-tertiary">Воркспейс</th>
                                    <th className="text-center px-4 py-3 font-medium text-text-tertiary">Генерации</th>
                                    <th className="text-right px-4 py-3 font-medium text-text-tertiary">Затраты ($)</th>
                                </>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {tab === "users" && data.byUser.map(u => (
                            <tr key={u.id} className="border-b border-border-primary/50 hover:bg-bg-secondary/30 transition-colors">
                                <td className="px-4 py-3 font-medium text-text-primary">{u.name}</td>
                                <td className="px-4 py-3 text-text-secondary">{u.email}</td>
                                <td className="px-4 py-3 text-center text-text-secondary">{u.count}</td>
                                <td className="px-4 py-3 text-right font-mono text-text-primary">${u.cost.toFixed(3)}</td>
                            </tr>
                        ))}
                        {tab === "models" && data.byModel.map(m => (
                            <tr key={m.model} className="border-b border-border-primary/50 hover:bg-bg-secondary/30 transition-colors">
                                <td className="px-4 py-3 font-medium text-text-primary">{m.model}</td>
                                <td className="px-4 py-3 text-center text-text-secondary">{m.count}</td>
                                <td className="px-4 py-3 text-right font-mono text-text-primary">${m.cost.toFixed(3)}</td>
                            </tr>
                        ))}
                        {tab === "projects" && data.byProject.map(p => (
                            <tr key={p.id} className="border-b border-border-primary/50 hover:bg-bg-secondary/30 transition-colors">
                                <td className="px-4 py-3 font-medium text-text-primary">{p.name}</td>
                                <td className="px-4 py-3 text-text-tertiary">{p.workspaceName}</td>
                                <td className="px-4 py-3 text-center text-text-secondary">{p.count}</td>
                                <td className="px-4 py-3 text-right font-mono text-text-primary">${p.cost.toFixed(3)}</td>
                            </tr>
                        ))}
                        {tab === "workspaces" && data.byWorkspace.map(w => (
                            <tr key={w.id} className="border-b border-border-primary/50 hover:bg-bg-secondary/30 transition-colors">
                                <td className="px-4 py-3 font-medium text-text-primary">{w.name}</td>
                                <td className="px-4 py-3 text-center text-text-secondary">{w.count}</td>
                                <td className="px-4 py-3 text-right font-mono text-text-primary">${w.cost.toFixed(3)}</td>
                            </tr>
                        ))}
                        {((tab === "users" && data.byUser.length === 0) ||
                          (tab === "models" && data.byModel.length === 0) ||
                          (tab === "projects" && data.byProject.length === 0) ||
                          (tab === "workspaces" && data.byWorkspace.length === 0)) && (
                            <tr>
                                <td colSpan={4} className="px-4 py-8 text-center text-text-tertiary">
                                    Нет данных за выбранный период.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

/* ─── Main Page ──────────────────────────────────────── */

export default function AdminDashboardPage() {
    const router = useRouter();
    const [userSearch, setUserSearch] = useState("");
    const [costPeriod, setCostPeriod] = useState<PeriodKey>("all");
    const [customFrom, setCustomFrom] = useState(() => {
        const d = new Date(); d.setMonth(d.getMonth() - 1);
        return d.toISOString().slice(0, 10);
    });
    const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));

    // Compute date range for cost analytics
    const rawRange = costPeriod === "custom"
        ? { from: customFrom, to: customTo }
        : getDateRange(costPeriod);
    const costDateRange = { dateFrom: rawRange.from, dateTo: rawRange.to };

    // Access guard — must be before any early return
    const { data: me, isLoading: meLoading } = trpc.auth.me.useQuery(undefined, { refetchOnWindowFocus: false });
    const isSuperAdmin = me?.role === "SUPER_ADMIN";

    // ALL hooks must be called unconditionally (React Rules of Hooks)
    const { data: stats, isLoading: statsLoading } = trpc.admin.stats.useQuery(undefined, { enabled: isSuperAdmin });
    const { data: usersData, isLoading: usersLoading } = trpc.admin.users.useQuery({
        search: userSearch || undefined,
        limit: 50,
        offset: 0,
    }, { enabled: isSuperAdmin });
    const { data: workspaces, isLoading: wsLoading } = trpc.admin.workspaces.useQuery(undefined, { enabled: isSuperAdmin });
    const { data: costAnalytics, isLoading: costLoading } = trpc.admin.aiCostAnalytics.useQuery(
        { dateFrom: costDateRange.dateFrom, dateTo: costDateRange.dateTo },
        { enabled: isSuperAdmin }
    );

    const updateRoleMutation = trpc.admin.updateUserRole.useMutation();

    const handleToggleRole = async (userId: string, currentRole: string) => {
        const newRole = currentRole === "SUPER_ADMIN" ? "USER" as const : "SUPER_ADMIN" as const;
        await updateRoleMutation.mutateAsync({ userId, role: newRole });
        window.location.reload();
    };

    // Early returns AFTER all hooks
    if (meLoading) {
        return (
            <AppShell>
                <TopBar breadcrumbs={[{ label: "Админ-панель" }]} showBackToProjects={false} showHistoryNavigation={true} />
                <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm text-text-tertiary">Загрузка...</p>
                </div>
            </AppShell>
        );
    }

    if (!isSuperAdmin) {
        return (
            <AppShell>
                <TopBar breadcrumbs={[{ label: "Админ-панель" }]} showBackToProjects={false} showHistoryNavigation={true} />
                <div className="flex-1 flex flex-col items-center justify-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
                        <ShieldX size={32} className="text-red-400" />
                    </div>
                    <h2 className="text-lg font-semibold text-text-primary">Нет доступа</h2>
                    <p className="text-sm text-text-tertiary max-w-[300px] text-center">
                        Эта страница доступна только супер-администраторам платформы.
                    </p>
                    <Button onClick={() => router.push("/")}>На главную</Button>
                </div>
            </AppShell>
        );
    }

    return (
        <AppShell>
            <TopBar
                breadcrumbs={[{ label: "Админ-панель" }]}
                showBackToProjects={false}
                showHistoryNavigation={true}
            />

            <div className="flex-1 overflow-y-auto">
                <div className="max-w-7xl mx-auto px-6 py-6 space-y-8">
                    {/* Header */}
                    <div>
                        <h1 className="text-2xl font-semibold text-text-primary">Админ-панель</h1>
                        <p className="text-sm text-text-tertiary mt-1">Обзор платформы, пользователи и воркспейсы</p>
                    </div>

                    {/* KPI Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                        <KPICard
                            label="Пользователи"
                            value={statsLoading ? "..." : stats?.totalUsers ?? 0}
                            icon={Users}
                            color="bg-blue-500/15 text-blue-400"
                        />
                        <KPICard
                            label="Воркспейсы"
                            value={statsLoading ? "..." : stats?.totalWorkspaces ?? 0}
                            icon={Building2}
                            color="bg-violet-500/15 text-violet-400"
                        />
                        <KPICard
                            label="Проекты"
                            value={statsLoading ? "..." : stats?.totalProjects ?? 0}
                            icon={FolderKanban}
                            color="bg-emerald-500/15 text-emerald-400"
                        />
                        <KPICard
                            label="Шаблоны"
                            value={statsLoading ? "..." : stats?.totalTemplates ?? 0}
                            icon={LayoutTemplate}
                            color="bg-amber-500/15 text-amber-400"
                        />
                        <KPICard
                            label="AI-генерации"
                            value={statsLoading ? "..." : stats?.totalAIGenerations ?? 0}
                            icon={Sparkles}
                            color="bg-pink-500/15 text-pink-400"
                        />
                        <KPICard
                            label="AI-затраты"
                            value={statsLoading ? "..." : `$${(stats?.totalAICost ?? 0).toFixed(2)}`}
                            icon={DollarSign}
                            color="bg-green-500/15 text-green-400"
                        />
                    </div>

                    {/* Users Table */}
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-text-primary">Пользователи</h2>
                            <div className="relative w-64">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                                <input
                                    type="text"
                                    value={userSearch}
                                    onChange={(e) => setUserSearch(e.target.value)}
                                    placeholder="Поиск по имени или email..."
                                    className="w-full h-9 pl-9 pr-3 text-xs rounded-xl border border-border-primary bg-bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/20 transition-all"
                                />
                            </div>
                        </div>

                        <div className="bg-bg-surface border border-border-primary rounded-2xl overflow-hidden">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-border-primary bg-bg-secondary/50">
                                        <th className="text-left px-4 py-3 font-medium text-text-tertiary">Имя</th>
                                        <th className="text-left px-4 py-3 font-medium text-text-tertiary">Email</th>
                                        <th className="text-left px-4 py-3 font-medium text-text-tertiary">Роль</th>
                                        <th className="text-center px-4 py-3 font-medium text-text-tertiary">Воркспейсы</th>
                                        <th className="text-center px-4 py-3 font-medium text-text-tertiary">Проекты</th>
                                        <th className="text-center px-4 py-3 font-medium text-text-tertiary">AI-генерации</th>
                                        <th className="text-right px-4 py-3 font-medium text-text-tertiary">AI-затраты</th>
                                        <th className="text-right px-4 py-3 font-medium text-text-tertiary">Создан</th>
                                        <th className="w-10"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {usersLoading ? (
                                        <tr><td colSpan={9} className="px-4 py-8 text-center text-text-tertiary">Загрузка...</td></tr>
                                    ) : usersData?.users.map((user) => (
                                        <tr key={user.id} className="border-b border-border-primary/50 hover:bg-bg-secondary/30 transition-colors">
                                            <td className="px-4 py-3 font-medium text-text-primary">{user.name}</td>
                                            <td className="px-4 py-3 text-text-secondary">{user.email}</td>
                                            <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
                                            <td className="px-4 py-3 text-center text-text-secondary">{user._count.memberships}</td>
                                            <td className="px-4 py-3 text-center text-text-secondary">{user._count.projects}</td>
                                            <td className="px-4 py-3 text-center text-text-secondary">{user.aiGenerations}</td>
                                            <td className="px-4 py-3 text-right font-mono text-text-secondary">
                                                {user.aiCost > 0 ? `$${user.aiCost.toFixed(3)}` : "—"}
                                            </td>
                                            <td className="px-4 py-3 text-right text-text-tertiary">
                                                {new Date(user.createdAt).toLocaleDateString("ru-RU")}
                                            </td>
                                            <td className="px-2 py-3">
                                                {user.id === me?.id ? (
                                                    <span className="text-[10px] text-text-tertiary px-1.5" title="Это вы">Вы</span>
                                                ) : (
                                                    <button
                                                        onClick={() => handleToggleRole(user.id, user.role)}
                                                        className="p-1.5 rounded-lg hover:bg-bg-secondary text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                                                        title={user.role === "SUPER_ADMIN" ? "Понизить до User" : "Повысить до Super Admin"}
                                                    >
                                                        <MoreHorizontal size={14} />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {usersData && (
                                <div className="px-4 py-2 text-[10px] text-text-tertiary border-t border-border-primary/50">
                                    Показано {usersData.users.length} из {usersData.total}
                                </div>
                            )}
                        </div>
                    </section>

                    {/* Cost Analytics Section */}
                    {!costLoading && costAnalytics && (
                        <CostAnalyticsSection
                            data={costAnalytics}
                            period={costPeriod}
                            onPeriodChange={setCostPeriod}
                            customFrom={customFrom}
                            customTo={customTo}
                            onCustomFromChange={setCustomFrom}
                            onCustomToChange={setCustomTo}
                        />
                    )}

                    {/* Workspaces Table */}
                    <section>
                        <h2 className="text-lg font-semibold text-text-primary mb-4">Воркспейсы</h2>

                        <div className="bg-bg-surface border border-border-primary rounded-2xl overflow-hidden">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-border-primary bg-bg-secondary/50">
                                        <th className="text-left px-4 py-3 font-medium text-text-tertiary">Название</th>
                                        <th className="text-left px-4 py-3 font-medium text-text-tertiary">Slug</th>
                                        <th className="text-left px-4 py-3 font-medium text-text-tertiary">BU</th>
                                        <th className="text-center px-4 py-3 font-medium text-text-tertiary">Участники</th>
                                        <th className="text-center px-4 py-3 font-medium text-text-tertiary">Проекты</th>
                                        <th className="text-center px-4 py-3 font-medium text-text-tertiary">Шаблоны</th>
                                        <th className="text-right px-4 py-3 font-medium text-text-tertiary">Создан</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {wsLoading ? (
                                        <tr><td colSpan={7} className="px-4 py-8 text-center text-text-tertiary">Загрузка...</td></tr>
                                    ) : workspaces?.map((ws) => (
                                        <tr key={ws.id} className="border-b border-border-primary/50 hover:bg-bg-secondary/30 transition-colors">
                                            <td className="px-4 py-3 font-medium text-text-primary">{ws.name}</td>
                                            <td className="px-4 py-3 text-text-tertiary font-mono text-[10px]">{ws.slug}</td>
                                            <td className="px-4 py-3">
                                                <span className="px-2 py-0.5 rounded-md bg-bg-secondary border border-border-primary text-[10px] text-text-secondary">
                                                    {ws.businessUnit}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center text-text-secondary">{ws._count.members}</td>
                                            <td className="px-4 py-3 text-center text-text-secondary">{ws._count.projects}</td>
                                            <td className="px-4 py-3 text-center text-text-secondary">{ws._count.templates}</td>
                                            <td className="px-4 py-3 text-right text-text-tertiary">
                                                {new Date(ws.createdAt).toLocaleDateString("ru-RU")}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>
            </div>
        </AppShell>
    );
}
