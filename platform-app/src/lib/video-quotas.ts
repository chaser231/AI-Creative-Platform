/**
 * Default daily per-user quotas for video generation models (client-safe).
 *
 * These seed the VideoModelQuota table lazily: the first quota read creates
 * missing rows with these defaults; admins can then edit limits in the admin
 * panel. `null` means unlimited (still subject to the per-minute rate limit).
 */

import type { VideoTier } from "./video-models";

export const VIDEO_TIER_DEFAULT_DAILY_LIMITS: Record<VideoTier, number | null> = {
    premium: 10,
    advanced: 30,
    standard: null,
};
