import type { TemplatePackV2 } from "@/services/templateService";

export interface TemplatePackMeta {
    id: string;
    name: string;
    description: string;
    thumbnailColor: string;
    data: TemplatePackV2;
}

export const DEFAULT_PACKS: TemplatePackMeta[] = [
    {
        id: "ecommerce-bundle",
        name: "E-commerce Bundle",
        description: "Готовый набор для товаров: Instagram Post + Story",
        thumbnailColor: "#4F46E5",
        data: {
            id: "ecommerce-bundle-data",
            version: "1.1.0",
            name: "E-commerce Bundle",
            description: "Default E-commerce Pack",
            baseWidth: 1080,
            baseHeight: 1080,

            // V2 catalog metadata
            businessUnits: ["yandex-market"],
            categories: ["smm", "performance"],
            contentType: "visual",
            occasion: "default",
            tags: [
                { id: "tag-ecom", label: "E-commerce", color: "#4F46E5" },
                { id: "tag-product", label: "Продуктовый" },
            ],
            author: "system",
            isOfficial: true,
            popularity: 42,
            createdAt: "2026-01-15T00:00:00Z",
            updatedAt: "2026-02-19T00:00:00Z",

            resizes: [
                { id: "post", name: "Instagram Post", width: 1080, height: 1080, label: "1080 × 1080", instancesEnabled: true },
                { id: "story", name: "Instagram Story", width: 1080, height: 1920, label: "1080 × 1920", instancesEnabled: true },
                { id: "cover", name: "Facebook Cover", width: 1200, height: 628, label: "1200 × 628", instancesEnabled: true }
            ],
            masterComponents: [
                {
                    id: "mc-bg", type: "rectangle", name: "Background",
                    props: { type: "rectangle", x: 0, y: 0, width: 1080, height: 1080, fill: "#F3F4F6", stroke: "", strokeWidth: 0, cornerRadius: 0, rotation: 0, visible: true, locked: true }
                },
                {
                    id: "mc-image", type: "image", name: "Product Image",
                    props: { type: "image", x: 140, y: 240, width: 800, height: 600, src: "", objectFit: "cover", rotation: 0, visible: true, locked: false }
                },
                {
                    id: "mc-title", type: "text", name: "Headline",
                    props: { type: "text", x: 140, y: 140, width: 800, height: 80, text: "SUMMER SALE", fontSize: 80, fontFamily: "Inter", fontWeight: "700", fill: "#111827", align: "center", letterSpacing: 0, lineHeight: 1.2, rotation: 0, visible: true, locked: false }
                },
                {
                    id: "mc-cta", type: "badge", name: "CTA",
                    props: { type: "badge", x: 390, y: 880, width: 300, height: 80, label: "Shop Now", shape: "pill", fill: "#4F46E5", textColor: "#FFFFFF", fontSize: 32, rotation: 0, visible: true, locked: false }
                }
            ],
            componentInstances: [
                {
                    id: "ci-bg-story", masterId: "mc-bg", resizeId: "story",
                    localProps: { type: "rectangle", x: 0, y: 0, width: 1080, height: 1920, fill: "#F3F4F6", stroke: "", strokeWidth: 0, cornerRadius: 0, rotation: 0, visible: true, locked: true }
                },
                {
                    id: "ci-image-story", masterId: "mc-image", resizeId: "story",
                    localProps: { type: "image", x: 0, y: 560, width: 1080, height: 800, src: "", objectFit: "cover", rotation: 0, visible: true, locked: false }
                },
                {
                    id: "ci-title-story", masterId: "mc-title", resizeId: "story",
                    localProps: { type: "text", x: 140, y: 300, width: 800, height: 120, text: "SUMMER SALE", fontSize: 100, fontFamily: "Inter", fontWeight: "700", fill: "#111827", align: "center", letterSpacing: 0, lineHeight: 1.2, rotation: 0, visible: true, locked: false }
                },
                {
                    id: "ci-cta-story", masterId: "mc-cta", resizeId: "story",
                    localProps: { type: "badge", x: 290, y: 1500, width: 500, height: 120, label: "Shop Now", shape: "pill", fill: "#4F46E5", textColor: "#FFFFFF", fontSize: 48, rotation: 0, visible: true, locked: false }
                }
            ]
        }
    },
    {
        id: "blog-bundle",
        name: "Blog Post Bundle",
        description: "Обложки для статей: Facebook + LinkedIn",
        thumbnailColor: "#10B981",
        data: {
            id: "blog-bundle-data",
            version: "1.1.0",
            name: "Blog Bundle",
            description: "Default Blog Pack",
            baseWidth: 1200,
            baseHeight: 630,

            // V2 catalog metadata
            businessUnits: ["other"],
            categories: ["smm", "digital"],
            contentType: "visual",
            occasion: "default",
            tags: [
                { id: "tag-blog", label: "Блог", color: "#10B981" },
                { id: "tag-content", label: "Контент-маркетинг" },
            ],
            author: "system",
            isOfficial: true,
            popularity: 28,
            createdAt: "2026-01-15T00:00:00Z",
            updatedAt: "2026-02-19T00:00:00Z",

            resizes: [
                { id: "linkedin", name: "LinkedIn Cover", width: 1584, height: 396, label: "1584 × 396", instancesEnabled: true }
            ],
            masterComponents: [
                {
                    id: "mc-bg-2", type: "rectangle", name: "Background",
                    props: { type: "rectangle", x: 0, y: 0, width: 1200, height: 630, fill: "#111827", stroke: "", strokeWidth: 0, cornerRadius: 0, rotation: 0, visible: true, locked: true }
                },
                {
                    id: "mc-tag-2", type: "badge", name: "Category Tag",
                    props: { type: "badge", x: 60, y: 60, width: 140, height: 40, label: "TECHNOLOGY", shape: "rectangle", fill: "#374151", textColor: "#60A5FA", fontSize: 14, rotation: 0, visible: true, locked: false }
                },
                {
                    id: "mc-title-2", type: "text", name: "Article Title",
                    props: { type: "text", x: 60, y: 140, width: 1000, height: 200, text: "The Future of AI Design", fontSize: 72, fontFamily: "Inter", fontWeight: "700", fill: "#FFFFFF", align: "left", letterSpacing: -1, lineHeight: 1.1, rotation: 0, visible: true, locked: false }
                },
                {
                    id: "mc-author-2", type: "text", name: "Author",
                    props: { type: "text", x: 60, y: 500, width: 400, height: 40, text: "By Alex Writer", fontSize: 24, fontFamily: "Inter", fontWeight: "400", fill: "#9CA3AF", align: "left", letterSpacing: 0, lineHeight: 1.5, rotation: 0, visible: true, locked: false }
                }
            ],
            componentInstances: [
                {
                    id: "ci-bg-link", masterId: "mc-bg-2", resizeId: "linkedin",
                    localProps: { type: "rectangle", x: 0, y: 0, width: 1584, height: 396, fill: "#111827", stroke: "", strokeWidth: 0, cornerRadius: 0, rotation: 0, visible: true, locked: true }
                },
                {
                    id: "ci-tag-link", masterId: "mc-tag-2", resizeId: "linkedin",
                    localProps: { type: "badge", x: 80, y: 40, width: 140, height: 40, label: "TECHNOLOGY", shape: "rectangle", fill: "#374151", textColor: "#60A5FA", fontSize: 14, rotation: 0, visible: true, locked: false }
                },
                {
                    id: "ci-title-link", masterId: "mc-title-2", resizeId: "linkedin",
                    localProps: { type: "text", x: 80, y: 100, width: 1000, height: 160, text: "The Future of AI Design", fontSize: 64, fontFamily: "Inter", fontWeight: "700", fill: "#FFFFFF", align: "left", letterSpacing: -1, lineHeight: 1.1, rotation: 0, visible: true, locked: false }
                },
                {
                    id: "ci-author-link", masterId: "mc-author-2", resizeId: "linkedin",
                    localProps: { type: "text", x: 80, y: 300, width: 400, height: 40, text: "By Alex Writer", fontSize: 20, fontFamily: "Inter", fontWeight: "400", fill: "#9CA3AF", align: "left", letterSpacing: 0, lineHeight: 1.5, rotation: 0, visible: true, locked: false }
                }
            ]
        }
    }
];
