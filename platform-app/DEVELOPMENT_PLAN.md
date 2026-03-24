# AI Creative Platform — Development Plan & Agent Guidelines

> **Purpose:** Roadmap, coding standards, and guidelines for all development agents working on this codebase.

---

## Coding Standards

### TypeScript
- **Strict mode** — no `any` types. Use `unknown` + type narrowing
- **Functional components** + hooks only (no class components)
- **Named exports** for components, functions, types
- **Explicit return types** on public functions and tRPC procedures

### Naming
| Entity | Convention | Example |
|--------|-----------|---------|
| Components | PascalCase | `WorkspaceBrowseModal` |
| Hooks | camelCase, `use` prefix | `useProjectSync` |
| Stores | camelCase, `Store` suffix | `canvasStore` |
| tRPC routers | camelCase | `workspaceRouter` |
| Types/Interfaces | PascalCase | `MasterComponent` |
| Files | PascalCase for components, camelCase for utilities | `Canvas.tsx`, `snapService.ts` |

### File Organization
- **One component per file** (split when >300 lines)
- **Collocate** related code: `ComponentName.tsx` + `ComponentName.test.tsx`
- **No duplicate files** — if utility exists in `services/`, don't recreate in `utils/`
- **Types** in `types/index.ts` for shared types, colocated for local types

### Error Handling
```typescript
// ✅ Correct
try {
    await riskyOperation();
} catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // handle
}

// ❌ Wrong
try { ... } catch (e: any) { console.log(e.message); }
```

### Console Output
- **API routes / server**: `console.error()` is acceptable for critical failures
- **Components**: No `console.log` in production code. Use error boundaries or toast notifications
- **Remove all** `console.warn` and `console.log` debug statements before commit

### AI Integration Rules
1. **Human in the Loop** — AI suggests, human approves
2. **Non-Destructive** — AI creates layers/versions, never overwrites
3. **Context-Aware** — Always inject Brand Kit context into prompts (hidden from user)
4. **Prompt versioning** — Store AI prompts in dedicated `prompts/` directory

### Git Workflow
- **Branch**: `develop` for active development
- **Atomic commits**: One logical change per commit
- **Message format**: `Feat:`, `Fix:`, `Refactor:`, `Docs:`, `Chore:`
- **Commit after testing**: Every approved change → commit → push immediately

---

## ESLint Configuration (Target)

```javascript
// eslint.config.ts — to be set up
export default [
    // TypeScript strict
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": "error",
    "no-console": ["warn", { allow: ["error"] }],
    // React
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
];
```

---

## Immediate Cleanup Tasks (from Audit)

| # | Task | Priority | Effort |
|---|------|----------|--------|
| 1 | Set up ESLint + `npm run lint` script | P0 | 15 min |
| 2 | Delete duplicate `src/services/layoutEngine.ts` (keep `utils/`) | P0 | 10 min |
| 3 | Fix `catch (e: any)` → `unknown` in 2 files | P0 | 5 min |
| 4 | Replace 5 `any` types in server routers with proper Prisma types | P1 | 20 min |
| 5 | Remove stale `console.log/warn` from components | P1 | 15 min |
| 6 | Delete dead components: `Tooltip.tsx`, `PreviewCanvas.tsx` (if confirmed unused) | P2 | 5 min |
| 7 | Replace 36 remaining `any` types in components/services | P2 | 30 min |
| 8 | Split `canvasStore.ts` (2035 lines) into domain slices | P3 | 2h |

---

## Feature Roadmap

### In Progress
- [x] Workspace management (browse, create, settings, join requests)
- [ ] Codebase cleanup (from audit)

### Short-term
- [ ] Activity Feed on admin dashboard
- [ ] Bulk actions for template admin
- [ ] Edit-in-Canvas flow for templates
- [ ] Analytics backend using `PlatformEvent` model

### Medium-term
- [ ] Real-time collaboration (WebSocket cursor sharing)
- [ ] Comment threads on project elements
- [ ] Template versioning with diff view
- [ ] AI workflow builder (visual pipeline)
- [ ] Export presets per workspace

### Long-term
- [ ] Video creative support
- [ ] Brand asset library with smart search
- [ ] A/B test creative variants
- [ ] External API for programmatic creative generation

---

## Architecture Guidelines for Agents

### When Adding a New Feature
1. Check this plan and `ARCHITECTURE.md` first
2. Determine which files to modify (don't create parallel structures)
3. Add types to `types/index.ts` if shared
4. Add tRPC procedure to existing router (don't create new router unless new domain)
5. Follow the Master/Instance pattern for canvas features
6. Inject Brand Kit context for any AI integration
7. Test with `tsc --noEmit` before committing
8. Commit with descriptive message + push

### When Fixing a Bug
1. Identify root cause before patching symptoms
2. Check if the bug exists in related components (pattern fix, not spot fix)
3. Add defensive checks (null guards, min/max clamps)
4. Verify fix doesn't break existing functionality

### File Size Guidelines
- **Components**: Split at ~300 lines. Extract sub-components
- **Stores**: Split at ~500 lines. Use Zustand slices
- **Services**: Split at ~200 lines. One concern per file
- **Routers**: Acceptable up to ~400 lines (they're just procedure definitions)
