# AI Workflows Context

Last updated: 2026-04-25

Purpose: compact working memory for the new node-based AI Workflows module. Keep this file small, current, and useful before making follow-up changes.

## Product Intent

AI Workflows is a workspace-level visual automation builder for repeatable AI scenarios. It should feel closer to Flora AI's dark, spatial, node-canvas workflow than to a plain form editor: clear canvas texture, compact floating controls, rich image previews, visible node state, and fast paths from banner/photo surfaces into saved scenarios.

Near-term target:

- make the current graph editor pleasant and reliable;
- allow execution from any selected node, not only the whole graph;
- add core creative nodes: image generation, text generation, layer editor, batch, router;
- expose saved workflows as "AI scenarios" inside banner canvas and photo project surfaces.

## Current Architecture

Stack:

- Next.js App Router, React 19, TypeScript, Tailwind v4 design tokens.
- Graph editor: `@xyflow/react`.
- Canvas/banner editor: Konva via `react-konva`.
- State: Zustand slices.
- Persistence/API: tRPC + Prisma.
- Image processing: provider calls through existing agent action executor, local transforms through `sharp`.

Data model:

- Prisma model: `AIWorkflow`.
- Legacy workflow format lives in `steps Json`.
- New node editor format lives in nullable `graph Json?`.
- Reusable scenario metadata lives in nullable `scenarioConfig Json?`.
- `graph` is validated by `workflowGraphSchema` and currently has shape:
  - `version: 1`
  - `nodes: WorkflowNode[]`
  - `edges: WorkflowEdge[]`

Main routes:

- `/workflows`: workspace workflow list, graph workflows only by default.
- `/workflows/new`: creates an empty graph workflow or a preset graph from `?preset=...` via `workflow.saveGraph`.
- `/workflows/[id]`: loads `WorkflowEditorShell`, then dynamically imports the xyflow editor client-side.

Key files:

- `platform-app/src/server/workflow/types.ts`: `WorkflowNodeType`, ports, `NODE_REGISTRY`, server action IDs.
- `platform-app/src/lib/workflow/graphSchema.ts`: persisted graph schema.
- `platform-app/src/lib/workflow/nodeParamSchemas.ts`: per-node params schemas.
- `platform-app/src/lib/workflow/scenarioConfig.ts`: scenario metadata schema/defaults.
- `platform-app/src/lib/workflow/connectionValidator.ts`: port compatibility.
- `platform-app/src/store/workflow/*`: graph, viewport, run state, executor, client handlers.
- `platform-app/src/components/workflows/*`: editor, palette, topbar, inspector, nodes.
- `platform-app/src/components/workflows/AIScenariosModal.tsx`: shared launcher for banner/photo/asset surfaces.
- `platform-app/src/hooks/workflow/useWorkflowScenarioRun.ts`: client-side external scenario runner.
- `platform-app/src/server/routers/workflow.ts`: workflow CRUD + graph save/load.
- `platform-app/src/app/api/workflow/execute-node/route.ts`: server node execution endpoint.
- `platform-app/src/server/agent/executeAction.ts`: actual action handlers for workflow server nodes.

## Existing Nodes

Current `WorkflowNodeType`:

- `imageInput`: client node; source can be workspace asset, URL, or uploaded file.
- `removeBackground`: server action `remove_background`.
- `addReflection`: server action `add_reflection`.
- `mask`: server action `apply_mask`.
- `blur`: server action `apply_blur`.
- `preview`: client pass-through output with visual result.
- `assetOutput`: client handler that registers final URL as a workspace asset.

Important current registry pattern:

- `NODE_REGISTRY` is the central source for display name, category, ports, defaults, and executor target.
- Adding a node currently requires touching:
  - `WorkflowNodeType`
  - `NODE_REGISTRY`
  - `workflowNodeTypeSchema`
  - `NODE_PARAM_SCHEMAS`
  - node renderer registration in `components/workflows/nodes/index.tsx`
  - executor/client/server handler paths as needed
  - tests.

