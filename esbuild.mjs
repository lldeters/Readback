// @ts-check
// Builds the extension host bundle, the webview bundle and the layout worker bundle.
//   node esbuild.mjs                 development build (source maps)
//   node esbuild.mjs --production    minified build without source maps (used for packaging)
//   node esbuild.mjs --watch         incremental rebuilds (F5 pre-launch task)
//   node esbuild.mjs --tests         additionally bundles the VS Code integration tests into out/test
import * as esbuild from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

const args = new Set(process.argv.slice(2));
const production = args.has('--production');
const watch = args.has('--watch');
const tests = args.has('--tests');

// Oldest runtimes for engines.vscode ^1.105.0: Electron 37 = Node 22.19 / Chromium 138.
const NODE_TARGET = 'node22';
const WEBVIEW_TARGET = 'chrome138';

/** Prints the lines the "esbuild-watch" problem matcher in .vscode/tasks.json expects. */
/** @type {import('esbuild').Plugin} */
const problemMatcher = {
  name: 'problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      }
      console.log('[watch] build finished');
    });
  },
};

/**
 * Writes the esbuild metafile to out/meta/<name>.json; scripts/notices.mjs reads it to find every
 * third-party package that ends up in a bundle.
 * @param {string} name
 * @returns {import('esbuild').Plugin}
 */
const metafileWriter = (name) => ({
  name: 'metafile-writer',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.metafile) {
        await mkdir('out/meta', { recursive: true });
        await writeFile(`out/meta/${name}.json`, JSON.stringify(result.metafile));
      }
    });
  },
});

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'linked',
  sourcesContent: false,
  metafile: true,
  logLevel: watch ? 'silent' : 'info',
};

/** @type {Array<{ name: string, options: import('esbuild').BuildOptions }>} */
const builds = [
  {
    name: 'extension',
    options: {
      ...common,
      entryPoints: ['src/extension.ts'],
      outfile: 'dist/extension.js',
      platform: 'node',
      format: 'cjs',
      target: NODE_TARGET,
      external: ['vscode'],
    },
  },
  {
    name: 'webview',
    options: {
      ...common,
      entryPoints: ['webview/src/main.tsx'],
      outfile: 'dist/webview/main.js',
      platform: 'browser',
      format: 'iife',
      target: WEBVIEW_TARGET,
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' },
    },
  },
  {
    name: 'worker',
    options: {
      ...common,
      entryPoints: ['webview/worker/layout.worker.ts'],
      outfile: 'dist/webview/layout.worker.js',
      platform: 'browser',
      format: 'iife',
      target: WEBVIEW_TARGET,
    },
  },
];

if (tests) {
  builds.push({
    name: 'tests',
    options: {
      ...common,
      metafile: false,
      minify: false,
      sourcemap: 'inline',
      entryPoints: ['test/integration/**/*.test.ts', 'test/untrusted/**/*.ts'],
      outbase: 'test',
      outdir: 'out/test',
      platform: 'node',
      format: 'cjs',
      target: NODE_TARGET,
      external: ['vscode', 'mocha'],
    },
  });
}

const withPlugins = builds.map(({ name, options }) => ({
  ...options,
  plugins: [
    ...(options.metafile ? [metafileWriter(name)] : []),
    ...(watch ? [problemMatcher] : []),
  ],
}));

if (watch) {
  const contexts = await Promise.all(withPlugins.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all(withPlugins.map((options) => esbuild.build(options)));
}
