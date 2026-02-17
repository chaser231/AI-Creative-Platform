# Research & UX Map: AI Creative Platform

## 1. Executive Summary
The landscape of creative tools is shifting from **"Manual Execution"** (Adobe Photoshop, early Figma) to **"Curated Creation"** (Canva, Microsoft Designer, Krea.ai). For a platform targeting semi-professional users (marketers, managers) within Yandex, the goal is to provide **"Professional Guardrails"**—tools that allow flexibility but prevent breaking brand consistency.

**Key Insight:** The user should feel like an Art Director, not a Pixel Pusher. The AI acts as the hands, while the user provides the intent.

## 2. Graphic Software Best Practices & Adaptation

### 2.1 Figma Best Practices → Adapted for Non-Designers
| Professional Feature (Figma) | Adaptation for General Audience |
|------------------------------|---------------------------------|
| **Auto-Layout** | **Smart Content Blocks**: Users don't manage padding/gap manually. They drag content in, and the container expands/shrinks based on predefined rules (Brand Guidelines). |
| **Component Properties** | **Visual Toggles**: Instead of complex property panels, use simple "Show/Hide" toggles or "Variant" selectors (e.g., "Light Theme" vs "Dark Theme"). |
| **Layers Panel** | **Content Outline**: Hiding raw vector layers (paths, groups) and showing only logical blocks (Header, Image, CTA, Disclaimer). |
| **Constraints** | **Responsive Preview**: Instead of setting pins, users just see how the banner looks on Mobile/Desktop instantly. |

### 2.2 Adobe/Generic Editor Best Practices
*   **Contextual Toolbars:** Like Adobe's new AI bar. When a user selects text, they see "Rewrite", "Shorten". When they select an image, they see "Remove BG", "Replace".
*   **Non-Destructive Editing:** Always keep the original asset available. AI generations are layers on top or versions.

## 3. AI Creative Tool Trends (2024-2025)

### 3.1 The "Generative Canvas"
Tools like Krea.ai and Leonardo.ai use an infinite canvas where generation and editing happen together.
*   **Adaptation:** A "Playground" area for unrestricted generation, which can then be dragged into a "Production" frame (Banner).

### 3.2 Implicit Context
Instead of users writing "banner for Yandex.Market in red style...", the system knows the **Project Context**.
*   **Implementation:** `System Prompt` injected silently: "You are a designer for [Business Unit]. Use [Tone of Voice]. Core colors are [Hex Codes]."

### 3.3 Multi-Modal Feedback
*   **Text-to-Design:** "Make the headline punchier" (LLM editing).
*   **Image-to-Image:** "Make this banner look like *this* reference" (Style Transfer/IP-Adapter).

## 4. UX Map & User Journey

### Phase 1: Intent & Setup (The "Wizard")
*   **Goal:** Set the context/constraints without overwhelming.
*   **User Action:** Select Business Unit -> Select Campaign Goal -> Upload specific assets (optional).
*   **System:** Loads relevant Brand Kit, Templates, and System Prompts.

### Phase 2: Ideation (The "Playground")
*   **Goal:** Rapid exploration.
*   **Interface:** Infinite Canvas or Grid View.
*   **Interaction:**
    *   Prompt: "Summer sale banner for sneakers."
    *   System: Generates 4-8 variations using different Templates + AI Images + AI Copy.
    *   User: Selects favorites to refine.

### Phase 3: Refinement (The "Editor")
*   **Goal:** Polishing the selected asset.
*   **Interface:** Focused view of one asset (with sidebar for Resizes).
*   **Tools:**
    *   **Click on Text:** AI Rewrite, Font size (constrained), Color (palette only).
    *   **Click on Image:** Inpaint, Outpaint, Recolor, Swap.
    *   **Global Controls:** "Remix" (try different layout), "Resize" (auto-adapt).

### Phase 4: Delivery
*   **Goal:** Export and Handoff.
*   **Action:** Bulk Export, Link Share.
*   **Validation:** Automated check against strict Brand Guidelines (e.g., "Logo is too small").

## 5. Key UX Principles
1.  **Constraint-Based Freedom:** Users can change things, but only within the "Brand Safety Zone".
2.  **Context is King:** The interface changes based on *what* is selected (Text vs Image vs Project).
3.  **Proactive AI:** Don't wait for a prompt. Suggest "Variations" or "Fixes" automatically.