Known mismatch:

- `actionRegistry.ts` lists `remove_background` and `add_reflection` as workflow-only actions, but does not list `apply_mask` / `apply_blur` even though `executeAction.ts` supports them and `/api/workflow/execute-node` allows them.

## Execution Flow

Client run button:

1. `WorkflowEditor` calls `useWorkflowRun`.
2. `useWorkflowRun` validates with `validateBeforeRun`.
3. `executeGraph` builds a `graphology` directed graph.
4. It rejects cycles and missing required input edges.
5. It runs topological generations in parallel.
6. Client nodes run in `clientHandlers.ts`.
7. Server nodes call `/api/workflow/execute-node`.
8. API route checks auth, rate limit, workspace access, action allowlist, then calls `executeAction`.
9. Results are stored in `runResults`; `BaseNode` renders preview images when `result.url` exists.

Current limitation:

- Execution always starts from all source/root nodes and runs the whole valid graph.
- Validation requires every required input in the entire graph, so partial/run-from-node needs a subgraph mode or explicit external input injection.
- External scenario runner can inject an image/asset into the first `imageInput` node and run the full graph; arbitrary-node execution is still separate work.

## UI State

Current editor layout:

- Topbar with back, name, autosave state, manual save, run button.
- Left palette grouped by node category.
- Center xyflow canvas with `Background`, `Controls`, `MiniMap`.
- Right `NodeInspector`.

Current UI issues from screenshots/request:

- Canvas is too plain and does not yet match the richer Flora-like dark graph surface.
- Node cards are plain DS cards with accent left border, not spatial workflow tiles.
- Edge detaching/removal is not discoverable; React Flow removal handling exists only through edge change remove events.
- Image input node does not reliably show selected/uploaded image preview on the node before execution.
- Image upload path exists in `ImageSourceInput`, but UX/layout are rough and may have functional breakage.
- Inspector uses auto-generated schema fields and has poor layout for complex node params.
- Preview behavior is inconsistent: most nodes only show output after a run; image input should show its chosen source immediately.
- Trackpad two-finger swipe in workflow editor likely defaults to xyflow zoom behavior; desired behavior is pan canvas, not zoom.

Flora-style UI notes from provided screenshots:

- Dark canvas with subtle dotted grid.
- Nodes are content-first: image nodes show large actual previews; text nodes show compact text cards.
- Floating side toolbar and floating node/tool menus.
- Right inspector uses dark grouped panels, compact controls, and clear current selection title.
- Quick-add node menu contains Text, Image, Video, Layer Editor, Batch, Router, Add model.

## Existing Integration Points

Photo projects:

- `PhotoResultCard` already has hover actions and a "В баннер" dropdown.
- `PhotoLibraryPanel` asset tiles already have a "В баннер" action.
- Both use `useCreateBannerFromAsset`.
- Good place to add "AI сценарии" hover/menu action for selected/generated image assets.

Banner canvas:

- Editor page: `platform-app/src/app/editor/[id]/page.tsx`.
- Header actions already contain "Ассеты", "Версии", "Поделиться", "Экспорт".
- Good place for a header action "AI сценарии" near "Ассеты".
- Floating `Toolbar` can also take an `onOpenAIScenarios` prop and show a Sparkles/Workflow icon tool.
- Selected image layer can be found through `useCanvasStore` selected IDs and `layers`.
- Applying workflow to selection should likely:
  - resolve selected image layer URL;
  - run a workflow with that URL injected into an input node;
  - update selected image layer source with the result or create a new layer, depending on scenario config.

Banner creation from image:

- `useCreateBannerFromAsset` creates a banner project and seeds an image via query params.
- Existing editor seed flow supports `assetId`, `imageUrl`, `applyTemplate`, `applySlot`, `openTemplates`.
- A future workflow node "В баннер" can reuse the same project creation semantics.

Assets/library:

