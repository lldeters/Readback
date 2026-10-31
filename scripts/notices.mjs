// @ts-check
// Generates THIRD_PARTY_NOTICES.md and enforces the license policy (docs/adr/009-license-policy.md)
// for all third-party code in the VSIX: the npm packages esbuild bundled (found through the
// metafiles in out/meta/) and the Python packages vendored into engine/vendor/ (VENDOR.json).
//   node scripts/notices.mjs           write THIRD_PARTY_NOTICES.md
//   node scripts/notices.mjs --check   fail if the file is out of date or a license is not allowed
// Options (relative paths are resolved against the current directory):
//   --metafiles <a.json,b.json>  esbuild metafiles, default out/meta/{extension,webview,worker}.json
//                                (environment: READBACK_NOTICES_METAFILES)
//   --vendor <VENDOR.json>       vendored Python packages, default engine/vendor/VENDOR.json
//                                (environment: READBACK_NOTICES_VENDOR)
//   --root <dir>                 directory esbuild ran in, default the repository root
//   --out <file>                 notices file, default THIRD_PARTY_NOTICES.md
// Exit codes: 0 success, 1 license gate failed or notices out of date, 2 usage or input error.
import { realpathSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_METAFILES = Object.freeze([
  'out/meta/extension.json',
  'out/meta/webview.json',
  'out/meta/worker.json',
]);
export const DEFAULT_VENDOR = 'engine/vendor/VENDOR.json';
export const DEFAULT_OUT = 'THIRD_PARTY_NOTICES.md';

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

const POLICY = 'docs/adr/009-license-policy.md';
const REGENERATE = 'npm run build:prod && npm run notices';

/** Permissive licenses any shipped package may use (docs/adr/009-license-policy.md). */
export const ALLOWED_LICENSES = Object.freeze([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'PSF-2.0',
  'Python-2.0',
  'Zlib',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Unlicense',
]);

/**
 * @typedef {object} LicenseException
 * @property {string} expression  The exact SPDX expression the package must declare.
 * @property {readonly string[]} allow  Licenses beyond ALLOWED_LICENSES that Readback relies on.
 * @property {string} decision  Where the exception was approved.
 * @property {string} notice  Text for the package's entry; {version} is replaced.
 */

/**
 * npm packages approved to ship under a license outside ALLOWED_LICENSES. An exception covers
 * exactly the declared expression, so a license change in a new version fails the gate again.
 * @type {ReadonlyMap<string, LicenseException>}
 */
export const NPM_LICENSE_EXCEPTIONS = new Map([
  [
    'elkjs',
    {
      expression: 'EPL-2.0 OR GPL-3.0-or-later',
      allow: ['EPL-2.0'],
      decision: POLICY,
      // EPL-2.0 section 3.1(a): say that the code is EPL-2.0 and how to obtain its source.
      notice:
        'Readback uses elkjs under the Eclipse Public License 2.0 and ships its files unmodified, ' +
        "separate from Readback's own code. Source code: " +
        'https://github.com/kieler/elkjs/tree/{version}, built from the Eclipse Layout Kernel ' +
        '(https://github.com/eclipse-elk/elk).',
    },
  ],
]);

/**
 * License texts of bundled packages whose npm tarball omits the license file, copied verbatim
 * from the package's repository. The notices must reproduce the text (MIT: "The above copyright
 * notice and this permission notice shall be included ..."), so a package without its own license
 * file and without an entry here fails the gate.
 * @type {ReadonlyMap<string, { file: string, url: string, text: string }>}
 */
export const SUPPLEMENTARY_LICENSE_TEXTS = new Map([
  [
    '@vscode/l10n',
    {
      file: 'LICENSE',
      url: 'https://github.com/microsoft/vscode-l10n/blob/8f370288b7b1a765db9e31c7b5f6edbdd0eabc71/LICENSE',
      text: [
        '    MIT License',
        '',
        '    Copyright (c) Microsoft Corporation.',
        '',
        '    Permission is hereby granted, free of charge, to any person obtaining a copy',
        '    of this software and associated documentation files (the "Software"), to deal',
        '    in the Software without restriction, including without limitation the rights',
        '    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
        '    copies of the Software, and to permit persons to whom the Software is',
        '    furnished to do so, subject to the following conditions:',
        '',
        '    The above copyright notice and this permission notice shall be included in all',
        '    copies or substantial portions of the Software.',
        '',
        '    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
        '    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
        '    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
        '    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
        '    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
        '    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
        '    SOFTWARE',
      ].join('\n'),
    },
  ],
]);

/** Matches LICENSE, LICENCE and COPYING, each optionally with .md or .txt, in any case. */
const LICENSE_FILE = /^(?:licen[cs]e|copying)(?:\.(?:md|txt))?$/i;

// ---------------------------------------------------------------------------------------------
// SPDX license expressions

export class SpdxSyntaxError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'SpdxSyntaxError';
  }
}

