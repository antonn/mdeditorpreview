import '@toast-ui/editor/dist/toastui-editor.css';
import 'highlight.js/styles/github.css';
import './style.css';

import Editor from '@toast-ui/editor';
import DOMPurify from 'dompurify';
import { diagramCodeBlockRenderer, enhancePreview } from './diagrams.js';
import sampleMarkdown from './sample.md?raw';

// Toast UI ships with an old bundled sanitizer and phones home with usage
// statistics by default. Both are overridden here: DOMPurify 3 sanitises every
// piece of rendered HTML, and usageStatistics is switched off.
const sanitize = (html) =>
  DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'base', 'meta', 'link'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'formaction'],
    ADD_ATTR: ['target'],
  });

const STORAGE_KEY = 'mdeditorpreview.draft';
const PANES_KEY = 'mdeditorpreview.panes';

const $ = (sel) => document.querySelector(sel);
const rawEl = $('#raw');
const statusEl = $('#status');
const panesEl = $('#panes');
const fileInput = $('#file-input');
const dropOverlay = $('#drop-overlay');

/* ---------------- state & sync ---------------- */

const state = { md: '', fileName: 'document.md', suppressEditorEvents: false };

const viewer = Editor.factory({
  el: $('#preview'),
  viewer: true,
  usageStatistics: false,
  customHTMLSanitizer: sanitize,
  customHTMLRenderer: {
    codeBlock: diagramCodeBlockRenderer(defaultCodeBlockRenderer),
  },
});
viewer.on('afterPreviewRender', () => enhancePreview($('#preview')));

const editor = new Editor({
  el: $('#wysiwyg'),
  height: '100%',
  initialEditType: 'wysiwyg',
  hideModeSwitch: true,
  usageStatistics: false,
  autofocus: false,
  customHTMLSanitizer: sanitize,
  toolbarItems: [
    ['heading', 'bold', 'italic', 'strike'],
    ['hr', 'quote'],
    ['ul', 'ol', 'task', 'indent', 'outdent'],
    ['table', 'link', 'image'],
    ['code', 'codeblock'],
  ],
});

/**
 * Single entry point for content changes. `source` is where the change came
 * from so that pane is left untouched (keeps the user's cursor in place).
 */
function setMarkdown(md, source) {
  if (md === state.md) return;
  state.md = md;
  if (source !== 'raw') rawEl.value = md;
  viewer.setMarkdown(md);
  if (source !== 'wysiwyg') {
    state.suppressEditorEvents = true;
    try {
      editor.setMarkdown(md, false);
    } finally {
      state.suppressEditorEvents = false;
    }
  }
  scheduleSave();
  updateStatus();
}

const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

rawEl.addEventListener('input', debounce(() => setMarkdown(rawEl.value, 'raw'), 150));

// The suppress flag must be checked synchronously, at event time: change
// events fired by our own editor.setMarkdown() call must never be debounced
// into a later sync that would overwrite the raw pane with normalised text.
const syncFromEditor = debounce(() => setMarkdown(editor.getMarkdown(), 'wysiwyg'), 150);
editor.on('change', () => {
  if (!state.suppressEditorEvents) syncFromEditor();
});

// Tab inserts two spaces in the raw editor (handy for nested lists).
rawEl.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Tab') return;
  ev.preventDefault();
  const { selectionStart: s, selectionEnd: e, value } = rawEl;
  rawEl.value = `${value.slice(0, s)}  ${value.slice(e)}`;
  rawEl.selectionStart = rawEl.selectionEnd = s + 2;
  rawEl.dispatchEvent(new Event('input'));
});

/* ---------------- persistence ---------------- */

const scheduleSave = debounce(() => {
  try {
    localStorage.setItem(STORAGE_KEY, state.md);
  } catch {
    /* storage unavailable (private mode / policy): draft simply isn't kept */
  }
}, 400);

function loadDraft() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return saved;
  } catch {
    /* ignore */
  }
  return sampleMarkdown;
}

function updateStatus() {
  const chars = state.md.length;
  const lines = state.md ? state.md.split('\n').length : 0;
  statusEl.textContent = `${state.fileName} · ${lines} lines · ${chars} chars · draft saved in this browser`;
}

/* ---------------- file actions ---------------- */

function openFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.fileName = file.name || 'document.md';
    setMarkdown(String(reader.result ?? ''), 'file');
  };
  reader.readAsText(file);
}

