// esbuild bundles imported stylesheets into dist/webview/main.css. TypeScript 6 checks that
// side-effect imports resolve, so stylesheet imports need a module declaration.
declare module '*.css';
