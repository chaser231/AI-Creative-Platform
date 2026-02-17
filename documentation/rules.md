# Project Rules & Guidelines

## 1. Coding Standards
*   **Language:** TypeScript (Strict Mode).
*   **Style:** Functional components, Hooks.
*   **State Management:** Zustand or Redux Toolkit (for complex canvas state).
*   **Styling:** Tailwind CSS (utility-first) or CSS Modules (if complex animations needed).

## 2. Design Principles
*   **"Invisible UI":** The interface should not compete with the content.
*   **"Outcome over Output":** Focus on the final asset quality, not the number of features used.
*   **"Safe by Default":** Users should find it hard to break brand guidelines.

## 3. AI Integration Rules
*   **"Human in the Loop":** AI suggests, Human approves.
*   **"Non-Destructive":** AI changes are layers or versions, never irreversible overwrites.
*   **"Context Aware":** Always inject Project/Brand context into prompts hidden from the user.

## 4. Documentation
*   All major architectural decisions must be documented in `architecture decision records` (ADR).
*   All AI prompts must be versioned and stored in a dedicated `prompts/` directory.

## 5. Version Control Workflow
*   **Mandatory Commits:** Every successful application change that has been **tested and approved** by the user (or confirmed working) must be committed to the local git repository immediately.
*   **Immediate Push:** After committing, changes MUST be pushed to the remote repository (GitHub) to ensure backups and history preservation.
*   **Atomic Commits:** Commits should represent a single logical change or feature completion.
*   **Commit Messages:** Use clear, descriptive messages (e.g., `Feat: Add AI panel`, `Fix: Undo/Redo state bug`).
