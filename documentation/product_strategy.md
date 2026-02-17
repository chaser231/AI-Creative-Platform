# Product Strategy: AI Creative Platform

## 1. Product Statement
To empower every Yandex employee—from expert designers to marketing managers—to create high-quality, on-brand creative content efficiently by combining professional-grade design tools with accessible AI automation.

**Vision:** "The AI co-pilot for Yandex's creative production."

## 2. Product Architecture

### 2.1 Core Entities
1.  **Workspace**: The top-level container (e.g., "Yandex.Market", "Yandex.Go").
2.  **Project**: A specific campaign or task (e.g., "Summer Sale 2026").
3.  **Asset**: A single unit of content (Banner, Video, Text).
    *   **Master Asset**: The source of truth.
    *   **Resize**: A variation for a specific platform/format.
4.  **Template**: A blueprint for Assets (Layout + Rules + named Slots for components).
5.  **Brand Kit**: The DNA of the Workspace (Colors, Fonts, Logos, Tone of Voice).
6.  **Creative Component**: A high-level content unit (Text Block, Image, Badge, CTA).
    *   **Master Component**: Editable source with configurable properties.
    *   **Instance**: A linked copy bound to a specific resize/format. Properties cascade from Master unless overridden locally.
    *   Can be created manually OR generated via AI Pipeline.

### 2.2 System Modules
*   **Design Engine**: Canvas, Creative Components, Properties, Auto-Layout, Template Engine.
*   **AI Engine**:
    *   **Orchestrator**: Routing requests to specific models (SDXL, Flux, GPT-4, etc.).
    *   **Context Manager**: Injecting Brand Kit & Project Context into prompts.
    *   **AI Pipeline Engine**:
        *   **Text Pipeline**: User prompt → TOV System Prompt → LLM → formatted output.
        *   **Image Pipeline**: User prompt → Style Guide transform → Model router → output.
        *   **Pipeline Registry**: Versioned, per-workspace pipeline configs stored in `prompts/`.
    *   **Agent Mode**: Autonomous creative assembly from text brief using Components + Templates + Pipelines.
*   **Workflow Engine**: Approval flows, Comments, Version History.
*   **Analytics Engine**: Usage tracking, Cost calculation, Performance metrics.

## 3. Product Processes & Methodology

### 3.1 Planning Methodology: Hybrid (Scrumban)
Given the innovative nature of the product, strict Scrum might be too rigid, but pure Kanban lacks the "heartbeat" needed for milestones.
*   **Recommendation:** **2-Week Sprints**.
    *   **Week 1:** Feature development & Experimentation.
    *   **Week 2:** Polish, Integration, & User Testing.
    *   **Release:** At the end of every sprint (deployment to Staging/Prod).

### 3.2 Backlog Management & Scoring
Use **RICE Scoring** to prioritize features:
*   **Reach**: How many users will this impact? (Is it for everyone or just Admins?)
*   **Impact**: How much will it improve the workflow? (High/Medium/Low)
*   **Confidence**: How sure are we about this? (80%? 50%?)
*   **Effort**: t-shirt sizing (S/M/L/XL).

**Formula**: $(Reach \times Impact \times Confidence) / Effort$

### 3.3 Discovery & Hypothesis Generation
Before building, we validate.
*   **Process**:
    1.  **Problem definition**: "Users find it hard to resize banners for 10 formats."
    2.  **Hypothesis**: "If we implement 'Smart Reszing' based on Auto-Layout, users will save 50% time."
    3.  **Experiment**: MVP prototype -> Test with 5 designers -> Measure time saved.
    4.  **Decision**: Build / Pivot / Kill.

### 4. Delivery & Quality Assurance
*   **CI/CD**: Automatic deployment to Staging on merge to `main`.
*   **Feature Flags**: Enable new AI models/features for a small group (Beta Testers) before full rollout.
*   **Visual Regression Testing**: Ensure that code changes don't break the rendering engine (crucial for a design tool).

### 5. Key Metrics (KPIs)

#### 5.1 North Star Metric
*   **"Creative Hours Saved"**: The estimated time saved per project compared to the manual workflow.

#### 5.2 Business Metrics
*   **Cost per Creative**: (Compute Cost + Human Time Cost). Goal: Reduce by 30-50%.
*   **Adoption Rate**: % of target users in Yandex active weekly (WAU).

#### 5.3 Quality Metrics (User Feedback)
*   **CSAT (Customer Satisfaction Score)**: "How satisfied are you with the result?" (1-5 after export).
*   **Brand Compliance Score**: % of exports that pass the automated Guidelines Check without warnings.

## 6. Feedback Loop
1.  **In-App Feedback**: Simplest possible ("Thumbs Up/Down" on generations).
2.  **Beta Community**: dedicated Slack channel for distinct "Power Users".
3.  **Quarterly Review**: Deep dive interviews with stakeholders from major Business Units.
