// Reuse the repository's existing SPA Vitest installation without shipping test code.
export default {
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.mjs']
  }
};
