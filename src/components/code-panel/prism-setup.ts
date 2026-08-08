import Prism from 'prismjs'

// prism-jsx (UMD) references a bare `Prism` global; the production bundle only
// sets `global.Prism` (undefined in browsers) so the jsx grammar would fail to
// register. Wire the global explicitly before the component side-effect import
// evaluates (sibling imports run in source order).
;(globalThis as Window & typeof globalThis).Prism ??= Prism

export { Prism }