- Workspace assets are listed by `asset.listByWorkspace`.
- Project assets are listed by `asset.listByProject`.
- Workflow `assetOutput` registers a workspace-level asset through `asset.attachUrlToWorkspace`.

## Backlog

P0 UI/functionality fixes:

- Make edge removal/detaching explicit and discoverable.
- Make canvas visually distinct in light and dark themes.
- Fix image input node:
  - selected/uploaded image preview directly on node;
  - reliable local file upload;
  - better image source control layout in inspector.
- Normalize previews across all nodes.
- Align workflow UI with DS tokens while moving toward Flora-like workflow ergonomics.
- Make two-finger trackpad gesture pan the workflow canvas; reserve zoom for explicit controls/pinch/modifier.

## P0 Work Plan

Design target:

- Keep the product's DS language: `bg-*`, `text-*`, `border-*`, radius/shadow tokens, Plus Jakarta Sans, light/dark theme parity.
- Move AI Workflows toward a premium studio canvas: content-first nodes, denser floating chrome, visible state, and a darker/spatial feel without breaking light mode.
- Apply `ui-ux-pro-max` checks while designing:
  - accessibility first: contrast, keyboard deletion, aria labels for icon actions, visible focus;
  - touch/interaction: explicit controls, 44px-ish hit targets where practical, loading/disabled feedback;
  - layout/responsive: no horizontal scroll, stable node dimensions, no text overflow;
  - motion: 150-300ms state transitions, respect reduced motion.

P0.1 Canvas interaction foundation:

- Configure React Flow interaction model:
  - `zoomOnScroll={false}`;
  - `panOnScroll={true}`;
  - `panOnScrollMode="free"` if current `@xyflow/react` supports it;
  - keep explicit zoom via controls and pinch/modifier only after Mac trackpad check.
- Add selected edge state:
  - `onEdgeClick` selects an edge and clears selected node;
  - pane/node clicks clear selected edge;
  - selected edge gets stronger stroke and delete affordance.
- Add deletion paths:
  - Backspace/Delete removes selected edge or selected node;
  - small floating "detach" button for selected edge;
  - optional edge context menu for "Отключить".
- Tests:
  - graph slice `disconnect` already exists; add component/store tests where practical for edge deletion behavior.

P0.2 Visual canvas polish:

- Create workflow-specific canvas surface styles using DS tokens rather than raw one-off colors.
- Light mode: soft paper/stage feel with subtle dotted grid and enough contrast from side panels.
- Dark mode: Flora-like deep canvas with dotted grid, stronger edge visibility, and compact floating controls.
- Restyle React Flow controls/minimap so they read as DS floating tools, not default xyflow chrome.
- Avoid broad one-hue gradients; accents should be functional, mostly status/category/AI affordances.
- Checks:
  - screenshot desktop at light/dark;
  - verify nodes/edges remain readable at zoomed-out and normal zoom.

P0.3 Node card system and preview normalization:

- Replace current plain DS card node shell with a `WorkflowNodeCard` pattern:
  - stable min/max width and preview aspect-ratio;
  - compact header with category/status;
  - explicit input/output handles with labels or visible port hints on hover/selection;
  - status ring/badge plus inline error when a node fails.
- Normalize previews:
  - image-like nodes use the same preview component;
  - `imageInput` shows selected `sourceUrl` immediately before execution;
  - server/image transform nodes show last run output;
  - `preview` node gets larger content-first treatment;
  - `assetOutput` shows saved asset/result summary.
- Add accessible alt/labels and reserve preview space to avoid layout jumps.
- Tests:
  - unit-test preview URL resolution from params/results;
  - visual/manual pass for each current node type.

P0.4 Image input reliability and inspector ergonomics:

- Make upload flow robust:
  - validate file type/size before compression;
  - show upload progress/loading and clear retry path;
  - keep `sourceUrl` for asset picks so node preview does not require extra fetch;
  - preserve user-selected filename/asset label when possible.
