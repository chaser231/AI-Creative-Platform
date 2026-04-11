"use client";

/**
 * /settings/workspace — Comprehensive Workspace Settings
 *
 * Sections:
 * 1. Hero: Logo + name + slug
 * 2. General: Name, slug, BU
 * 3. Members: Team list (migrated from /team), roles, invite
 * 4. Access: Visibility, joinPolicy, invite link, join requests
 * 5. Stats: Projects, generations, cost, formats
 * 6. Leave workspace (with admin reassignment)
 * 7. Delete workspace (danger zone)
 *
 * Access: ADMIN/CREATOR see all sections. Others see stats + leave.
 */

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import {
  Globe, Lock, Users, Check, X, Loader2, Copy, Trash2, ShieldAlert,
  Clock, Camera, Crown, Paintbrush, Eye, UserIcon, ChevronDown,
  Link2, FolderKanban, Sparkles, DollarSign, LayoutTemplate,
  LogOut, AlertTriangle, Layers,
} from "lucide-react";
import { Select } from "@/components/ui/Select";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ExtendedWorkspace {
  id: string;
  name: string;
  slug: string;
  businessUnit: string;
  visibility: "VISIBLE" | "HIDDEN";
  joinPolicy: "OPEN" | "REQUEST" | "INVITE_ONLY";
  logoUrl?: string | null;
}

interface JoinRequest {
  id: string;
  message: string | null;
  user: { id: string; name: string; email: string; avatarUrl: string | null };
}

