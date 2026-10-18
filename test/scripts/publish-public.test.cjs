'use strict';

// Tests scripts/publish-public.cjs with real git repositories in a temporary folder: a working repository standing
// in for this one, and an empty bare repository standing in for the public one. Versions are published from the
// first to the second, and the tests check what arrives (one commit per version, with exactly the version's files,
// its tag, the publishing name and address, Claude as co-author, each after the last) and what is refused: a
// version that is already public, files with a private word, and a public repository that can't be reached. A dry
// run sends nothing.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// The repositories here ignore the git settings of whoever runs the tests.
process.env.GIT_CONFIG_GLOBAL = os.devNull;
process.env.GIT_CONFIG_NOSYSTEM = '1';
const { publish, AUTHOR, CO_AUTHOR } = require('../../scripts/publish-public.cjs');

// git in a folder; returns what it printed, trimmed.
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A working repository and an empty public one, in a temporary folder that goes away after the test `t`. */
function repositories(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ym-publish-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const work = path.join(folder, 'work'),
    url = path.join(folder, 'public.git');
  fs.mkdirSync(work);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.name', 'Someone Working');
  git(work, 'config', 'user.email', 'work@example.com');
  git(folder, 'init', '-q', '--bare', '-b', 'main', url);
  return { work, url };
}

/** Commits files ({ path: text }) to the working repository's main, with `version` in package.json. */
function commit(work, version, files = {}) {
  const all = { 'package.json': `${JSON.stringify({ version })}\n`, ...files };
  for (const [file, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
    fs.writeFileSync(path.join(work, file), text);
  }
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', `Work on ${version}`);
}

test('the first version arrives as one commit with exactly its files, its tag and Claude', (t) => {
  const { work, url } = repositories(t);
  commit(work, '1.0.1', { 'README.md': 'Yes Machine\n' });
  commit(work, '1.0.1', { 'src/app.js': 'start();\n' });

  const { commit: sent, ...published } = publish({ cwd: work, url });
  assert.deepEqual(published, { version: '1.0.1', tag: 'v1.0.1', files: 3, parent: null });
  assert.equal(git(url, 'rev-list', '--count', 'main'), '1');
  assert.equal(git(url, 'rev-parse', 'main'), sent);
  assert.equal(git(url, 'rev-parse', 'v1.0.1'), sent);
  assert.equal(git(url, 'rev-parse', 'main^{tree}'), git(work, 'rev-parse', 'main^{tree}'));
  const signed = `${AUTHOR.name} <${AUTHOR.email}>`;
  assert.equal(git(url, 'log', '-1', '--format=%an <%ae>|%cn <%ce>'), `${signed}|${signed}`);
  assert.equal(git(url, 'log', '-1', '--format=%B'), `Yes Machine 1.0.1\n\n${CO_AUTHOR}`);
  assert.match(AUTHOR.email, /@users\.noreply\.github\.com$/);
});

test('each version comes after the last one, so the public history only grows', (t) => {
  const { work, url } = repositories(t);
  commit(work, '1.0.1', { 'README.md': 'one\n' });
  const first = publish({ cwd: work, url }).commit;
  commit(work, '1.0.2', { 'README.md': 'two\n' });

  const second = publish({ cwd: work, url });
  assert.equal(second.parent, first);
  assert.equal(git(url, 'rev-parse', 'main~1'), first);
  assert.equal(git(url, 'rev-parse', 'v1.0.2'), second.commit);
  assert.equal(git(url, 'show', 'main:README.md'), 'two');
});

test('a version that is already public is refused, and nothing more is sent', (t) => {
  const { work, url } = repositories(t);
  commit(work, '1.0.1');
  publish({ cwd: work, url });
  commit(work, '1.0.1', { 'notes.txt': 'more\n' });

  assert.throws(() => publish({ cwd: work, url }), /v1\.0\.1 is already public/);
  assert.equal(git(url, 'rev-list', '--count', 'main'), '1');
});

test('a private word in the files, in any case, stops the version', (t) => {
  const { work, url } = repositories(t);
  fs.mkdirSync(path.join(work, '.git/info'), { recursive: true });
  fs.writeFileSync(path.join(work, '.git/info/private-words'), '# never public\n\nSecretName\n');
  commit(work, '1.0.1', { 'docs/notes.md': 'Made by secretname.\n', 'clean.txt': 'Nothing.\n' });

  assert.throws(
    () => publish({ cwd: work, url }),
    /private words\.\n {2}SecretName: docs\/notes\.md$/,
  );
  assert.equal(git(url, 'for-each-ref'), '');
});

test('a public repository that can’t be reached is reported, and a dry run sends nothing', (t) => {
  const { work, url } = repositories(t);
  commit(work, '1.0.1', { 'README.md': 'Yes Machine\n' });

  const missing = path.join(work, 'missing.git');
  assert.throws(() => publish({ cwd: work, url: missing }), /can't reach/);
  assert.deepEqual(publish({ cwd: work, url, dryRun: true }), {
    version: '1.0.1',
    tag: 'v1.0.1',
    files: 2,
    parent: null,
    commit: null,
  });
  assert.equal(git(url, 'for-each-ref'), '');
});
