/**
 * Client-side video frame extraction.
 *
 * Decodes a video URL in an off-DOM <video> element, seeks to the requested
 * time and rasterises the frame through a canvas. Requires CORS-enabled
 * video hosting (our S3 bucket is CORS-configured; fal.media also sends
 * permissive headers). Used for:
 *   - project thumbnails after a generation completes
 *   - "use frame as start image" action in the video feed
 *   - the extractFrame workflow node
 */

export async function captureVideoFrame(
    videoUrl: string,
    timeSec = 0,
    mimeType: "image/webp" | "image/png" = "image/webp",
): Promise<string> {
    return new Promise((resolve, reject) => {
        const video = document.createElement("video");
        video.crossOrigin = "anonymous";
        video.preload = "auto";
        video.muted = true;
        video.playsInline = true;

        const cleanup = () => {
            video.removeAttribute("src");
            video.load();
        };

        const fail = (msg: string) => {
            cleanup();
            reject(new Error(msg));
        };

        const timeout = setTimeout(() => fail("Video frame capture timed out"), 30_000);

        video.onerror = () => {
            clearTimeout(timeout);
            fail("Failed to load video for frame capture");
        };

        video.onloadedmetadata = () => {
            const target = Math.min(Math.max(0, timeSec), Math.max(0, (video.duration || 0) - 0.05));
            // Seeking to exactly 0 sometimes yields a black frame on mp4 —
            // nudge slightly forward.
            video.currentTime = target > 0 ? target : 0.05;
        };

        video.onseeked = () => {
            clearTimeout(timeout);
            try {
                const canvas = document.createElement("canvas");
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                if (!canvas.width || !canvas.height) {
                    return fail("Video has no decodable dimensions");
                }
                const ctx = canvas.getContext("2d");
                if (!ctx) return fail("Canvas 2D context unavailable");
                ctx.drawImage(video, 0, 0);
                const dataUrl = canvas.toDataURL(mimeType, 0.9);
                cleanup();
                resolve(dataUrl);
            } catch (err) {
                // SecurityError → tainted canvas (no CORS on the video host)
                fail(err instanceof Error ? err.message : String(err));
            }
        };

        video.src = videoUrl;
    });
}
