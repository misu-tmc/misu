# Responsive Role and Session Row Delete Design

## Goal

Make role and session deletion discoverable on meeting-management layouts without consuming scarce row space on small screens.

## Interaction

- Every role and session row has a compact cross-mark delete button.
- On layouts at least 701px wide, the button is always visible at the right edge of the row.
- On layouts below 701px wide, the button remains hidden until the user swipes the row left.
- Swiping right or interacting with the revealed row again closes the delete action.
- Activating the button removes the row from local editor state immediately. The existing section Save action persists the deletion.
- Deletion does not require confirmation.

## Presentation

- The wide-layout action is an icon-only red cross on a transparent circular button.
- The compact-layout action uses the same cross mark against the existing destructive-action reveal treatment.
- The button occupies a touch target of at least 36px by 36px.
- Wide rows reserve enough right-side space for the button so row summaries and expanded controls do not overlap it.
- Swipe instructions appear only on compact layouts. Wide layouts describe only drag-to-reorder behavior.

## Accessibility

- Each button has a row-specific accessible name:
  - `Delete <role name> role`
  - `Delete <session name> session`
- Unnamed rows use `Delete unnamed role` and `Delete unnamed session`.
- The decorative cross is hidden from assistive technology through the button's accessible name.
- The button has a visible keyboard focus state.
- On compact layouts, keyboard focus reveals the otherwise hidden action so keyboard users never land on an invisible control.

## Implementation Boundaries

- Reuse the existing `swipedRow`, pointer gesture handlers, and local row-removal callbacks in `EditorPage`.
- Adapt the existing `.editor-row-delete` styles rather than adding a second delete component or dependency.
- Use the editor's existing 701px responsive breakpoint to match the management-layout transition.
- Do not change backend APIs, save semantics, drag behavior, row expansion, or deletion behavior outside the Roles and Sessions panels.

## Validation

- Add focused editor rendering tests that verify:
  - role delete buttons have row-specific accessible names and remove the selected role;
  - session delete buttons have row-specific accessible names and remove the selected session;
  - a left touch swipe reveals the corresponding delete action;
  - a right touch swipe closes it.
- Verify CSS at widths below and above 701px.
- Run `npm run validate` in `apps/spa`.
