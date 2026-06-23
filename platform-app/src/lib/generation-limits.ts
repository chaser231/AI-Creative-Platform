/** Max parallel image generation jobs per project (client-side semaphore). */
export const MAX_CONCURRENT_IMAGE_JOBS = 4;

/** Backoff delays (ms) when a provider rate-limits a running job. */
export const GENERATION_RATE_LIMIT_RETRY_DELAYS_MS = [3_000, 8_000] as const;

/**
 * Max images per "Мульти-генерация" batch. Bounds browser memory (each item
 * keeps a thumbnail + status) and runaway provider spend. The client queue
 * still throttles concurrency to MAX_CONCURRENT_IMAGE_JOBS regardless of size.
 */
export const MAX_BATCH_ITEMS = 200;
