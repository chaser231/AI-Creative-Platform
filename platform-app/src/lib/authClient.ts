type AuthProbeResponse = {
  status?: "authenticated" | "unauthenticated" | "unknown";
  reason?: string;
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export async function confirmAuthSessionMissing(fetcher: FetchLike = fetch) {
  try {
    const response = await fetcher("/api/auth/probe", {
      cache: "no-store",
      credentials: "same-origin",
    });

    if (!response.ok) return false;

    const data = (await response.json()) as AuthProbeResponse;
    return data.status === "unauthenticated";
  } catch {
    return false;
  }
}
