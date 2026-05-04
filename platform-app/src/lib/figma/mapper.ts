/**
 * FigmaMapper — converts Figma document nodes into our internal Layer tree.
 *
 * Design goals:
 *  - Pure functions: no I/O, no globals, no side-effects. Easy to unit-test.
 *  - Report every lossy conversion so the UI can surface an honest "we lost these"
 *    summary to the user.
 *  - Translate auto-layout 1:1 — our `layoutEngine` accepts the same semantics
 *    as Figma's, so geometry round-trips exactly for supported cases.
 *  - Preserve `figmaNodeId` on every layer so future exports/round-trips can
 *    merge back into the same source file.
 *
 * Unsupported today (Phase 1):
 *  - Vector / Boolean nodes → rasterized as ImageLayer (svg URL is fetched by worker).
 *  - Gradients / multi-fill → flattened to first solid fill; warning emitted.
 *  - Effects (shadows/blurs) → ignored; warning emitted.
 *  - Stroke align / dashes → lost, only weight + color preserved.
 *  - Text with mixed character styles → collapsed to node-level style.
 */

import { v4 as uuid } from "uuid";
import type {
    CanvasNode,
    Component,
    DocumentNode,
    FrameNode,
    InstanceNode,
    LayoutConstraint,
    Node,
    Paint,
    Rectangle,
    RGBA,
    SubcanvasNode,
    TypeStyle,
} from "@figma/rest-api-spec";
import type {
    ConstraintH,
    ConstraintV,
    FrameLayer,
    ImageLayer,
    Layer,
    LayerConstraints,
    RectangleLayer,
    TextLayer,
} from "@/types";
import type {
    FigmaImportOptions,
    ImportReport,
    LossyReason,
} from "./types";
import { DEFAULT_IMPORT_OPTIONS, emptyReport } from "./types";

// ─── Public API ─────────────────────────────────────────────────────────────

export interface MapperOptions extends FigmaImportOptions {
    /**
     * If provided, only descendants of this node become layers. Coordinates are
     * re-based so the target frame sits at (0,0).
     */
    rootNodeId?: string;
}

export interface MapperPage {
    pageId: string;
    pageName: string;
    /** Top-level frames found on this page. */
    frames: MapperFrame[];
}

export interface MapperFrame {
    /** Figma node id of the top-level frame. */
    figmaNodeId: string;
    /** User-visible name (used as ResizeFormat name). */
    name: string;
    width: number;
    height: number;
    /** Flat list of all layers in the frame (frame + descendants). First item is the root FrameLayer. */
    layers: Layer[];
    /** Ids of vector/raster nodes that need to be fetched via `/v1/images`. */
    nodesToRender: Array<{ nodeId: string; targetLayerId: string; format: "svg" | "png" }>;
    /** imageRefs referenced by IMAGE fills on any layer. */
    imageRefs: Array<{ imageRef: string; targetLayerId: string }>;
}

export interface MapperResult {
    /** Per-page groupings. Always at least one — empty pages produce an empty `frames` array. */
    pages: MapperPage[];
    /** Accumulated warnings / stats across all pages. */
    report: ImportReport;
}

/**
 * Entry point — walk a full Figma GetFileResponse document and produce a
 * MapperResult ready for the import worker to post-process (asset download +
 * Prisma persistence).
 */
export function mapFigmaDocument(
    document: DocumentNode,
    components: Record<string, Component> | undefined,
    options?: MapperOptions,
): MapperResult {
    const opts = { ...DEFAULT_IMPORT_OPTIONS, ...options };
    const report = emptyReport();

    const pages: MapperPage[] = [];
    const ctx = makeCtx(report, opts, components ?? {});

    // ── Pass 1 ──────────────────────────────────────────────────────────────
    // Pre-assign layer ids to every COMPONENT node anywhere in the document so
    // that subsequent INSTANCE → COMPONENT resolution doesn't depend on the
    // order in which pages/nodes happen to be traversed. Figma libraries often
    // keep components on a dedicated page that may appear after the page using
    // them — without this pass, those `masterId` links would be silently lost.
    preassignComponentIds(document, ctx);

    // ── Pass 2: full mapping ────────────────────────────────────────────────
    for (const canvas of document.children) {
        if (canvas.type !== "CANVAS") continue;
        report.stats.pagesSeen++;

        const frames: MapperFrame[] = [];
        for (const topNode of canvas.children) {
            // Only FRAME / COMPONENT / COMPONENT_SET / SECTION become "formats".
            // Other top-level shapes are rare in banner files; import them as
            // standalone frames wrapped in a synthetic FrameLayer so they still show up.
            const mapped = mapTopLevelNode(topNode, ctx);
            if (mapped) frames.push(mapped);
        }

        pages.push({
            pageId: canvas.id,
            pageName: canvas.name,
            frames,
        });
    }

    // ── Pass 3: resolve any late-bound instance links ───────────────────────
    for (const pending of ctx.pendingInstances) {
        const masterId = ctx.componentLayerIds.get(pending.componentId);
        if (masterId) {
            pending.layer.masterId = masterId;
            ctx.report.stats.instancesCreated++;
        }
    }

    return { pages, report };
}

