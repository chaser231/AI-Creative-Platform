// ─── Project ────────────────────────────────────────────
export type ProjectStatus = "draft" | "in-progress" | "review" | "published";
export type ProjectGoal = "banner" | "text" | "video" | "photo";
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
    createdBy?: {
        id: string;
        name: string;
        avatarUrl: string | null;
    };
}

// ─── Layer Binding (Phase 2: Master System v2) ──────────
/** @deprecated Legacy sync mode — use individual sync flags instead */
export type SyncMode = 'all' | 'content_and_style' | 'content_only' | 'none';

/**
 * How image geometry syncs from master to instance:
 * - "content"       — only src/objectFit/focus, instance keeps its own frame
 * - "relative_size" — image coverage (% of artboard) syncs, position grows from instance center
 * - "relative_full" — full proportional mapping of both size and position
 */
export type ImageSyncMode = "content" | "relative_size" | "relative_full";

export interface LayerBinding {
    masterLayerId: string;     // ID слоя в мастер-формате
    targetLayerId: string;     // ID слоя в этом формате

    // Granular sync flags (Phase 2.1)
    syncContent: boolean;      // text, src, label
    syncStyle: boolean;        // fill, fontSize, fontFamily, etc.
    syncSize: boolean;         // width, height
    syncPosition: boolean;     // x, y, rotation

    /** Image-specific geometry sync mode */
    imageSyncMode?: ImageSyncMode;

    /** @deprecated Use imageSyncMode instead */
    syncImageProportional?: boolean;

    /** @deprecated Legacy field — auto-migrated to flags on read */
    syncMode?: SyncMode;
}

/**
 * Migrate a legacy LayerBinding (syncMode enum) to flag-based format.
 * Safe to call on already-migrated bindings — flags take precedence.
 */
export function resolveImageSyncMode(binding: Partial<LayerBinding>): ImageSyncMode | undefined {
    if (binding.imageSyncMode) return binding.imageSyncMode;
    if (binding.syncImageProportional === true) return "relative_full";
    if (binding.syncImageProportional === false) return "content";
    return undefined;
}

export function migrateLegacyBinding(binding: Partial<LayerBinding> & { masterLayerId: string; targetLayerId: string }): LayerBinding {
    const imageSyncMode = resolveImageSyncMode(binding);

    if (binding.syncContent !== undefined) {
        return {
            masterLayerId: binding.masterLayerId,
            targetLayerId: binding.targetLayerId,
            syncContent: binding.syncContent ?? false,
            syncStyle: binding.syncStyle ?? false,
            syncSize: binding.syncSize ?? false,
            syncPosition: binding.syncPosition ?? false,
            imageSyncMode,
        };
    }

    const mode = binding.syncMode ?? 'content_only';
    return {
        masterLayerId: binding.masterLayerId,
        targetLayerId: binding.targetLayerId,
        syncContent: mode !== 'none',
        syncStyle: mode === 'content_and_style' || mode === 'all',
        syncSize: mode === 'all',
        syncPosition: mode === 'all',
        imageSyncMode,
    };
}

// ─── Resize Formats ─────────────────────────────────────
export type AdaptationDiagnosticCode =
    | "no-source-layers"
    | "invalid-layer-geometry"
    | "layer-out-of-bounds";

export interface AdaptationDiagnostic {
    code: AdaptationDiagnosticCode;
    severity: "warning";
    message: string;
    layerId?: string;
    layerName?: string;
}

export interface ResizeFormat {
    id: string;
    name: string;
    width: number;
    height: number;
    label: string; // e.g. "Instagram Post", "Facebook Cover"
    instancesEnabled: boolean; // true = receives content-source cascade from master
    layerSnapshot?: Layer[]; // per-format independent layer state (snapshot/page mode)

    // Phase 2: Master binding
    isMaster?: boolean;               // this format is the master source
    layerBindings?: LayerBinding[];   // per-layer sync config to master

    /** Warnings emitted when this format was created via smart adaptation. */
    adaptationDiagnostics?: AdaptationDiagnostic[];
    /** Source format id used for the last smart adaptation. */
    adaptedFromResizeId?: string;

