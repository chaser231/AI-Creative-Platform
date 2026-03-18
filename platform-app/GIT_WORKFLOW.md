# Project Git Workflow (Vercel Compatibility)

Due to Vercel Hobby plan limitations (which block deployments from third-party commit authors / collaborators), the following workflow MUST be followed:

1. **Local Commits**: The AI Agent makes atomic, descriptive commits to the local repository.
2. **Feature Branches**: NEVER push directly to the production branch (e.g., `main`). All pushes must be to a uniquely named feature/fix branch (e.g., `feat/ai-panels`, `fix/layout-bugs`).
3. **Remote Push**: The AI Agent pushes the branch to GitHub.
4. **Pull Request**: The Human User manually creates a Pull Request from the feature branch to the production branch via the GitHub UI.
5. **Merge**: The Human User manually merges the Pull Request.

This ensures that the final "Merge" commit is authored by the Human User, triggering the automatic Vercel deployment successfully.
