# Development Plan: AI Creative Platform

## Phase 1: Foundation (The MVP) ✅
*   **Goal:** A working "Banner Editor" that can export a simple image.
*   **Key Features:**
    *   [x] Workspace / Project / Asset Schema (in-memory).
    *   [x] Canvas Engine setup (Pan, Zoom, Select).
    *   [x] Basic Layers (Text, Image, Rectangle, Badge).
    *   [x] Export to PNG.

## Phase 2: Design Engine + Component System

### Sprint 1 — Component Model & Templates ✅
*   [x] Creative Components (Master + Instance binding).
*   [x] Template Engine (create, apply shell + named slots).
*   [x] Resize system (Master → multiple format instances, per-format overrides).
*   [x] Instance toggle (enable/disable inheritance per format).
*   [x] Content-only inheritance (text, image src, badge label + image size).
*   [x] Brand Kit foundation (colors, fonts, TOV storage + settings UI).
*   [x] Adaptive UI: Wizard ↔ Studio mode switcher.
*   [x] Text properties panel — grouped popovers (font, metrics, alignment, color).
*   [x] Inline text editing on canvas (double-click → textarea overlay).
*   [x] Dark mode gradient cards on dashboard.

### Sprint 2 — Frames, Image Upload ✅
*   [x] **Frame layer** — container with clip, fill, stroke, cornerRadius, nested children.
*   [x] **Frame constraints system** — horizontal/vertical constraint modes for children.
*   [x] **Frame child coordinate system** — bubble guards, local→absolute conversion.
*   [x] **Nesting across resizes** — childIds sync to masterComponents/instances.
*   [x] Image upload + drag-and-drop from file system.
*   [x] Image replacement via properties panel.

### Sprint 2B — Hotfixes + Quick UX Wins ✅
*   [x] Fix: Properties Panel / AI Panel overlap.
*   [x] Fix: Master artboard always takes fixed default size.
*   [x] Context menus on canvas objects (right-click → duplicate, delete, copy, bring-to-front).
*   [x] Context menus in layers panel (rename, delete, duplicate).
*   [x] Inline rename (double-click layer name in panel).
*   [x] New store actions: duplicateLayer, bringToFront, sendToBack, toggleLayerLock.

### Sprint 3A — Editor Polish & Navigation ✅
*   [x] Share / Help / Settings dialogs (Project Settings, Hotkeys).
*   [x] Breadcrumbs — clickable navigation + Project Name edit.
*   [x] Template custom naming (input dialog on save).
*   [x] Format packs (UI in ResizePanel).
*   [x] Undo/Redo system (HistorySnapshot + throttled updates).
*   [x] Keyboard shortcuts (Delete, Cmd+Z/Shift+Z, arrow nudge).
### Sprint 4 — Canvas Intelligence & Smart Layout 🚧
*   [ ] **Snap Guides** — smart alignment lines (center, edges) when dragging.
*   [ ] **Multi-select** — Shift+Click selection and drag-box selection.
*   [ ] **Smart Resize Engine:**
    *   [ ] Template slot mapping UI (assign layers to specific template slots).
    *   [ ] Auto-placement algorithm (constraints logic + slot rules).
    *   [ ] Template packs (save/load groups of formats).
    *   [ ] Bulk export for multiple sizes.

## Phase 3: AI Layer + Agent Mode
*   **Goal:** Injecting intelligence at every level.
*   **Key Features:**
    *   [ ] AI Pipeline Engine architecture (prompt chaining).
    *   [ ] Text generation with TOV system prompts.
    *   [ ] Image generation (txt2img) with style guide transforms.
    *   [ ] **Text:** "Rewrite", "Shorten", "Tone Change" (Contextual Menu).
    *   [ ] **Image:** "Remove BG", "Inpaint", "Outpaint", "Txt2Img" generation.
    *   [ ] **Agent Mode:** Autonomous banner assembly from text brief.
    *   [ ] **Figma Import:** Parse Figma frames into Template shells.

## Phase 4: Scale & Polish
*   **Goal:** Ready for wide internal rollout.
*   **Key Features:**
    *   [ ] Multi-user roles (Admin vs Viewer).
    *   [ ] Wizard Mode (full guided flow for non-designers).
    *   [ ] Template Marketplace (share across workspaces).
    *   [ ] Analytics Dashboard.
    *   [ ] Persistence layer (database / API backend).