/**
 * @typedef {{ type: 'license', id: string }
 *   | { type: 'with', id: string, exception: string }
 *   | { type: 'and' | 'or', operands: SpdxNode[] }} SpdxNode
 */

const OPERATORS = new Set(['AND', 'OR', 'WITH']);
// License and exception ids, LicenseRef-/DocumentRef- references and the deprecated "+" suffix.
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9.+:-]*$/;

/** @param {string} expression */
function tokenize(expression) {
  const tokens = expression.replace(/[()]/g, ' $& ').trim().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (token !== '(' && token !== ')' && !OPERATORS.has(token) && !IDENTIFIER.test(token)) {
      throw new SpdxSyntaxError(`"${token}" is not a license identifier`);
    }
  }
  return tokens;
}

/** @param {string} token */
function unexpected(token) {
  // SPDX operators are case-sensitive; "mit or isc" is a common mistake worth explaining.
  const hint = OPERATORS.has(token.toUpperCase()) ? ' (operators must be AND, OR, WITH)' : '';
  return new SpdxSyntaxError(`unexpected "${token}"${hint}`);
}

/**
 * Parses an SPDX license expression (SPDX 2.3 Annex D). Precedence: WITH, then AND, then OR.
 * @param {string} expression
 * @returns {SpdxNode}
 */
export function parseSpdx(expression) {
  const tokens = tokenize(expression);
  if (tokens.length === 0) {
    throw new SpdxSyntaxError('the expression is empty');
  }
  let position = 0;

  /** @param {'and' | 'or'} type @param {() => SpdxNode} parseOperand @returns {SpdxNode} */
  const parseList = (type, parseOperand) => {
    const operator = type.toUpperCase();
    const operands = [parseOperand()];
    while (tokens[position] === operator) {
      position += 1;
      operands.push(parseOperand());
    }
    if (operands.length === 1 && operands[0]) {
      return operands[0];
    }
    // "(A OR B) OR C" and "A OR (B OR C)" mean the same; flattening gives one canonical form.
    return {
      type,
      operands: operands.flatMap((operand) =>
        operand.type === type ? operand.operands : [operand],
      ),
    };
  };

  /** @returns {SpdxNode} */
  const parsePrimary = () => {
    const token = tokens[position];
    position += 1;
    if (token === undefined) {
      throw new SpdxSyntaxError('the expression ends early');
    }
    if (token === '(') {
      const inner = parseOr();
      if (tokens[position] !== ')') {
        throw new SpdxSyntaxError('a closing parenthesis is missing');
      }
      position += 1;
      return inner;
    }
    if (token === ')' || OPERATORS.has(token)) {
      throw unexpected(token);
    }
    if (tokens[position] !== 'WITH') {
      return { type: 'license', id: token };
    }
    position += 1;
    const exception = tokens[position];
    position += 1;
    if (
      exception === undefined ||
      exception === '(' ||
      exception === ')' ||
      OPERATORS.has(exception)
    ) {
      throw new SpdxSyntaxError('WITH must be followed by a license exception identifier');
    }
    return { type: 'with', id: token, exception };
  };

  const parseAnd = () => parseList('and', parsePrimary);
  const parseOr = () => parseList('or', parseAnd);

  const tree = parseOr();
  const rest = tokens[position];
  if (rest !== undefined) {
    throw unexpected(rest);
  }
  return tree;
}

/**
 * Canonical text of a parsed expression (parentheses only where precedence needs them).
 * @param {SpdxNode} node
 * @returns {string}
 */
export function formatSpdx(node) {
  switch (node.type) {
    case 'license':
      return node.id;
    case 'with':
      return `${node.id} WITH ${node.exception}`;
    case 'and':
      return node.operands
        .map((operand) =>
          operand.type === 'or' ? `(${formatSpdx(operand)})` : formatSpdx(operand),
        )
        .join(' AND ');
    case 'or':
      return node.operands.map(formatSpdx).join(' OR ');
  }
}

/**
 * @param {SpdxNode} node
 * @param {ReadonlySet<string>} allowed  lower-case terms
 * @returns {string[]}
 */
function unmetTerms(node, allowed) {
  switch (node.type) {
    case 'license':
    case 'with': {
      // A WITH term counts only when listed as a whole: exceptions are rare enough to review.
      const term = formatSpdx(node);
      return allowed.has(term.toLowerCase()) ? [] : [term];
    }
    case 'and':
      return node.operands.flatMap((operand) => unmetTerms(operand, allowed));
    case 'or': {
      const branches = node.operands.map((operand) => unmetTerms(operand, allowed));
      return branches.some((branch) => branch.length === 0) ? [] : branches.flat();
    }
  }
}

