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

### Sprint 3A — Editor Polish & Template Foundations
*   [ ] Share / Help / Settings dialogs (MVP implementations).
*   [ ] Breadcrumbs — clickable navigation.
*   [ ] Template custom naming (input dialog on save).
*   [ ] Format packs (preset groups of resize formats, e.g. "Social Media Pack").
*   [ ] Undo/Redo system (history stack).
*   [ ] Keyboard shortcuts (Delete, Cmd+C/V, arrow nudge).
*   [ ] Snap guides / smart alignment on canvas.
*   [ ] Multi-select layers (Shift+Click / drag-select).

### Sprint 3B — Smart Resize MVP
*   [ ] Template slot mapping UI (master layer → template slot assignment).
*   [ ] Auto-placement algorithm (constraints + slot rules per format).
*   [ ] Template packs (save/load reusable format+slot groups).
*   [ ] Smart Resize integration testing.

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
