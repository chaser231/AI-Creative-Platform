/** Max parallel image generation jobs per project (client-side semaphore). */
export const MAX_CONCURRENT_IMAGE_JOBS = 4;

/** Backoff delays (ms) when a provider rate-limits a running job. */
export const GENERATION_RATE_LIMIT_RETRY_DELAYS_MS = [3_000, 8_000] as const;