    /**
     * Layout grids / safe zones for this format (Figma-like). Display-only
     * overlay guides that also act as snap targets; never exported.
     */
    layoutGrids?: LayoutGrid[];
}

// ─── Layout Grids (safe zones, Figma-like) ──────────────

export type LayoutGridType = "columns" | "rows" | "uniform" | "container";

/** Placement of fixed-size tracks within the available span (columns/rows). */
export type LayoutGridAlign = "stretch" | "min" | "center" | "max";

export interface LayoutGridMargins {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/**
 * A single layout grid layer. Multiple grids can be stacked per resize format.
 * Display-only: the overlay is a visual safe-zone guide and provides snap lines
 * for content; it is never part of the exported artwork.
 */
export interface LayoutGrid {
    id: string;
    type: LayoutGridType;
    /** Per-grid visibility toggle (independent of the global show/hide flag). */
    visible: boolean;
    /** Overlay color (hex). */
    color: string;
    /** Overlay opacity, 0..1. */
    opacity: number;

    // ── uniform pixel grid ──
    /** Cell size in px for the uniform grid. */
    cellSize?: number;

    // ── columns / rows ──
    /** Number of tracks (columns or rows). */
    count?: number;
    /** Gap between adjacent tracks, px. */
    gutter?: number;
    /** Outer margin (left/right for columns, top/bottom for rows), px. */
    margin?: number;
    /** Fixed track size (width for columns, height for rows); null = auto/stretch. */
    trackSize?: number | null;
    /** Placement of fixed-size tracks within the available span. */
    align?: LayoutGridAlign;

