"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { signOut } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import {
  User, Mail, Camera, Shield, Sun, Moon, Monitor,
  Sparkles, BarChart3, Zap, LogOut, Loader2, Check,
  Building2, Crown, ChevronRight,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { trpc } from "@/lib/trpc";
import { useThemeStore, type ThemeMode } from "@/store/themeStore";
import { useWorkspace } from "@/providers/WorkspaceProvider";

const themeOptions: { id: ThemeMode; label: string; icon: React.ReactNode; description: string }[] = [
  { id: "light", label: "Светлая", icon: <Sun size={18} />, description: "Кремовая палитра" },
  { id: "dark", label: "Тёмная", icon: <Moon size={18} />, description: "Для работы ночью" },
  { id: "system", label: "Системная", icon: <Monitor size={18} />, description: "Следует ОС" },
];

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Администратор",
  CREATOR: "Создатель",
  USER: "Пользователь",
  VIEWER: "Наблюдатель",
};

const PROVIDER_LABELS: Record<string, string> = {
  yandex: "Яндекс ID",
  google: "Google",
  github: "GitHub",
  credentials: "Email / пароль",
};

export default function ProfileSettingsPage() {
  const { theme, setTheme } = useThemeStore();
  const { setWorkspaceId } = useWorkspace();

  // Fetch user data
  const meQuery = trpc.auth.me.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const statsQuery = trpc.auth.myStats.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const updateProfileMutation = trpc.auth.updateProfile.useMutation({
    onSuccess: () => {
      meQuery.refetch();
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
  });

  // Local state
  const [name, setName] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hydration guard for theme
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(t);
  }, []);

  // Populate name from server
  useEffect(() => {
    if (meQuery.data?.name) {
      setName(meQuery.data.name);
    }
  }, [meQuery.data?.name]);

  const currentTheme = mounted ? theme : undefined;
  const user = meQuery.data;
  const stats = statsQuery.data;
  const providers = user?.accounts?.map((a: { provider: string }) => a.provider) ?? [];

  // Save name
  const handleSaveName = useCallback(() => {
    if (!name.trim() || name === user?.name) return;
    setSaveStatus("saving");
    updateProfileMutation.mutate({ name: name.trim() });
  }, [name, user?.name, updateProfileMutation]);

  // Avatar upload
  const handleAvatarUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarUploading(true);
    try {
      // Read file as base64 data URL
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Upload to S3 via the existing upload API (expects JSON with base64)
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64,
          mimeType: file.type || "image/png",
          projectId: "avatars",
        }),
      });

      if (!res.ok) throw new Error("Upload failed");

      const data = await res.json();
      if (data.url) {
        updateProfileMutation.mutate({ avatarUrl: data.url });
      }
    } catch (err) {
      console.error("Avatar upload failed:", err);
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [updateProfileMutation]);

  return (
    <AppShell>
      <TopBar
        breadcrumbs={[{ label: "Настройки" }, { label: "Профиль" }]}
        showBackToProjects={false}
        showHistoryNavigation={true}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-10">

          {/* ═══════════════════════════════════════════════ */}
          {/* AVATAR + NAME HERO */}
          {/* ═══════════════════════════════════════════════ */}
          <section className="flex items-center gap-6">
            {/* Avatar */}
            <div className="relative group shrink-0">
              <div className="w-20 h-20 rounded-full overflow-hidden bg-bg-tertiary border-2 border-border-primary shadow-[var(--shadow-sm)]">
                {user?.avatarUrl ? (
                  <Image
                    src={user.avatarUrl}
                    alt={user.name || "Avatar"}
                    width={80}
                    height={80}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-accent-primary/20 to-accent-primary/10">
                    <User size={32} className="text-accent-primary/60" />
                  </div>
                )}
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarUploading}
                className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-all cursor-pointer"
              >
                <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                  {avatarUploading ? (
                    <Loader2 size={20} className="text-white animate-spin" />
                  ) : (
                    <Camera size={20} className="text-white" />
                  )}
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                className="hidden"
              />
            </div>

            {/* Name + email quick view */}
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-light text-text-primary truncate">
                {user?.name || "Загрузка..."}
              </h1>
              <p className="text-sm text-text-tertiary truncate mt-0.5">
                {user?.email}
              </p>
              {providers.length > 0 && (
                <div className="flex items-center gap-1.5 mt-2">
                  <Shield size={12} className="text-text-tertiary" />
                  <span className="text-[11px] text-text-tertiary">
                    {providers.map((p: string) => PROVIDER_LABELS[p] || p).join(", ")}
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* ═══════════════════════════════════════════════ */}
          {/* PERSONAL DATA */}
          {/* ═══════════════════════════════════════════════ */}
          <section>
            <h2 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
              <User size={16} className="text-text-tertiary" />
              Личные данные
            </h2>
            <div className="space-y-4 p-5 rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface">
              {/* Name */}
              <div>
                <label className="text-xs text-text-secondary mb-1.5 block">Имя</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveName(); }}
                    className="flex-1 px-3 py-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-primary text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary/50 focus:ring-1 focus:ring-accent-primary/20 outline-none transition-all"
                    placeholder="Ваше имя"
                  />
                  <Button
                    size="sm"
                    onClick={handleSaveName}
                    disabled={!name.trim() || name === user?.name || saveStatus === "saving"}
                    icon={saveStatus === "saved" ? <Check size={14} /> : saveStatus === "saving" ? <Loader2 size={14} className="animate-spin" /> : undefined}
                  >
                    {saveStatus === "saved" ? "Сохранено" : "Сохранить"}
                  </Button>
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="text-xs text-text-secondary mb-1.5 block">Email</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-tertiary text-sm text-text-secondary cursor-not-allowed">
                    {user?.email || "—"}
                  </div>
                  <Mail size={16} className="text-text-tertiary shrink-0" />
                </div>
                <p className="text-[11px] text-text-tertiary mt-1">
                  Email привязан к аккаунту {providers.map((p: string) => PROVIDER_LABELS[p] || p).join(", ")}
                </p>
              </div>
            </div>
          </section>

          {/* ═══════════════════════════════════════════════ */}
          {/* AI STATS */}
          {/* ═══════════════════════════════════════════════ */}
          <section>
            <h2 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
              <Sparkles size={16} className="text-text-tertiary" />
              Моя AI-статистика
            </h2>

            {statsQuery.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-text-tertiary" />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Stat cards */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-[var(--radius-md)] bg-violet-100 dark:bg-violet-500/20 flex items-center justify-center">
                        <Zap size={16} className="text-violet-600 dark:text-violet-400" />
                      </div>
                      <span className="text-xs text-text-tertiary">Генерации</span>
                    </div>
                    <p className="text-2xl font-light text-text-primary">
                      {stats?.totalGenerations ?? 0}
                    </p>
                  </div>
                  <div className="p-4 rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-[var(--radius-md)] bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center">
                        <BarChart3 size={16} className="text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <span className="text-xs text-text-tertiary">Затраты</span>
                    </div>
                    <p className="text-2xl font-light text-text-primary">
                      ${(stats?.totalCost ?? 0).toFixed(2)}
                    </p>
                  </div>
                </div>

                {/* Top models */}
                {stats?.topModels && stats.topModels.length > 0 && (
                  <div className="p-4 rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface">
                    <p className="text-xs text-text-tertiary mb-3">Используемые модели</p>
                    <div className="space-y-2.5">
                      {stats.topModels.map((model: { name: string; count: number; cost: number }, i: number) => {
                        const maxCount = stats.topModels[0]?.count || 1;
                        const pct = Math.round((model.count / maxCount) * 100);
                        return (
                          <div key={model.name}>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="text-text-primary font-medium truncate mr-2">{model.name}</span>
                              <span className="text-text-tertiary whitespace-nowrap">
                                {model.count} · ${model.cost.toFixed(2)}
                              </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-accent-primary/60 to-accent-primary transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ═══════════════════════════════════════════════ */}
          {/* THEME */}
          {/* ═══════════════════════════════════════════════ */}
          <section>
            <h2 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
              <Sun size={16} className="text-text-tertiary" />
              Тема оформления
            </h2>
            <div className="grid grid-cols-3 gap-3">
              {themeOptions.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setTheme(option.id)}
                  className={`
                    flex flex-col items-center gap-2.5 p-4 rounded-[var(--radius-xl)] border transition-all cursor-pointer
                    ${currentTheme === option.id
                      ? "bg-bg-tertiary border-accent-primary shadow-[var(--shadow-md)]"
                      : "bg-bg-surface border-border-primary hover:border-border-secondary hover:shadow-[var(--shadow-sm)]"
                    }
                  `}
                >
                  <span className={currentTheme === option.id ? "text-accent-primary" : "text-text-secondary"}>
                    {option.icon}
                  </span>
                  <div className="text-center">
                    <p className={`text-xs font-medium ${currentTheme === option.id ? "text-text-primary" : "text-text-secondary"}`}>
                      {option.label}
                    </p>
                    <p className="text-[10px] text-text-tertiary mt-0.5">
                      {option.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* ═══════════════════════════════════════════════ */}
          {/* WORKSPACES */}
          {/* ═══════════════════════════════════════════════ */}
          <section>
            <h2 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
              <Building2 size={16} className="text-text-tertiary" />
              Мои воркспейсы
            </h2>
            <div className="space-y-2">
              {user?.memberships?.map((m: { id: string; role: string; workspace: { id: string; name: string; slug: string; businessUnit: string; logoUrl: string | null } }) => (
                <button
                  key={m.id}
                  onClick={() => setWorkspaceId(m.workspace.id)}
                  className="w-full flex items-center gap-3 p-4 rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface hover:bg-bg-secondary hover:border-border-secondary transition-all cursor-pointer group text-left"
                >
                  <div className="w-10 h-10 rounded-[var(--radius-md)] bg-gradient-to-br from-accent-primary/15 to-accent-primary/5 flex items-center justify-center shrink-0 text-accent-primary font-semibold text-sm">
                    {m.workspace.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{m.workspace.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {m.role === "ADMIN" && <Crown size={10} className="text-amber-500" />}
                      <span className="text-[11px] text-text-tertiary">
                        {ROLE_LABELS[m.role] || m.role}
                      </span>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              )) ?? (
                <div className="flex items-center justify-center py-6 text-text-tertiary text-sm">
                  <Loader2 size={16} className="animate-spin mr-2" />
                  Загрузка...
                </div>
              )}
            </div>
          </section>

          {/* ═══════════════════════════════════════════════ */}
          {/* SIGN OUT */}
          {/* ═══════════════════════════════════════════════ */}
          <section className="pb-8">
            <button
              onClick={() => signOut({ callbackUrl: "/auth/signin" })}
              className="flex items-center gap-2.5 px-5 py-3 rounded-[var(--radius-xl)] border border-red-200 dark:border-red-900/30 bg-red-50/50 dark:bg-red-950/20 hover:bg-red-100/80 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400 text-sm font-medium transition-all cursor-pointer"
            >
              <LogOut size={16} />
              Выйти из аккаунта
            </button>
          </section>

        </div>
      </div>
    </AppShell>
  );
}
