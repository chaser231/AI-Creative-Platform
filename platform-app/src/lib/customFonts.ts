export interface CustomFont {
    name: string;
    buffer: ArrayBuffer;
}

export interface PreinstalledFont {
    name: string;
    url: string;
}

// Pre-installed fonts available via public/fonts
// E.g., if you place "MyBrandFont.ttf" in public/fonts/, add it here.
export const PREINSTALLED_FONTS: PreinstalledFont[] = [
    // Example: { name: "MyBrandFont", url: "/fonts/MyBrandFont.ttf" }
];

const DB_NAME = "CreativePlatformDB";
const STORE_NAME = "customFonts";

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

// Load preinstalled and user fonts into document.fonts
export async function loadAllCustomFonts(): Promise<string[]> {
    if (typeof window === "undefined" || !("fonts" in document)) return [];
    
    const loadedFontNames: string[] = [];

    // 1. Load Pre-installed fonts via CSS/URL
    for (const font of PREINSTALLED_FONTS) {
        try {
            const f = new FontFace(font.name, `url(${font.url})`);
            const loadedFace = await f.load();
            document.fonts.add(loadedFace);
            loadedFontNames.push(font.name);
        } catch (e) {
            console.error(`Failed to load pre-installed font ${font.name}:`, e);
        }
    }

    // 2. Load User fonts from IndexedDB
    try {
        const userFonts = await getUserFonts();
        for (const font of userFonts) {
            try {
                const f = new FontFace(font.name, font.buffer);
                const loadedFace = await f.load();
                document.fonts.add(loadedFace);
                loadedFontNames.push(font.name);
            } catch (e) {
                console.error(`Failed to load user font ${font.name}:`, e);
            }
        }
    } catch (e) {
        console.error("Failed to load user fonts from IndexedDB:", e);
    }

    return loadedFontNames;
}