    // ── container (parametric, slice-like) ──
    cols?: number;
    rows?: number;
    /** Fixed px per column; null entries auto-share remaining width. */
    colSizes?: Array<number | null>;
    /** Fixed px per row; same semantics as colSizes. */
    rowSizes?: Array<number | null>;
    gapX?: number;
    gapY?: number;
    margins?: LayoutGridMargins;
}

export const DEFAULT_LAYOUT_GRID_COLOR = "#F24E1E";
export const DEFAULT_LAYOUT_GRID_OPACITY = 0.1;

/** Build a layout grid with sensible per-type defaults. */
export function createDefaultLayoutGrid(id: string, type: LayoutGridType): LayoutGrid {
    const base = {
        id,
        type,
        visible: true,
        color: DEFAULT_LAYOUT_GRID_COLOR,
        opacity: DEFAULT_LAYOUT_GRID_OPACITY,
    } as const;
    switch (type) {
        case "uniform":
            return { ...base, cellSize: 8 };
        case "columns":
            return { ...base, count: 12, gutter: 16, margin: 0, trackSize: null, align: "stretch" };
        case "rows":
            return { ...base, count: 4, gutter: 16, margin: 0, trackSize: null, align: "stretch" };
        case "container":
            return {
                ...base,
                cols: 3,
                rows: 1,
                colSizes: [],
                rowSizes: [],
                gapX: 16,
                gapY: 16,
                margins: { top: 0, right: 0, bottom: 0, left: 0 },
            };
    }
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
export type ComponentType = "text" | "image" | "rectangle" | "badge" | "frame" | "vector" | "slice";

export interface BaseComponentProps {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    flipX?: boolean;
    flipY?: boolean;
    visible: boolean;
    locked: boolean;
    opacity?: number; // 0–1, default 1
    slotId?: TemplateSlotRole;
    constraints?: {
        horizontal: "left" | "right" | "center" | "stretch" | "scale";
        vertical: "top" | "bottom" | "center" | "stretch" | "scale";
    };
    layoutSizingWidth?: "fixed" | "fill" | "hug";
    layoutSizingHeight?: "fixed" | "fill" | "hug";
    isAbsolutePositioned?: boolean;
    detachedSizeSync?: boolean;
    /** When true, this layer's content (e.g. image src) is locked by the template and cannot be overridden */
    isFixedAsset?: boolean;
    /** Links to palette swatches. When set, `fill`/`stroke`/text fill are driven by the referenced swatch. */
    swatchRefs?: SwatchRefs;
    /** Optional authoring hints for generated custom resize formats. */
    responsive?: LayerResponsiveSettings;
}

export type GradientType = "linear" | "radial" | "angular" | "diamond";

export interface PaintPoint {
    x: number; // normalized 0..1
    y: number; // normalized 0..1
}

export interface PaintStop {
    id: string;
    offset: number; // normalized 0..1
    color: string;
    opacity: number; // normalized 0..1
}

export interface SolidPaint {
    kind: "solid";
    color: string;
    opacity: number;
}

export interface GradientPaint {
    kind: "gradient";
    gradientType: GradientType;
    stops: PaintStop[];
    angle: number;
    start?: PaintPoint;
    end?: PaintPoint;
    center?: PaintPoint;
    radius?: number; // normalized against the largest side
}

/**
 * Fill values are intentionally backward compatible with legacy hex strings.
 * New code should normalize through `normalizePaint()` before rendering/editing.
 */
export type Paint = string | SolidPaint | GradientPaint;

export type FillMode = "paint" | "image";

export interface LayerImageFill {
    src: string;
    fit: ImageFitMode;
    opacity?: number;
    focusX?: number;
    focusY?: number;
    swatchRef?: string;
}

export interface TextComponentProps extends BaseComponentProps {
    type: "text";
    text: string;
    fontSize: number;
    fontFamily: string;
    fontWeight: string;
    fill: string;
    fillEnabled?: boolean; // default true
    align: "left" | "center" | "right";
    verticalAlign?: "top" | "middle" | "bottom";
    letterSpacing: number;
    lineHeight: number;
    textAdjust?: "auto_width" | "auto_height" | "fixed";
    truncateText?: boolean;
    verticalTrim?: boolean;
    /** Trim the container bottom to the text baseline (cuts descenders). */
    baselineTrim?: boolean;
    textTransform?: "none" | "uppercase" | "lowercase";
}

/** Stroke position relative to layer bounds (Figma-compatible). */
export type StrokeAlign = "inside" | "center" | "outside";

export const STROKE_ALIGN_LABELS: Record<StrokeAlign, string> = {
    inside: "Внутри",
    center: "По центру",
    outside: "Снаружи",
};

/** Corner join style for strokes (maps to Konva `lineJoin`). */
export type StrokeJoin = "miter" | "round" | "bevel";

export const STROKE_JOIN_LABELS: Record<StrokeJoin, string> = {
    miter: "Прямой",
    round: "Скруглённый",
    bevel: "Скошенный",
};

export interface CornerRadii {
    topLeft?: number;
    topRight?: number;
    bottomRight?: number;
    bottomLeft?: number;
}

export interface RectangleComponentProps extends BaseComponentProps {
    type: "rectangle";
    fill: Paint;
    fillMode?: FillMode;
    imageFill?: LayerImageFill;
    fillEnabled?: boolean; // default true
    stroke: Paint;
    strokeMode?: FillMode;
    strokeImage?: LayerImageFill;
    strokeEnabled?: boolean; // default true
    strokeWidth: number;
    strokeAlign?: StrokeAlign;
    strokeJoin?: StrokeJoin;
    cornerRadius: number;
    cornerRadii?: CornerRadii;
}

export type ImageFitMode = "cover" | "contain" | "fill" | "crop";

export const IMAGE_FIT_MODE_LABELS: Record<ImageFitMode, string> = {
    cover: "Заполнить",
    contain: "Вместить",
    fill: "Растянуть",
    crop: "Кадрировать",
};

/**
 * Normalized image viewing intent shared across formats.
 * Values are in the 0..1 range and describe the preferred focal point.
 */
export interface ImageViewIntent {
    focusX?: number;
    focusY?: number;
}

export interface ImageComponentProps extends BaseComponentProps, ImageViewIntent {
    type: "image";
    src: string;
    objectFit: ImageFitMode;
    fill?: Paint;
    fillMode?: FillMode;
    fillEnabled?: boolean; // default true
    stroke?: Paint;
    strokeMode?: FillMode;
    strokeImage?: LayerImageFill;
    strokeEnabled?: boolean; // default false
    strokeWidth?: number;
    strokeAlign?: StrokeAlign;
    strokeJoin?: StrokeJoin;
    cornerRadius?: number;
    cornerRadii?: CornerRadii;
}

export interface BadgeComponentProps extends BaseComponentProps {
    type: "badge";
    label: string;
    shape: "pill" | "rectangle" | "circle";
    fill: Paint;
    fillEnabled?: boolean; // default true
    textColor: string;
    fontSize: number;
}

export interface FrameComponentProps extends BaseComponentProps {
    type: "frame";
    fill: Paint;
    fillMode?: FillMode;
    imageFill?: LayerImageFill;
    fillEnabled?: boolean; // default true
    stroke: Paint;
    strokeMode?: FillMode;
    strokeImage?: LayerImageFill;
    strokeEnabled?: boolean; // default true
    strokeWidth: number;
    strokeAlign?: StrokeAlign;
    strokeJoin?: StrokeJoin;
    cornerRadius: number;
    cornerRadii?: CornerRadii;
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
    /** Groups nested text slots for coordinated AI generation */
    groupSlotId?: string;
}

/** Presets for AI text generation style */
export type TextGenPreset = "selling" | "informational" | "emotional" | "short" | "long";

export const TEXT_GEN_PRESET_LABELS: Record<TextGenPreset, string> = {
    selling: "Продающий",
    informational: "Информационный",
    emotional: "Эмоциональный",
    short: "Короткий",
    long: "Развёрнутый",
};

export type ComponentProps = TextComponentProps | RectangleComponentProps | ImageComponentProps | BadgeComponentProps | FrameComponentProps;

/** Which properties cascade from master to instances as "content source" */
export const CONTENT_SOURCE_KEYS: Record<ComponentType, string[]> = {
    text: ["text"],
    // For images, formats keep their own frame geometry.
    // We only cascade the shared asset plus viewing intent.
    image: ["src", "objectFit", "focusX", "focusY"],
    badge: ["label"],
    rectangle: [],
    frame: [],
    vector: [],
    slice: [],
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
export type ToolType = "select" | "text" | "rectangle" | "image" | "badge" | "frame" | "pen" | "slice";

// ─── Editor Mode ────────────────────────────────────────
export type EditorMode = "wizard" | "studio";

// ─── View Mode (single artboard vs overview grid) ───────
/**
 * Orthogonal to `EditorMode`: toggles between editing/previewing a single
 * active artboard (`single`) and a world-space overview of every format
 * laid out as a grid (`overview`, à la Figma Slides grid view).
 */
export type ViewMode = "single" | "overview";

// ─── Legacy Layer compat (used by Canvas renderer) ──────
export type LayerType = "text" | "image" | "rectangle" | "badge" | "frame" | "vector" | "slice";

export type TemplateSlotRole = 'headline' | 'subhead' | 'cta' | 'background' | 'image-primary' | 'logo' | 'none';

export type ConstraintH = "left" | "right" | "center" | "stretch" | "scale";
export type ConstraintV = "top" | "bottom" | "center" | "stretch" | "scale";

export interface LayerConstraints {
    horizontal: ConstraintH;
    vertical: ConstraintV;
}

export const DEFAULT_CONSTRAINTS: LayerConstraints = { horizontal: "left", vertical: "top" };

export type LayerResponsiveBehavior = "auto" | "fixed" | "fluid" | "background";

export type LayerTextFit = "shrink";

export interface LayerResponsiveSettings {
    role?: string;
    behavior?: LayerResponsiveBehavior;
    canHide?: boolean;
    minFontSize?: number;
    maxFontSize?: number;
    /** Adaptation-only: shrink font to fit a fixed text box (height overflow). */
    textFit?: LayerTextFit;
    /** Cap visible line count; pairs with ellipsis when text overflows the cap. */
    maxLines?: number;
    /** Clamp text container width/height on the adaptation path. */
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
}

// ─── Slice alignment (slice-aware automation) ───────────
// A third automation mechanism, independent of auto-layout and format
// adaptation: a layer (or its top-level frame) can re-position / re-scale so
// it does not get clipped by slice cut-lines when slices are created.

/** How a layer reacts to slice cut-lines. */
export type SliceAlignMode =
    /** Disabled — slices do not affect this layer. */
    | "none"
    /** Minimal shift so no slice cut-line crosses the layer (fully inside one cell). */
    | "avoid_cut"
    /** Proportionally scale to fit the nearest slice cell and center inside it. */
    | "fit";

/** What actually moves/scales when slice alignment applies. */
export type SliceAlignScope =
    /** Move/scale the layer's outermost (top-level) frame, keeping inner layout intact. */
    | "frame"
    /** Detach this layer (absolute) and move/scale only it. */
    | "layer";

/** Horizontal anchor for "fit" placement / scaling. */
export type SliceAlignH = "left" | "center" | "right";
/** Vertical anchor for "fit" placement / scaling. */
export type SliceAlignV = "top" | "center" | "bottom";

export interface SliceAlignSettings {
    mode: SliceAlignMode;
    scope: SliceAlignScope;
    /**
     * "fit" anchor. On an axis constrained by the slice cell, decides where the
     * scaled object sits inside the cell; on the free axis, decides which edge
     * stays fixed while scaling. Default center / center.
     */
    alignH?: SliceAlignH;
    alignV?: SliceAlignV;
    /**
     * "avoid_cut": also keep the layer from overlapping other content layers
     * while shifting it off the cut-lines (best-effort, cut-avoidance wins).
     */
    avoidOverlap?: boolean;
}

export const DEFAULT_SLICE_ALIGN: SliceAlignSettings = {
    mode: "none",
    scope: "frame",
    alignH: "center",
    alignV: "center",
    avoidOverlap: false,
};

/**
 * Auxiliary metadata attached to a layer.
 * Currently used for Figma round-trip: preserving the original Figma node ID
 * and the source `imageRef` so we can match layers when re-importing or exporting.
 * Never consumed by renderers — treated as opaque by the canvas.
 */
export interface LayerMetadata {
    /** Figma node id (e.g. "1:23") — preserved for future round-trip export/import */
    figmaNodeId?: string;
    /** Figma image reference hash for IMAGE fills — lets us reuse the same asset on re-import */
    figmaImageRef?: string;
    /** Original Figma node type if the layer is a lossy/rasterized conversion (e.g. "VECTOR", "BOOLEAN_OPERATION") */
    figmaOriginalType?: string;
    /** Non-fatal notes emitted during import (e.g. "mixed text styles collapsed") */
    figmaImportNotes?: string[];
}

export interface BaseLayer {
    id: string;
    type: LayerType;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    flipX?: boolean;
    flipY?: boolean;
    visible: boolean;
    locked: boolean;
    opacity?: number; // 0–1, default 1
    masterId?: string; // link to master component
    constraints?: LayerConstraints; // behaviour when parent frame resizes
    slotId?: TemplateSlotRole; // Smart Resize slot
    layoutSizingWidth?: "fixed" | "fill" | "hug";
    layoutSizingHeight?: "fixed" | "fill" | "hug";
    isAbsolutePositioned?: boolean;
    detachedSizeSync?: boolean;
    /** When true, this layer's content (e.g. image src) is locked by the template and cannot be overridden */
    isFixedAsset?: boolean;
    /** Links to palette swatches. When set, `fill`/`stroke`/text fill are driven by the referenced swatch. */
    swatchRefs?: SwatchRefs;
    /** Optional authoring hints for generated custom resize formats. */
    responsive?: LayerResponsiveSettings;
    /** Slice-aware automation: re-position / re-scale relative to slice cut-lines. */
    sliceAlign?: SliceAlignSettings;
    /** Opaque integration metadata (Figma, future Sketch/XD, etc.) */
    metadata?: LayerMetadata;
    /** When true, resize keeps width/height proportional (Figma chain-link lock). */
    lockAspectRatio?: boolean;
}

export interface TextLayer extends BaseLayer {
    type: "text";
    text: string;
    fontSize: number;
    fontFamily: string;
    fontWeight: string;
    fill: string;
    fillEnabled?: boolean; // default true
    align: "left" | "center" | "right";
    verticalAlign?: "top" | "middle" | "bottom";
    letterSpacing: number;
    lineHeight: number;
    textAdjust?: "auto_width" | "auto_height" | "fixed";
    truncateText?: boolean;
    verticalTrim?: boolean;
    /** Trim the container bottom to the text baseline (cuts descenders). */
    baselineTrim?: boolean;
    textTransform?: "none" | "uppercase" | "lowercase";
}

export interface RectangleLayer extends BaseLayer {
    type: "rectangle";
    fill: Paint;
    fillMode?: FillMode;
    imageFill?: LayerImageFill;
    fillEnabled?: boolean; // default true
    stroke: Paint;
    strokeMode?: FillMode;
    strokeImage?: LayerImageFill;
    strokeEnabled?: boolean; // default true
    strokeWidth: number;
    strokeAlign?: StrokeAlign;
    strokeJoin?: StrokeJoin;
    cornerRadius: number;
    cornerRadii?: CornerRadii;
}

export interface ImageLayer extends BaseLayer, ImageViewIntent {
    type: "image";
    src: string;
    objectFit?: ImageFitMode;
    fill?: Paint;
    fillMode?: FillMode;
    fillEnabled?: boolean; // default true
    stroke?: Paint;
    strokeMode?: FillMode;
    strokeImage?: LayerImageFill;
    strokeEnabled?: boolean; // default false
    strokeWidth?: number;
    strokeAlign?: StrokeAlign;
    strokeJoin?: StrokeJoin;
    cornerRadius?: number;
    cornerRadii?: CornerRadii;
}

export interface BadgeLayer extends BaseLayer {
    type: "badge";
    label: string;
    shape: "pill" | "rectangle" | "circle";
    fill: Paint;
    fillEnabled?: boolean; // default true
    textColor: string;
    fontSize: number;
}

export interface FrameLayer extends BaseLayer {
    type: "frame";
    fill: Paint;
    fillMode?: FillMode;
    imageFill?: LayerImageFill;
    fillEnabled?: boolean; // default true
    stroke: Paint;
    strokeMode?: FillMode;
    strokeImage?: LayerImageFill;
    strokeEnabled?: boolean; // default true
    strokeWidth: number;
    strokeAlign?: StrokeAlign;
    strokeJoin?: StrokeJoin;
    cornerRadius: number;
    cornerRadii?: CornerRadii;
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
    /** Groups nested text slots for coordinated AI generation */
    groupSlotId?: string;
}

// ─── Vector (editable path) ─────────────────────────────

export type VectorPointType = "corner" | "bezier";

/**
 * A single anchor point of a vector path. Coordinates are normalized to the
 * 0..1 range relative to the layer bounding box; control handles (`in`/`out`)
 * are absolute normalized positions, not offsets.
 */
export interface VectorAnchor {
    x: number;
    y: number;
    inX?: number;
    inY?: number;
    outX?: number;
    outY?: number;
    type: VectorPointType;
}

export interface VectorSubpath {
    points: VectorAnchor[];
    closed: boolean;
}

export interface VectorLayer extends BaseLayer {
    type: "vector";
    /** Editable geometry, normalized to the 0..1 unit box. */
    subpaths: VectorSubpath[];
    fillRule?: "nonzero" | "evenodd";
    fill: Paint;
    fillEnabled?: boolean; // default true
    stroke?: Paint;
    strokeEnabled?: boolean; // default false
    strokeWidth?: number;
    strokeAlign?: StrokeAlign;
    strokeJoin?: StrokeJoin;
    /** Optional fallback raw `d` (natural coords) used when subpaths are empty. */
    rawSvgPath?: string;
    viewBoxWidth?: number;
    viewBoxHeight?: number;
    /** Faithful SVG snippet (viewBox-sized) for boolean/subtract imports from Figma. */
    inlineSvg?: string;
    /** Backlink to a library/template SVG asset URL (when inserted from library). */
    src?: string;
}

// ─── Slice (export region, Figma-like) ──────────────────

/**
 * A slice marks a rectangular export region on the artboard. It renders only
 * as a studio-mode overlay (dashed outline + label), never appears in the
 * exported content itself, and is always top-level (never a frame child).
 */
export interface SliceLayer extends BaseLayer {
    type: "slice";
}

export type Layer = TextLayer | RectangleLayer | ImageLayer | BadgeLayer | FrameLayer | VectorLayer | SliceLayer;

/** Accepts any subset of layer properties without requiring the `type` discriminant. */
export type LayerUpdate = Partial<BaseLayer>
    & Partial<Omit<TextLayer, keyof BaseLayer | "fill">>
    & Partial<Omit<RectangleLayer, keyof BaseLayer | "fill">>
    & Partial<Omit<ImageLayer, keyof BaseLayer>>
    & Partial<Omit<BadgeLayer, keyof BaseLayer | "fill">>
    & Partial<Omit<FrameLayer, keyof BaseLayer | "fill">>
    & Partial<Omit<VectorLayer, keyof BaseLayer | "fill">>
    & { fill?: Paint };

// ─── Template Catalogization ────────────────────────────

export type TemplateCategory =
    | "in-app" | "performance" | "digital" | "offline"
    | "smm" | "showcase" | "email" | "other";

export type ContentType = "visual" | "video" | "audio" | "generative" | "mixed";

export type TemplateVisibility = "PRIVATE" | "WORKSPACE" | "PUBLIC" | "SHARED";

export type TemplateEditPermission = "AUTHOR_ONLY" | "WORKSPACE" | "SPECIFIC";

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

// ─── Palette / Swatches ─────────────────────────────────

/**
 * How a background image is fitted onto the artboard.
 * Matches the semantics of CSS `background-size` for cover/contain and
 * behaves like `fill` (stretch) when set to "fill".
 */
export type ArtboardBackgroundFit = "cover" | "contain" | "fill";

/**
 * Global artboard background image. Currently stored once on ArtboardProps
 * (shared across all resizes). Per-resize overrides are a future extension.
 */
export interface ArtboardBackgroundImage {
    src: string;
    fit: ArtboardBackgroundFit;
    /** 0..1, defaults to 1 */
    opacity?: number;
    /** 0..1, focal point (for cover/contain cropping) */
    focusX?: number;
    focusY?: number;
    /** If the background was applied from a swatch, keep a backlink for cascade updates */
    swatchRef?: string;
}

/** Which parts of a layer are driven by a swatch reference. */
export interface SwatchRefs {
    fill?: string;
    stroke?: string;
    /** Reserved for explicit text-fill swatch (separate from generic `fill`) */
    text?: string;
    /** Image-background swatch applied to an image layer's `src` */
    src?: string;
}

export type SwatchType = "color" | "background";

/**
 * Value of a background swatch — either a solid color or an image with fit/focus.
 * (Color swatches store their hex directly in `Swatch.value: string`.)
 */
export type BackgroundSwatchValue =
    | { kind: "solid"; color: string }
    | { kind: "gradient"; paint: GradientPaint }
    | {
          kind: "image";
          src: string;
          fit: ArtboardBackgroundFit;
          focusX?: number;
          focusY?: number;
      };

export interface Swatch {
    id: string;
    type: SwatchType;
    name: string;
    /** Paint for `type === "color"`, BackgroundSwatchValue for `type === "background"`. */
    value: Paint | BackgroundSwatchValue;
    sortOrder?: number;
}

export interface TemplatePalette {
    colors: Swatch[];
    backgrounds: Swatch[];
}

export const DEFAULT_PALETTE: TemplatePalette = { colors: [], backgrounds: [] };
