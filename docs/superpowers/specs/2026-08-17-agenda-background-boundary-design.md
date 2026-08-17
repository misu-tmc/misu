# Agenda Background Boundary Fix

## Problem

The agenda preview contains two A4 sheets and is taller than the viewport. Global
styles fix both `html` and `body` to `height: 100%`, while the agenda-specific
gray background is applied only to `body`. The agenda content overflows the
fixed-height body, revealing the default lavender `html` background and creating
a horizontal color boundary.

## Design

Override the agenda layout body to use `height: auto`. Keep the existing viewport
minimum height and gray background. This lets the body grow with both agenda
sheets and addresses the overflow at its source without changing other routes,
adding lifecycle classes to `html`, or masking the issue on a child element.

## Scope

- Change only the agenda layout CSS.
- Preserve the existing agenda background color, sheet layout, printing, and
  responsive scaling.
- Do not alter global page sizing behavior for other routes.

## Verification

- Reproduce the agenda with two sheets in a browser and confirm the body extends
  through the full document height with no lavender boundary.
- Run the SPA validation command: `npm run validate`.