- Improve `ImageSourceInput` layout:
  - use existing `Tabs`/`SegmentedControl` style or align its custom tabs with DS controls;
  - make URL/upload/library modes visually distinct and compact;
  - show one clear error near the active source control.
- Improve inspector grouping:
  - image source block first, then node-specific settings;
  - dark grouped panels, compact labels, helper text only where it reduces ambiguity.
- Tests:
  - `ImageSourceInput` mode switching clears stale invalid fields;
  - upload success/failure behavior with mocked `uploadForAI`.

P0.5 Workflow shell finish:

- Convert left palette and right inspector from heavy fixed sidebars to a richer studio shell:
  - still anchored left/right for now, but visually lighter and closer to floating panels;
  - retain predictable DS layout and avoid nested cards.
- Add empty/selection states:
  - no selection: concise guidance and primary next action;
  - edge selected: show edge details and detach action;
  - node selected: current inspector.
- Tighten topbar:
  - keep one primary action (`Запустить`);
  - secondary actions (`Сохранить`, `Сценарий`) stay subordinate;
  - expose run disabled reason without layout jump.

P0.6 Verification and finish line:

- Run focused tests:
  - workflow store tests;
  - workflow node param/client handler tests;
  - workflow autosave tests if touched.
- Run lint for changed files or `npm run lint` if the slice changes enough UI.
- Manual browser QA:
  - create workflow, drag nodes, connect/disconnect edge;
  - select edge and delete via UI + keyboard;
  - pick asset/URL/upload image and confirm immediate node preview;
  - run simple graph and confirm previews/statuses;
  - test light/dark themes and trackpad pan behavior.

P0.x Optional interaction candy:

- Magnetic handles / smart connection targeting:
  - when dragging a connection near a compatible port, softly highlight and snap the connection target;
  - avoid moving the visible handle under the cursor, because that causes hover jitter;
  - keep the larger invisible hit target from the first P0 implementation;
  - only consider compatible ports from `connectionValidator`.
- Manual node sizing / auto-fit:
  - store optional node dimensions in graph state;
  - add `NodeResizer` only for content-heavy nodes (`imageInput`, `preview`, future layer editor);
  - consider auto-width from image aspect ratio, with min/max bounds so layouts stay manageable.

Definition of done for P0:

- The editor looks intentionally designed in both themes, not like default React Flow.
- A user can understand and remove connections without guessing.
- Image input is trustworthy: selected image appears on the node immediately and upload errors are recoverable.
- Preview behavior is consistent across current node types.
- Trackpad two-finger scroll pans the canvas; zoom is deliberate.
- Accessibility basics are intact: keyboard deletion, focus states, readable contrast, labelled icon controls.

P0 implementation log:

- 2026-04-24:
  - P0.1 initial slice implemented:
    - custom workflow edge with selected state and inline detach button;
    - inspector state for selected edge with source/target summary and detach action;
    - Delete/Backspace removes selected edge or node outside editable controls;
    - React Flow scroll model changed to pan-on-scroll, no wheel zoom, no double-click zoom.
  - P0.2 initial visual polish implemented:
    - workflow-specific canvas chrome in `globals.css`;
    - dotted grid, themed controls/minimap, token-driven edge/handle colors;
    - content-first node cards with category bars and status/error treatment.
  - P0.3 initial preview normalization implemented:
    - `imageInput` renders selected `sourceUrl` before execution;
    - run results still take priority after execution;
    - shared preview resolver covered by unit tests.
  - P0.4 partial image input ergonomics:
    - DS segmented source control;
    - URL mode preview in inspector;
    - local file preflight validation before compression/upload.
  - P0.4 second slice:
    - upload source got drag/drop zone, loading state, retry action, and stronger inline errors;
    - image upload validation covered by unit tests;
    - inspector now uses grouped sections for node settings, edge route summary, and empty state.
  - P0.4 bugfix follow-up:
    - upload clear action now removes stale `sourceUrl` / retry state;
    - workflow uploads use `/api/upload` with `projectId: "tmp"` instead of a fake project id;
    - node transparency checkerboard is now a subdued DS CSS class.
  - P0 interaction follow-up:
    - visible handles no longer move/scale on hover;
    - handles use a larger invisible hit target to reduce cursor jitter.
  - P0.5 workflow shell finish:
    - editor body now uses a full canvas with anchored floating palette and inspector panels;
    - palette is a compact studio panel with category affordances plus double-click/keyboard node creation;
    - inspector has distinct empty, edge, and node states with primary add-source and detach actions;
    - topbar keeps `Запустить` as the single primary action and reserves stable space for run blockers/errors.
  - P0.5 compact shell follow-up:
    - inspector is hidden when nothing is selected and uses content-height floating sheets for selected nodes/edges;
    - left node catalog moved into a compact icon rail with searchable flyout menus;
    - utility controls/minimap are offset for the rail and contextual inspector instead of sitting in the canvas center.
  - P0.5 utility chrome follow-up:
    - minimap removed from the default workflow canvas because the contextual inspector made it shift and compete with the graph;
    - explicit zoom controls remain near the lower-left rail.
  - P0.6 focused checks:
    - added pure unit coverage for node palette category/search grouping and outside-click close behavior;
    - focused workflow tests pass for palette, image input validation, preview resolution, and connection validation.

