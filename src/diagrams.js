/**
 * Preview post-processing: syntax highlighting, Mermaid and draw.io diagrams.
 *
 * The Toast UI Viewer patches its DOM incrementally, so every function here is
 * idempotent: elements already processed carry data-state="done" and are skipped.
 * Heavy libraries (mermaid, draw.io viewer) are loaded lazily, and only from the
 * app's own bundle / public folder, never from a CDN.
 */
import hljs from 'highlight.js/lib/common';

const DIAGRAM_LANGS = new Set(['mermaid', 'drawio']);

/** Toast UI custom renderer for fenced code blocks tagged `mermaid` or `drawio`. */
export function diagramCodeBlockRenderer(defaultRenderer) {
  return function codeBlock(node, context) {
    const lang = (node.info || '').trim().split(/\s+/)[0]?.toLowerCase();
    if (!DIAGRAM_LANGS.has(lang)) {
      return defaultRenderer(node, context);
    }
    return [
      {
        type: 'openTag',
        tagName: 'div',
        classNames: ['diagram', `diagram-${lang}`],
        attributes: { 'data-diagram': lang, 'data-state': 'pending' },
      },
      { type: 'openTag', tagName: 'pre', classNames: ['diagram-source'] },
      { type: 'text', content: node.literal || '' },
      { type: 'closeTag', tagName: 'pre' },
      { type: 'closeTag', tagName: 'div' },
    ];
  };
}

/** Run all post-processing on a rendered preview container. */
export function enhancePreview(root) {
  highlightCode(root);
  renderMermaid(root);
  renderDrawio(root);
}

/* ---------------- syntax highlighting ---------------- */

function highlightCode(root) {
  root.querySelectorAll('pre > code[data-language]:not([data-state])').forEach((code) => {
    code.dataset.state = 'done';
    const lang = code.dataset.language;
    if (!lang || !hljs.getLanguage(lang)) return;
    code.classList.add(`language-${lang}`);
    hljs.highlightElement(code);
  });
}

/* ---------------- mermaid ---------------- */

let mermaidPromise = null;
let mermaidSeq = 0;
const mermaidCache = new Map(); // source -> svg

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
        fontFamily: 'inherit',
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

function renderMermaid(root) {
  const blocks = root.querySelectorAll('.diagram-mermaid[data-state="pending"]');
  if (!blocks.length) return;
  blocks.forEach((el) => {
    el.dataset.state = 'loading';
    const source = el.querySelector('.diagram-source')?.textContent ?? '';
    if (mermaidCache.has(source)) {
      showMermaid(el, mermaidCache.get(source));
      return;
    }
    loadMermaid()
      .then((mermaid) => mermaid.render(`mermaid-${++mermaidSeq}`, source))
      .then(({ svg }) => {
        mermaidCache.set(source, svg);
        showMermaid(el, svg);
      })
      .catch((err) => showDiagramError(el, err));
  });
}

function showMermaid(el, svg) {
  if (!el.isConnected) return;
  const holder = document.createElement('div');
  holder.className = 'diagram-render';
  holder.innerHTML = svg; // mermaid output, generated with securityLevel: 'strict'
  el.appendChild(holder);
  el.dataset.state = 'done';
}

/* ---------------- draw.io ---------------- */

const DRAWIO_BASE = 'vendor/drawio/';
let drawioPromise = null;

function loadDrawio() {
  if (!drawioPromise) {
    drawioPromise = new Promise((resolve, reject) => {
      if (window.GraphViewer) return resolve(window.GraphViewer);
      // Point every asset path at our own vendor folder so the viewer never
      // reaches out to diagrams.net (which is typically blocked anyway).
      window.mxBasePath = `${DRAWIO_BASE}mxgraph`;
      window.mxImageBasePath = `${DRAWIO_BASE}mxgraph/images`;
      window.STENCIL_PATH = `${DRAWIO_BASE}stencils`;
      window.SHAPES_PATH = `${DRAWIO_BASE}shapes`;
      window.STYLE_PATH = `${DRAWIO_BASE}styles`;
      window.DRAW_MATH_URL = `${DRAWIO_BASE}math4/es5`; // MathJax stays optional & local
      window.PROXY_URL = '';
      window.DRAWIO_BASE_URL = '';
      window.mxLoadResources = false;
      window.mxLoadStylesheets = false;
      window.mxForceIncludes = false;

      const script = document.createElement('script');
      script.src = `${DRAWIO_BASE}viewer-static.min.js`;
      script.async = true;
      script.onload = () =>
        window.GraphViewer
          ? resolve(window.GraphViewer)
          : reject(new Error('draw.io viewer loaded but GraphViewer is undefined'));
      script.onerror = () =>
        reject(new Error(`Could not load ${script.src}. See README: draw.io viewer is optional.`));
      document.head.appendChild(script);
    });
    drawioPromise.catch(() => {
      drawioPromise = null; // allow a retry on the next render
    });
  }
  return drawioPromise;
}

function renderDrawio(root) {
  const blocks = root.querySelectorAll('.diagram-drawio[data-state="pending"]');
  if (!blocks.length) return;
  blocks.forEach((el) => {
    el.dataset.state = 'loading';
    const xml = (el.querySelector('.diagram-source')?.textContent ?? '').trim();
    loadDrawio()
      .then((GraphViewer) => {
        if (!el.isConnected) return;
        const holder = document.createElement('div');
        holder.className = 'mxgraph';
        holder.setAttribute(
          'data-mxgraph',
          JSON.stringify({
            xml,
            highlight: '#0000ff',
            nav: true,
            resize: true,
            lightbox: false,
            toolbar: 'zoom layers',
            'auto-fit': true,
          }),
        );
        el.appendChild(holder);
        GraphViewer.createViewerForElement(holder);
        el.dataset.state = 'done';
      })
      .catch((err) => showDiagramError(el, err));
  });
}

/* ---------------- shared ---------------- */

function showDiagramError(el, err) {
  if (!el.isConnected) return;
  const msg = document.createElement('p');
  msg.className = 'diagram-error';
  msg.textContent = `Diagram could not be rendered: ${err?.message || err}`;
  el.prepend(msg);
  el.dataset.state = 'error';
}
