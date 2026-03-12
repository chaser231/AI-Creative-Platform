// ─── Project ────────────────────────────────────────────
export type ProjectStatus = "draft" | "in-progress" | "review" | "published";
export type ProjectGoal = "banner" | "text" | "video";
export type BusinessUnit = "yandex-market" | "yandex-go" | "yandex-food" | "other";

export interface Project {
    id: string;
    name: string;
    businessUnit: BusinessUnit;
    goal: ProjectGoal;
    status: ProjectStatus;
    createdAt: Date;
    updatedAt: Date;
    thumbnail?: string;
    templateId?: string;
    resizes: ResizeFormat[];
    activeResizeId: string;
}

// ─── Resize Formats ─────────────────────────────────────
export interface ResizeFormat {
    id: string;
    name: string;
    width: number;
    height: number;
    label: string; // e.g. "Instagram Post", "Facebook Cover"
    instancesEnabled: boolean; // true = receives content-source cascade from master
}

export const PRESET_FORMATS: ResizeFormat[] = [
    // Social
    { id: "instagram-post", name: "Instagram Post", width: 1080, height: 1080, label: "1080 × 1080", instancesEnabled: true },
    { id: "instagram-story", name: "Instagram Story", width: 1080, height: 1920, label: "1080 × 1920", instancesEnabled: true },
    { id: "facebook-cover", name: "Facebook Cover", width: 1200, height: 628, label: "1200 × 628", instancesEnabled: true },
    { id: "vk-post", name: "VK Post", width: 1000, height: 700, label: "1000 × 700", instancesEnabled: true },
    // Display Ads
    { id: "display-banner", name: "Display Banner", width: 300, height: 250, label: "300 × 250", instancesEnabled: true },
    { id: "leaderboard", name: "Leaderboard", width: 728, height: 90, label: "728 × 90", instancesEnabled: true },
    { id: "wide-skyscraper", name: "Wide Skyscraper", width: 160, height: 600, label: "160 × 600", instancesEnabled: true },
    { id: "billboard", name: "Billboard", width: 970, height: 250, label: "970 × 250", instancesEnabled: true },
    // Video
    { id: "youtube-thumb", name: "YouTube Thumbnail", width: 1280, height: 720, label: "1280 × 720", instancesEnabled: true },
    { id: "video-fullhd", name: "Full HD", width: 1920, height: 1080, label: "1920 × 1080", instancesEnabled: true },
];

export interface FormatPack {
    id: string;
    name: string;
    description: string;
    formatIds: string[];
}

export const FORMAT_PACKS: FormatPack[] = [
    {
        id: "social",
        name: "Соц. сети",
        description: "Instagram, Facebook, VK",
        formatIds: ["instagram-post", "instagram-story", "facebook-cover", "vk-post"],
    },
    {
        id: "display",
        name: "Дисплей",
        description: "Баннеры IAB",
        formatIds: ["display-banner", "leaderboard", "wide-skyscraper", "billboard"],
    },
    {
        id: "video",
        name: "Видео",
        description: "YouTube, Full HD",
        formatIds: ["youtube-thumb", "video-fullhd"],
    },
];

// ─── Creative Component (Master/Instance) ───────────────
export type ComponentType = "text" | "image" | "rectangle" | "badge" | "frame";

export interface BaseComponentProps {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    visible: boolean;
    locked: boolean;
    slotId?: TemplateSlotRole;
    constraints?: {
        horizontal: "left" | "right" | "center" | "stretch" | "scale";
        vertical: "top" | "bottom" | "center" | "stretch" | "scale";
    };
    layoutSizingWidth?: "fixed" | "fill" | "hug";
    layoutSizingHeight?: "fixed" | "fill" | "hug";
    isAbsolutePositioned?: boolean;
}

export interface TextComponentProps extends BaseComponentProps {
    type: "text";
    text: string;
    fontSize: number;
    fontFamily: string;
    fontWeight: string;
    fill: string;
    align: "left" | "center" | "right";
    letterSpacing: number;
    lineHeight: number;
    textAdjust?: "auto_width" | "auto_height" | "fixed";
    truncateText?: boolean;
    verticalTrim?: boolean;
}

export interface RectangleComponentProps extends BaseComponentProps {
    type: "rectangle";
    fill: string;
    stroke: string;
    strokeWidth: number;
    cornerRadius: number;
}

export interface ImageComponentProps extends BaseComponentProps {
    type: "image";
    src: string;
    objectFit: "cover" | "contain" | "fill";
}

export interface BadgeComponentProps extends BaseComponentProps {
    type: "badge";
    label: string;
    shape: "pill" | "rectangle" | "circle";
    fill: string;
    textColor: string;
    fontSize: number;
}

export interface FrameComponentProps extends BaseComponentProps {
    type: "frame";
    fill: string;
    stroke: string;
    strokeWidth: number;
    cornerRadius: number;
    clipContent: boolean;
    childIds: string[];
    layoutMode?: "none" | "horizontal" | "vertical";
    paddingTop?: number;
    paddingRight?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    spacing?: number;
    primaryAxisAlignItems?: "flex-start" | "center" | "flex-end" | "space-between";
    counterAxisAlignItems?: "flex-start" | "center" | "flex-end" | "stretch";
    primaryAxisSizingMode?: "fixed" | "auto";
    counterAxisSizingMode?: "fixed" | "auto";
}