$('#btn-open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  openFile(fileInput.files?.[0]);
  fileInput.value = '';
});

function downloadMarkdown() {
  const blob = new Blob([state.md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = state.fileName.match(/\.(md|markdown)$/i) ? state.fileName : `${state.fileName}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('#btn-download').addEventListener('click', downloadMarkdown);

async function copyMarkdown() {
  const btn = $('#btn-copy');
  const original = btn.textContent;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(state.md);
    } else {
      rawEl.select();
      document.execCommand('copy');
      rawEl.setSelectionRange(0, 0);
    }
    btn.textContent = 'Copied!';
  } catch {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => (btn.textContent = original), 1500);
}
$('#btn-copy').addEventListener('click', copyMarkdown);

$('#btn-clear').addEventListener('click', () => {
  if (state.md && !window.confirm('Clear the whole document? This cannot be undone.')) return;
  state.fileName = 'document.md';
  setMarkdown('', 'clear');
  rawEl.focus();
});

document.addEventListener('keydown', (ev) => {
  if (!(ev.ctrlKey || ev.metaKey)) return;
  if (ev.key === 's' || ev.key === 'S') {
    ev.preventDefault();
    downloadMarkdown();
  } else if (ev.key === 'o' || ev.key === 'O') {
    ev.preventDefault();
    fileInput.click();
  }
});

// Drag & drop a file anywhere on the page.
let dragDepth = 0;
document.addEventListener('dragenter', (ev) => {
  if (!ev.dataTransfer?.types?.includes('Files')) return;
  dragDepth += 1;
  dropOverlay.hidden = false;
});
document.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.hidden = true;
});
document.addEventListener('dragover', (ev) => {
  if (ev.dataTransfer?.types?.includes('Files')) ev.preventDefault();
});
document.addEventListener('drop', (ev) => {
  dragDepth = 0;
  dropOverlay.hidden = true;
  const file = ev.dataTransfer?.files?.[0];
  if (!file) return;
  ev.preventDefault();
  openFile(file);
});

/* ---------------- pane toggles ---------------- */

const toggles = {
  raw: $('#toggle-raw'),
  preview: $('#toggle-preview'),
  wysiwyg: $('#toggle-wysiwyg'),
};

function applyPanes() {
  let visible = 0;
  for (const [name, box] of Object.entries(toggles)) {
    panesEl.classList.toggle(`hide-${name}`, !box.checked);
    if (box.checked) visible += 1;
  }
  panesEl.classList.toggle('cols-2', visible === 2);
  panesEl.classList.toggle('cols-1', visible === 1);
  try {
    localStorage.setItem(
      PANES_KEY,
      JSON.stringify(Object.fromEntries(Object.entries(toggles).map(([k, b]) => [k, b.checked]))),
    );
  } catch {
    /* ignore */
  }
}

for (const box of Object.values(toggles)) {
  box.addEventListener('change', () => {
    // Never allow zero panes.
    if (!Object.values(toggles).some((b) => b.checked)) box.checked = true;
    applyPanes();
  });
}

(function restorePanes() {
  try {
    const saved = JSON.parse(localStorage.getItem(PANES_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const [k, box] of Object.entries(toggles)) if (k in saved) box.checked = !!saved[k];
      if (!Object.values(toggles).some((b) => b.checked)) toggles.raw.checked = true;
    }
  } catch {
    /* ignore */
  }
  applyPanes();
})();

/* ---------------- boot ---------------- */

setMarkdown(loadDraft(), 'init');

/**
 * Toast UI's default code block renderer, reproduced so diagram blocks can fall
 * back to it. (The library does not export its built-in renderers.)
 */
function defaultCodeBlockRenderer(node) {
  const infoWords = node.info ? node.info.split(/\s+/) : [];
  const preClasses = [];
  const codeAttrs = {};
  if (node.fenceLength > 3) codeAttrs['data-backticks'] = node.fenceLength;
  if (infoWords.length > 0 && infoWords[0].length > 0) {
    preClasses.push(`lang-${infoWords[0]}`);
    codeAttrs['data-language'] = infoWords[0];
  }
  return [
    { type: 'openTag', tagName: 'pre', classNames: preClasses },
    { type: 'openTag', tagName: 'code', attributes: codeAttrs },
    { type: 'text', content: node.literal || '' },
    { type: 'closeTag', tagName: 'code' },
    { type: 'closeTag', tagName: 'pre' },
  ];
}