/**
 * Walks the full document and reserves a stable `uuid` for every node whose
 * type is `COMPONENT` (or `COMPONENT_SET`, which also acts as a source of
 * instance lookups). We deliberately do NOT touch `figmaToLayerId` here — the
 * full mapper is free to overwrite the assignment when it later visits the
 * same node.
 */
function preassignComponentIds(doc: DocumentNode, ctx: MapCtx): void {
    const stack: Node[] = [doc];
    while (stack.length > 0) {
        const node = stack.pop()!;
        const nodeType = (node as { type?: string }).type;
        if (nodeType === "COMPONENT" || nodeType === "COMPONENT_SET") {
            const id = (node as { id?: string }).id;
            if (id && !ctx.componentLayerIds.has(id)) {
                const layerId = uuid();
                ctx.componentLayerIds.set(id, layerId);
                ctx.figmaToLayerId.set(id, layerId);
            }
        }
        const children = (node as { children?: Node[] }).children;
        if (children) stack.push(...children);
    }
}

/**
 * Walk a document and keep only the subtree rooted at `rootNodeId`, returning
 * a single frame as if it were a page.
 */
export function findNodeById(doc: DocumentNode, nodeId: string): Node | null {
    const stack: Node[] = [doc];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if ((node as { id?: string }).id === nodeId) return node;
        const children = (node as { children?: Node[] }).children;
        if (children) stack.push(...children);
    }
    return null;
}

// ─── Internal: mapping context ─────────────────────────────────────────────

interface PendingInstanceLink {
    layer: Layer;
    componentId: string;
}

interface MapCtx {
    report: ImportReport;
    opts: Required<FigmaImportOptions>;
    components: Record<string, Component>;
    /** Figma node id → generated layer id, used to resolve master/instance links. */
    figmaToLayerId: Map<string, string>;
    /** Figma component id → generated layer id of the matching COMPONENT node. */
    componentLayerIds: Map<string, string>;
    /**
     * INSTANCE nodes whose `componentId` wasn't resolved at mapping time. We
     * attempt a second pass after the full tree is walked so the link can
     * still be set if the component lives in a page we haven't visited yet.
     */
    pendingInstances: PendingInstanceLink[];
}

function makeCtx(
    report: ImportReport,
    opts: Required<FigmaImportOptions>,
    components: Record<string, Component>,
): MapCtx {
    return {
        report,
        opts,
        components,
        figmaToLayerId: new Map(),
        componentLayerIds: new Map(),
        pendingInstances: [],
    };
}

function warn(
    ctx: MapCtx,
    node: { id: string; name: string },
    reason: LossyReason,
    message?: string,
): void {
    ctx.report.warnings.push({
        nodeId: node.id,
        nodeName: node.name,
        reason,
        message,
    });
}

/**
 * Sets `layer.masterId` from the given Figma `componentId`, deferring the link
 * to the end-of-walk resolution pass if the COMPONENT hasn't been mapped yet.
 * Pre-assignment in pass 1 makes this deferral rare, but we keep the safety
 * net for files where the component lives in an unreachable subtree (e.g. a
 * shared library not yet included in the response).
 */
function linkInstance(layer: Layer, componentId: string | undefined, ctx: MapCtx): void {
    if (!componentId) return;
    const masterLayerId = ctx.componentLayerIds.get(componentId);
    if (masterLayerId) {
        layer.masterId = masterLayerId;
        ctx.report.stats.instancesCreated++;
        return;
    }
    ctx.pendingInstances.push({ layer, componentId });
}

