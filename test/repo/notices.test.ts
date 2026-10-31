// scripts/notices.mjs: SPDX evaluation, the license gate, package-root resolution, rendering and
// the command line (write, --check, exit codes), all against synthetic fixtures (no real bundles).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { repoRoot } from './helpers';

type SpdxNode =
  | { readonly type: 'license'; readonly id: string }
  | { readonly type: 'with'; readonly id: string; readonly exception: string }
  | { readonly type: 'and' | 'or'; readonly operands: readonly SpdxNode[] };

interface LicenseText {
  readonly file: string;
  readonly text: string;
  readonly origin?: string;
}

interface NpmNotice {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly source: string;
  readonly outputs: readonly string[];
  readonly note?: string;
  readonly texts: readonly LicenseText[];
}

interface PythonNotice {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly source: string;
  readonly wheel?: string;
  readonly sha256?: string;
  readonly pruned: readonly string[];
  readonly texts: readonly LicenseText[];
}

/** The part of the script's API the tests use; the script is plain JavaScript. */
interface NoticesModule {
  readonly ALLOWED_LICENSES: readonly string[];
  readonly NPM_LICENSE_EXCEPTIONS: ReadonlyMap<string, { readonly expression: string }>;
  readonly SpdxSyntaxError: new (message: string) => Error;
  parseSpdx(expression: string): SpdxNode;
  formatSpdx(node: SpdxNode): string;
  unmetLicenses(node: SpdxNode, allowed: Iterable<string>): string[];
  licenseProblem(
    ecosystem: 'npm' | 'python',
    name: string,
    declared: string | undefined,
  ): string | undefined;
  packageRootOf(inputPath: string): { name: string; root: string } | undefined;
  bundledInputs(metafile: unknown): Map<string, Set<string>>;
  licenseFileNames(fileNames: readonly string[]): string[];
  repositoryUrl(repository: string): string | undefined;
  fenceFor(text: string): string;
  renderNotices(notices: { npm: readonly NpmNotice[]; python: readonly PythonNotice[] }): string;
}

const SCRIPT = path.join(repoRoot, 'scripts', 'notices.mjs');
// Not a string literal, so TypeScript does not look for declarations of the .mjs file.
const modulePath = '../../scripts/notices.mjs';
const notices = (await import(/* @vite-ignore */ modulePath)) as NoticesModule;

function unmet(expression: string, allowed: Iterable<string> = notices.ALLOWED_LICENSES) {
  return notices.unmetLicenses(notices.parseSpdx(expression), allowed);
}

describe('SPDX expressions', () => {
  it('accepts allowed licenses, comparing ids case-insensitively', () => {
    expect(unmet('MIT')).toEqual([]);
    expect(unmet('mit')).toEqual([]);
    expect(unmet('Apache-2.0')).toEqual([]);
    expect(unmet('LicenseRef-Proprietary')).toEqual(['LicenseRef-Proprietary']);
  });

  it('needs one allowed alternative for OR', () => {
    expect(unmet('MIT OR GPL-3.0-only')).toEqual([]);
    expect(unmet('GPL-2.0-only OR GPL-3.0-only')).toEqual(['GPL-2.0-only', 'GPL-3.0-only']);
  });

  it('needs every part of AND', () => {
    expect(unmet('MIT AND Apache-2.0 AND PSF-2.0')).toEqual([]);
    expect(unmet('MIT AND GPL-3.0-only')).toEqual(['GPL-3.0-only']);
  });

  it('binds AND tighter than OR and honors parentheses', () => {
    // (MIT AND GPL-3.0-only) OR ISC
    expect(unmet('MIT AND GPL-3.0-only OR ISC')).toEqual([]);
    expect(unmet('MIT AND (GPL-3.0-only OR ISC)')).toEqual([]);
    expect(unmet('GPL-3.0-only AND (MIT OR ISC)')).toEqual(['GPL-3.0-only']);
    expect(unmet('((MIT))')).toEqual([]);
  });

  it('accepts a WITH exception only when the whole term is allowed', () => {
    expect(unmet('Apache-2.0 WITH LLVM-exception')).toEqual(['Apache-2.0 WITH LLVM-exception']);
    expect(unmet('Apache-2.0 WITH LLVM-exception', ['Apache-2.0 WITH LLVM-exception'])).toEqual([]);
  });

  it('formats expressions canonically', () => {
    const format = (expression: string) => notices.formatSpdx(notices.parseSpdx(expression));
    expect(format('( MIT OR ISC ) OR Zlib')).toBe('MIT OR ISC OR Zlib');
    expect(format('MIT AND (ISC OR Zlib)')).toBe('MIT AND (ISC OR Zlib)');
    expect(format('(MIT AND ISC) OR Zlib')).toBe('MIT AND ISC OR Zlib');
    expect(format('GPL-2.0-only WITH Classpath-exception-2.0')).toBe(
      'GPL-2.0-only WITH Classpath-exception-2.0',
    );
  });

  it.each([
    '',
    '   ',
    'MIT OR',
    'OR MIT',
    '(MIT',
    'MIT)',
    'MIT ISC',
    'MIT or ISC',
    'MIT AND AND ISC',
    'MIT WITH',
    '(MIT OR ISC) WITH Classpath-exception-2.0',
    'Apache 2.0',
    'SEE LICENSE IN LICENSE.md',
    'MIT/X11',
  ])('rejects the invalid expression %j', (expression) => {
    expect(() => notices.parseSpdx(expression)).toThrow(notices.SpdxSyntaxError);
  });

  it('explains lower-case operators', () => {
    expect(() => notices.parseSpdx('MIT or ISC')).toThrow(/operators must be AND, OR, WITH/);
  });
});