/**
 * The license terms that keep an expression from being satisfied with the allowed licenses
 * (empty when it is satisfied). OR needs one allowed alternative, AND needs all of its parts.
 * License ids compare case-insensitively, as SPDX specifies.
 * @param {SpdxNode} node
 * @param {Iterable<string>} allowed
 * @returns {string[]}
 */
export function unmetLicenses(node, allowed) {
  const lowerCase = new Set([...allowed].map((term) => term.toLowerCase()));
  return [...new Set(unmetTerms(node, lowerCase))].sort(compareText);
}

/**
 * Checks a package's declared license against the policy.
 * @param {'npm' | 'python'} ecosystem
 * @param {string} name
 * @param {string | undefined} declared
 * @returns {string | undefined} why the package fails the gate, or undefined
 */
export function licenseProblem(ecosystem, name, declared) {
  if (declared === undefined || declared.trim() === '') {
    return 'declares no license';
  }
  let tree;
  try {
    tree = parseSpdx(declared);
  } catch (error) {
    return `declares "${declared}", which is not a valid SPDX expression: ${errorText(error)}`;
  }
  const exception = ecosystem === 'npm' ? NPM_LICENSE_EXCEPTIONS.get(name) : undefined;
  if (exception) {
    const approved = formatSpdx(parseSpdx(exception.expression));
    if (formatSpdx(tree).toLowerCase() !== approved.toLowerCase()) {
      return `declares "${declared}", but the exception in ${exception.decision} covers only "${exception.expression}"`;
    }
  }
  const unmet = unmetLicenses(tree, [...ALLOWED_LICENSES, ...(exception?.allow ?? [])]);
  if (unmet.length > 0) {
    return `declares "${declared}"; not allowed by ${POLICY}: ${unmet.join(', ')}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// npm packages in the esbuild bundles

/**
 * The npm package an esbuild input path belongs to: the directory after the last node_modules
 * segment (two segments for @scope/name), so a nested install maps to the nested copy.
 * @param {string} inputPath  metafile input path, relative to the esbuild working directory
 * @returns {{ name: string, root: string } | undefined}  root keeps the input's prefix
 */
export function packageRootOf(inputPath) {
  // Inputs in esbuild namespaces such as "(disabled):" carry no file contents. A one-letter
  // prefix is a Windows drive, not a namespace.
  if (/^(?:\([^)]*\)|[A-Za-z][\w-]+):/.test(inputPath)) {
    return undefined;
  }
  const segments = inputPath.replaceAll('\\', '/').split('/');
  const index = segments.lastIndexOf('node_modules');
  if (index < 0) {
    return undefined;
  }
  const nameLength = segments[index + 1]?.startsWith('@') ? 2 : 1;
  const end = index + 1 + nameLength;
  const nameSegments = segments.slice(index + 1, end);
  // The name must be followed by a file. Names starting with "." are npm's own directories
  // (node_modules/.bin, node_modules/.cache), not packages.
  if (
    segments.length <= end ||
    nameSegments.length < nameLength ||
    nameSegments.some((segment) => segment === '' || segment.startsWith('.'))
  ) {
    return undefined;
  }
  return { name: nameSegments.join('/'), root: segments.slice(0, end).join('/') };
}

/**
 * Input files that put at least one byte into an output, with those outputs. Inputs that
 * tree-shaking removed completely are not shipped and need no notice.
 * @param {unknown} metafile
 * @returns {Map<string, Set<string>>}  input path -> output paths
 */
export function bundledInputs(metafile) {
  if (!isRecord(metafile) || !isRecord(metafile.outputs)) {
    throw new InputError('is not an esbuild metafile (no "outputs")');
  }
  /** @type {Map<string, Set<string>>} */
  const inputs = new Map();
  for (const [output, info] of Object.entries(metafile.outputs)) {
    if (!isRecord(info) || !isRecord(info.inputs)) {
      continue;
    }
    for (const [input, contribution] of Object.entries(info.inputs)) {
      const bytes = isRecord(contribution) ? contribution.bytesInOutput : undefined;
      if (typeof bytes === 'number' && bytes > 0) {
        const outputs = inputs.get(input) ?? new Set();
        outputs.add(output);
        inputs.set(input, outputs);
      }
    }
  }
  return inputs;
}

/**
 * The license files among a package directory's file names, sorted.
 * @param {readonly string[]} fileNames
 */
export function licenseFileNames(fileNames) {
  return fileNames.filter((name) => LICENSE_FILE.test(name)).sort(compareText);
}

/**
 * Turns an npm "repository" value into a browsable https URL, if possible.
 * @param {string} repository
 * @returns {string | undefined}
 */
export function repositoryUrl(repository) {
  const value = repository.trim();
  // npm shorthands: "user/repo", "github:user/repo", "gitlab:user/repo", "bitbucket:user/repo".
  const shorthand = /^(?:(github|gitlab|bitbucket):)?([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(value);
  if (shorthand?.[2]) {
    const host = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' }[
      /** @type {'github' | 'gitlab' | 'bitbucket'} */ (shorthand[1] ?? 'github')
    ];
    return `https://${host}/${shorthand[2]}`;
  }
  let url = value.replace(/^git\+/, '');
  // scp-like syntax: git@github.com:user/repo.git
  const scp = /^[\w.-]+@([\w.-]+):(?!\/)(.+)$/.exec(url);
  if (scp) {
    url = `https://${scp[1] ?? ''}/${scp[2] ?? ''}`;
  }
  url = url.replace(/^(?:git|ssh|http):\/\/(?:[^@/]+@)?/, 'https://');
  if (!/^https:\/\/[^/]+\/./.test(url)) {
    return undefined;
  }
  return url.replace(/\.git$/, '').replace(/\/+$/, '');
}