function skip(ctx: MapCtx, node: { id: string; name: string; type: string }): void {
    ctx.report.skippedNodes.push({
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
    });
}

// ─── Top-level frame mapping ───────────────────────────────────────────────

function mapTopLevelNode(node: SubcanvasNode, ctx: MapCtx): MapperFrame | null {
    // Tolerate any "frame-like" top-level node: FRAME, COMPONENT, COMPONENT_SET, GROUP, INSTANCE, SECTION.
    if (
        node.type !== "FRAME" &&
        node.type !== "COMPONENT" &&
        node.type !== "COMPONENT_SET" &&
        node.type !== "GROUP" &&
        node.type !== "INSTANCE" &&
        node.type !== "SECTION"
    ) {
        skip(ctx, node);
        return null;
    }

    const bbox = (node as { absoluteBoundingBox?: Rectangle | null }).absoluteBoundingBox;
    const width = bbox?.width ?? 0;
    const height = bbox?.height ?? 0;
    const originX = bbox?.x ?? 0;
    const originY = bbox?.y ?? 0;

    const frame: MapperFrame = {
        figmaNodeId: node.id,
        name: node.name || "Frame",
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
        layers: [],
        nodesToRender: [],
        imageRefs: [],
    };

        // Reuse a pre-assigned layer id if this is a COMPONENT we already
        // registered in pass 1, so any INSTANCE that was mapped earlier can
        // link to the same uuid.
        const preassigned = ctx.componentLayerIds.get(node.id);
        const rootLayerId = preassigned ?? uuid();
        ctx.figmaToLayerId.set(node.id, rootLayerId);
        if ((node.type === "COMPONENT" || node.type === "COMPONENT_SET") && !preassigned) {
            ctx.componentLayerIds.set(node.id, rootLayerId);
        }

    const childIds: string[] = [];
    const children: SubcanvasNode[] | undefined = (node as FrameNode).children as SubcanvasNode[] | undefined;
    if (children) {
        for (const child of children) {
            const mappedChild = mapNode(child, originX, originY, ctx, frame);
            if (mappedChild) {
                childIds.push(mappedChild.id);
            }
        }
    }

    const rootLayer: FrameLayer = {
        id: rootLayerId,
        type: "frame",
        name: node.name || "Frame",
        x: 0,
        y: 0,
        width: frame.width,
        height: frame.height,
        rotation: 0,
        visible: node.visible !== false,
        locked: !!(node as { locked?: boolean }).locked,
        opacity: readOpacity(node),
        constraints: readConstraints((node as { constraints?: LayoutConstraint }).constraints),
        ...resolveFills(node, ctx, frame, rootLayerId, "rectangle"),
        stroke: resolveStrokeColor(node),
        strokeEnabled: hasVisibleStroke(node),
        strokeWidth: readStrokeWeight(node),
        cornerRadius: readCornerRadius(node),
        clipContent: (node as { clipsContent?: boolean }).clipsContent ?? true,
        childIds,
        ...readAutoLayout(node),
        metadata: { figmaNodeId: node.id, figmaOriginalType: node.type },
    };

    frame.layers.unshift(rootLayer);
    ctx.report.stats.layersCreated++;

        // Top-level INSTANCE frames still need their master link resolved.
        if (node.type === "INSTANCE") {
            linkInstance(rootLayer, (node as InstanceNode).componentId, ctx);
        }

    return frame;
}

// ─── Recursive node → Layer mapping ────────────────────────────────────────

function mapNode(
    node: SubcanvasNode,
    originX: number,
    originY: number,
    ctx: MapCtx,
    frame: MapperFrame,
): Layer | null {
    ctx.report.stats.nodesSeen++;

    switch (node.type) {
        case "FRAME":
        case "GROUP":
        case "COMPONENT":
        case "COMPONENT_SET":
        case "SECTION":
            return mapFrame(node, originX, originY, ctx, frame);

        case "INSTANCE":
            return mapInstance(node, originX, originY, ctx, frame);

        case "TEXT":
            return mapText(node, originX, originY, ctx, frame);

        case "RECTANGLE":
            return mapRectangle(node, originX, originY, ctx, frame);

        case "ELLIPSE":
        case "REGULAR_POLYGON":
        case "STAR":
            return mapShape(node, originX, originY, ctx, frame);

        case "LINE":
        case "VECTOR":
        case "BOOLEAN_OPERATION":
            return mapVector(node, originX, originY, ctx, frame);

        default:
            skip(ctx, node);
            warn(ctx, node, "unsupported_node_type", `Unsupported node type: ${node.type}`);
            return null;
    }
}