describe('license gate', () => {
  it('passes permissive packages', () => {
    expect(notices.licenseProblem('npm', 'react', 'MIT')).toBeUndefined();
    expect(notices.licenseProblem('npm', 'd3-ease', 'BSD-3-Clause')).toBeUndefined();
    expect(notices.licenseProblem('python', 'parso', 'MIT AND PSF-2.0')).toBeUndefined();
    expect(notices.licenseProblem('python', 'jedi', 'MIT AND Apache-2.0')).toBeUndefined();
  });

  it('fails missing, invalid and unknown licenses', () => {
    expect(notices.licenseProblem('npm', 'a', undefined)).toBe('declares no license');
    expect(notices.licenseProblem('npm', 'a', ' ')).toBe('declares no license');
    expect(notices.licenseProblem('npm', 'a', 'SEE LICENSE IN EULA.txt')).toMatch(
      /not a valid SPDX expression/,
    );
    expect(notices.licenseProblem('npm', 'a', 'UNLICENSED')).toMatch(/not allowed.*UNLICENSED/);
    expect(notices.licenseProblem('npm', 'a', 'GPL-3.0-or-later')).toMatch(/GPL-3\.0-or-later/);
    expect(notices.licenseProblem('npm', 'a', 'MIT AND CC-BY-4.0')).toMatch(/CC-BY-4\.0/);
  });

  it('allows elkjs exactly under its approved exception (docs/adr/009)', () => {
    const approved = notices.NPM_LICENSE_EXCEPTIONS.get('elkjs')?.expression;
    expect(approved).toBe('EPL-2.0 OR GPL-3.0-or-later');
    expect(notices.licenseProblem('npm', 'elkjs', 'EPL-2.0 OR GPL-3.0-or-later')).toBeUndefined();
    expect(notices.licenseProblem('npm', 'elkjs', '(EPL-2.0 OR GPL-3.0-or-later)')).toBeUndefined();
  });

  it('fails elkjs when its license changes, and EPL-2.0 anywhere else', () => {
    for (const changed of ['EPL-2.0', 'GPL-3.0-or-later', 'EPL-2.0 AND MIT', 'EPL-1.0']) {
      expect(notices.licenseProblem('npm', 'elkjs', changed)).toMatch(/009-license-policy\.md/);
    }
    expect(notices.licenseProblem('npm', 'other', 'EPL-2.0 OR GPL-3.0-or-later')).toMatch(
      /EPL-2\.0, GPL-3\.0-or-later/,
    );
    expect(notices.licenseProblem('python', 'elkjs', 'EPL-2.0 OR GPL-3.0-or-later')).toBeDefined();
  });
});