/**
 * Where to find the source of an npm package: its repository, else its homepage, else npm.
 * @param {Record<string, unknown>} manifest  package.json
 * @param {string} name
 * @param {string} version
 */
export function npmSourceUrl(manifest, name, version) {
  const repository = isRecord(manifest.repository) ? manifest.repository.url : manifest.repository;
  const fromRepository = typeof repository === 'string' ? repositoryUrl(repository) : undefined;
  if (fromRepository) {
    return fromRepository;
  }
  if (typeof manifest.homepage === 'string' && /^https?:\/\/\S+$/.test(manifest.homepage)) {
    return manifest.homepage;
  }
  return `https://www.npmjs.com/package/${name}/v/${version}`;
}

/**
 * The license an npm package declares, including the deprecated object forms.
 * @param {Record<string, unknown>} manifest
 * @returns {string | undefined}
 */
export function declaredNpmLicense(manifest) {
  const { license, licenses } = manifest;
  if (typeof license === 'string') {
    return license;
  }
  if (isRecord(license) && typeof license.type === 'string') {
    return license.type;
  }
  // The deprecated "licenses" array does not say whether its entries are alternatives, so only
  // a single entry is unambiguous.
  if (Array.isArray(licenses) && licenses.length === 1) {
    const [entry] = /** @type {unknown[]} */ (licenses);
    return isRecord(entry) && typeof entry.type === 'string' ? entry.type : undefined;
  }
  return undefined;
}

/**
 * @typedef {object} LicenseText
 * @property {string} file  File name or path shown above the text.
 * @property {string} text
 * @property {string} [origin]  URL the text was copied from when the package itself lacks it.
 */

/**
 * @typedef {object} NpmNotice
 * @property {string} name
 * @property {string} version
 * @property {string} license
 * @property {string} source
 * @property {readonly string[]} outputs  Bundles that contain code of the package.
 * @property {string} [note]
 * @property {readonly LicenseText[]} texts
 */

/**
 * @typedef {object} PythonNotice
 * @property {string} name
 * @property {string} version
 * @property {string} license
 * @property {string} source
 * @property {string} [wheel]
 * @property {string} [sha256]
 * @property {readonly string[]} pruned  Paths removed from the wheel.
 * @property {readonly LicenseText[]} texts
 */

/**
 * Collects the bundled npm packages and checks them against the policy.
 * @param {ReadonlyArray<{ file: string, metafile: unknown }>} metafiles
 * @param {string} root  directory the metafile input paths are relative to
 * @param {string[]} problems  receives one message per violation
 * @returns {Promise<NpmNotice[]>}
 */
export async function collectNpmPackages(metafiles, root, problems) {
  /** @type {Map<string, Set<string>>} */
  const packageOutputs = new Map();
  for (const { file, metafile } of metafiles) {
    let inputs;
    try {
      inputs = bundledInputs(metafile);
    } catch (error) {
      throw new InputError(`${display(file)} ${errorText(error)}`);
    }
    for (const [input, outputs] of inputs) {
      const found = packageRootOf(input);
      if (found) {
        const directory = path.resolve(root, found.root);
        const known = packageOutputs.get(directory) ?? new Set();
        outputs.forEach((output) => known.add(output));
        packageOutputs.set(directory, known);
      }
    }
  }

  /** @type {Map<string, NpmNotice>} */
  const notices = new Map();
  for (const directory of [...packageOutputs.keys()].sort(compareText)) {
    const outputs = packageOutputs.get(directory) ?? new Set();
    const notice = await readNpmPackage(directory, outputs, problems);
    if (!notice) {
      continue;
    }
    // The same name and version installed twice (nested copies) is one notice.
    const key = `${notice.name}@${notice.version}`;
    const existing = notices.get(key);
    notices.set(
      key,
      existing
        ? { ...existing, outputs: unique([...existing.outputs, ...notice.outputs]) }
        : notice,
    );
  }
  return [...notices.values()];
}

