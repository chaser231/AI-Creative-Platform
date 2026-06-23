/**
 * Yandex.Disk public folder import for "Мульти-генерация".
 *
 * Given a public Yandex.Disk link (a folder or a single file), this route
 * walks the public listing API (cloud-api.yandex.net — a fixed, trusted host;
 * the user-supplied link only ever travels as the `public_key` query param),
 * collects image files, downloads each one and re-uploads it to our S3 bucket
 * so the batch references stable HTTPS URLs.
 *
 * Download links returned by Yandex 302-redirect to storage nodes, so we
 * follow redirects manually through `safeFetch`, re-validating every hop
 * against a Yandex-only host allowlist (SSRF protection).
 */

import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { requireSessionAndProjectAccess } from "@/server/authz/guards";
import { TRPCError } from "@trpc/server";
import {
    safeFetch,
    type SsrfPolicyOptions,
} from "@/server/security/ssrfGuard";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { checkRateLimit } from "@/lib/rateLimit";
import { MAX_BATCH_ITEMS } from "@/lib/generation-limits";
import { mimeForName } from "@/utils/zipImport";
import {
    collectImageFiles,
    buildDownloadUrl,
    YandexImportError,
    type CollectedFile,
    type YadiskFetchJson,
    type YandexListResponse,
} from "@/utils/yandexDiskImport";

export const maxDuration = 300;

const s3 = new S3Client({
    region: "ru-central1",
    endpoint: process.env.S3_ENDPOINT || "https://storage.yandexcloud.net",
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    },
});
const BUCKET = process.env.S3_BUCKET || "acp-assets";

const DOWNLOAD_CONCURRENCY = 5;

/** Yandex-only allowlist; no MIME enforcement so 302 hops (no Content-Type) pass. */
function yandexDownloadPolicy(): SsrfPolicyOptions {
    return {
        allowedSchemes: ["https:"],
        allowedPorts: [443],
        allowedHosts: [".yandex.net", ".yandex.ru", ".yadi.sk"],
        maxContentLength: 64 * 1024 * 1024,
        headTimeoutMs: 20_000,
    };
}

/** Adapter: fetch a cloud-api listing URL into the shape the walker expects. */
const listingFetch: YadiskFetchJson = async (url) => {
    const res = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: { Accept: "application/json" },
    });
    if (!res.ok) {
        return { ok: false, status: res.status, data: {} };
    }
    const data = (await res.json()) as YandexListResponse;
    return { ok: true, status: res.status, data };
};

/** Resolve a file's direct download href (listing `file`, else download API). */
async function resolveDownloadHref(
    publicKey: string,
    item: CollectedFile,
): Promise<string | null> {
    if (item.file) return item.file;
    try {
        const res = await fetch(buildDownloadUrl(publicKey, item.path), {
            signal: AbortSignal.timeout(20_000),
            headers: { Accept: "application/json" },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { href?: string };
        return data.href ?? null;
    } catch {
        return null;
    }
}

/** Fetch image bytes, following Yandex redirects through the SSRF guard. */
async function fetchYandexImage(
    href: string,
    maxRedirects = 5,
): Promise<{ buffer: Buffer; contentType: string } | null> {
    let current = href;
    for (let hop = 0; hop <= maxRedirects; hop++) {
        const res = await safeFetch(
            current,
            { signal: AbortSignal.timeout(60_000) },
            yandexDownloadPolicy(),
        );

        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get("location");
            await res.body?.cancel().catch(() => {});
            if (!location) return null;
            current = new URL(location, current).toString();
            continue;
        }

        if (!res.ok) {
            await res.body?.cancel().catch(() => {});
            return null;
        }

        const contentType =
            res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ||
            "";
        if (!contentType.startsWith("image/")) {
            await res.body?.cancel().catch(() => {});
            return null;
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length === 0) return null;
        return { buffer, contentType };
    }
    return null;
}

async function uploadToS3(
    buffer: Buffer,
    contentType: string,
    projectId: string,
    name: string,
): Promise<string> {
    const ext =
        contentType.split("/")[1]?.split(";")[0] ||
        name.split(".").pop() ||
        "jpg";
    const key = `multi-imports/${projectId}/${randomUUID()}.${ext}`;
    await s3.send(
        new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: buffer,
            ContentType: contentType,
        }),
    );
    return `${process.env.S3_ENDPOINT || "https://storage.yandexcloud.net"}/${BUCKET}/${key}`;
}