describe('bundled packages', () => {
  it.each([
    ['node_modules/react/index.js', 'react', 'node_modules/react'],
    ['node_modules/@xyflow/react/dist/esm/index.js', '@xyflow/react', 'node_modules/@xyflow/react'],
    ['node_modules/a/node_modules/b/lib/x.js', 'b', 'node_modules/a/node_modules/b'],
    ['node_modules/@a/b/node_modules/@c/d/x.js', '@c/d', 'node_modules/@a/b/node_modules/@c/d'],
    ['../../node_modules/react/cjs/react.js', 'react', '../../node_modules/react'],
    [
      '/home/dev/readback/node_modules/zustand/x.js',
      'zustand',
      '/home/dev/readback/node_modules/zustand',
    ],
    ['node_modules\\@scope\\pkg\\index.js', '@scope/pkg', 'node_modules/@scope/pkg'],
    ['C:\\dev\\node_modules\\react\\index.js', 'react', 'C:/dev/node_modules/react'],
    [
      'node_modules/.pnpm/react@19.3.1/node_modules/react/index.js',
      'react',
      'node_modules/.pnpm/react@19.3.1/node_modules/react',
    ],
  ])('maps %s to %s', (input, name, root) => {
    expect(notices.packageRootOf(input)).toEqual({ name, root });
  });

  it.each([
    'src/extension.ts',
    'webview/src/main.tsx',
    '(disabled):node_modules/ws/browser.js',
    'virtual:node_modules/x/index.js',
    'node_modules/.bin/esbuild',
    'node_modules/stray.js',
    'node_modules/@scope/index.js',
    'node_modules/@scope',
  ])('ignores %s', (input) => {
    expect(notices.packageRootOf(input)).toBeUndefined();
  });

  it('counts only inputs that put bytes into an output', () => {
    const inputs = notices.bundledInputs({
      inputs: {},
      outputs: {
        'dist/a.js': {
          inputs: { 'node_modules/kept/index.js': { bytesInOutput: 12 } },
        },
        'dist/b.js': {
          inputs: {
            'node_modules/kept/index.js': { bytesInOutput: 3 },
            'node_modules/shaken/index.js': { bytesInOutput: 0 },
          },
        },
        'dist/a.js.map': { inputs: {} },
      },
    });
    expect([...inputs.keys()]).toEqual(['node_modules/kept/index.js']);
    expect([...(inputs.get('node_modules/kept/index.js') ?? [])].sort()).toEqual([
      'dist/a.js',
      'dist/b.js',
    ]);
    expect(() => notices.bundledInputs({ inputs: {} })).toThrow(/not an esbuild metafile/);
  });

  it('finds LICENSE, LICENCE and COPYING files with optional .md or .txt', () => {
    const names = ['README.md', 'license.md', 'LICENSE', 'COPYING', 'Copying.TXT', 'LICENCE.txt'];
    expect(notices.licenseFileNames([...names, 'LICENSE-MIT', 'licenses', 'LICENSE.rst'])).toEqual([
      'COPYING',
      'Copying.TXT',
      'LICENCE.txt',
      'LICENSE',
      'license.md',
    ]);
  });

  it.each([
    ['git+https://github.com/pmndrs/zustand.git', 'https://github.com/pmndrs/zustand'],
    ['https://github.com/Microsoft/vscode-l10n.git', 'https://github.com/Microsoft/vscode-l10n'],
    ['jorgebucaran/classcat', 'https://github.com/jorgebucaran/classcat'],
    ['github:user/repo', 'https://github.com/user/repo'],
    ['gitlab:user/repo', 'https://gitlab.com/user/repo'],
    ['git@github.com:user/repo.git', 'https://github.com/user/repo'],
    ['ssh://git@github.com/user/repo.git', 'https://github.com/user/repo'],
    ['git://github.com/user/repo.git', 'https://github.com/user/repo'],
  ])('turns the repository %s into %s', (repository, url) => {
    expect(notices.repositoryUrl(repository)).toBe(url);
  });

  it('gives up on repositories that are not URLs', () => {
    expect(notices.repositoryUrl('see the website')).toBeUndefined();
  });
});

