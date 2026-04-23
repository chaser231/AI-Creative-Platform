"use client";

/**
 * WorkspaceOnboarding
 *
 * Full-screen modal shown when a user has no workspace memberships.
 * Shows all available teams and lets the user join one.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { Users, ShoppingCart, Utensils, Car, Store, Loader2, Check, LogOut } from "lucide-react";
import { useSignOutAndClearState } from "@/hooks/useSignOutAndClearState";

const TEAM_ICONS: Record<string, React.ReactNode> = {
  "yandex-market": <ShoppingCart size={28} />,
  "yandex-food": <Utensils size={28} />,
  "yandex-go": <Car size={28} />,
  "yandex-lavka": <Store size={28} />,
};

const TEAM_GRADIENTS: Record<string, string> = {
  "yandex-market": "from-indigo-500/20 to-purple-500/20",
  "yandex-food": "from-orange-500/20 to-red-500/20",
  "yandex-go": "from-yellow-500/20 to-amber-500/20",
  "yandex-lavka": "from-green-500/20 to-emerald-500/20",
};

const TEAM_ACCENT: Record<string, string> = {
  "yandex-market": "border-indigo-500 ring-indigo-500/30",
  "yandex-food": "border-orange-500 ring-orange-500/30",
  "yandex-go": "border-yellow-500 ring-yellow-500/30",
  "yandex-lavka": "border-green-500 ring-green-500/30",
};

export function WorkspaceOnboarding() {
  const { refetch, setWorkspaceId } = useWorkspace();
  const signOutAndClearState = useSignOutAndClearState();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const allWorkspaces = trpc.workspace.listAll.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const joinMutation = trpc.workspace.join.useMutation({
    onSuccess: () => {
      if (selectedId) {
        setWorkspaceId(selectedId);
      }
      refetch();
      setJoining(false);
    },
    onError: () => {
      setJoining(false);
    },
  });

  const handleJoin = () => {
    if (!selectedId) return;
    setJoining(true);
    joinMutation.mutate({ workspaceId: selectedId });
  };

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-bg-primary/95 backdrop-blur-sm overscroll-contain">
      <div className="min-h-full flex items-center justify-center py-8 px-4">
        <div className="max-w-2xl w-full">
        {/* Header */}
        <div className="text-center mb-6 sm:mb-8">
          <div className="flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-orange-400 via-red-400 to-yellow-400 mx-auto mb-4">
            <span className="text-2xl sm:text-3xl">🔥</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary mb-2">
            Добро пожаловать в AI Creative!
          </h1>
          <p className="text-sm text-text-tertiary max-w-md mx-auto">
            Выберите команду, к которой хотите присоединиться. Вы сможете
            переключаться между командами в любое время.
          </p>
        </div>

        {/* Team cards */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {allWorkspaces.isLoading ? (
            <div className="col-span-2 flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-text-tertiary" />
            </div>
          ) : (
            allWorkspaces.data?.map((ws) => {
              const isSelected = selectedId === ws.id;
              const gradient = TEAM_GRADIENTS[ws.slug] || "from-gray-500/20 to-gray-600/20";
              const accent = TEAM_ACCENT[ws.slug] || "border-gray-500 ring-gray-500/30";
              const icon = TEAM_ICONS[ws.slug] || <Users size={28} />;

              return (
                <button
                  key={ws.id}
                  onClick={() => setSelectedId(ws.id)}
                  className={`relative flex flex-col items-center gap-2 sm:gap-3 p-4 sm:p-6 rounded-[var(--radius-2xl)] border-2 transition-all duration-200 cursor-pointer bg-gradient-to-br ${gradient} ${
                    isSelected
                      ? `${accent} ring-2`
                      : "border-border-primary hover:border-border-secondary"
                  }`}
                >
                  {isSelected && (
                    <div className="absolute top-3 right-3">
                      <Check size={18} className="text-accent-primary" />
                    </div>
                  )}
                  <div className="flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-[var(--radius-xl)] bg-bg-surface/60 text-text-primary">
                    {icon}
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-text-primary">
                      {ws.name}
                    </p>
                    <p className="text-[11px] text-text-tertiary mt-1">
                      {ws.memberCount} {ws.memberCount === 1 ? "участник" : "участников"} · {ws.projectCount} проектов
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Join button */}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={handleJoin}
            disabled={!selectedId || joining}
            className="px-8 py-3 rounded-[var(--radius-xl)] bg-accent-primary text-text-inverse text-sm font-semibold hover:bg-accent-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center gap-2"
          >
            {joining ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Присоединяемся...
              </>
            ) : (
              "Присоединиться к команде"
            )}
          </button>
          <button
            onClick={signOutAndClearState}
            className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-xl)] text-xs text-text-tertiary hover:text-text-primary hover:bg-bg-surface/60 transition-colors cursor-pointer"
          >
            <LogOut size={14} />
            Выйти из аккаунта
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
