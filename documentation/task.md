# Sprint 4: Smart Layout & Canvas Interactions

## 1. Canvas Interactions 👆
*   [ ] **Snap Guides**
    *   Display dynamic guidelines when dragging layers.
    *   Snap to: Canvas center (X/Y), Edges of other layers, Center of other layers.
    *   Keyboard modifier (Ctrl/Cmd) to temporarily disable snapping.
*   [ ] **Multi-Selection**
    *   Shift + Click to add/remove from selection.
    *   Click + Drag on canvas background to create a selection box (marquee).
    *   Move/Resize/Delete multiple selected items simultaneously.

## 2. Smart Resize Engine 🧩
*   [ ] **Template Slot UI**
    *   Add "Slot" property to Layers (e.g., Headline, CTA, Background).
    *   Visual indicator of which slot a layer belongs to.
*   [ ] **Auto-Placement Logic**
    *   Implement constraint-based positioning for different aspect ratios.
    *   Example: "Pin to bottom-right with 20px padding" regardless of canvas size.
*   [ ] **Template Packs**
    *   Save current project structure as a reusable "Template Pack".
    *   Load pack into new projects.

## 3. Tech Debt & Polish 🧹
*   [ ] Refactor `canvasStore` selection logic to support array of IDs (`selectedLayerIds` instead of single `selectedLayerId`).
*   [ ] Ensure Undo/Redo handles multi-selection state correctly.
