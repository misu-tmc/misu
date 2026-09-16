# Developing principles

- The web application is a Preact SPA built with Vite, Wouter and Preact Signals.
- Keep dependencies lightweight and use plain CSS plus native browser APIs where practical.
- Run `npm run validate` in `apps/spa` after frontend changes.
- Mobile first. Web first. Keep layout responsive.
- Design docs might be stale and are not always the authoritative sources.
- No backward compatibility.
- Add tests only for important app invariants and behaviors. Do not keep tests for feature development and validations in project.