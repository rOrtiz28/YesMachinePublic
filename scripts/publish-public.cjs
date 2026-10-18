'use strict';
// Publishes a version of Yes Machine to the public repository, YesMachinePublic, as one commit that holds exactly
// that version's files. This repository keeps the history of the work; the public one gets the versions only, so
// its history and its activity show one commit and one push per version. `npm run publish-public` publishes main;
// another branch or tag can be named (`npm run publish-public -- v1.0.2`), and `--dry-run` tells what would be
// published without sending anything.
//
// Each version's commit comes after the last one published, so the public history is never rewritten. It is signed
// with the publishing name and GitHub's private address for the owner's account, which links it to the account
// without showing an email, has Claude as co-author, and goes out with the version's tag (v1.0.1), on which the
// release with the installers is then made on GitHub. Nothing is published when the tag is already public, or when
// the files contain a word from .git/info/private-words: one word per line, in any case, kept outside the
// repository so that the list itself stays private.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Where versions go, and who publishes them.
const PUBLIC_URL = 'https://github.com/rOrtiz28/YesMachinePublic.git';
const AUTHOR = { name: 'Raul', email: '53981240+rOrtiz28@users.noreply.github.com' };
const CO_AUTHOR = 'Co-Authored-By: Claude <noreply@anthropic.com>';
// Where the public repository's last version is kept once fetched, beside the remote-tracking branches.
const PUBLIC_MAIN = 'refs/remotes/public/main';

/** Runs git in `cwd`, with `env` added to the environment, and returns what it printed, trimmed. */
function git(cwd, args, env = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * The words from .git/info/private-words that the files of `tree` contain, as "word: file" lines. Empty lines and
 * lines that start with # are skipped, and binary files aren't searched.
 */
function privateWordsIn(cwd, tree) {
  const list = path.resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'info/private-words']));
  if (!fs.existsSync(list)) return [];
  const words = fs
    .readFileSync(list, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  return words.flatMap((word) => {
    let found;
    try {
      found = git(cwd, ['grep', '-I', '-i', '-l', '-F', '-e', word, tree]);
    } catch (error) {
      if (error.status === 1) return []; // git grep exits with 1 when nothing matches
      throw error;
    }
    return found.split('\n').map((file) => `${word}: ${file.slice(tree.length + 1)}`);
  });
}

/**
 * Publishes the files of `ref` as the next version in the repository at `url`, or only works out what that would
 * be when `dryRun` is set. Returns { version, tag, files, parent, commit }: the version in ref's package.json, its
 * tag, how many files it has, the last public version's commit (null before the first) and the new commit (null in
 * a dry run). Throws, publishing nothing, when the files contain a private word, the public repository can't be
 * reached, or the tag is already public.
 */
function publish({ ref = 'main', url = PUBLIC_URL, dryRun = false, cwd = process.cwd() } = {}) {
  const { version } = JSON.parse(git(cwd, ['show', `${ref}:package.json`]));
  const tag = `v${version}`;
  const tree = git(cwd, ['rev-parse', `${ref}^{tree}`]);
  const files = git(cwd, ['ls-tree', '-r', '--name-only', tree]).split('\n').length;
  const found = privateWordsIn(cwd, tree);
  if (found.length) {
    throw new Error(`Nothing published: the files contain private words.\n  ${found.join('\n  ')}`);
  }

  // The public repository's last version, if it has one, and whether this version's tag is taken.
  let remote;
  try {
    remote = git(cwd, ['ls-remote', url, 'refs/heads/main', `refs/tags/${tag}`]);
  } catch (error) {
    throw new Error(
      `Nothing published: can't reach ${url}, which must exist, even empty.\n${error.stderr}`,
    );
  }
  if (remote.includes(`refs/tags/${tag}`)) {
    throw new Error(`Nothing published: ${tag} is already public.`);
  }
  let parent = null;
  if (remote.includes('refs/heads/main')) {
    git(cwd, ['fetch', '--quiet', '--no-tags', url, `+refs/heads/main:${PUBLIC_MAIN}`]);
    parent = git(cwd, ['rev-parse', PUBLIC_MAIN]);
  }
  if (dryRun) return { version, tag, files, parent, commit: null };

  const identity = {
    GIT_AUTHOR_NAME: AUTHOR.name,
    GIT_AUTHOR_EMAIL: AUTHOR.email,
    GIT_COMMITTER_NAME: AUTHOR.name,
    GIT_COMMITTER_EMAIL: AUTHOR.email,
  };
  const after = parent ? ['-p', parent] : [];
  const message = ['-m', `Yes Machine ${version}`, '-m', CO_AUTHOR];
  const commit = git(cwd, ['commit-tree', tree, ...after, ...message], identity);
  // The branch and the tag arrive together, or neither does.
  const refs = [`${commit}:refs/heads/main`, `${commit}:refs/tags/${tag}`];
  git(cwd, ['push', '--quiet', '--atomic', url, ...refs]);
  git(cwd, ['update-ref', PUBLIC_MAIN, commit]);
  return { version, tag, files, parent, commit };
}

module.exports = { publish, AUTHOR, CO_AUTHOR };

// Run directly, as `npm run publish-public` does, with an optional branch or tag and --dry-run.
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const ref = args.find((arg) => !arg.startsWith('--')) || 'main';
  try {
    const { version, tag, files, parent, commit } = publish({ ref, dryRun });
    const place = parent ? `after ${parent.slice(0, 7)}` : 'as the first version';
    if (dryRun) {
      console.log(
        `Would publish Yes Machine ${version} from ${ref}: ${files} files, tag ${tag}, ${place}.`,
      );
    } else {
      console.log(
        `Published Yes Machine ${version} as ${commit.slice(0, 7)}: ${files} files, tag ${tag}, ${place}.`,
      );
      console.log(`Next, make the release on GitHub, on tag ${tag}, with the installers.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