function mapFrame(
    node: SubcanvasNode,
    originX: number,
    originY: number,
    ctx: MapCtx,
    frame: MapperFrame,
): FrameLayer | null {
    const bbox = (node as { absoluteBoundingBox?: Rectangle | null }).absoluteBoundingBox;
    if (!bbox) return null;

    const preassigned = ctx.componentLayerIds.get(node.id);
    const id = preassigned ?? uuid();
    ctx.figmaToLayerId.set(node.id, id);
    if ((node.type === "COMPONENT" || node.type === "COMPONENT_SET") && !preassigned) {
        ctx.componentLayerIds.set(node.id, id);
    }

    const childIds: string[] = [];
    const children = (node as FrameNode).children as SubcanvasNode[] | undefined;
    if (children) {
        for (const child of children) {
            const mapped = mapNode(child, originX, originY, ctx, frame);
            if (mapped) childIds.push(mapped.id);
        }
    }

    const layer: FrameLayer = {
        id,
        type: "frame",
        name: node.name || "Frame",
        x: Math.round(bbox.x - originX),
        y: Math.round(bbox.y - originY),
        width: Math.max(1, Math.round(bbox.width)),
        height: Math.max(1, Math.round(bbox.height)),
        rotation: readRotation(node),
        visible: node.visible !== false,
        locked: !!(node as { locked?: boolean }).locked,
        opacity: readOpacity(node),
        constraints: readConstraints((node as { constraints?: LayoutConstraint }).constraints),
        ...resolveFills(node, ctx, frame, id, "rectangle"),
        stroke: resolveStrokeColor(node),
        strokeEnabled: hasVisibleStroke(node),
        strokeWidth: readStrokeWeight(node),
        cornerRadius: readCornerRadius(node),
        clipContent: (node as { clipsContent?: boolean }).clipsContent ?? false,
        childIds,
        ...readAutoLayout(node),
        metadata: { figmaNodeId: node.id, figmaOriginalType: node.type },
    };
    frame.layers.push(layer);
    ctx.report.stats.layersCreated++;
    return layer;
}

function mapInstance(
    node: SubcanvasNode,
    originX: number,
    originY: number,
    ctx: MapCtx,
    frame: MapperFrame,
): FrameLayer | null {
    // We map an instance the same as a frame, but also record the master link
    // once the parent component has been discovered.
    const layer = mapFrame(node, originX, originY, ctx, frame);
    if (!layer) return null;

    linkInstance(layer, (node as InstanceNode).componentId, ctx);
    return layer;
}

