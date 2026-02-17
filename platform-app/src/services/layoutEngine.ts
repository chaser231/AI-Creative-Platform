import type { Layer, TemplateSlotRole, ResizeFormat } from "@/types";

export interface LayoutRule {
    slotId: TemplateSlotRole;
    formatId: string; // e.g. "instagram-story" or "*"
    constraints: {
        top?: string; // e.g. "20%" or "100px"
        bottom?: string;
        left?: string;
        right?: string;
        centerX?: boolean;
        centerY?: boolean;
        width?: string;
        height?: string;
        scale?: number;
    };
}

const RULES: LayoutRule[] = [
    // Instagram Story Rules
    {
        slotId: "headline",
        formatId: "instagram-story",
        constraints: { top: "15%", centerX: true, width: "80%" }
    },
    {
        slotId: "subhead",
        formatId: "instagram-story",
        constraints: { top: "25%", centerX: true, width: "70%" }
    },
    {
        slotId: "cta",
        formatId: "instagram-story",
        constraints: { bottom: "10%", centerX: true }
    },
    {
        slotId: "background",
        formatId: "*",
        constraints: { top: "0", left: "0", width: "100%", height: "100%" }
    },
    // Instagram Post Rules
    {
        slotId: "headline",
        formatId: "instagram-post",
        constraints: { top: "10%", left: "10%", width: "80%" }
    },
    {
        slotId: "cta",
        formatId: "instagram-post",
        constraints: { bottom: "10%", right: "10%" }
    }
];

export function applyLayout(layers: Layer[], format: ResizeFormat): Layer[] {
    return layers.map(layer => {
        if (!layer.slotId || layer.slotId === "none") return layer;

        // Find applicable rule
        const rule = RULES.find(r =>
            r.slotId === layer.slotId &&
            (r.formatId === format.id || r.formatId === "*")
        );

        if (!rule) return layer;

        // Apply constraints
        const newLayer = { ...layer };
        const c = rule.constraints;
        const fw = format.width;
        const fh = format.height;

        // Helper to parse value (percent or px)
        const parse = (val: string, dim: number) => {
            if (val.endsWith("%")) {
                return (parseFloat(val) / 100) * dim;
            }
            return parseFloat(val);
        };

        if (c.width) newLayer.width = parse(c.width, fw);
        if (c.height) newLayer.height = parse(c.height, fh);

        let x = newLayer.x;
        let y = newLayer.y;

        if (c.left) x = parse(c.left, fw);
        if (c.right) x = fw - parse(c.right, fw) - newLayer.width;
        if (c.centerX) x = (fw - newLayer.width) / 2;

        if (c.top) y = parse(c.top, fh);
        if (c.bottom) y = fh - parse(c.bottom, fh) - newLayer.height;
        if (c.centerY) y = (fh - newLayer.height) / 2;

        newLayer.x = x;
        newLayer.y = y;

        return newLayer;
    });
}