interface Member {
  id: string;
  role: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────

const BU_OPTIONS = [
  { value: "yandex-market", label: "Яндекс Маркет" },
  { value: "yandex-go", label: "Яндекс Go" },
  { value: "yandex-food", label: "Яндекс Еда" },
  { value: "yandex-lavka", label: "Яндекс Лавка" },
  { value: "yandex-travel", label: "Яндекс Путешествия" },
  { value: "other", label: "Другое" },
];

interface RoleInfo {
  label: string;
  icon: React.ReactNode;
  color: string;
}

const ROLE_LABELS: Record<string, RoleInfo> = {
  ADMIN: { label: "Администратор", icon: <Crown size={14} />, color: "text-amber-400 bg-amber-500/10" },
  CREATOR: { label: "Создатель", icon: <Paintbrush size={14} />, color: "text-blue-400 bg-blue-500/10" },
  USER: { label: "Участник", icon: <UserIcon size={14} />, color: "text-green-400 bg-green-500/10" },
  VIEWER: { label: "Зритель", icon: <Eye size={14} />, color: "text-gray-400 bg-gray-500/10" },
};

const ROLES = ["ADMIN", "CREATOR", "USER", "VIEWER"] as const;

// ─── Component ──────────────────────────────────────────────────────────────

export default function WorkspaceSettingsPage() {
  const router = useRouter();
  const { currentWorkspace, refetch, isAdmin, currentRole } = useWorkspace();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canManage = currentRole === "ADMIN" || currentRole === "CREATOR";

  // ─── Form state ────────────────────────────────────────
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [businessUnit, setBusinessUnit] = useState("other");
  const [visibility, setVisibility] = useState<"VISIBLE" | "HIDDEN">("VISIBLE");
  const [joinPolicy, setJoinPolicy] = useState<"OPEN" | "REQUEST" | "INVITE_ONLY">("OPEN");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [newAdminId, setNewAdminId] = useState<string>("");
  const [roleDropdownId, setRoleDropdownId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // ─── Load current values ───────────────────────────────
  useEffect(() => {
    if (currentWorkspace) {
      setName(currentWorkspace.name);
      const ws = currentWorkspace as unknown as ExtendedWorkspace;
      setSlug(ws.slug || "");
      setBusinessUnit(ws.businessUnit || "other");
      setVisibility(ws.visibility || "VISIBLE");
      setJoinPolicy(ws.joinPolicy || "OPEN");
      setLogoUrl(ws.logoUrl || null);
    }
  }, [currentWorkspace]);

  // ─── Queries ───────────────────────────────────────────
  const membersQuery = trpc.workspace.listMembers.useQuery(
    { workspaceId: currentWorkspace?.id ?? "" },
    { enabled: !!currentWorkspace?.id, refetchOnWindowFocus: false }
  );
  const members = (membersQuery.data ?? []) as Member[];

  const joinRequestsQuery = trpc.workspace.listJoinRequests.useQuery(
    { workspaceId: currentWorkspace?.id ?? "" },
    { enabled: !!currentWorkspace?.id && isAdmin }
  );
  const joinRequests = joinRequestsQuery.data ?? [];

  const statsQuery = trpc.workspace.stats.useQuery(
    { workspaceId: currentWorkspace?.id ?? "" },
    { enabled: !!currentWorkspace?.id, refetchOnWindowFocus: false }
  );
  const stats = statsQuery.data;

  // ─── Fetch current user to identify self ───────────────
  const meQuery = trpc.auth.me.useQuery(undefined, { refetchOnWindowFocus: false });
  const myUserId = meQuery.data?.id;

  // ─── Mutations ─────────────────────────────────────────
  const updateMutation = trpc.workspace.update.useMutation({
    onSuccess: () => {
      refetch();
      utils.workspace.list.invalidate();
      showToast("Сохранено");
    },
  });

  const deleteMutation = trpc.workspace.delete.useMutation({
    onSuccess: () => {
      refetch();
      router.push("/");
    },
  });

  const leaveMutation = trpc.workspace.leave.useMutation({
    onSuccess: (data) => {
      refetch();
      if (data.workspaceDeleted) {
        router.push("/");
      } else {
        router.push("/");
      }
    },
    onError: (err) => showToast(err.message),
  });

  const updateRoleMutation = trpc.workspace.updateMemberRole.useMutation({
    onSuccess: () => {
      membersQuery.refetch();
      setRoleDropdownId(null);
    },
    onError: (err: { message: string }) => showToast(err.message),
  });

  const removeMemberMutation = trpc.workspace.removeMember.useMutation({
    onSuccess: () => membersQuery.refetch(),
    onError: (err: { message: string }) => showToast(err.message),
  });

  const handleRequestMutation = trpc.workspace.handleJoinRequest.useMutation({
    onSuccess: () => {
      joinRequestsQuery.refetch();
      membersQuery.refetch();
    },
  });

  // ─── Handlers ──────────────────────────────────────────
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleSave = () => {
    if (!currentWorkspace) return;
    updateMutation.mutate({
      workspaceId: currentWorkspace.id,
      name: name.trim(),
      slug: slug.trim(),
      businessUnit,
      visibility,
      joinPolicy,
      logoUrl,
    });
  };

  const handleCopyInvite = () => {
    if (!slug) return;
    const url = `${window.location.origin}/invite/${slug}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = () => {
    if (!currentWorkspace || deleteInput !== currentWorkspace.name) return;
    deleteMutation.mutate({ workspaceId: currentWorkspace.id });
  };

  const handleLeave = () => {
    if (!currentWorkspace) return;
    leaveMutation.mutate({
      workspaceId: currentWorkspace.id,
      newAdminId: newAdminId || undefined,
    });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentWorkspace) return;
    setUploading(true);
    try {
      // Read file as base64 data URL
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64,
          mimeType: file.type || "image/png",
          projectId: "workspace-logos",
        }),
      });

      if (!res.ok) throw new Error("Upload failed");

      const data = await res.json();
      if (data.url) {
        setLogoUrl(data.url);
        // Auto-save logo immediately
        updateMutation.mutate({
          workspaceId: currentWorkspace.id,
          logoUrl: data.url,
        });
      }
    } catch {
      showToast("Ошибка загрузки");
    } finally {
      setUploading(false);
    }
  };

  const handleRoleChange = (memberId: string, role: string) => {
    if (!currentWorkspace) return;
    updateRoleMutation.mutate({
      workspaceId: currentWorkspace.id,
      memberId,
      role: role as "ADMIN" | "CREATOR" | "USER" | "VIEWER",
    });
  };

  const handleRemoveMember = (memberId: string, memberName: string) => {
    if (!currentWorkspace) return;
    if (!confirm(`Удалить ${memberName} из команды?`)) return;
    removeMemberMutation.mutate({
      workspaceId: currentWorkspace.id,
      memberId,
    });
  };

  // Check if current user is the only admin (for leave logic)
  const adminCount = members.filter(m => m.role === "ADMIN").length;
  const isOnlyAdmin = isAdmin && adminCount <= 1;
  const nonAdminMembers = members.filter(m => m.role !== "ADMIN" && m.user.id !== myUserId);

  // ─── Loading / Access ──────────────────────────────────
  if (!currentWorkspace) {
    return (
      <AppShell>
        <TopBar breadcrumbs={[{ label: "Настройки" }, { label: "Воркспейс" }]} showBackToProjects={false} showHistoryNavigation={true} />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-text-tertiary" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <TopBar breadcrumbs={[{ label: "Настройки" }, { label: "Воркспейс" }]} showBackToProjects={false} showHistoryNavigation={true} />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-10">

          {/* ═══════════════════════════════════════════════ */}
          {/* HERO */}
          {/* ═══════════════════════════════════════════════ */}
          <div className="flex items-center gap-5">
            {/* Logo */}
            <div
              className="relative w-16 h-16 rounded-[var(--radius-xl)] bg-gradient-to-br from-accent-primary/20 to-accent-primary/5 flex items-center justify-center overflow-hidden group shrink-0 border border-border-primary cursor-pointer"
              onClick={() => canManage && fileInputRef.current?.click()}
            >
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-accent-primary">
                  {currentWorkspace.name.charAt(0).toUpperCase()}
                </span>
              )}
              {canManage && (
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  {uploading ? (
                    <Loader2 size={18} className="text-white animate-spin" />
                  ) : (
                    <Camera size={18} className="text-white" />
                  )}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoUpload}
              />
            </div>
            <div>
              <h1 className="text-2xl font-light text-text-primary">{currentWorkspace.name}</h1>
              <p className="text-xs text-text-tertiary mt-0.5">/{(currentWorkspace as unknown as ExtendedWorkspace).slug || "..."}</p>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════ */}
          {/* GENERAL — admin/creator only */}
          {/* ═══════════════════════════════════════════════ */}
          {canManage && (
            <section>
              <h2 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
                <FolderKanban size={16} className="text-text-tertiary" />
                Основные данные
              </h2>
              <div className="space-y-4 bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] p-5">
                <div>
                  <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Название</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full h-10 px-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">URL-идентификатор</label>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-text-tertiary shrink-0">/invite/</span>
                    <input
                      type="text"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value.replace(/[^a-z0-9-]/g, ""))}
                      className="flex-1 h-10 px-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-sm text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-border-focus"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Бизнес-юнит</label>
                  <Select
                    value={businessUnit}
                    onChange={(val) => setBusinessUnit(val)}
                    options={BU_OPTIONS.map((bu) => ({ value: bu.value, label: bu.label }))}
                  />
                </div>
              </div>
            </section>
          )}

          {/* ═══════════════════════════════════════════════ */}
          {/* MEMBERS — full team management */}
          {/* ═══════════════════════════════════════════════ */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-text-primary flex items-center gap-2">
                <Users size={16} className="text-text-tertiary" />
                Участники
                <span className="text-[10px] text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded-full ml-1">
                  {members.length}
                </span>
              </h2>
              <button
                onClick={handleCopyInvite}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-text-secondary bg-bg-surface border border-border-primary rounded-[var(--radius-lg)] hover:border-border-secondary hover:text-text-primary transition-all cursor-pointer"
              >
                {copied ? <Check size={12} className="text-green-400" /> : <Link2 size={12} />}
                {copied ? "Скопировано!" : "Ссылка-приглашение"}
              </button>
            </div>

            {membersQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={20} className="animate-spin text-text-tertiary" />
              </div>
            ) : (
              <div className="space-y-2">
                {members.map((member) => {
                  const roleInfo = ROLE_LABELS[member.role] || ROLE_LABELS.USER;
                  const isRoleDropdownOpen = roleDropdownId === member.id;
                  const isSelf = member.user.id === myUserId;

                  return (
                    <div
                      key={member.id}
                      className="flex items-center justify-between p-3.5 bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] hover:border-border-secondary transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-accent-primary/20 to-accent-primary/5 text-accent-primary text-sm font-semibold overflow-hidden shrink-0">
                          {member.user.avatarUrl ? (
                            <img src={member.user.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
                          ) : (
                            member.user.name?.charAt(0)?.toUpperCase() || "?"
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-text-primary truncate">
                            {member.user.name}
                            {isSelf && <span className="text-[10px] text-text-tertiary ml-1.5">(вы)</span>}
                          </p>
                          <p className="text-[11px] text-text-tertiary truncate">{member.user.email}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isAdmin && !isSelf ? (
                          <div className="relative">
                            <button
                              onClick={() => setRoleDropdownId(isRoleDropdownOpen ? null : member.id)}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-full)] text-[10px] font-medium cursor-pointer hover:opacity-80 transition-opacity ${roleInfo.color}`}
                            >
                              {roleInfo.icon}
                              {roleInfo.label}
                              <ChevronDown size={10} className={isRoleDropdownOpen ? "rotate-180" : ""} />
                            </button>
                            {isRoleDropdownOpen && (
                              <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-bg-surface border border-border-primary rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)] py-1 animate-in fade-in slide-in-from-top-1 duration-150">
                                {ROLES.map((r) => {
                                  const ri = ROLE_LABELS[r];
                                  return (
                                    <button
                                      key={r}
                                      onClick={() => handleRoleChange(member.id, r)}
                                      className={`flex items-center gap-2 w-full px-3 py-2 text-xs transition-colors cursor-pointer ${
                                        member.role === r
                                          ? "text-accent-primary bg-bg-tertiary font-medium"
                                          : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
                                      }`}
                                    >
                                      {ri.icon}
                                      {ri.label}
                                      {member.role === r && <Check size={12} className="ml-auto" />}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-full)] text-[10px] font-medium ${roleInfo.color}`}>
                            {roleInfo.icon}
                            {roleInfo.label}
                          </div>
                        )}

                        {isAdmin && !isSelf && (
                          <button
                            onClick={() => handleRemoveMember(member.id, member.user.name)}
                            className="p-1.5 rounded-[var(--radius-md)] text-text-tertiary hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                            title="Удалить из команды"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Join requests — admin only */}
            {isAdmin && (joinRequests as JoinRequest[]).length > 0 && (
              <div className="mt-6">
                <h3 className="text-xs font-medium text-text-secondary mb-3 flex items-center gap-1.5">
                  <Clock size={13} className="text-text-tertiary" />
                  Заявки на вступление
                  <span className="text-[10px] text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded-full">
                    {(joinRequests as JoinRequest[]).length}
                  </span>
                </h3>
                <div className="bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] overflow-hidden divide-y divide-border-primary">
                  {(joinRequests as JoinRequest[]).map((req) => (
                    <div key={req.id} className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-bg-tertiary flex items-center justify-center shrink-0">
                          <Users size={14} className="text-text-tertiary" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-text-primary truncate">{req.user.name}</p>
                          <p className="text-[10px] text-text-tertiary truncate">{req.user.email}</p>
                          {req.message && <p className="text-[10px] text-text-secondary mt-0.5 italic">«{req.message}»</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleRequestMutation.mutate({ requestId: req.id, action: "approve" })}
                          disabled={handleRequestMutation.isPending}
                          className="p-1.5 rounded-[var(--radius-md)] bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors cursor-pointer"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          onClick={() => handleRequestMutation.mutate({ requestId: req.id, action: "reject" })}
                          disabled={handleRequestMutation.isPending}
                          className="p-1.5 rounded-[var(--radius-md)] bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors cursor-pointer"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* ═══════════════════════════════════════════════ */}
          {/* ACCESS — admin only */}
          {/* ═══════════════════════════════════════════════ */}
          {canManage && (
            <section>
              <h2 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
                <Lock size={16} className="text-text-tertiary" />
                Доступ и видимость
              </h2>
              <div className="space-y-4 bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] p-5">
                <div>
                  <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Видимость</label>
                  <SegmentedControl
                    variant="bordered"
                    value={visibility}
                    onChange={setVisibility}
                    fullWidth
                    options={[
                      { value: "VISIBLE", label: "Видима в обзоре", icon: <Globe size={12} /> },
                      { value: "HIDDEN", label: "Скрыта", icon: <Lock size={12} /> },
                    ]}
                  />
                  <p className="text-[10px] text-text-tertiary mt-1.5">
                    {visibility === "VISIBLE" ? "Команда видна в обзоре команд всем пользователям" : "Команда доступна только по приглашению"}
                  </p>
                </div>
                <div>
                  <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Политика вступления</label>
                  <Select
                    value={joinPolicy}
                    onChange={(val) => setJoinPolicy(val as "OPEN" | "REQUEST" | "INVITE_ONLY")}
                    options={[
                      { value: "OPEN", label: "Свободное — все могут вступить" },
                      { value: "REQUEST", label: "По заявке — требуется одобрение" },
                      { value: "INVITE_ONLY", label: "Только по приглашению" },
                    ]}
                  />
                </div>
              </div>
            </section>
          )}

          {/* ═══════════════════════════════════════════════ */}
          {/* SAVE — admin only */}
          {/* ═══════════════════════════════════════════════ */}
          {canManage && (
            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="h-10 px-6 flex items-center gap-2 bg-accent-primary text-text-inverse rounded-[var(--radius-lg)] text-sm font-medium hover:bg-accent-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {updateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : "Сохранить"}
              </button>
              {updateMutation.isSuccess && (
                <span className="text-xs text-green-500 flex items-center gap-1"><Check size={12} /> Сохранено</span>
              )}
              {updateMutation.error && (
                <span className="text-xs text-red-400">{updateMutation.error.message}</span>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════ */}
          {/* STATISTICS */}
          {/* ═══════════════════════════════════════════════ */}
          <section>
            <h2 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
              <Sparkles size={16} className="text-text-tertiary" />
              Статистика воркспейса
            </h2>
            {statsQuery.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={18} className="animate-spin text-text-tertiary" />
              </div>
            ) : stats ? (
              <div className="grid grid-cols-3 gap-3">
                <StatCard icon={<FolderKanban size={16} />} label="Проекты" value={stats.projectCount} color="text-blue-500 bg-blue-500/10" />
                <StatCard icon={<Users size={16} />} label="Участники" value={stats.memberCount} color="text-violet-500 bg-violet-500/10" />
                <StatCard icon={<LayoutTemplate size={16} />} label="Шаблоны" value={stats.templateCount} color="text-pink-500 bg-pink-500/10" />
                <StatCard icon={<Layers size={16} />} label="Форматы" value={stats.formatCount} color="text-teal-500 bg-teal-500/10" />
                <StatCard icon={<Sparkles size={16} />} label="AI-генерации" value={stats.aiGenerations} color="text-amber-500 bg-amber-500/10" />
                <StatCard icon={<DollarSign size={16} />} label="AI-затраты" value={`$${stats.totalAICost.toFixed(2)}`} color="text-emerald-500 bg-emerald-500/10" />
              </div>
            ) : null}
          </section>

          {/* ═══════════════════════════════════════════════ */}
          {/* LEAVE WORKSPACE */}
          {/* ═══════════════════════════════════════════════ */}
          <section className="border border-amber-500/20 rounded-[var(--radius-xl)] p-5">
            <h2 className="text-sm font-medium text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-2">
              <LogOut size={15} />
              Покинуть воркспейс
            </h2>
            <p className="text-xs text-text-tertiary mb-4">
              Вы потеряете доступ ко всем проектам и данным этого воркспейса.
            </p>
            {!leaveConfirm ? (
              <button
                onClick={() => setLeaveConfirm(true)}
                className="h-9 px-4 flex items-center gap-2 border border-amber-500/30 text-amber-600 dark:text-amber-400 rounded-[var(--radius-lg)] text-xs font-medium hover:bg-amber-500/10 transition-colors cursor-pointer"
              >
                <LogOut size={12} /> Покинуть воркспейс
              </button>
            ) : (
              <div className="space-y-3">
                {isOnlyAdmin && nonAdminMembers.length > 0 && (
                  <div>
                    <p className="text-xs text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-1.5">
                      <AlertTriangle size={13} />
                      Вы единственный администратор. Назначьте нового админа:
                    </p>
                    <select
                      value={newAdminId}
                      onChange={(e) => setNewAdminId(e.target.value)}
                      className="w-full h-10 px-3 rounded-[var(--radius-lg)] border border-amber-500/30 bg-bg-secondary text-sm text-text-primary focus:outline-none"
                    >
                      <option value="">Выберите участника...</option>
                      {nonAdminMembers.map((m) => (
                        <option key={m.user.id} value={m.user.id}>{m.user.name} ({m.user.email})</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleLeave}
                    disabled={leaveMutation.isPending || (isOnlyAdmin && nonAdminMembers.length > 0 && !newAdminId)}
                    className="h-9 px-4 flex items-center gap-2 bg-amber-500 text-white rounded-[var(--radius-lg)] text-xs font-medium hover:bg-amber-600 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {leaveMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <><LogOut size={12} /> Подтвердить</>}
                  </button>
                  <button
                    onClick={() => { setLeaveConfirm(false); setNewAdminId(""); }}
                    className="h-9 px-4 text-xs text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ═══════════════════════════════════════════════ */}
          {/* DANGER ZONE — admin only */}
          {/* ═══════════════════════════════════════════════ */}
          {isAdmin && (
            <section className="border border-red-500/20 rounded-[var(--radius-xl)] p-5 mb-8">
              <h2 className="text-sm font-medium text-red-400 mb-2 flex items-center gap-2">
                <ShieldAlert size={15} />
                Опасная зона
              </h2>
              <p className="text-xs text-text-tertiary mb-4">
                Удаление воркспейса необратимо. Все проекты, шаблоны и данные будут потеряны навсегда.
              </p>
              {!deleteConfirm ? (
                <button
                  onClick={() => setDeleteConfirm(true)}
                  className="h-9 px-4 flex items-center gap-2 border border-red-500/30 text-red-400 rounded-[var(--radius-lg)] text-xs font-medium hover:bg-red-500/10 transition-colors cursor-pointer"
                >
                  <Trash2 size={12} /> Удалить воркспейс
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-red-400">
                    Введите «<strong>{currentWorkspace.name}</strong>» для подтверждения:
                  </p>
                  <input
                    type="text"
                    value={deleteInput}
                    onChange={(e) => setDeleteInput(e.target.value)}
                    placeholder={currentWorkspace.name}
                    className="w-full h-10 px-3 rounded-[var(--radius-lg)] border border-red-500/30 bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-red-500/50"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDelete}
                      disabled={deleteInput !== currentWorkspace.name || deleteMutation.isPending}
                      className="h-9 px-4 flex items-center gap-2 bg-red-500 text-white rounded-[var(--radius-lg)] text-xs font-medium hover:bg-red-600 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {deleteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <><Trash2 size={12} /> Удалить навсегда</>}
                    </button>
                    <button
                      onClick={() => { setDeleteConfirm(false); setDeleteInput(""); }}
                      className="h-9 px-4 text-xs text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] text-sm text-text-primary animate-in fade-in slide-in-from-bottom-2 duration-200">
          {toast}
        </div>
      )}
    </AppShell>
  );
}

// ─── Stat Card Sub-component ────────────────────────────────────────────────

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number | string; color: string }) {
  return (
    <div className="p-4 bg-bg-surface border border-border-primary rounded-[var(--radius-xl)]">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-[var(--radius-md)] flex items-center justify-center ${color}`}>
          {icon}
        </div>
        <span className="text-[11px] text-text-tertiary">{label}</span>
      </div>
      <p className="text-lg font-semibold text-text-primary">{value}</p>
    </div>
  );
}
