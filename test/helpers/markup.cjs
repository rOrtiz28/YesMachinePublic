'use strict';

// Small readers for the tests in test/pages/ that check the source of the pages (HTML) and their style sheets (CSS)
// without a browser. They find elements and CSS blocks by their structure rather than by exact text, so the way the
// source is laid out (one attribute per line, or all on one line) doesn't matter. They are deliberately simple: they
// match tags and blocks with regular expressions and are not full HTML or CSS parsers.

const fs = require('node:fs');
const path = require('node:path');

/** Reads a file of the project as text; `file` is a path relative to the repository root. */
function read(file) {
  return fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
}

/**
 * The HTML of the first element whose start tag matches `start` (a regular expression for the start tag), from its
 * start tag to its matching end tag, counting elements of the same name nested inside.
 */
function element(html, start) {
  const match = start.exec(html);
  if (!match) throw new Error(`No element matches ${start}`);
  const name = match[0].match(/^<([a-z0-9-]+)/i)[1];
  // Walk every start and end tag with the same element name from the match onwards. Start tags go one level
  // deeper and end tags one level up, so the end tag that brings the depth back to 0 closes the matched element.
  const tags = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi');
  tags.lastIndex = match.index;
  let depth = 0;
  for (let tag; (tag = tags.exec(html));) {
    depth += tag[1] ? -1 : 1;
    if (depth === 0) return html.slice(match.index, tag.index + tag[0].length);
  }
  throw new Error(`The element ${start} never ends`);
}

/** Every button inside this HTML, in order: its id (if any), its start tag and its whole HTML. */
function buttons(html) {
  return [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(([whole]) => ({
    id: (whole.match(/^<button\b[^>]*\bid="([^"]+)"/) || [])[1],
    tag: whole.match(/^<button\b[^>]*>/)[0],
    html: whole,
  }));
}

/** The text of some HTML, without its tags, with its spaces collapsed. */
function text(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The custom properties (--name: value) set in the first CSS block whose selector matches `selector` (a regular
 * expression that ends just before the block's opening brace).
 */
function customProperties(css, selector) {
  const match = new RegExp(`${selector.source}\\s*\\{`).exec(css);
  if (!match) throw new Error(`No block matches ${selector}`);
  const start = match.index + match[0].length;
  // The block ends at the first closing brace, which is enough for blocks that only set custom properties.
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)].map(([, name, value]) => [name, value.trim()]),
  );
}

module.exports = { read, element, buttons, text, customProperties };