/**
 * @param {string} directory
 * @param {ReadonlySet<string>} outputs
 * @param {string[]} problems
 * @returns {Promise<NpmNotice | undefined>}
 */
async function readNpmPackage(directory, outputs, problems) {
  /** @type {Record<string, unknown>} */
  let manifest;
  try {
    const parsed = /** @type {unknown} */ (
      JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
    );
    if (!isRecord(parsed)) {
      throw new Error('not a JSON object');
    }
    manifest = parsed;
  } catch (error) {
    problems.push(
      `npm package in ${display(directory)}: cannot read package.json: ${errorText(error)}`,
    );
    return undefined;
  }
  const name =
    typeof manifest.name === 'string' && manifest.name !== '' ? manifest.name : undefined;
  const version =
    typeof manifest.version === 'string' && manifest.version !== '' ? manifest.version : undefined;
  if (name === undefined || version === undefined) {
    problems.push(`npm package in ${display(directory)}: package.json has no name or version`);
    return undefined;
  }
  const label = `npm package ${name} ${version}`;
  const license = declaredNpmLicense(manifest);
  const licenseError = licenseProblem('npm', name, license);
  if (licenseError) {
    problems.push(`${label}: ${licenseError}`);
  }

  /** @type {LicenseText[]} */
  const texts = [];
  const entries = await readdir(directory, { withFileTypes: true });
  // Symbolic links count as well (linked or pnpm-style installs); reading follows them.
  const files = licenseFileNames(
    entries.filter((entry) => entry.isFile() || entry.isSymbolicLink()).map((entry) => entry.name),
  );
  for (const file of files) {
    let text;
    try {
      text = normalizeText(await readFile(path.join(directory, file), 'utf8'));
    } catch (error) {
      problems.push(`${label}: cannot read license file ${file}: ${errorText(error)}`);
      continue;
    }
    if (text === '') {
      problems.push(`${label}: license file ${file} is empty`);
    } else {
      texts.push({ file, text });
    }
  }
  const supplementary = SUPPLEMENTARY_LICENSE_TEXTS.get(name);
  if (files.length === 0 && supplementary) {
    texts.push({
      file: supplementary.file,
      text: normalizeText(supplementary.text),
      origin: supplementary.url,
    });
  } else if (files.length === 0) {
    problems.push(
      `${label}: has no license file (LICENSE, LICENCE or COPYING); add its text to SUPPLEMENTARY_LICENSE_TEXTS in scripts/notices.mjs`,
    );
  }

  const exception = NPM_LICENSE_EXCEPTIONS.get(name);
  return {
    name,
    version,
    license: license ?? '',
    source: npmSourceUrl(manifest, name, version),
    outputs: [...outputs].sort(compareText),
    ...(exception ? { note: exception.notice.replaceAll('{version}', version) } : {}),
    texts,
  };
}

// ---------------------------------------------------------------------------------------------
// Vendored Python packages

/**
 * @typedef {object} VendoredPackage
 * @property {string} name
 * @property {string} version
 * @property {string | undefined} license
 * @property {string | undefined} wheel
 * @property {string | undefined} sha256
 * @property {readonly string[]} licenseFiles  Relative to the directory of VENDOR.json.
 * @property {readonly string[]} prunedPatterns
 */

/**
 * Reads the package list that scripts/vendor_engine.py writes to engine/vendor/VENDOR.json:
 * an array of packages, or an object with a "packages" array.
 * @param {unknown} manifest
 * @param {string[]} problems
 * @returns {VendoredPackage[]}
 */
