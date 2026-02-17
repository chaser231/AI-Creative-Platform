# UXPilot Prompts: AI Creative Platform

Use these prompts in UXPilot to generate high-quality wireframes and UI designs. They are calibrated for the **System Theme (Light)** preference.

## 1. Global System & Navigation
**Prompt:**
> Create a high-fidelity web app layout for an AI Creative Platform.
> *   **Style:** Clean, professional, minimal interface (similar to Linear or Raycast).
> *   **Theme:** System Light Mode. Background #FFFFFF, Sidebar #F9FAFB, Border #E5E7EB.
> *   **Typography:** Inter font, clean hierarchy.
> *   **Layout:**
>     *   **Left Sidebar (Navigation):** 240px wide. Sections: "Workspace" (Logo + Dropdown), "Projects" (List), "Assets" (Folders), "Team" (Avatars). Active state on "Projects".
>     *   **Top Bar (Context):** Breadcrumbs ("Yandex Market / Summer Sale / Banner 1"), "Share" button, "Export" button.
>     *   **Main Content:** Empty state for now.
> *   **Key Visual:** Use subtle shadows and rounded corners (8px) for buttons.

## 2. The "Wizard" (New Project Flow)
**Prompt:**
> Design a modal window for "Create New Project" - Step 1 of 3.
> *   **Context:** A marketing manager starting a new campaign.
> *   **Style:** Minimal, centered modal with a backdrop blur.
> *   **Content:**
>     *   **Header:** "Start a new campaign".
>     *   **Input 1:** "Campaign Name" (Text field).
>     *   **Input 2:** "Business Unit" (Dropdown: Yandex Market, Go, Food).
>     *   **Selection Grid:** "Choose Goal" - 3 cards with icons:
>         1.  "Banner Set" (Icon: Image stack)
>         2.  "Social Media Text" (Icon: Type tool)
>         3.  "Video Ad" (Icon: Play button)
>     *   **Footer:** "Cancel" (Ghost button) and "Continue" (Primary Black button).

## 3. The "Canvas" (Banner Editor)
**Prompt:**
> Design the main "Banner Editor" interface.
> *   **Layout:** 3-column "Holy Grail" layout.
>     *   **Left (Layers & Assets):** Tree view of layers (Background, Product Image, Headline, CTA). Tab switcher for "Assets" (Images, Icons).
>     *   **Center (Canvas):** Infinite gray grid background. In the center, a 1080x1080 social media banner frame.
>         *   **Banner Content:** A sneaker photo, bold headline "SUMMER SALE", and a "Shop Now" button.
>         *   **Controls:** Floating toolbar at the bottom center (Select, Text, Image, AI Magic).
>     *   **Right (Properties & AI):** 280px wide context panel.
>         *   **Selected:** The "Headline" text layer is selected.
>         *   **Panel Content:** Font inputs (Inter, Bold, 64px), Color picker.
>         *   **AI Section:** A distinct "AI Assistant" block at the top of the panel with a purple gradient border. Actions: "Rewrite", "Shorten", "Make Punchier".

## 4. AI Feature: Image Generation Modal
**Prompt:**
> Design a floating palette for "AI Image Generation".
> *   **Trigger:** User pressed "AI Magic" -> "Generate Image".
> *   **UI:** A compact, draggable window.
> *   **Inputs:**
>     *   **Prompt Area:** Large text area "Describe your image...".
>     *   **Style Selector:** Horizontal scroller of chips: "Photo", "3D Render", "Illustration", "Corporate".
>     *   **Aspect Ratio:** Toggle (1:1, 16:9, 9:16).
>     *   **Button:** Large "Generate" button with a sparkle icon.
> *   **Results:** Below the button, show 4 skeleton loader squares (indicating generation in progress).

## 5. Dashboard (Project List)
**Prompt:**
> Design the main "Dashboard" view where users see their projects.
> *   **Header:** "Projects" title with "New Project" button (Black, Primary) on the right.
> *   **Filters:** Row of tabs below header: "All", "My Drafts", "Published", "Archived".
> *   **Content:** A responsive grid of cards.
>     *   **Card Design:**
>         *   **Thumbnail:** Large preview of the project (banner or text snippet).
>         *   **Info:** Project Name ("Summer Sale"), Last edited ("2 hours ago"), Author Avatar.
>         *   **Status Badge:** Small pill in the corner ("In Progress", "Review").
>     *   **Empty State:** If no projects, show a friendly illustration and "Create your first project" button.

## 6. Asset Library
**Prompt:**
> Design the "Asset Library" management screen.
> *   **Layout:** sidebar for folders, main grid for files.
> *   **Sidebar:** "All Assets", "Brand Logos", "Product Shots", "Generated Images".
> *   **Main Area:**
>     *   **Upload Area:** Large dashed drop zone at the top ("Drop files here").
>     *   **Grid:** Grid of square thumbnails. Images show preview, fonts show "Aa", videos show play icon.
>     *   **AI Feature:** A "Generate Asset" button next to upload, implying you can create assets here too.

## 7. Text Editor (Copywriting Project)
**Prompt:**
> Design the "Copywriting Editor" interface.
> *   **Layout:** Focused document view, similar to Notion but with AI powers.
> *   **Center:** A clean white page. Title "Instagram Post Captions". Body text with headers and paragraphs.
> *   **Right Sidebar (AI Copilot):**
>     *   **Context:** "Tone of Voice: Friendly & energetic" (Editable).
>     *   **Chat:** A chat interface at the bottom of the sidebar. User asks "Give me 3 variations of the intro".
>     *   **Suggestions:** Cards appearing in the sidebar unrelated to chat, e.g., "Word count is high, try shortening?".
> *   **Selection Menu:** When user selects text on the page, a floating menu appears: "Rewrite", "Expand", "Translate".

## 8. Export Flow
**Prompt:**
> Design the "Export" modal window.
> *   **Header:** "Export 3 Assets".
> *   **Preview:** Horizontal scroll of the assets being exported.
> *   **Settings:**
>     *   **Format:** Dropdown (PNG, JPG, WEBP, MP4).
>     *   **Scale:** 1x, 2x.
>     *   **Quality:** Slider (80%).
> *   **Validation:** A warning alert: "⚠️ 2 assets have low-contrast text. Fix before exporting?" (AI check).
> *   **Action:** Big "Download" button.

## 9. Brand Guidelines (Settings)
**Prompt:**
> Design the "Brand Kit" settings page.
> *   **Navigation:** Tabs for "Colors", "Typography", "Logos", "Voice".
> *   **Colors Section:**
>     *   **Palette:** Swatches of "Primary Blue", "Secondary Yellow". click to edit hex.
>     *   **Usage Rules:** Small text below "Use for buttons", "Use for backgrounds".
> *   **Typography Section:**
>     *   **Headings:** Preview of H1, H2, H3 with font names.
>     *   **Upload:** Button to upload custom font files.
> *   **Voice Section:**
>     *   **System Prompt:** A large text area "Describe your brand's voice...". Pre-filled with "We are professional, reliable, but innovative...".
