import "@testing-library/dom";

// Polyfill mínimo: alguns componentes usam clipboard (copiar código de pareamento).
if (!navigator.clipboard) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async () => {} },
    configurable: true,
  });
}