function mapText(
    node: SubcanvasNode,
    originX: number,
    originY: number,
    ctx: MapCtx,
    frame: MapperFrame,
): TextLayer | null {
    const bbox = (node as { absoluteBoundingBox?: Rectangle | null }).absoluteBoundingBox;
    if (!bbox) return null;

    const characters = (node as { characters?: string }).characters ?? "";
    const style = (node as { style?: TypeStyle }).style ?? {};
    const fills = (node as { fills?: Paint[] }).fills ?? [];
    const characterStyleOverrides = (node as { characterStyleOverrides?: number[] }).characterStyleOverrides;

    if (characterStyleOverrides && characterStyleOverrides.some((x) => x !== 0)) {
        warn(ctx, node, "mixed_text_styles_collapsed", "Character-level styles collapsed to node style");
    }

    const id = uuid();
    ctx.figmaToLayerId.set(node.id, id);

    // Letter spacing: Figma returns a value in px (already absolute — not %).
    const letterSpacing = typeof style.letterSpacing === "number" ? style.letterSpacing : 0;

    // Line height: prefer explicit px; fall back to % of font size.
    const fontSize = style.fontSize ?? 16;
    let lineHeight = 1.2; // relative multiplier, matches our renderer's expectation
    if (style.lineHeightUnit === "PIXELS" && style.lineHeightPx) {
        lineHeight = fontSize > 0 ? style.lineHeightPx / fontSize : 1.2;
    } else if (style.lineHeightPercentFontSize) {
        lineHeight = style.lineHeightPercentFontSize / 100;
    }

    // Text alignment: we don't support JUSTIFIED — degrade to LEFT.
    let align: TextLayer["align"] = "left";
    if (style.textAlignHorizontal === "CENTER") align = "center";
    else if (style.textAlignHorizontal === "RIGHT") align = "right";
    else if (style.textAlignHorizontal === "JUSTIFIED") {
        align = "left";
        warn(ctx, node, "justified_text_lost", "Justified alignment is not supported; left used");
    }

    let verticalAlign: TextLayer["verticalAlign"] = "top";
    if (style.textAlignVertical === "CENTER") verticalAlign = "middle";
    else if (style.textAlignVertical === "BOTTOM") verticalAlign = "bottom";

    // Text case / decoration
    let textTransform: TextLayer["textTransform"] = "none";
    if (style.textCase === "UPPER") textTransform = "uppercase";
    else if (style.textCase === "LOWER") textTransform = "lowercase";
    else if (style.textCase && style.textCase !== "ORIGINAL") {
        warn(ctx, node, "unsupported_text_case", `Text case ${style.textCase} not supported`);
    }

    if (style.textDecoration && style.textDecoration !== "NONE") {
        warn(ctx, node, "unsupported_text_decoration", `Decoration ${style.textDecoration} ignored`);
    }

    // Determine the visible fill colour. Text uses its own `fills`; first solid wins.
    const fill = firstSolidHex(fills) ?? "#000000";
    const fillEnabled = fills.length > 0 && (fills[0]?.visible ?? true);

    // textAutoResize → our textAdjust.
    let textAdjust: TextLayer["textAdjust"] = "fixed";
    if (style.textAutoResize === "WIDTH_AND_HEIGHT") textAdjust = "auto_width";
    else if (style.textAutoResize === "HEIGHT") textAdjust = "auto_height";

    const layer: TextLayer = {
        id,
        type: "text",
        name: node.name || "Text",
        x: Math.round(bbox.x - originX),
        y: Math.round(bbox.y - originY),
        width: Math.max(1, Math.round(bbox.width)),
        height: Math.max(1, Math.round(bbox.height)),
        rotation: readRotation(node),
        visible: node.visible !== false,
        locked: !!(node as { locked?: boolean }).locked,
        opacity: readOpacity(node),
        constraints: readConstraints((node as { constraints?: LayoutConstraint }).constraints),
        text: characters,
        fontSize,
        fontFamily: style.fontFamily ?? "Inter",
        fontWeight: style.fontWeight ? String(style.fontWeight) : "400",
        fill,
        fillEnabled,
        align,
        verticalAlign,
        letterSpacing,
        lineHeight,
        textAdjust,
        textTransform,
        metadata: { figmaNodeId: node.id, figmaOriginalType: node.type },
    };

    frame.layers.push(layer);
    ctx.report.stats.layersCreated++;
    return layer;
}

function mapRectangle(
    node: SubcanvasNode,
    originX: number,
    originY: number,
    ctx: MapCtx,
    frame: MapperFrame,
): RectangleLayer | ImageLayer | null {
    const bbox = (node as { absoluteBoundingBox?: Rectangle | null }).absoluteBoundingBox;
    if (!bbox) return null;

    const id = uuid();
    ctx.figmaToLayerId.set(node.id, id);

    const fills = (node as { fills?: Paint[] }).fills ?? [];
    const primaryImageFill = fills.find((p): p is Paint & { type: "IMAGE"; imageRef: string } =>
        p.type === "IMAGE" && "imageRef" in p && !!(p as { imageRef: string }).imageRef,
    );

    if (primaryImageFill) {
        frame.imageRefs.push({ imageRef: primaryImageFill.imageRef, targetLayerId: id });
        const layer: ImageLayer = {
            id,
            type: "image",
            name: node.name || "Image",
            x: Math.round(bbox.x - originX),
            y: Math.round(bbox.y - originY),
            width: Math.max(1, Math.round(bbox.width)),
            height: Math.max(1, Math.round(bbox.height)),
            rotation: readRotation(node),
            visible: node.visible !== false,
            locked: !!(node as { locked?: boolean }).locked,
            opacity: readOpacity(node),
            constraints: readConstraints((node as { constraints?: LayoutConstraint }).constraints),
            src: "", // populated by the worker once the image has been uploaded to S3
            objectFit: mapImageScaleMode(primaryImageFill.scaleMode),
            metadata: {
                figmaNodeId: node.id,
                figmaOriginalType: node.type,
                figmaImageRef: primaryImageFill.imageRef,
            },
        };
        frame.layers.push(layer);
        ctx.report.stats.layersCreated++;
        return layer;
    }

    const layer: RectangleLayer = {
        id,
        type: "rectangle",
        name: node.name || "Rectangle",
        x: Math.round(bbox.x - originX),
        y: Math.round(bbox.y - originY),
        width: Math.max(1, Math.round(bbox.width)),
        height: Math.max(1, Math.round(bbox.height)),
        rotation: readRotation(node),
        visible: node.visible !== false,
        locked: !!(node as { locked?: boolean }).locked,
        opacity: readOpacity(node),
        constraints: readConstraints((node as { constraints?: LayoutConstraint }).constraints),
        ...resolveFills(node, ctx, frame, id, "rectangle"),
        stroke: resolveStrokeColor(node),
        strokeEnabled: hasVisibleStroke(node),
        strokeWidth: readStrokeWeight(node),
        cornerRadius: readCornerRadius(node),
        metadata: { figmaNodeId: node.id, figmaOriginalType: node.type },
    };
    frame.layers.push(layer);
    ctx.report.stats.layersCreated++;
    return layer;
}

