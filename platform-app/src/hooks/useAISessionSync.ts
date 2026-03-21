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
import { trpc } from "@/lib/trpc";
import type { AIChatMessage } from "@/components/editor/AIChatPanel";

/**
 * Hook to sync AI chat messages with the backend.
 * Returns messages array and functions to add messages.
 */
export function useAISessionSync(projectId: string) {
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionInitRef = useRef(false);

  // Get or create session
  const createSessionMutation = trpc.ai.createSession.useMutation();
  const addMessageMutation = trpc.ai.addMessage.useMutation();

  // List existing sessions — if project doesn't exist in DB, this will error
  const sessionsQuery = trpc.ai.listSessions.useQuery(
    { projectId },
    {
      retry: false, // Don't retry if project doesn't exist in DB
      refetchOnWindowFocus: false,
    }
  );

  // Initialize session — only if project exists in DB
  useEffect(() => {
    if (sessionInitRef.current) return;
    if (sessionsQuery.isLoading) return;

    // If query errored (project not in DB), stay in local-only mode
    if (sessionsQuery.isError) {
      sessionInitRef.current = true;
      return;
    }

    sessionInitRef.current = true;

    const sessions = sessionsQuery.data || [];
    if (sessions.length > 0) {
      // Use latest session
      setSessionId(sessions[0].id);
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
  }, [sessionsQuery.isLoading, sessionsQuery.isError, sessionsQuery.data]);

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
          if (msg.type === "plan") continue; // plan steps are ephemeral UI
          addMessageMutation
            .mutateAsync({
              sessionId,
              role: msg.role as "user" | "assistant" | "system",
              content: msg.content,
              type: msg.type as "text" | "image" | "error",
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