P1 execution:

- Run from arbitrary node.
- Define how upstream inputs are provided when running a middle node:
  - use cached upstream run results when available;
  - or run required ancestors automatically;
  - or let the user inject selected image/text as a temporary input.
- Show per-node run controls and status.

P1 node expansion:

- Image generation node.
- Text generation node.
- Layer editor node.
- Batch node.
- Router node.
- "В баннер" output/action node.

P1 scenario integrations:

- Banner editor "AI сценарии" header/menu near "Ассеты". Done initial slice.
- Banner toolbar quick action. Done initial slice.
- Apply scenario to selected image layer. Done for image outputs (`replace-selection`, `create-layer`, `save-asset`, `open-banner`).
- Photo generated image hover action "AI сценарии". Done initial slice.
- Photo asset tile action "AI сценарии". Done initial slice.
- Preset workflow links from `/workflows/new?preset=...` currently only log; make this real.

## P1 Work Plan

Execution-first principle:

- Ship run-from-node before adding many new nodes, so new nodes inherit the right execution contract.
- First default behavior: selected node runs with all required ancestors automatically.
- Do not mutate unrelated branch results when running a selected subgraph.
- Keep full-graph `Запустить` behavior available and stable.

P1.1 Subgraph planning/executor core:

- Add pure helpers in `store/workflow/executor.ts`:
  - `getAncestorNodeIds(targetNodeId, nodes, edges)`;
  - `buildExecutionSlice({ targetNodeId, nodes, edges })`;
  - optional `validateBeforeRun(nodes, edges, { targetNodeId })` or new `validateExecutionSlice`.
- Subgraph should include the selected target and all upstream ancestors only.
- Validation should only require required inputs inside that subgraph.
- Cycles should still be rejected if present in the relevant graph.
- Tests:
  - selected middle node runs only ancestors + target;
  - missing input in an unrelated downstream/output node does not block selected run;
  - unrelated branch is not executed or marked blocked;
  - invalid params on an unrelated node do not block selected run.

Status:

- Done 2026-04-25:
  - `executeGraph` accepts optional `targetNodeId`;
  - ancestor/slice helpers are implemented and exported;
  - `validateBeforeRun(..., { targetNodeId })` validates only the selected node's upstream slice;
  - executor tests cover selective validation, ancestor slicing, selected-node execution, and unrelated invalid branches.

P1.2 Hook/store integration:

- Extend `useWorkflowRun` with `runNode(nodeId)` and `validationIssuesForNode(nodeId)`.
- Preserve `runAll`.
- Initialize run state carefully:
  - nodes in the execution slice become `idle/running/done/error`;
  - unrelated nodes keep existing last results/status where practical;
  - downstream nodes may remain idle rather than blocked for a selected-node run.