function mapShape(
    node: SubcanvasNode,
    originX: number,
    originY: number,
    ctx: MapCtx,
    frame: MapperFrame,
): RectangleLayer | null {
    // ELLIPSE / STAR / REGULAR_POLYGON → rasterize to RectangleLayer w/ cornerRadius.
    // For ellipses we set cornerRadius = min(w,h)/2 so the canvas renderer shows a pill/circle.
    const bbox = (node as { absoluteBoundingBox?: Rectangle | null }).absoluteBoundingBox;
    if (!bbox) return null;

    const id = uuid();
    ctx.figmaToLayerId.set(node.id, id);

    const w = Math.max(1, Math.round(bbox.width));
    const h = Math.max(1, Math.round(bbox.height));

    let cornerRadius = readCornerRadius(node);
    if (node.type === "ELLIPSE") {
        cornerRadius = Math.floor(Math.min(w, h) / 2);
    } else {
        warn(ctx, node, "vector_rasterized", `${node.type} approximated as rectangle`);
    }

    const layer: RectangleLayer = {
        id,
        type: "rectangle",
        name: node.name || node.type,
        x: Math.round(bbox.x - originX),
        y: Math.round(bbox.y - originY),
        width: w,
        height: h,
        rotation: readRotation(node),
        visible: node.visible !== false,
        locked: !!(node as { locked?: boolean }).locked,
        opacity: readOpacity(node),
        constraints: readConstraints((node as { constraints?: LayoutConstraint }).constraints),
        ...resolveFills(node, ctx, frame, id, "rectangle"),
        stroke: resolveStrokeColor(node),
        strokeEnabled: hasVisibleStroke(node),
        strokeWidth: readStrokeWeight(node),
        cornerRadius,
        metadata: { figmaNodeId: node.id, figmaOriginalType: node.type },
    };
    frame.layers.push(layer);
    ctx.report.stats.layersCreated++;
    return layer;
}

function mapVector(
    node: SubcanvasNode,
    originX: number,
    originY: number,
    ctx: MapCtx,
    frame: MapperFrame,
): ImageLayer | null {
    if (!ctx.opts.preserveVectorsAsImages) {
        skip(ctx, node);
        warn(ctx, node, "vector_rasterized", `Vector dropped (preserveVectorsAsImages=false)`);
        return null;
    }

    const bbox = (node as { absoluteBoundingBox?: Rectangle | null }).absoluteBoundingBox;
    if (!bbox) return null;

    const id = uuid();
    ctx.figmaToLayerId.set(node.id, id);

    warn(ctx, node, "vector_rasterized", `${node.type} will be exported as SVG`);

    frame.nodesToRender.push({ nodeId: node.id, targetLayerId: id, format: "svg" });

    const layer: ImageLayer = {
        id,
        type: "image",
        name: node.name || node.type,
        x: Math.round(bbox.x - originX),
        y: Math.round(bbox.y - originY),
        width: Math.max(1, Math.round(bbox.width)),
        height: Math.max(1, Math.round(bbox.height)),
        rotation: readRotation(node),
        visible: node.visible !== false,
        locked: !!(node as { locked?: boolean }).locked,
        opacity: readOpacity(node),
        constraints: readConstraints((node as { constraints?: LayoutConstraint }).constraints),
        src: "", // populated by worker with SVG url from /v1/images
        objectFit: "contain",
        metadata: { figmaNodeId: node.id, figmaOriginalType: node.type },
    };
    frame.layers.push(layer);
    ctx.report.stats.layersCreated++;
    return layer;
}

