# Agenda Background Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agenda preview's gray background cover the complete two-sheet scrollable document without affecting other routes.

**Architecture:** Add an agenda-scoped body height override so the body grows with its overflowing content instead of exposing the fixed-height `html` background. Lock the CSS contract with a focused Vitest assertion, then verify the actual rendered boundary in Edge.

**Tech Stack:** Preact, Vite, Vitest, plain CSS, Microsoft Edge

---

## File Structure

- Modify `apps/spa/css/components.css`: add the agenda-only `height: auto` override beside the existing agenda background.
- Modify `apps/spa/src/pages/AgendaPage.test.jsx`: assert that the agenda layout CSS permits the body to grow.

### Task 1: Make the agenda body grow with both sheets

**Files:**
- Modify: `apps/spa/src/pages/AgendaPage.test.jsx`
- Modify: `apps/spa/css/components.css:798`

- [ ] **Step 1: Write the failing CSS regression test**

Add the Node file reader import and load the stylesheet:

```jsx
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';

const componentsCss = readFileSync(new URL('../../css/components.css', import.meta.url), 'utf8');
```

Add this test within the existing `AgendaPage` suite:

```jsx
it('allows the agenda body to grow with both sheets', () => {
  expect(componentsCss).toMatch(
    /body\.agenda-print-layout\s*\{[^}]*\bheight:\s*auto;/
  );
});
```

- [ ] **Step 2: Run the test and verify the regression is red**

Run:

```powershell
npm --prefix apps\spa test -- AgendaPage.test.jsx
```

Expected: FAIL in `allows the agenda body to grow with both sheets` because the existing agenda body rule does not declare `height: auto`.

- [ ] **Step 3: Apply the minimal agenda-scoped CSS fix**

Update the existing rule in `apps/spa/css/components.css`:

```css
body.agenda-print-layout { height: auto; background: #cfd3d5; }
```

Do not change the global `html, body { height: 100%; }` rule because other routes rely on the viewport-height layout.

- [ ] **Step 4: Run the focused test and verify it is green**

Run:

```powershell
npm --prefix apps\spa test -- AgendaPage.test.jsx
```

Expected: all `AgendaPage.test.jsx` tests pass.

- [ ] **Step 5: Verify the rendered background in Edge**

Serve the SPA and load `/app/meetings/42/agenda` with the same mocked authentication and meeting responses used during diagnosis. Inspect the document after both `.print-agenda-stage` elements render.

Expected:

```text
document.body.getBoundingClientRect().height === document.querySelector('#page').getBoundingClientRect().height
getComputedStyle(document.body).backgroundColor === "rgb(207, 211, 213)"
```

Capture the page at the transition between the two sheets and confirm the outer background is continuously gray with no lavender horizontal boundary.

- [ ] **Step 6: Run complete SPA validation**

Run:

```powershell
npm --prefix apps\spa run validate
```

Expected: Vitest passes, the Vite production build succeeds, and distribution validation passes.

- [ ] **Step 7: Commit the implementation**

```powershell
git add -- apps/spa/css/components.css apps/spa/src/pages/AgendaPage.test.jsx
git commit -m "fix(spa): extend agenda preview background" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: one implementation commit after the committed design and plan documents.

### Task 2: Fast-forward master and push

**Files:**
- No file changes.

- [ ] **Step 1: Fetch and verify master has not diverged**

```powershell
git fetch origin
git merge-base --is-ancestor origin/master HEAD
```

Expected: exit code 0. If it fails, stop rather than force-pushing.

- [ ] **Step 2: Fast-forward local master in its existing worktree**

Run from `E:\misu`:

```powershell
git status --short
git merge --ff-only agents/agenda-page-background-boundary-issue
```

Expected: the worktree is clean and `master` fast-forwards to the implementation commit.

- [ ] **Step 3: Push master to origin**

Run from `E:\misu`:

```powershell
git push origin master
```

Expected: `origin/master` advances to the implementation commit without a force push.

- [ ] **Step 4: Verify the remote result**

```powershell
git fetch origin
git rev-parse master
git rev-parse origin/master
git status --short
```

Expected: `master` and `origin/master` resolve to the same commit, and both worktrees are clean.

