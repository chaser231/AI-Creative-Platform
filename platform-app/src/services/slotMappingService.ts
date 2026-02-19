import type { MasterComponent, ComponentType } from "@/types";
import type { TemplatePack } from "@/services/templateService";

/* ─── Types ──────────────────────────────────────────────── */

export interface SlotMapping {
    /** Master component ID from the current project */
    masterId: string;
    /** Master component name (for UI display) */
    masterName: string;
    /** Master component type */
    masterType: ComponentType;
    /** Template master component ID (source of positions) */
    templateMasterId: string;
    /** Template master component name */
    templateMasterName: string;
    /** Confidence score 0-1 */
    confidence: number;
}

export interface MappingResult {
    mappings: SlotMapping[];
    /** Master component IDs that couldn't be matched to any template slot */
    unmappedMaster: { id: string; name: string; type: ComponentType }[];
    /** Template master component IDs that have no match in the current project */
    unmappedTemplate: { id: string; name: string; type: ComponentType }[];
}

/* ─── Name similarity ────────────────────────────────────── */

const SLOT_SYNONYMS: Record<string, string[]> = {
    headline: ["header", "title", "заголовок", "headline", "heading", "h1"],
    subhead: ["subtitle", "подзаголовок", "subheading", "sub", "description"],
    cta: ["button", "кнопка", "action", "cta", "btn"],
    image: ["photo", "picture", "изображение", "картинка", "image", "hero", "product"],
    background: ["bg", "фон", "backdrop", "background"],
    logo: ["лого", "логотип", "brand", "logo"],
    badge: ["badge", "бейдж", "label", "метка", "tag"],
};

function normalizeForComparison(name: string): string {
    return name
        .toLowerCase()
        .replace(/[-_\s]+/g, " ")
        .trim();
}

function getNameSimilarity(nameA: string, nameB: string): number {
    const a = normalizeForComparison(nameA);
    const b = normalizeForComparison(nameB);

    // Exact match
    if (a === b) return 1.0;

    // Check synonym groups
    for (const synonyms of Object.values(SLOT_SYNONYMS)) {
        const aMatch = synonyms.some(s => a.includes(s));
        const bMatch = synonyms.some(s => b.includes(s));
        if (aMatch && bMatch) return 0.85;
    }

    // Substring match
    if (a.includes(b) || b.includes(a)) return 0.6;

    return 0;
}

/* ─── Auto-mapping algorithm ─────────────────────────────── */

/**
 * Automatically maps current project master components to template master components.
 *
 * Priority:
 * 1. Exact slotId + type match → confidence 1.0
 * 2. Same type + similar name    → confidence 0.7
 * 3. Same type (first available)  → confidence 0.4
 */