export function parseVendorManifest(manifest, problems) {
  const entries = Array.isArray(manifest)
    ? /** @type {unknown[]} */ (manifest)
    : isRecord(manifest) && Array.isArray(manifest.packages)
      ? /** @type {unknown[]} */ (manifest.packages)
      : undefined;
  if (entries === undefined) {
    throw new InputError('has no "packages" array');
  }
  /** @type {VendoredPackage[]} */
  const packages = [];
  entries.forEach((entry, index) => {
    const name = isRecord(entry) && typeof entry.name === 'string' ? entry.name : '';
    const version = isRecord(entry) && typeof entry.version === 'string' ? entry.version : '';
    if (!isRecord(entry) || name === '' || version === '') {
      problems.push(`VENDOR.json: package entry ${String(index + 1)} has no name or version`);
      return;
    }
    packages.push({
      name,
      version,
      license: optionalString(entry.license),
      wheel: optionalString(entry.wheel),
      sha256: optionalString(entry.sha256),
      licenseFiles: stringList(entry.licenseFiles),
      prunedPatterns: stringList(entry.prunedPatterns),
    });
  });
  return packages;
}

/**
 * Checks the vendored packages and reads their license files.
 * @param {readonly VendoredPackage[]} packages
 * @param {string} vendorDirectory  directory of VENDOR.json (engine/vendor)
 * @param {string[]} problems
 * @returns {Promise<PythonNotice[]>}
 */
export async function collectPythonPackages(packages, vendorDirectory, problems) {
  /** @type {PythonNotice[]} */
  const notices = [];
  for (const entry of packages) {
    const label = `Python package ${entry.name} ${entry.version}`;
    const licenseError = licenseProblem('python', entry.name, entry.license);
    if (licenseError) {
      problems.push(`${label}: ${licenseError}`);
    }
    if (entry.licenseFiles.length === 0) {
      problems.push(`${label}: VENDOR.json lists no license file`);
    }
    /** @type {LicenseText[]} */
    const texts = [];
    for (const file of entry.licenseFiles) {
      const relative = file.replaceAll('\\', '/');
      if (path.isAbsolute(file) || relative.split('/').includes('..')) {
        problems.push(`${label}: license file ${file} lies outside the vendor directory`);
        continue;
      }
      let text;
      try {
        text = normalizeText(await readFile(path.join(vendorDirectory, relative), 'utf8'));
      } catch (error) {
        problems.push(`${label}: cannot read license file ${relative}: ${errorText(error)}`);
        continue;
      }
      if (text === '') {
        problems.push(`${label}: license file ${relative} is empty`);
      } else {
        texts.push({ file: relative, text });
      }
    }
    notices.push({
      name: entry.name,
      version: entry.version,
      license: entry.license ?? '',
      source: `https://pypi.org/project/${encodeURIComponent(entry.name)}/${encodeURIComponent(entry.version)}/`,
      ...(entry.wheel ? { wheel: entry.wheel } : {}),
      ...(entry.sha256 ? { sha256: entry.sha256 } : {}),
      pruned: [...entry.prunedPatterns].sort(compareText),
      texts,
    });
  }
  return notices;
}

// ---------------------------------------------------------------------------------------------
// Rendering

const INTRO = [
  '# Third-party notices',
  '',
  'Readback ("Readback – Understand AI-Written Code", extension ID `lldeters.readback-code`)',
  'contains the third-party software listed below. Each package is licensed under its own terms,',
  'reproduced in full.',
  '',
  'This file is generated by `scripts/notices.mjs` from the esbuild metafiles of the production',
  'bundles (`out/meta/*.json`) and from `engine/vendor/VENDOR.json`. Do not edit it by hand; run',
  `\`${REGENERATE}\` instead. \`npm run notices:check\`, which runs in`,
  '`vscode:prepublish`, fails when this file is out of date or when a license is not allowed by',
  `\`${POLICY}\`.`,
];

/**
 * A code fence longer than any backtick run in the text, so a license cannot close it early.
 * @param {string} text
 */
export function fenceFor(text) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/** @param {readonly LicenseText[]} texts @returns {string[]} */
function renderTexts(texts) {
  return [...texts]
    .sort((a, b) => compareText(a.file, b.file))
    .flatMap(({ file, text, origin }) => {
      const fence = fenceFor(text);
      const heading = origin
        ? `\`${file}\` (not included in the package; copied from ${origin}):`
        : `\`${file}\`:`;
      return [heading, '', `${fence}text`, text, fence, ''];
    });
}

/**
 * @template {{ name: string, version: string }} T
 * @param {readonly T[]} packages
 * @returns {T[]}
 */
function sortPackages(packages) {
  return [...packages].sort(
    (a, b) => compareText(a.name, b.name) || compareVersions(a.version, b.version),
  );
}

/**
 * Renders THIRD_PARTY_NOTICES.md. The result depends only on the data, not on its order.
 * @param {{ npm: readonly NpmNotice[], python: readonly PythonNotice[] }} notices
 */