- Keep `isRunning` global for now to avoid overlapping runs.
- Tests around executor are enough initially; hook remains hard to render until DOM test setup exists.

Status:

- Done 2026-04-25:
  - `useWorkflowRun` exposes `runNode(nodeId)` and `validationIssuesForNode(nodeId)`;
  - `runAll` still resets all run state/results and executes the full graph;
  - selected-node runs reset only the execution slice and preserve unrelated run results/statuses;
  - pure run-state helpers are covered by unit tests because the repo still lacks DOM hook test setup.

P1.3 Node-level UI controls:

- Add per-node run button on selected/hovered node card.
- Add corresponding action in the right inspector header for selected nodes.
- Disable per-node run with a visible reason when:
  - no workspace;
  - selected node subgraph is invalid;
  - another run is already active.
- Full topbar run keeps running the whole graph.
- UX target:
  - icon button on node, labelled tooltip/title;
  - button in inspector for discoverability;
  - status badge remains the primary state signal.

Status:

- Done 2026-04-25:
  - workflow editor provides node-run controls through `WorkflowRunControlsContext`;
  - node cards show a selected/hover run button wired to `runNode(nodeId)`;
  - inspector header exposes the same selected-node run action;
  - per-node actions use `validationIssuesForNode(nodeId)` for disabled reasons and respect global `isRunning`;
  - hidden node-card run buttons are removed from tab order until the node is selected.

P1.4 Cached input strategy follow-up:

- After ancestor-run mode works, add an optional "run only this node with cached inputs" mode.
- Use existing `runResults` to satisfy required incoming ports.
- If cache is missing or stale, fall back to "run ancestors".
- This can be a later dropdown/secondary action; do not block P1.1.

Status:

- Done 2026-04-25:
  - executor now supports `targetRunMode: "cached-inputs"` for selected-node runs;
  - cached mode runs only the target node when required incoming ports have cached upstream `runResults`;
  - missing cached inputs automatically fall back to the existing ancestor execution plan;
  - graph mutations invalidate stale run outputs for changed nodes and downstream branches;
  - hydrated workflows clear transient run state/results so cache does not leak across graphs;
  - inspector exposes a secondary cached-input run action for the selected node.

P1.5 Workflow preset creation:

- Make `/workflows/new?preset=...` real.
- Define preset graph factories for common scenarios:
  - product reflection pipeline;
  - remove background + preview;
  - asset input + transform + save.
- Tests:
  - preset graph validates;
  - nodes/edges have stable required params;
  - unknown preset falls back to empty graph.

Status:

- Done 2026-04-25:
  - added pure workflow preset factories in `lib/workflow/presets.ts`;
  - `/workflows/new?preset=...` now creates a prefilled graph with preset name/description;
  - supported IDs: `product-reflection-pipeline`, `remove-background-preview`, `asset-transform-save`;
  - unknown preset IDs still create the empty default workflow;
  - `/workflows` now exposes compact preset cards plus a separate empty workflow action;
  - the workflow editor left rail opens a preset flyout from the bottom workflow button;
  - tests cover schema-valid preset graphs, stable ids, executable defaults after user image input injection, unknown fallback, and preset entrypoint links.

P1.6 Image generation node:

- Add node type `imageGeneration` with text prompt/model/style params and image output.
- Prefer workflow-specific action contract if `generate_image` remains banner-flavored.
- API route allowlist and response mapping must support image result.
- UI:
  - text prompt field first;
  - output preview same as image transform nodes.
- Tests:
  - schema defaults;
  - executor sends correct action;
  - preview resolves from result.

Status:

- Done 2026-04-25:
  - added `imageGeneration` workflow node with prompt/style/model/aspect-ratio params and image output;
  - node is registered in graph schema, node registry, param schemas, React Flow node map, palette grouping, and inspector labels;
  - workflow execute-node route now allows `generate_image` and maps workflow `prompt` to the existing action `subject`;
  - `generate_image` now accepts `prompt` as an alias and forwards `aspectRatio` / `scale` to the provider layer;
  - tests cover param validation, selected/full executor dispatch, API route mapping, and existing workflow graph behavior.