export function autoMap(
    currentMasters: MasterComponent[],
    templatePack: TemplatePack,
): MappingResult {
    const templateMasters = templatePack.masterComponents;
    const mappings: SlotMapping[] = [];
    const usedCurrentIds = new Set<string>();
    const usedTemplateIds = new Set<string>();

    // ─── Pass 1: Exact slotId + type ────────────────────
    for (const cm of currentMasters) {
        if (!cm.props.slotId || cm.props.slotId === "none") continue;

        const match = templateMasters.find(tm =>
            !usedTemplateIds.has(tm.id) &&
            tm.type === cm.type &&
            tm.props.slotId === cm.props.slotId
        );

        if (match) {
            mappings.push({
                masterId: cm.id,
                masterName: cm.name,
                masterType: cm.type,
                templateMasterId: match.id,
                templateMasterName: match.name,
                confidence: 1.0,
            });
            usedCurrentIds.add(cm.id);
            usedTemplateIds.add(match.id);
        }
    }

    // ─── Pass 2: Same type + similar name ───────────────
    for (const cm of currentMasters) {
        if (usedCurrentIds.has(cm.id)) continue;

        let bestMatch: MasterComponent | null = null;
        let bestScore = 0;

        for (const tm of templateMasters) {
            if (usedTemplateIds.has(tm.id)) continue;
            if (tm.type !== cm.type) continue;

            const sim = getNameSimilarity(cm.name, tm.name);
            if (sim > bestScore) {
                bestScore = sim;
                bestMatch = tm;
            }
        }

        if (bestMatch && bestScore >= 0.5) {
            mappings.push({
                masterId: cm.id,
                masterName: cm.name,
                masterType: cm.type,
                templateMasterId: bestMatch.id,
                templateMasterName: bestMatch.name,
                confidence: 0.7,
            });
            usedCurrentIds.add(cm.id);
            usedTemplateIds.add(bestMatch.id);
        }
    }

    // ─── Pass 3: Same type (first free) ─────────────────
    for (const cm of currentMasters) {
        if (usedCurrentIds.has(cm.id)) continue;

        const match = templateMasters.find(tm =>
            !usedTemplateIds.has(tm.id) && tm.type === cm.type
        );

        if (match) {
            mappings.push({
                masterId: cm.id,
                masterName: cm.name,
                masterType: cm.type,
                templateMasterId: match.id,
                templateMasterName: match.name,
                confidence: 0.4,
            });
            usedCurrentIds.add(cm.id);
            usedTemplateIds.add(match.id);
        }
    }

    // ─── Collect unmapped ───────────────────────────────
    const unmappedMaster = currentMasters
        .filter(cm => !usedCurrentIds.has(cm.id))
        .map(cm => ({ id: cm.id, name: cm.name, type: cm.type }));

    const unmappedTemplate = templateMasters
        .filter(tm => !usedTemplateIds.has(tm.id))
        .map(tm => ({ id: tm.id, name: tm.name, type: tm.type }));

    return { mappings, unmappedMaster, unmappedTemplate };
}

/**
 * Update a mapping result — replace or add a manual mapping.
 */
export function updateMapping(
    result: MappingResult,
    masterId: string,
    templateMasterId: string,
    currentMasters: MasterComponent[],
    templateMasters: MasterComponent[],
): MappingResult {
    const cm = currentMasters.find(m => m.id === masterId);
    const tm = templateMasters.find(m => m.id === templateMasterId);
    if (!cm || !tm) return result;

    // Remove any existing mapping for either side
    const filteredMappings = result.mappings.filter(
        m => m.masterId !== masterId && m.templateMasterId !== templateMasterId
    );

    const newMapping: SlotMapping = {
        masterId: cm.id,
        masterName: cm.name,
        masterType: cm.type,
        templateMasterId: tm.id,
        templateMasterName: tm.name,
        confidence: 1.0, // Manual = full confidence
    };

    const mappings = [...filteredMappings, newMapping];
    const usedCurrentIds = new Set(mappings.map(m => m.masterId));
    const usedTemplateIds = new Set(mappings.map(m => m.templateMasterId));

    return {
        mappings,
        unmappedMaster: currentMasters
            .filter(m => !usedCurrentIds.has(m.id))
            .map(m => ({ id: m.id, name: m.name, type: m.type })),
        unmappedTemplate: templateMasters
            .filter(m => !usedTemplateIds.has(m.id))
            .map(m => ({ id: m.id, name: m.name, type: m.type })),
    };
}

/**
 * Remove a mapping (unlink a pair).
 */
export function removeMapping(
    result: MappingResult,
    masterId: string,
    currentMasters: MasterComponent[],
    templateMasters: MasterComponent[],
): MappingResult {
    const filteredMappings = result.mappings.filter(m => m.masterId !== masterId);
    const usedCurrentIds = new Set(filteredMappings.map(m => m.masterId));
    const usedTemplateIds = new Set(filteredMappings.map(m => m.templateMasterId));

    return {
        mappings: filteredMappings,
        unmappedMaster: currentMasters
            .filter(m => !usedCurrentIds.has(m.id))
            .map(m => ({ id: m.id, name: m.name, type: m.type })),
        unmappedTemplate: templateMasters
            .filter(m => !usedTemplateIds.has(m.id))
            .map(m => ({ id: m.id, name: m.name, type: m.type })),
    };
}