export function renderNotices({ npm, python }) {
  const lines = [...INTRO, '', '## Bundled JavaScript packages', ''];
  lines.push(
    'esbuild compiles these packages into the extension bundles in `dist/`. The list is taken from',
    'the bundles themselves, so it includes transitive dependencies and nothing that is not shipped.',
    '',
  );
  if (npm.length === 0) {
    lines.push('No third-party JavaScript packages are bundled.', '');
  }
  for (const entry of sortPackages(npm)) {
    lines.push(`### ${entry.name} ${entry.version}`, '');
    lines.push(`- License: ${entry.license}`, `- Source: ${entry.source}`);
    const outputs = [...entry.outputs].sort(compareText).map((output) => `\`${output}\``);
    if (outputs.length > 0) {
      lines.push(`- Included in: ${outputs.join(', ')}`);
    }
    lines.push('');
    if (entry.note) {
      lines.push(entry.note, '');
    }
    lines.push(...renderTexts(entry.texts));
  }

  lines.push('## Vendored Python packages', '');
  lines.push(
    '`scripts/vendor_engine.py` unpacks these packages from their published wheels, verified by',
    'SHA-256, into `engine/vendor/`. Paths listed as removed are deleted to keep the extension small.',
    '',
  );
  if (python.length === 0) {
    lines.push('No Python packages are vendored.', '');
  }
  for (const entry of sortPackages(python)) {
    lines.push(`### ${entry.name} ${entry.version}`, '');
    lines.push(`- License: ${entry.license}`, `- Source: ${entry.source}`);
    if (entry.wheel) {
      lines.push(`- Wheel: \`${entry.wheel}\``);
    }
    if (entry.sha256) {
      lines.push(`- SHA-256: \`${entry.sha256}\``);
    }
    if (entry.pruned.length > 0) {
      const pruned = [...entry.pruned].sort(compareText).map((pattern) => `\`${pattern}\``);
      lines.push(`- Removed from the wheel: ${pruned.join(', ')}`);
    }
    lines.push('', ...renderTexts(entry.texts));
  }

  while (lines.at(-1) === '') {
    lines.pop();
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------
// Command line

class UsageError extends Error {}
class InputError extends Error {}

const USAGE = `Usage: node scripts/notices.mjs [--check] [--metafiles <a.json,b.json>] [--vendor <VENDOR.json>]
                                [--root <dir>] [--out <file>]
Checks the licenses of the bundled npm packages and the vendored Python packages against
${POLICY} and writes THIRD_PARTY_NOTICES.md. With --check, only verifies that
the file is up to date.`;

/**
 * @typedef {object} Options
 * @property {boolean} check
 * @property {string[]} metafiles
 * @property {string} vendor
 * @property {string} root
 * @property {string} out
 */

/**
 * @param {readonly string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @returns {Options | 'help'}
 */
function parseArguments(argv, env) {
  /** @type {Partial<Options>} */
  const given = {};
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    const equals = argument.startsWith('--') ? argument.indexOf('=') : -1;
    const flag = equals > 0 ? argument.slice(0, equals) : argument;
    const inline = equals > 0 ? argument.slice(equals + 1) : undefined;
    const value = () => {
      const next = inline ?? argv[(index += 1)];
      if (next === undefined || next === '') {
        throw new UsageError(`${flag} needs a value`);
      }
      return next;
    };
    if ((flag === '--check' || flag === '--help') && inline !== undefined) {
      throw new UsageError(`${flag} takes no value`);
    }
    switch (flag) {
      case '--check':
        check = true;
        break;
      case '--metafiles':
        given.metafiles = splitList(value());
        break;
      case '--vendor':
        given.vendor = value();
        break;
      case '--root':
        given.root = value();
        break;
      case '--out':
        given.out = value();
        break;
      case '--help':
      case '-h':
        return 'help';
      default:
        throw new UsageError(`unknown argument "${argument}"`);
    }
  }
  const envMetafiles = env.READBACK_NOTICES_METAFILES
    ? splitList(env.READBACK_NOTICES_METAFILES)
    : undefined;
  const metafiles = given.metafiles ?? envMetafiles;
  // An empty list would silently report "no bundled packages".
  if (metafiles?.length === 0) {
    throw new UsageError('the metafile list is empty');
  }
  const fromCwd = (/** @type {string} */ file) => path.resolve(file);
  const fromRepo = (/** @type {string} */ file) => path.resolve(repoRoot, file);
  return {
    check,
    metafiles: metafiles?.map(fromCwd) ?? DEFAULT_METAFILES.map(fromRepo),
    vendor: fromCwd(given.vendor ?? env.READBACK_NOTICES_VENDOR ?? fromRepo(DEFAULT_VENDOR)),
    root: given.root ? fromCwd(given.root) : repoRoot,
    out: given.out ? fromCwd(given.out) : fromRepo(DEFAULT_OUT),
  };
}

/**
 * @param {string} file
 * @param {string} hint  what to run when the file is missing
 * @returns {Promise<unknown>}
 */
async function readJson(file, hint) {
  let content;
  try {
    content = await readFile(file, 'utf8');
  } catch (error) {
    throw new InputError(`cannot read ${display(file)} (${errorCode(error)}). ${hint}`);
  }
  try {
    return /** @type {unknown} */ (JSON.parse(content));
  } catch (error) {
    throw new InputError(`${display(file)} is not valid JSON: ${errorText(error)}`);
  }
}

/**
 * Builds the notices from the inputs; returns the problems instead of failing on the first one.
 * @param {Options} options
 * @returns {Promise<{ text: string, problems: string[], counts: { npm: number, python: number } }>}
 */
async function buildNotices(options) {
  /** @type {string[]} */
  const problems = [];
  const metafiles = [];
  for (const file of options.metafiles) {
    metafiles.push({ file, metafile: await readJson(file, 'Run "npm run build:prod" first.') });
  }
  const vendorManifest = await readJson(options.vendor, 'Run "npm run vendor" first.');
  let vendored;
  try {
    vendored = parseVendorManifest(vendorManifest, problems);
  } catch (error) {
    throw new InputError(`${display(options.vendor)} ${errorText(error)}`);
  }
  const npm = await collectNpmPackages(metafiles, options.root, problems);
  const python = await collectPythonPackages(vendored, path.dirname(options.vendor), problems);
  return {
    text: renderNotices({ npm, python }),
    problems,
    counts: { npm: npm.length, python: python.length },
  };
}

/**
 * Runs the command line. Returns the exit code.
 * @param {readonly string[]} argv
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function main(argv, env = process.env) {
  try {
    const options = parseArguments(argv, env);
    if (options === 'help') {
      console.log(USAGE);
      return EXIT_OK;
    }
    const { text, problems, counts } = await buildNotices(options);
    if (problems.length > 0) {
      console.error(`notices: the license gate failed (${POLICY}):`);
      for (const problem of problems) {
        console.error(`  - ${problem}`);
      }
      return EXIT_FAILED;
    }
    const summary = `${String(counts.npm)} JavaScript packages, ${String(counts.python)} Python packages`;
    const target = display(options.out);
    if (!options.check) {
      await writeFile(options.out, text, 'utf8');
      console.log(`Wrote ${target} (${summary}).`);
      return EXIT_OK;
    }
    const current = await readFile(options.out, 'utf8').catch(() => undefined);
    if (current === text) {
      console.log(`${target} is up to date (${summary}).`);
      return EXIT_OK;
    }
    const where =
      current === undefined
        ? 'does not exist'
        : `is out of date (first difference in line ${String(firstDifferentLine(current, text))})`;
    console.error(`notices: ${target} ${where}. Run "${REGENERATE}".`);
    return EXIT_FAILED;
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`notices: ${error.message}\n\n${USAGE}`);
      return EXIT_USAGE;
    }
    if (error instanceof InputError) {
      console.error(`notices: ${error.message}`);
      return EXIT_USAGE;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value */
function optionalString(value) {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** @param {unknown} value @returns {string[]} */
function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/** @param {string} value */
function splitList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** @template T @param {readonly T[]} values @returns {T[]} */
function unique(values) {
  return [...new Set(values)];
}

/**
 * Code-unit order: unlike localeCompare it is the same on every machine.
 * @param {string} a
 * @param {string} b
 */
function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Orders versions numerically per dot-separated part ("1.10.0" after "1.9.0").
 * @param {string} a
 * @param {string} b
 */
function compareVersions(a, b) {
  const left = a.split(/[.+-]/);
  const right = b.split(/[.+-]/);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const x = left[index] ?? '';
    const y = right[index] ?? '';
    const order = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : compareText(x, y);
    if (order !== 0) {
      return order;
    }
  }
  return 0;
}

/**
 * License texts are reproduced as published; only the byte-order mark, line endings and blank
 * lines around the text are normalized, so the output is the same on every platform.
 * @param {string} text
 */
function normalizeText(text) {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .trimEnd();
}

/** @param {string} a @param {string} b */
function firstDifferentLine(a, b) {
  const left = a.split('\n');
  const right = b.split('\n');
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index + 1;
}

/** @param {string} file */
function display(file) {
  const relative = path.relative(process.cwd(), file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative
    : file;
}

/** @param {unknown} error */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {unknown} error */
function errorCode(error) {
  return isRecord(error) && typeof error.code === 'string' ? error.code : errorText(error);
}

function isMainModule() {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = await main(process.argv.slice(2));
}