// ─── Trait helpers ─────────────────────────────────────────────────────────

function readOpacity(node: SubcanvasNode | CanvasNode): number | undefined {
    const op = (node as { opacity?: number }).opacity;
    return typeof op === "number" ? op : undefined;
}

function readRotation(node: SubcanvasNode): number {
    const r = (node as { rotation?: number }).rotation;
    if (typeof r !== "number") return 0;
    // Figma stores rotation in radians; our Layer uses degrees.
    return Math.round((r * 180) / Math.PI);
}

function readConstraints(c: LayoutConstraint | undefined): LayerConstraints {
    return {
        horizontal: mapH(c?.horizontal),
        vertical: mapV(c?.vertical),
    };
}

function mapH(h: LayoutConstraint["horizontal"] | undefined): ConstraintH {
    switch (h) {
        case "RIGHT":
            return "right";
        case "CENTER":
            return "center";
        case "LEFT_RIGHT":
            return "stretch";
        case "SCALE":
            return "scale";
        case "LEFT":
        default:
            return "left";
    }
}

function mapV(v: LayoutConstraint["vertical"] | undefined): ConstraintV {
    switch (v) {
        case "BOTTOM":
            return "bottom";
        case "CENTER":
            return "center";
        case "TOP_BOTTOM":
            return "stretch";
        case "SCALE":
            return "scale";
        case "TOP":
        default:
            return "top";
    }
}

function readCornerRadius(node: SubcanvasNode): number {
    const cr = (node as { cornerRadius?: number }).cornerRadius;
    if (typeof cr === "number") return Math.round(cr);
    const individual = (node as { rectangleCornerRadii?: number[] }).rectangleCornerRadii;
    if (individual && individual.length === 4) {
        // Pick the max so that the shape still looks rounded even if we can't per-corner.
        return Math.round(Math.max(...individual));
    }
    return 0;
}

function readStrokeWeight(node: SubcanvasNode): number {
    const sw = (node as { strokeWeight?: number }).strokeWeight;
    return typeof sw === "number" ? Math.round(sw) : 0;
}

function hasVisibleStroke(node: SubcanvasNode): boolean {
    const strokes = (node as { strokes?: Paint[] }).strokes;
    if (!strokes || strokes.length === 0) return false;
    return strokes.some((s) => s.visible !== false);
}

function resolveStrokeColor(node: SubcanvasNode): string {
    const strokes = (node as { strokes?: Paint[] }).strokes ?? [];
    return firstSolidHex(strokes) ?? "#000000";
}

// ─── Fills ─────────────────────────────────────────────────────────────────

function resolveFills(
    node: SubcanvasNode | CanvasNode,
    ctx: MapCtx,
    _frame: MapperFrame,
    _targetLayerId: string,
    fallbackShape: "rectangle" | "frame",
): { fill: string; fillEnabled?: boolean } {
    const fills = (node as { fills?: Paint[] }).fills ?? [];
    const visible = fills.filter((p) => p.visible !== false);

    if (visible.length === 0) {
        return { fill: "#ffffff", fillEnabled: false };
    }

    // Figma stacks fills front-to-back (last on top). For our single-colour layers we
    // collapse to the topmost solid. Non-solid paints cause a warning.
    const top = visible[visible.length - 1];
    if (top.type === "SOLID") {
        if (visible.length > 1) {
            warn(ctx, node as { id: string; name: string }, "multiple_fills_flattened");
        }
        return { fill: rgbaToHex(top.color, top.opacity ?? 1), fillEnabled: true };
    }
    if (top.type === "IMAGE") {
        // IMAGE fills on frames/groups stay as fill-only; the worker replaces it
        // with an ImageLayer child in some cases. For rectangles we already chose
        // the ImageLayer path earlier.
        warn(ctx, node as { id: string; name: string }, "multiple_fills_flattened", "IMAGE fill on a non-rectangle node");
        void fallbackShape;
        return { fill: "#ffffff", fillEnabled: false };
    }

    warn(ctx, node as { id: string; name: string }, "gradient_fill_flattened", `${top.type} collapsed to its dominant stop`);
    if (top.type === "GRADIENT_LINEAR" || top.type === "GRADIENT_RADIAL" || top.type === "GRADIENT_ANGULAR" || top.type === "GRADIENT_DIAMOND") {
        // Pick the colour of the most-opaque gradient stop — usually the "brand" colour.
        const stops = (top as { gradientStops?: Array<{ color: RGBA }> }).gradientStops ?? [];
        if (stops.length > 0) {
            const best = stops.slice().sort((a, b) => (b.color.a ?? 1) - (a.color.a ?? 1))[0];
            return { fill: rgbaToHex(best.color, 1), fillEnabled: true };
        }
    }
    return { fill: "#ffffff", fillEnabled: false };
}