export type ComponentProps = TextComponentProps | RectangleComponentProps | ImageComponentProps | BadgeComponentProps | FrameComponentProps;

/** Which properties cascade from master to instances as "content source" */
export const CONTENT_SOURCE_KEYS: Record<ComponentType, string[]> = {
    text: ["text"],
    image: ["src", "width", "height"],
    badge: ["label"],
    rectangle: [],
    frame: [],
};

/**
 * Master Component — the source of truth.
 * Only content-source properties cascade to instances.
 */
export interface MasterComponent {
    id: string;
    type: ComponentType;
    name: string;
    slotId?: string; // template slot this occupies
    props: ComponentProps;
}

/**
 * Component Instance — linked to a master, scoped to a specific resize.
 * Stores FULL local props. Only content-source keys are updated from master.
 */
export interface ComponentInstance {
    id: string;
    masterId: string;
    resizeId: string;
    localProps: ComponentProps; // full copy — layout stays local, only content cascades
}

// ─── Removed Legacy Template ──────────────────────────────
// ─── Brand Kit ──────────────────────────────────────────
export interface BrandColor {
    id: string;
    name: string;
    hex: string;
    usage?: string; // e.g. "Primary action", "Background"
}

export interface BrandFont {
    id: string;
    name: string;       // e.g. "Inter"
    weights: string[];  // e.g. ["400", "500", "600", "700"]
    usage?: string;     // e.g. "Headlines", "Body text"
}

export interface BrandKit {
    id: string;
    workspaceName: string;
    colors: BrandColor[];
    fonts: BrandFont[];
    toneOfVoice: string;   // System prompt for TOV
    logoUrl?: string;
}

// ─── Tool ───────────────────────────────────────────────
export type ToolType = "select" | "text" | "rectangle" | "image" | "badge" | "frame";

// ─── Editor Mode ────────────────────────────────────────
export type EditorMode = "wizard" | "studio";

// ─── Legacy Layer compat (used by Canvas renderer) ──────
export type LayerType = "text" | "image" | "rectangle" | "badge" | "frame";

export type TemplateSlotRole = 'headline' | 'subhead' | 'cta' | 'background' | 'image-primary' | 'logo' | 'none';

export type ConstraintH = "left" | "right" | "center" | "stretch" | "scale";
export type ConstraintV = "top" | "bottom" | "center" | "stretch" | "scale";

export interface LayerConstraints {
    horizontal: ConstraintH;
    vertical: ConstraintV;
}

export const DEFAULT_CONSTRAINTS: LayerConstraints = { horizontal: "left", vertical: "top" };

export interface BaseLayer {
    id: string;
    type: LayerType;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    visible: boolean;
    locked: boolean;
    masterId?: string; // link to master component
    constraints?: LayerConstraints; // behaviour when parent frame resizes
    slotId?: TemplateSlotRole; // Smart Resize slot
    layoutSizingWidth?: "fixed" | "fill" | "hug";
    layoutSizingHeight?: "fixed" | "fill" | "hug";
    isAbsolutePositioned?: boolean;
}

export interface TextLayer extends BaseLayer {
    type: "text";
    text: string;
    fontSize: number;
    fontFamily: string;
    fontWeight: string;
    fill: string;
    align: "left" | "center" | "right";
    letterSpacing: number;
    lineHeight: number;
    textAdjust?: "auto_width" | "auto_height" | "fixed";
    truncateText?: boolean;
    verticalTrim?: boolean;
}

export interface RectangleLayer extends BaseLayer {
    type: "rectangle";
    fill: string;
    stroke: string;
    strokeWidth: number;
    cornerRadius: number;
}

export interface ImageLayer extends BaseLayer {
    type: "image";
    src: string;
}

export interface BadgeLayer extends BaseLayer {
    type: "badge";
    label: string;
    shape: "pill" | "rectangle" | "circle";
    fill: string;
    textColor: string;
    fontSize: number;
}

export interface FrameLayer extends BaseLayer {
    type: "frame";
    fill: string;
    stroke: string;
    strokeWidth: number;
    cornerRadius: number;
    clipContent: boolean;
    childIds: string[];
    layoutMode?: "none" | "horizontal" | "vertical";
    paddingTop?: number;
    paddingRight?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    spacing?: number;
    primaryAxisAlignItems?: "flex-start" | "center" | "flex-end" | "space-between";
    counterAxisAlignItems?: "flex-start" | "center" | "flex-end" | "stretch";
    primaryAxisSizingMode?: "fixed" | "auto";
    counterAxisSizingMode?: "fixed" | "auto";
}

export type Layer = TextLayer | RectangleLayer | ImageLayer | BadgeLayer | FrameLayer;

// ─── Template Catalogization ────────────────────────────

export type TemplateCategory =
    | "in-app" | "performance" | "digital" | "offline"
    | "smm" | "showcase" | "email" | "other";

export type ContentType = "visual" | "video" | "audio" | "generative" | "mixed";

export type TemplateOccasion =
    | "default" | "black-friday" | "new-year" | "spring-sale"
    | "back-to-school" | "summer" | "custom";

export interface TemplateTag {
    id: string;
    label: string;
    color?: string;
}

/** Serialized layer node — preserves frame → children nesting */
export interface SerializedLayerNode {
    layer: Layer;
    masterId?: string;
    children?: SerializedLayerNode[];
}