P1.7 Text generation node:

- Add text result support before or together with text nodes:
  - extend `NodeRunResult` beyond `{ url, assetId }` to include `text` and maybe `type`;
  - extend ports/results for `text`.
- Add headline/subtitle/free-text generation node.
- UI needs text preview cards in `BaseNode`.
- Tests:
  - text port compatibility;
  - server response mapping for text;
  - node preview for text output.

P1.8 Later node contracts:

- Layer editor node:
  - likely client/composite node first;
  - may need project/banner context, so keep after run-from-node and scenario runner are stable.
- Batch/router:
  - requires arrays/branching semantics and richer result types;
  - defer until basic image/text generation nodes are reliable.
- "В баннер" output/action node:
  - can reuse scenario output behavior and banner creation semantics;
  - depends on clearer output contract (`replace-selection`, `create-layer`, `open-banner`).

P2 platform polish:

- Better workflow list cards with thumbnails/last run/status.
- Workflow templates/scenarios with metadata: input type, output behavior, category, recommended surfaces.
- Cost/rate-limit visibility per run.
- Execution logs/history.

## Implementation Notes

Edge detaching:

- React Flow supports edge selection/deletion through `onEdgesChange`.
- Add UX affordances: selected edge style, delete/backspace handling, edge context action, or small detach button near handles/edge.
- Store already has `disconnect(edgeId)`.

Trackpad pan:

- In `ReactFlow`, likely set:
  - `zoomOnScroll={false}`
  - `panOnScroll={true}`
  - `panOnScrollMode="free"` if available in current xyflow version
  - keep `zoomOnPinch` true only if it does not conflict with two-finger scroll.
- Test on Mac trackpad because browser wheel events can map pinch to `ctrlKey`.

Image input preview:

- `ImageSourceInput` stores `sourceUrl` for asset picks and uploads.
- `BaseNode` currently only renders `runResults[id]?.url`.
- Node preview can read params for `imageInput` and render `sourceUrl` immediately.
- For asset-only records without `sourceUrl`, either keep writing `sourceUrl` on pick or add a tiny asset lookup/cache.

Run from node:

- Best first slice: run selected node with ancestors automatically.
- Build an induced ancestor subgraph ending at selected node; validation only for that subgraph.
- Store result for selected node and any ancestors.
- Later add "run downstream from selected" and "run this node with external selected layer" modes.

New node contracts:

- Image/text generation can reuse existing `executeAction("generate_image")`, `generate_headline`, `generate_subtitle` or introduce workflow-specific actions for less banner-specific prompts.
- Layer editor is likely a client/composite node at first if it edits banner layers; it may need a scenario runner rather than normal graph execution.
- Batch/router require executor changes: ports may need arrays, branching metadata, and result type beyond `{ url, assetId }`.

## Questions To Resolve

- Should saved workflows have explicit scenario metadata, or infer capabilities from graph inputs/outputs?
- For "run from arbitrary node", should the default be "run ancestors then this node" or "run only this node using cached inputs"?
- When applying a workflow from banner canvas, should output replace the selected layer, create a sibling layer, or ask per scenario?
- Should workflow outputs be workspace assets by default, project assets when launched from a project, or both?
- Do we want dark-mode-first Flora-like workflow UI, or theme-aware but with a Flora-inspired dark canvas option?

## Completed Task Log

- 2026-04-24: Mapped current AI Workflows architecture, key files, execution flow, UI issues, and integration points. Created this context file.
- 2026-04-24: Added first proper P1 scenario integration foundation: `AIWorkflow.scenarioConfig`, shared Zod contract, save/load/listScenarios API, workflow editor scenario settings modal, reusable external image scenario runner, shared `AIScenariosModal`, and entrypoints in banner header/toolbar, photo result cards, and photo asset library.
