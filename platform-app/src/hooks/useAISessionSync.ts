/**
 * useAISessionSync Hook
 *
 * Persists AI chat messages to PostgreSQL via tRPC.
 * Flow:
 * 1. On mount: creates or loads latest AI session for the project
 * 2. On message: saves to DB via ai.addMessage
 * 3. On reopen: loads messages from the latest session
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import {
    pickBetterEditorSessionForUser,
    pickEditorSession,
    type EditorSessionCandidate,
} from "@/lib/photoSessionUtils";
import type { AIChatMessage } from "@/components/editor/ai-chat";

/**
 * Hook to sync AI chat messages with the backend.
 * Returns messages array and functions to add messages.
 */
export function useAISessionSync(projectId: string, enabled: boolean = true) {
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionInitRef = useRef(false);
  const prevProjectIdRef = useRef(projectId);
  const { data: authSession, status: authStatus } = useSession();
  const currentUserId = authSession?.user?.id;

  // Get or create session
  const createSessionMutation = trpc.ai.createSession.useMutation();
  const addMessageMutation = trpc.ai.addMessage.useMutation();

  // List existing sessions — if project doesn't exist in DB, this will error
  const sessionsQuery = trpc.ai.listSessions.useQuery(
    { projectId },
    {
      enabled, // Skip in template mode
      retry: false, // Don't retry if project doesn't exist in DB
      refetchOnWindowFocus: false,
    }
  );

  // Re-init when navigating between editor projects without remounting the hook consumer.
  useEffect(() => {
    if (prevProjectIdRef.current === projectId) return;
    prevProjectIdRef.current = projectId;
    sessionInitRef.current = false;
    setSessionId(null);
    setMessages([]);
  }, [projectId]);

  // Initialize session — only if project exists in DB
  useEffect(() => {
    if (!enabled) {
      sessionInitRef.current = true;
      return;
    }
    if (sessionInitRef.current) return;
    if (authStatus === "loading") return;
    if (sessionsQuery.isLoading) return;

    // If query errored (project not in DB), stay in local-only mode
    if (sessionsQuery.isError) {
      sessionInitRef.current = true;
      return;
    }

    sessionInitRef.current = true;

    const sessions = (sessionsQuery.data || []) as EditorSessionCandidate[];
    if (sessions.length > 0) {
      const defaultId = pickEditorSession(sessions, currentUserId);
      if (defaultId) setSessionId(defaultId);
    } else {
      // Create new session — may fail if project is local-only
      createSessionMutation
        .mutateAsync({ projectId })
        .then((session: { id: string }) => {
          setSessionId(session.id);
        })
        .catch(() => {
          // Project doesn't exist in DB — stay in local-only mode (messages in memory)
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    authStatus,
    sessionsQuery.isLoading,
    sessionsQuery.isError,
    sessionsQuery.data,
    currentUserId,
  ]);

  // If auth resolved after init picked a colleague's session, switch to the user's best session.
  useEffect(() => {
    if (!currentUserId || !sessionsQuery.data || !sessionId) return;

    const sessions = sessionsQuery.data as EditorSessionCandidate[];
    const betterId = pickBetterEditorSessionForUser(sessions, currentUserId, sessionId);
    if (betterId) setSessionId(betterId);
  }, [currentUserId, sessionId, sessionsQuery.data]);

  // Load messages when session is ready
  const messagesQuery = trpc.ai.getMessages.useQuery(
    { sessionId: sessionId!, limit: 100 },
    {
      enabled: !!sessionId,
      retry: 1,
      refetchOnWindowFocus: false,
    }
  );

  // Populate messages from DB
  useEffect(() => {
    if (!messagesQuery.data?.messages) return;

    const dbMessages: AIChatMessage[] = messagesQuery.data.messages.map(
      (m: {
        id: string;
        role: string;
        content: string;
        type: string;
        createdAt: Date;
      }) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        type: m.type as "text" | "image" | "outpaint",
        content: m.content,
        timestamp: new Date(m.createdAt).getTime(),
      })
    );

    setMessages(dbMessages);
  }, [messagesQuery.data]);

  // Add messages and persist to DB
  const addMessages = useCallback(
    (newMessages: AIChatMessage[]) => {
      // Update local state immediately
      setMessages((prev) => [...prev, ...newMessages]);

      // Persist to DB (non-blocking, skip plan-type messages)
      if (sessionId) {
        for (const msg of newMessages) {
          if (msg.type === "plan" || msg.type === "template_choices" || msg.type === "fallback_actions" || msg.type === "text_variants") continue; // ephemeral UI messages

          // Assistant image messages are already cost-tracked by the API route
          // (generate/route.ts, image-edit/route.ts). Don't pass model/costUnits here
          // to avoid double-counting in analytics (analytics filters by model != null).
          const isTrackedByRoute = msg.role === "assistant" && (msg.type === "image" || msg.type === "outpaint");

          addMessageMutation
            .mutateAsync({
              sessionId,
              role: msg.role as "user" | "assistant" | "system",
              content: msg.content,
              type: msg.type as "text" | "image" | "error",
              model: isTrackedByRoute ? undefined : msg.model,
              costUnits: isTrackedByRoute ? undefined : msg.costUnits,
            })
            .catch((err: Error) => {
              console.error("Failed to save AI message:", err);
            });
        }
      }
    },
    [sessionId, addMessageMutation]
  );

  return {
    messages,
    addMessages,
    sessionId,
    isLoading: sessionsQuery.isLoading || messagesQuery.isLoading,
  };
}
