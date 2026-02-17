# Design & UX Strategy: AI Creative Platform

## 1. Design Statement
The platform must feel like a premium, modern tool (comparable to Linear, Raycast, Cron), not a legacy enterprise system. It should inspire creativity through its interface while remaining robust enough for complex workflows.

**Key Principles:**
1.  **Invisible UI**: The interface should recede, letting the user's content (the creative asset) be the hero.
2.  **Contextual Density**: Show simple controls by default, reveal complexity on demand (progressive disclosure).
3.  **Unified Language**: A single design system that scales from a simple "Text Input" to a complex "Node Graph".

## 2. Visual Style & Aesthetics
*   **Theme**: **System Theme** preference (Light/Dark auto-detect). Default to Light for better readability in text-heavy workflows, with a toggle for Dark Mode (preferred by some creative professionals).
*   **Typography**: Clean, sans-serif (e.g., Inter or Yandex Sans if available). High legibility at small sizes.
*   **Color Palette**:
    *   **Backgrounds**: Clean white `#FFFFFF` or soft gray `#F9FAFB` for Light Mode; `#1A1A1A` for Dark Mode.
    *   **Accents**: Used *sparingly* for primary actions (Generate, Save).
    *   **AI Indicators**: A distinct gradient or shimmer (e.g., Purple/Blue/Pink) to denote AI-powered elements.

## 3. Scalability Strategy: Atomics
We will build a **Design System** based on Atomic Design principles, specific to this platform.

### 3.1 Core Tokens (The "Atoms")
*   **Colors**: `bg-primary`, `text-secondary`, `border-subtle`, `ai-accent`.
*   **Spacing**: `4px` grid system.
*   **Start**: `14px` base font size.

### 3.2 Components (The "Molecules")
*   **Constraint Inputs**: Not just a text box, but a text box with a "Max 40 chars" indicator.
*   **Asset Cards**: A standard card that handles Image, Video, and Text previews consistently.
*   **AI Action Button**: A unified component for triggering generation (icon + label + shortcut).

### 3.3 Layouts (The "Organisms")
*   **The "Inspector" Panel**: Evaluation & editing of selected objects. Always on the right.
*   **The "Navigator" Panel**: Project structure & assets. Always on the left.
*   **The "Stage"**: The central infinite canvas.

## 4. Multi-Tier UX Strategy
How to serve both the Intern and the Art Director?

### 4.1 Mode A: The "Wizard" (Consumer Mode)
*   **For whom:** Managers, Marketers, Copywriters.
*   **UX Pattern:** Linear Flow. Steps 1 -> 2 -> 3.
*   **Interface:** Form-based. "Upload Logo", "Type Headline", "Choose Style".
*   **Output:** 3-4 options to choose from. Minimal editing (text tweaks only).

### 4.2 Mode B: The "Studio" (Pro Mode)
*   **For whom:** Designers, Art Directors, creative technologists.
*   **UX Pattern:** Non-linear Canvas.
*   **Interface:** Full control. Layers, Properties, Nodes.
*   **Output:** Pixel-perfect assets, Custom Templates.

**Transition**: A user can start in Wizard Mode, generate a result, and click **"Edit in Studio"** to unlock full control. This is the bridge.

## 5. Consistency & "Delighters"
*   **Micro-interactions**: Hover states should be snappy. Loading states should be interesting (skeleton screens or subtle animations, not just a spinner).
*   **Keyboard Shortcuts**: Power users rely on them (`Cmd+K` for command palette, `Space` to pan).
*   **Empty States**: Never dead ends. "No projects yet? Start with a template."

## 6. Accessibility (A11y)
*   **Contrast**: WCAG AA compliance for all text.
*   **Focus States**: Clear indicators for keyboard navigation.
*   **Screen Reader**: Semantic HTML for all form inputs.