describe('rendering', () => {
  const zeta: NpmNotice = {
    name: 'zeta',
    version: '1.0.0',
    license: 'MIT',
    source: 'https://github.com/example/zeta',
    outputs: ['dist/webview/main.js', 'dist/extension.js'],
    texts: [{ file: 'LICENSE', text: 'MIT License\n\nCopyright (c) Zeta' }],
  };
  const alpha: NpmNotice = {
    name: '@scope/alpha',
    version: '2.0.0',
    license: 'ISC',
    source: 'https://www.npmjs.com/package/@scope/alpha/v/2.0.0',
    outputs: ['dist/webview/main.js'],
    note: 'A note about the source.',
    texts: [{ file: 'LICENSE.md', text: 'Shown in ```text``` blocks' }],
  };
  const parso: PythonNotice = {
    name: 'parso',
    version: '0.8.7',
    license: 'MIT AND PSF-2.0',
    source: 'https://pypi.org/project/parso/0.8.7/',
    wheel: 'parso-0.8.7-py2.py3-none-any.whl',
    sha256: 'a8926eb2a1b915486941fdbd31e86a4baf88fe8c210f25f2f35ecec5b574ca1c',
    pruned: [],
    texts: [{ file: 'parso-0.8.7.dist-info/LICENSE.txt', text: 'MIT and PSF text' }],
  };
  const jedi: PythonNotice = {
    name: 'jedi',
    version: '0.20.1',
    license: 'MIT AND Apache-2.0',
    source: 'https://pypi.org/project/jedi/0.20.1/',
    pruned: ['jedi/third_party/typeshed/stubs', 'jedi/third_party/django-stubs'],
    texts: [
      { file: 'jedi/third_party/typeshed/LICENSE', text: 'Apache text' },
      { file: 'jedi-0.20.1.dist-info/LICENSE.txt', text: 'MIT text' },
    ],
  };
  const rendered = notices.renderNotices({ npm: [zeta, alpha], python: [parso, jedi] });

  it('names the project and how the file is generated', () => {
    expect(rendered.startsWith('# Third-party notices\n')).toBe(true);
    expect(rendered).toContain('`lldeters.readback-code`');
    expect(rendered).toContain('generated by `scripts/notices.mjs`');
    expect(rendered).toContain('npm run build:prod && npm run notices');
  });

  it('lists the sections and packages in a fixed order', () => {
    const order = [
      '## Bundled JavaScript packages',
      '### @scope/alpha 2.0.0',
      '### zeta 1.0.0',
      '## Vendored Python packages',
      '### jedi 0.20.1',
      '### parso 0.8.7',
    ].map((heading) => rendered.indexOf(`\n${heading}\n`));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('shows license, source, bundles, wheel and removed paths', () => {
    expect(rendered).toContain(
      '- License: MIT\n- Source: https://github.com/example/zeta\n' +
        '- Included in: `dist/extension.js`, `dist/webview/main.js`\n',
    );
    expect(rendered).toContain('A note about the source.');
    expect(rendered).toContain(
      '- Wheel: `parso-0.8.7-py2.py3-none-any.whl`\n' +
        '- SHA-256: `a8926eb2a1b915486941fdbd31e86a4baf88fe8c210f25f2f35ecec5b574ca1c`\n',
    );
    expect(rendered).toContain(
      '- Removed from the wheel: `jedi/third_party/django-stubs`, `jedi/third_party/typeshed/stubs`',
    );
  });

  it('puts every license text into a fence it cannot close', () => {
    expect(rendered).toContain('`LICENSE`:\n\n```text\nMIT License\n\nCopyright (c) Zeta\n```\n');
    expect(notices.fenceFor('Shown in ```text``` blocks')).toBe('````');
    expect(rendered).toContain('````text\nShown in ```text``` blocks\n````\n');
    expect(rendered.indexOf('jedi-0.20.1.dist-info/LICENSE.txt')).toBeLessThan(
      rendered.indexOf('jedi/third_party/typeshed/LICENSE'),
    );
  });

  it('does not depend on the input order', () => {
    const reordered = notices.renderNotices({
      npm: [alpha, { ...zeta, outputs: [...zeta.outputs].reverse() }],
      python: [jedi, parso],
    });
    expect(reordered).toBe(rendered);
    expect(rendered.endsWith('\n')).toBe(true);
    expect(rendered.endsWith('\n\n')).toBe(false);
  });

  it('says when nothing is bundled or vendored', () => {
    const empty = notices.renderNotices({ npm: [], python: [] });
    expect(empty).toContain('No third-party JavaScript packages are bundled.');
    expect(empty).toContain('No Python packages are vendored.');
  });
});

describe('command line', () => {
  const directories: string[] = [];
  afterAll(() => {
    for (const directory of directories) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  type Files = Record<string, string | object>;

  function write(root: string, files: Files): void {
    for (const [relative, content] of Object.entries(files)) {
      const file = path.join(root, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    }
  }

  function metafile(outputs: Record<string, Record<string, number>>): object {
    const entries = Object.entries(outputs).map(([output, inputs]): [string, object] => [
      output,
      {
        inputs: Object.fromEntries(
          Object.entries(inputs).map(([input, bytes]) => [input, { bytesInOutput: bytes }]),
        ),
      },
    ]);
    return { inputs: {}, outputs: Object.fromEntries(entries) };
  }

  /** A repository-like tree: two bundles, nested and scoped packages, two vendored packages. */
  function fixture(extra: Files = {}): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'readback-notices-'));
    directories.push(root);
    write(root, {
      'node_modules/alpha/package.json': {
        name: 'alpha',
        version: '1.2.3',
        license: 'MIT',
        repository: { type: 'git', url: 'git+https://github.com/example/alpha.git' },
      },
      'node_modules/alpha/index.js': '',
      'node_modules/alpha/LICENSE': 'MIT License\r\n\r\nCopyright (c) Alpha\r\n',
      'node_modules/alpha/node_modules/gamma/package.json': {
        name: 'gamma',
        version: '0.1.0',
        license: 'ISC',
        homepage: 'https://gamma.example',
      },
      'node_modules/alpha/node_modules/gamma/LICENCE.txt': 'ISC License (Gamma)',
      'node_modules/@scope/beta/package.json': {
        name: '@scope/beta',
        version: '2.0.0',
        license: '(MIT OR GPL-3.0-only)',
      },
      'node_modules/@scope/beta/license.md': 'MIT (Beta)',
      'node_modules/@vscode/l10n/package.json': {
        name: '@vscode/l10n',
        version: '0.0.18',
        license: 'MIT',
      },
      'node_modules/shaken/package.json': {
        name: 'shaken',
        version: '9.9.9',
        license: 'GPL-3.0-only',
      },
      'out/meta/host.json': metafile({
        'dist/extension.js': { 'node_modules/alpha/index.js': 120, 'src/extension.ts': 900 },
      }),
      'out/meta/web.json': metafile({
        'dist/webview/main.js': {
          'node_modules/alpha/index.js': 10,
          'node_modules/alpha/node_modules/gamma/index.js': 20,
          'node_modules/@scope/beta/index.js': 30,
          'node_modules/@vscode/l10n/dist/browser.js': 40,
          'node_modules/shaken/index.js': 0,
        },
        'dist/webview/main.css': { 'node_modules/@scope/beta/style.css': 5 },
      }),
      'vendor/VENDOR.json': {
        packages: [
          {
            name: 'parso',
            version: '0.8.7',
            wheel: 'parso-0.8.7-py2.py3-none-any.whl',
            sha256: 'a8926eb2a1b915486941fdbd31e86a4baf88fe8c210f25f2f35ecec5b574ca1c',
            license: 'MIT AND PSF-2.0',
            licenseFiles: ['parso-0.8.7.dist-info/LICENSE.txt'],
            prunedPatterns: [],
            fileCount: 37,
          },
          {
            name: 'jedi',
            version: '0.20.1',
            wheel: 'jedi-0.20.1-py2.py3-none-any.whl',
            sha256: '0fb16d86c4a4c73c37ba518c77419975e30fcc620658a8d14fbb5720cdd34142',
            license: 'MIT AND Apache-2.0',
            licenseFiles: [
              'jedi-0.20.1.dist-info/LICENSE.txt',
              'jedi/third_party/typeshed/LICENSE',
            ],
            prunedPatterns: ['jedi/third_party/typeshed/stubs'],
            fileCount: 1000,
          },
        ],
      },
      'vendor/parso-0.8.7.dist-info/LICENSE.txt': 'parso license text',
      'vendor/jedi-0.20.1.dist-info/LICENSE.txt': 'jedi license text',
      'vendor/jedi/third_party/typeshed/LICENSE': 'typeshed license text',
      ...extra,
    });
    return root;
  }

  const DEFAULT_ARGS = [
    '--root',
    '.',
    '--metafiles',
    'out/meta/host.json,out/meta/web.json',
    '--vendor',
    'vendor/VENDOR.json',
    '--out',
    'NOTICES.md',
  ];

  function run(cwd: string, args: readonly string[] = DEFAULT_ARGS, env: NodeJS.ProcessEnv = {}) {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it('writes notices for exactly the packages in the bundles', () => {
    const root = fixture();
    const result = run(root);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/4 JavaScript packages, 2 Python packages/);

    const written = readFileSync(path.join(root, 'NOTICES.md'), 'utf8');
    const headings = [...written.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual([
      '@scope/beta 2.0.0',
      '@vscode/l10n 0.0.18',
      'alpha 1.2.3',
      'gamma 0.1.0',
      'jedi 0.20.1',
      'parso 0.8.7',
    ]);
    expect(written).toContain(
      '- License: MIT\n- Source: https://github.com/example/alpha\n' +
        '- Included in: `dist/extension.js`, `dist/webview/main.js`\n',
    );
    expect(written).toContain('- Source: https://gamma.example\n');
    expect(written).toContain('- Source: https://www.npmjs.com/package/@scope/beta/v/2.0.0\n');
    expect(written).toContain('- Included in: `dist/webview/main.css`, `dist/webview/main.js`\n');
    // CRLF in a license file does not leak into the notices.
    expect(written).toContain('```text\nMIT License\n\nCopyright (c) Alpha\n```');
    expect(written).not.toContain('\r');
    expect(written).toMatch(/`LICENSE` \(not included in the package; copied from https:\/\//);
    expect(written).toContain('- Source: https://pypi.org/project/jedi/0.20.1/\n');
    expect(written).toContain('typeshed license text');
    expect(written).not.toContain('shaken');
  });

  it('passes --check for a current file and fails it for a stale or missing one', () => {
    const root = fixture();
    expect(run(root).status).toBe(0);
    const current = run(root, [...DEFAULT_ARGS, '--check']);
    expect(current.status).toBe(0);
    expect(current.stdout).toMatch(/is up to date/);

    const notesFile = path.join(root, 'NOTICES.md');
    writeFileSync(notesFile, readFileSync(notesFile, 'utf8').replace('Alpha', 'Edited'));
    const stale = run(root, [...DEFAULT_ARGS, '--check']);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toMatch(/NOTICES\.md is out of date \(first difference in line \d+\)/);

    rmSync(notesFile);
    const missing = run(root, [...DEFAULT_ARGS, '--check']);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/NOTICES\.md does not exist/);
  });

  it('fails the gate for a bundled package with a license that is not allowed', () => {
    const root = fixture({
      'node_modules/copyleft/package.json': {
        name: 'copyleft',
        version: '1.0.0',
        license: 'GPL-3.0-only',
      },
      'node_modules/copyleft/COPYING': 'GNU GENERAL PUBLIC LICENSE',
      'out/meta/extra.json': metafile({ 'dist/extension.js': { 'node_modules/copyleft/a.js': 1 } }),
    });
    const result = run(root, [
      ...DEFAULT_ARGS,
      '--metafiles',
      'out/meta/host.json,out/meta/web.json,out/meta/extra.json',
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/license gate failed/);
    expect(result.stderr).toMatch(/npm package copyleft 1\.0\.0: declares "GPL-3\.0-only"/);
    expect(existsSync(path.join(root, 'NOTICES.md'))).toBe(false);
  });

  it('lists files copied without esbuild and applies the elkjs exception', () => {
    const root = fixture({
      'node_modules/elkjs/package.json': {
        name: 'elkjs',
        version: '0.12.1',
        license: 'EPL-2.0 OR GPL-3.0-or-later',
        repository: { type: 'git', url: 'git+https://github.com/kieler/elkjs.git' },
      },
      'node_modules/elkjs/LICENSE.md': 'Eclipse Public License - v 2.0',
      // A copy step describes its files in the metafile format, so the gate sees them too.
      'out/meta/copied.json': metafile({
        'dist/webview/vendor/elkjs/elk-worker.min.js': {
          'node_modules/elkjs/lib/elk-worker.min.js': 1500,
        },
      }),
    });
    const result = run(root, [
      ...DEFAULT_ARGS,
      '--metafiles',
      'out/meta/host.json,out/meta/web.json,out/meta/copied.json',
    ]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const written = readFileSync(path.join(root, 'NOTICES.md'), 'utf8');
    expect(written).toContain(
      '### elkjs 0.12.1\n\n- License: EPL-2.0 OR GPL-3.0-or-later\n' +
        '- Source: https://github.com/kieler/elkjs\n' +
        '- Included in: `dist/webview/vendor/elkjs/elk-worker.min.js`\n',
    );
    expect(written).toContain('Eclipse Public License 2.0');
    expect(written).toContain('https://github.com/kieler/elkjs/tree/0.12.1');
  });

  it('fails the gate when a license text is missing', () => {
    const root = fixture({
      'node_modules/textless/package.json': { name: 'textless', version: '1.0.0', license: 'MIT' },
      'out/meta/extra.json': metafile({ 'dist/extension.js': { 'node_modules/textless/a.js': 1 } }),
      'vendor/VENDOR.json': {
        packages: [
          { name: 'nolicense', version: '1.0', licenseFiles: ['nolicense/LICENSE'] },
          { name: 'nofile', version: '2.0', license: 'MIT', licenseFiles: ['nofile/LICENSE'] },
          { name: 'escapes', version: '3.0', license: 'MIT', licenseFiles: ['../LICENSE'] },
          { name: 'unlisted', version: '4.0', license: 'MIT' },
        ],
      },
      'vendor/nolicense/LICENSE': 'text',
    });
    const result = run(root, [
      ...DEFAULT_ARGS,
      '--metafiles',
      'out/meta/host.json,out/meta/web.json,out/meta/extra.json',
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/npm package textless 1\.0\.0: has no license file/);
    expect(result.stderr).toMatch(/Python package nolicense 1\.0: declares no license/);
    expect(result.stderr).toMatch(/Python package nofile 2\.0: cannot read license file/);
    expect(result.stderr).toMatch(/Python package escapes 3\.0: .* outside the vendor directory/);
    expect(result.stderr).toMatch(/Python package unlisted 4\.0: VENDOR\.json lists no license/);
  });

  it('reads the input paths from environment variables', () => {
    const root = fixture();
    const result = run(root, ['--root', '.', '--out', 'NOTICES.md'], {
      READBACK_NOTICES_METAFILES: 'out/meta/host.json',
      READBACK_NOTICES_VENDOR: 'vendor/VENDOR.json',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/1 JavaScript packages, 2 Python packages/);
  });

  it('reports usage and input errors with exit code 2', () => {
    const root = fixture({ 'out/meta/broken.json': '{ not json' });
    const missing = run(root, [...DEFAULT_ARGS, '--metafiles', 'out/meta/absent.json']);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(
      /cannot read .*absent\.json \(ENOENT\)\. Run "npm run build:prod"/,
    );

    const broken = run(root, [...DEFAULT_ARGS, '--metafiles', 'out/meta/broken.json']);
    expect(broken.status).toBe(2);
    expect(broken.stderr).toMatch(/broken\.json is not valid JSON/);

    const noVendor = run(root, [...DEFAULT_ARGS, '--vendor', 'vendor/absent.json']);
    expect(noVendor.status).toBe(2);
    expect(noVendor.stderr).toMatch(/Run "npm run vendor" first/);

    const unknown = run(root, ['--frobnicate']);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toMatch(/unknown argument "--frobnicate"/);

    const flagValue = run(root, ['--check=yes']);
    expect(flagValue.status).toBe(2);
    expect(flagValue.stderr).toMatch(/--check takes no value/);

    const noMetafiles = run(root, [...DEFAULT_ARGS, '--metafiles', ' , ']);
    expect(noMetafiles.status).toBe(2);
    expect(noMetafiles.stderr).toMatch(/the metafile list is empty/);
  });
});