async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    mapper: (item: T) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;
    async function worker() {
        while (cursor < items.length) {
            const i = cursor++;
            results[i] = await mapper(items[i]);
        }
    }
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, () => worker()),
    );
    return results;
}

function looksLikeYandexLink(value: string): boolean {
    try {
        const u = new URL(value);
        if (u.protocol !== "https:") return false;
        const h = u.hostname.toLowerCase();
        return (
            h.endsWith("yadi.sk") ||
            h.endsWith("disk.yandex.ru") ||
            h.endsWith("disk.yandex.com") ||
            h.endsWith("yandex.ru") ||
            h.endsWith("yandex.com")
        );
    } catch {
        return false;
    }
}

export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const rl = checkRateLimit(`yadisk-import:${session.user.id}`, {
            limit: 10,
            windowSeconds: 60,
        });
        if (!rl.allowed) {
            return NextResponse.json(
                { error: "Слишком много запросов, попробуйте позже" },
                { status: 429 },
            );
        }

        const body = (await req.json()) as {
            publicKey?: string;
            projectId?: string;
        };
        const publicKey = body.publicKey?.trim();
        const projectId = body.projectId;

        if (!publicKey || !looksLikeYandexLink(publicKey)) {
            return NextResponse.json(
                { error: "Ожидается публичная ссылка Яндекс.Диска" },
                { status: 400 },
            );
        }
        if (!projectId) {
            return NextResponse.json(
                { error: "Не указан projectId" },
                { status: 400 },
            );
        }

        try {
            await requireSessionAndProjectAccess(
                session.user.id,
                projectId,
                "write",
            );
        } catch (e) {
            if (e instanceof TRPCError) {
                const status = e.code === "NOT_FOUND" ? 404 : 403;
                return NextResponse.json({ error: e.message }, { status });
            }
            throw e;
        }

        let files: CollectedFile[];
        try {
            files = await collectImageFiles(
                listingFetch,
                publicKey,
                MAX_BATCH_ITEMS,
            );
        } catch (e) {
            const status = e instanceof YandexImportError ? e.status : 502;
            return NextResponse.json(
                {
                    error:
                        e instanceof Error
                            ? e.message
                            : "Не удалось прочитать публичную папку",
                },
                { status: status === 404 ? 404 : 502 },
            );
        }

        if (files.length === 0) {
            return NextResponse.json(
                { error: "По ссылке не найдено изображений" },
                { status: 404 },
            );
        }

        const uploaded = await mapWithConcurrency(
            files,
            DOWNLOAD_CONCURRENCY,
            async (item): Promise<{ url: string; name: string } | null> => {
                try {
                    const href = await resolveDownloadHref(publicKey, item);
                    if (!href) return null;
                    const fetched = await fetchYandexImage(href);
                    if (!fetched) return null;
                    const contentType = fetched.contentType || mimeForName(item.name);
                    const url = await uploadToS3(
                        fetched.buffer,
                        contentType,
                        projectId,
                        item.name,
                    );
                    return { url, name: item.name };
                } catch {
                    return null;
                }
            },
        );

        const sources = uploaded.filter(
            (s): s is { url: string; name: string } => s !== null,
        );
        const failed = files.length - sources.length;

        return NextResponse.json({
            sources,
            failed,
            errors:
                failed > 0
                    ? [`Не удалось импортировать файлов: ${failed}`]
                    : [],
        });
    } catch (err) {
        console.error("[yandex-disk import] failed:", err);
        return NextResponse.json({ error: "Ошибка импорта" }, { status: 500 });
    }
}
