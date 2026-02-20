/**
 * Template Catalog Service
 * 
 * API-like interface for template discovery and management.
 * Currently uses local data + defaultPacks as the source of truth.
 * Designed to be replaced by a real backend API in the future.
 */

import type { BusinessUnit, TemplateCategory, ContentType, TemplateOccasion } from "@/types";
import type { TemplatePackV2 } from "@/services/templateService";
import { DEFAULT_PACKS, type TemplatePackMeta } from "@/constants/defaultPacks";

export interface CatalogSearchParams {
    query?: string;
    businessUnits?: BusinessUnit[];
    categories?: TemplateCategory[];
    contentType?: ContentType;
    occasion?: TemplateOccasion;
    tags?: string[];
    onlyOfficial?: boolean;
    onlyMine?: boolean;
    author?: string;
    sortBy?: "popularity" | "date" | "name";
    sortOrder?: "asc" | "desc";
    limit?: number;
    offset?: number;
}

export interface CatalogSearchResult {
    items: TemplatePackV2[];
    total: number;
    hasMore: boolean;
}

/**
 * Get all available template packs (official + user-saved).
 * In the future this will call the backend API.
 */
export function getAllPacks(savedPacks: TemplatePackV2[]): TemplatePackV2[] {
    const officialPacks = DEFAULT_PACKS.map(pm => pm.data);
    return [...officialPacks, ...savedPacks];
}

/**
 * Search and filter template packs.
 * Simulates a backend catalog API with local filtering.
 */
export function searchPacks(
    params: CatalogSearchParams,
    savedPacks: TemplatePackV2[] = []
): CatalogSearchResult {
    let packs = getAllPacks(savedPacks);

    // Text search (name, description, tags)
    if (params.query) {
        const q = params.query.toLowerCase();
        packs = packs.filter(p =>
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.tags?.some(t => t.label.toLowerCase().includes(q))
        );
    }

    // Business unit filter
    if (params.businessUnits && params.businessUnits.length > 0) {
        packs = packs.filter(p =>
            p.businessUnits?.some(bu => params.businessUnits!.includes(bu))
        );
    }

    // Category filter
    if (params.categories && params.categories.length > 0) {
        packs = packs.filter(p =>
            p.categories?.some(c => params.categories!.includes(c))
        );
    }

    // Content type filter
    if (params.contentType) {
        packs = packs.filter(p => p.contentType === params.contentType);
    }

    // Occasion filter
    if (params.occasion) {
        packs = packs.filter(p => p.occasion === params.occasion);
    }

    // Tag filter
    if (params.tags && params.tags.length > 0) {
        packs = packs.filter(p =>
            params.tags!.some(tagId => p.tags?.some(t => t.id === tagId))
        );
    }

    // Official only
    if (params.onlyOfficial) {
        packs = packs.filter(p => p.isOfficial);
    }

    // My packs only
    if (params.onlyMine) {
        packs = packs.filter(p => !p.isOfficial);
    }

    // Author filter
    if (params.author) {
        packs = packs.filter(p => p.author === params.author);
    }

    // Sort
    const sortBy = params.sortBy || "popularity";
    const sortOrder = params.sortOrder || "desc";
    const multiplier = sortOrder === "desc" ? -1 : 1;

    packs.sort((a, b) => {
        switch (sortBy) {
            case "popularity":
                return (a.popularity - b.popularity) * multiplier;
            case "date":
                return (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * multiplier;
            case "name":
                return a.name.localeCompare(b.name) * multiplier;
            default:
                return 0;
        }
    });

    const total = packs.length;
    const offset = params.offset || 0;
    const limit = params.limit || 20;
    const paginated = packs.slice(offset, offset + limit);

    return {
        items: paginated,
        total,
        hasMore: offset + limit < total,
    };
}

/**
 * Get packs recommended for a specific business unit.
 */
export function getRecommendedPacks(
    businessUnit: BusinessUnit,
    savedPacks: TemplatePackV2[] = [],
    limit = 6
): TemplatePackV2[] {
    const result = searchPacks({
        businessUnits: [businessUnit],
        sortBy: "popularity",
        sortOrder: "desc",
        limit,
    }, savedPacks);

    // If not enough BU-specific packs, fill with general ones
    if (result.items.length < limit) {
        const generalResult = searchPacks({
            onlyOfficial: true,
            sortBy: "popularity",
            sortOrder: "desc",
            limit: limit - result.items.length,
        }, savedPacks);

        const existingIds = new Set(result.items.map(p => p.id));
        const additional = generalResult.items.filter(p => !existingIds.has(p.id));
        return [...result.items, ...additional].slice(0, limit);
    }

    return result.items;
}

/**
 * Get recently used packs (placeholder — will use real usage tracking).
 */
export function getRecentPacks(
    savedPacks: TemplatePackV2[] = [],
    limit = 4
): TemplatePackV2[] {
    return searchPacks({
        sortBy: "date",
        sortOrder: "desc",
        limit,
    }, savedPacks).items;
}

/**
 * Get all unique tags from all available packs.
 */
export function getAllTags(savedPacks: TemplatePackV2[] = []): { id: string; label: string; count: number }[] {
    const tagMap = new Map<string, { label: string; count: number }>();
    const allPacks = getAllPacks(savedPacks);

    allPacks.forEach(p => {
        p.tags?.forEach(t => {
            const existing = tagMap.get(t.id);
            if (existing) {
                existing.count++;
            } else {
                tagMap.set(t.id, { label: t.label, count: 1 });
            }
        });
    });

    return Array.from(tagMap.entries())
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => b.count - a.count);
}