function firstSolidHex(paints: Paint[] | undefined): string | null {
    if (!paints) return null;
    for (const p of paints) {
        if (p.visible === false) continue;
        if (p.type === "SOLID") {
            return rgbaToHex(p.color, p.opacity ?? 1);
        }
    }
    return null;
}

function mapImageScaleMode(mode: "FILL" | "FIT" | "TILE" | "STRETCH" | undefined): ImageLayer["objectFit"] {
    switch (mode) {
        case "FIT":
            return "contain";
        case "STRETCH":
            return "fill";
        case "TILE":
            return "fill";
        case "FILL":
        default:
            return "cover";
    }
}

// ─── Auto-layout ───────────────────────────────────────────────────────────

function readAutoLayout(node: SubcanvasNode): Partial<FrameLayer> {
    const n = node as Partial<FrameNode>;
    if (!n.layoutMode || n.layoutMode === "NONE") {
        return { layoutMode: "none" };
    }
    if (n.layoutMode === "GRID") {
        // Grid auto-layout is not supported yet; fall back to none.
        return { layoutMode: "none" };
    }

    if (n.layoutWrap === "WRAP") {
        // We don't model wrap → flatten to a single row/column. Worker will emit a warning.
    }

    const layoutMode: FrameLayer["layoutMode"] = n.layoutMode === "HORIZONTAL" ? "horizontal" : "vertical";

    return {
        layoutMode,
        paddingTop: n.paddingTop,
        paddingRight: n.paddingRight,
        paddingBottom: n.paddingBottom,
        paddingLeft: n.paddingLeft,
        spacing: n.itemSpacing,
        primaryAxisAlignItems: mapPrimaryAlign(n.primaryAxisAlignItems),
        counterAxisAlignItems: mapCounterAlign(n.counterAxisAlignItems),
        primaryAxisSizingMode: n.primaryAxisSizingMode === "FIXED" ? "fixed" : "auto",
        counterAxisSizingMode: n.counterAxisSizingMode === "FIXED" ? "fixed" : "auto",
    };
}

function mapPrimaryAlign(
    v: FrameNode["primaryAxisAlignItems"] | undefined,
): FrameLayer["primaryAxisAlignItems"] {
    switch (v) {
        case "CENTER":
            return "center";
        case "MAX":
            return "flex-end";
        case "SPACE_BETWEEN":
            return "space-between";
        case "MIN":
        default:
            return "flex-start";
    }
}

function mapCounterAlign(
    v: FrameNode["counterAxisAlignItems"] | "STRETCH" | undefined,
): FrameLayer["counterAxisAlignItems"] {
    switch (v) {
        case "CENTER":
            return "center";
        case "MAX":
            return "flex-end";
        case "STRETCH":
            return "stretch";
        case "BASELINE":
            return "flex-start";
        case "MIN":
        default:
            return "flex-start";
    }
}

// ─── Colour conversion ─────────────────────────────────────────────────────

/**
 * Convert a Figma RGBA (0..1 channels) to a hex string. Alpha is folded into a
 * solid hex via pre-multiplication against white — we don't model per-layer
 * fill alpha separately (opacity is already captured at the node level).
 */
export function rgbaToHex(color: RGBA, extraOpacity = 1): string {
    const a = Math.max(0, Math.min(1, (color.a ?? 1) * extraOpacity));
    const channel = (c: number) => Math.max(0, Math.min(255, Math.round(c * 255)));
    const r = channel(color.r);
    const g = channel(color.g);
    const b = channel(color.b);

    if (a >= 0.999) {
        return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    }
    const alphaHex = Math.round(a * 255)
        .toString(16)
        .padStart(2, "0");
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}${alphaHex}`;
}
