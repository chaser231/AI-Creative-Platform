import { PREINSTALLED_FONT_FAMILIES } from "../config/preinstalledFonts";

export interface CustomFont {
    name: string;
    buffer: ArrayBuffer;
}

export interface PreinstalledFont {
    name: string;
}

export interface WorkspaceFontAsset {
    filename: string;
    url: string;
    metadata?: {
        family?: string;
    } | null;
}

// Pre-installed fonts available via public/fonts
export const PREINSTALLED_FONTS: PreinstalledFont[] = PREINSTALLED_FONT_FAMILIES.map(name => ({ name }));

const DB_NAME = "CreativePlatformDB";
const STORE_NAME = "customFonts";
// Family-level dedup for whole-file registrations (workspace/user fonts).
const loadedFontNames = new Set<string>();
// (family, weight, style)-level dedup for weight-specific FontFace registrations
// (e.g. preinstalled families where each weight is a separate file).
const loadedFontWeightKeys = new Set<string>();

/** Normalize a CSS font-weight token ("normal"/"bold"/"400") to a number. */
export function parseNumericFontWeight(weight: string | number | undefined | null): number {
    if (typeof weight === "number" && Number.isFinite(weight)) return weight;
    if (weight == null) return 400;
    const token = String(weight).trim().toLowerCase();
    if (token === "normal" || token === "") return 400;
    if (token === "bold") return 700;
    const parsed = parseInt(token, 10);
    return Number.isFinite(parsed) ? parsed : 400;
}

export interface RegisterFontOptions {
    /** When set, registers a weight-specific FontFace (descriptor `weight`). */
    weight?: string | number;
    /** FontFace `style` descriptor; defaults to "normal". */
    style?: string;
}

// Very simple indexedDB wrapper
function getDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = (e.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "name" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function saveUserFont(name: string, buffer: ArrayBuffer): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.put({ name, buffer });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function getUserFonts(): Promise<CustomFont[]> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result as CustomFont[]);
        req.onerror = () => reject(req.error);
    });
}

export async function removeUserFont(name: string): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export function normalizeFontFamilyName(name: string): string {
    return name
        .replace(/\.[^/.]+$/, "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export async function registerFont(
    name: string,
    source: ArrayBuffer | string,
    options?: RegisterFontOptions,
): Promise<string | null> {
    if (typeof window === "undefined" || !("fonts" in document)) return null;

    const family = normalizeFontFamilyName(name);
    if (!family) return null;

    const sourceArg = typeof source === "string" ? `url("${source}")` : source;

    // Weight-specific registration: dedup by (family, weight, style) and attach
    // FontFace weight/style descriptors so `document.fonts.check("700 …")`
    // resolves the right face instead of a single normal-weight fallback.
    if (options?.weight != null) {
        const numericWeight = parseNumericFontWeight(options.weight);
        const style = options.style || "normal";
        const key = `${family.toLowerCase()}::${numericWeight}::${style}`;
        if (loadedFontWeightKeys.has(key)) return family;

        const descriptors: FontFaceDescriptors = { weight: String(numericWeight), style };
        const fontFace = new FontFace(family, sourceArg, descriptors);
        const loadedFace = await fontFace.load();
        document.fonts.add(loadedFace);
        loadedFontWeightKeys.add(key);
        return family;
    }

    // Whole-file registration (workspace/user fonts): dedup by family.
    if (loadedFontNames.has(family)) return family;

    const fontFace = new FontFace(family, sourceArg);
    const loadedFace = await fontFace.load();
    document.fonts.add(loadedFace);
    loadedFontNames.add(family);
    return family;
}

export async function loadWorkspaceFonts(fontAssets: WorkspaceFontAsset[]): Promise<string[]> {
    const loaded: string[] = [];

    for (const asset of fontAssets) {
        const family = asset.metadata?.family || normalizeFontFamilyName(asset.filename);
        if (!family) continue;

        try {
            const loadedName = await registerFont(family, asset.url);
            if (loadedName) loaded.push(loadedName);
        } catch (e) {
            // Non-critical: the asset row may point to a file that no longer exists
            // in S3 (deleted manually / failed upload). Log as a warning so it
            // doesn't surface as a red Next.js dev-overlay issue.
            console.warn(
                `[customFonts] Skipped workspace font "${family}" (${asset.url}): ${(e as Error)?.message || e}`,
            );
        }
    }

    return loaded;
}

// Load preinstalled and user fonts into document.fonts
export async function loadAllCustomFonts(fontAssets: WorkspaceFontAsset[] = []): Promise<string[]> {
    if (typeof window === "undefined" || !("fonts" in document)) return [];
    
    const availableFontNames: string[] = [];

    // 1. Pre-installed fonts are loaded automatically via src/app/fonts.css
    availableFontNames.push(...PREINSTALLED_FONTS.map(f => f.name));

    // 2. Load User fonts from IndexedDB
    try {
        const userFonts = await getUserFonts();
        for (const font of userFonts) {
            try {
                const loadedName = await registerFont(font.name, font.buffer);
                if (loadedName) availableFontNames.push(loadedName);
            } catch (e) {
                console.warn(`[customFonts] Skipped user font "${font.name}":`, e);
            }
        }
    } catch (e) {
        console.warn("[customFonts] Failed to load user fonts from IndexedDB:", e);
    }

    const workspaceFontNames = await loadWorkspaceFonts(fontAssets);
    availableFontNames.push(...workspaceFontNames);

    return Array.from(new Set(availableFontNames));
}
