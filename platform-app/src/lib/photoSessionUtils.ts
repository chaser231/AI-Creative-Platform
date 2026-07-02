/** Session row shape returned by `ai.listSessions`. */
export interface PhotoSessionCandidate {
    id: string;
    updatedAt: Date | string;
    _count: { messages: number };
}

export interface EditorSessionCandidate extends PhotoSessionCandidate {
    user?: { id: string; name?: string | null };
}

/**
 * Pick the best default session for a photo workspace: prefer the session with
 * the most messages (so collaborators see existing history), tie-break by recency.
 */
export function pickDefaultPhotoSession(
    sessions: PhotoSessionCandidate[],
): string | null {
    if (sessions.length === 0) return null;

    let best = sessions[0];
    for (const session of sessions) {
        if (session._count.messages > best._count.messages) {
            best = session;
            continue;
        }
        if (session._count.messages === best._count.messages) {
            const sessionTime = new Date(session.updatedAt).getTime();
            const bestTime = new Date(best.updatedAt).getTime();
            if (sessionTime > bestTime) best = session;
        }
    }
    return best.id;
}

/**
 * Editor/banner chat: prefer the current user's sessions, fallback to any project session.
 */
export function pickEditorSession(
    sessions: EditorSessionCandidate[],
    currentUserId?: string,
): string | null {
    if (sessions.length === 0) return null;

    const userSessions = currentUserId
        ? sessions.filter((session) => session.user?.id === currentUserId)
        : sessions;
    const pool = userSessions.length > 0 ? userSessions : sessions;
    return pickDefaultPhotoSession(pool);
}

/**
 * When auth resolves after init, switch to the user's best session if currently on a colleague's.
 */
export function pickBetterEditorSessionForUser(
    sessions: EditorSessionCandidate[],
    currentUserId: string,
    currentSessionId: string,
): string | null {
    const current = sessions.find((session) => session.id === currentSessionId);
    if (current?.user?.id === currentUserId) return null;

    const userSessions = sessions.filter((session) => session.user?.id === currentUserId);
    const betterId = pickDefaultPhotoSession(userSessions);
    if (betterId && betterId !== currentSessionId) return betterId;
    return null;
}

/** Only auto-create when the project truly has no sessions yet. */
export function shouldAutoCreatePhotoSession(sessions: PhotoSessionCandidate[]): boolean {
    return sessions.length === 0;
}
