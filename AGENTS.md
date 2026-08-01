# Developing principles

- The web application is a Preact SPA built with Vite, Wouter and Preact Signals.
- Keep dependencies lightweight and use plain CSS plus native browser APIs where practical.
- Run `npm run validate` in `apps/spa` after frontend changes.
- Mobile first. Web first. We support both the responsive web/PWA surface and WeChat mini program.
  - Mobile mainly for attendee pages.
  - Wider layouts mainly for meeting editing and management.
- Treat current backend, SPA and mini-program implementations as authoritative when older design docs disagree.

