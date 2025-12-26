import { marked } from "marked"
import Fuse from "fuse.js"

marked.setOptions({
  breaks: true,
  gfm: true
});

const CATEGORY_COLORS = {
  Event: '#FF6B6B',
  Effect: '#FFA94D',
  Section: '#FFD93D',
  Expression: '#6BCB77',
  Type: '#4D96FF',
  Function: '#A66CFF',
  Condition: '#F06595',
  Structure: '#20C997'
};

const DEBOUNCE_DELAY = 300;
const MAX_HISTORY = 10;
const STORAGE_KEY = 'skript-search-history';

const FUSE_CONFIG = {
  keys: ['title', 'syntax', 'addon', 'category'],
  threshold: 0.5,
  includeScore: true
};

const STYLE = {
  foreground: 'var(--foreground)',
  gray: 'var(--gray)',
  darkCode: 'var(--dark-code)',
  off: '#12151a6e',
  on: '#a3be8c43',
};

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;'
};

const REGEX = {
  types: /%([^%]+)%/g,
  optional: /\[([^\]]+)\]/g,
  pluralEnding: /s$/,
  optionalLiterals: /\[([^\]%]+)\]/g,
  alternatives: /\(([^)]+)\)/g
};

const STYLES = {
  header: `margin-bottom: 0lh; padding: 0.25ch 0.5ch; display: flex; flex-wrap: wrap; gap: 1ch; align-items: baseline;`,
  title: (color) => `margin: 0; font-size: 1.5em; color: ${color}`,
  metadata: 'font-size: 0.9em;',
  syntax: `margin-left: 1ch; margin-bottom: 0.25lh; display: flex; align-items: flex-start; gap: 0.5ch;`,
  code: `background-color: ${STYLE.darkCode}; padding: 0.25ch 0.5ch; width: auto; display: inline-block; font-size: 0.9em;`,
  description: 'margin-left: 1ch; margin-top: 0; margin-bottom: 0.5lh',
  copyButton: `margin-left: 0.5ch; padding: 0.3ch; background-color: ${STYLE.off}; border: none; cursor: pointer; font-size: 0.9em; overflow: visible; color: ${STYLE.gray}; font-family: IosevkaSS14;`,
  pageButton: `padding: 0.5ch; background-color: ${STYLE.off}; border: none; cursor: pointer; overflow: visible; color: ${STYLE.gray}; font-family: inherit;`,
  pageButtonDisabled: `padding: 0.5ch; background-color: ${STYLE.off}; opacity: 0.5; border: none; cursor: not-allowed; overflow: visible; color: ${STYLE.gray}; font-family: inherit;`,
  historyDropdown: `position: absolute; background: ${STYLE.off}; width: 60ch; font-size: 0.9em;`,
  historyItem: `cursor: pointer; background-color: ${STYLE.off};`,
  resultBlock: (color) => `margin-bottom: 0.5lh; padding: 1ch; background-color: ${STYLE.off}; border-left: 0.5ch solid ${color}; max-width: 100ch;`,
  clearButton: `position: absolute; right: 0.5ch; top: 50%; transform: translateY(-50%); padding: 0.2ch 0.7ch; background-color: #00000000; border: none; cursor: pointer; color: ${STYLE.gray}; font-family: IosevkaSS14; font-size: 0.9em;`,
  searchWrapper: `position: relative; display: inline-block;`
};

const MESSAGES = {
  searching: '<p class="extra-info">Searching...</p>',
  loading: '<p class="extra-info">Loading syntax database...</p>',
  noResults: '<p class="extra-info">No results found.</p>',
  error: '<p class="extra-info">Search failed. Please try again.</p>',
  results: (duration, count) => `<p class="extra-info">Took ${duration}ms for ${count} results</p><br>`,
  copied: 'copied',
  copy: 'copy',
  short: 'short',
  full: 'full',
  linkCopied: 'link copied',
  copyLink: 'link',
  emptyState: '<p class="extra-info">Search for Skript syntax, types, expressions, and more...</p><p class="extra-info">Try searching for "player", "damage", or "location"</p>'
};

const SELECTORS = {
  searchbar: 'searchbar',
  container: 'syntax-container',
  typeLink: '.type-link',
  copyButton: '.copy-button',
  historyDropdown: 'history-dropdown'
};

const EVENTS = {
  enter: 'Enter'
};

let debounceTimer = null;
let cachedData = null;
let fuseInstance = null;

const escapeHtml = (text) => {
  if (!text) return '';
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
};

const formatMarkdown = (text) => text ? marked.parseInline(text) : '';

const formatSyntaxLine = (line) => {

  const wrapOptional = (text) => 
    `<span style="color:${STYLE.gray};">[${text}]</span>`;

  const createTypeLink = (type) =>
    `<a href="#" class="type-link" data-type="${escapeHtml(type)}">${escapeHtml(type)}</a>`;

  const formatTypes = (types) =>
    types
      .split('/')
      .map(t => t.trim())
      .map(createTypeLink)
      .join(`<span style="color:${STYLE.foreground};">/</span>`);

  const process = (text) => {
    let result = '';
    let i = 0;

    while (i < text.length) {
      if (text[i] === '[') {
        let depth = 1;
        let j = i + 1;
        while (j < text.length && depth > 0) {
          if (text[j] === '[') depth++;
          else if (text[j] === ']') depth--;
          j++;
        }
        if (depth !== 0) {
          result += '[';
          i++;
          continue;
        }
        const inner = text.slice(i + 1, j - 1);
        const formattedInner = process(inner);
        result += wrapOptional(formattedInner);
        i = j;

      } else {
        result += text[i];
        i++;
      }
    }
    return result.replace(REGEX.types, (_, types) => formatTypes(types));
  };

  return process(line);
};


const getColor = (category) => 
  CATEGORY_COLORS[category] || STYLE.foreground;

const createMetadata = (addon, since) => 
  addon || since 
    ? `<span class="extra-info" style="${STYLES.metadata}">${escapeHtml(addon || '')}${addon && since ? ' ' : ''}${escapeHtml(since || '')}</span>`
    : '';

const createSection = (content, styles = '') => 
  content ? `<div style="${styles}">${content}</div>` : '';

const createParagraph = (content, styles = '') => 
  content ? `<p style="${styles}">${content}</p>` : '';

const createCopyButton = (syntax, index) => 
  `<button class="copy-button" data-syntax="${escapeHtml(syntax)}" data-index="${index}" style="${STYLES.copyButton}">${MESSAGES.copy}</button>`;

const createLinkButton = (resultId) => 
  `<button class="link-button" data-result-id="${escapeHtml(resultId)}" style="${STYLES.copyButton}">${MESSAGES.copyLink}</button>`;

const createToggleButton = (syntax, index) =>
  `<button class="toggle-button" data-syntax="${escapeHtml(syntax)}" data-index="${index}" data-mode="full" style="${STYLES.copyButton}">${MESSAGES.short}</button>`;

function shortenSyntax(text) {
  function processSegment(str) {
    let result = '';
    let i = 0;
    while (i < str.length) {
      const char = str[i];
      if (char === '[') {
        let depth = 1;
        let j = i + 1;
        while (j < str.length && depth > 0) {
          if (str[j] === '[') depth++;
          else if (str[j] === ']') depth--;
          j++;
        }
        const inner = str.slice(i + 1, j - 1);
        const processedInner = processSegment(inner);
        if (processedInner.includes('%')) {
          result += `[${processedInner}]`;
        }
        i = j;
      } else if (char === '(') {
        let depth = 1;
        let j = i + 1;
        while (j < str.length && depth > 0) {
          if (str[j] === '(') depth++;
          else if (str[j] === ')') depth--;
          j++;
        }
        const inner = str.slice(i + 1, j - 1);
        let shortened;
        if (inner.includes('¦')) {
          shortened = `(${inner})`;
        } else {
          const alternatives = splitTopLevel(inner, '|');
          shortened = alternatives
            .map(a => processSegment(a.trim()))
            .reduce((s, curr) => curr.length < s.length ? curr : s, alternatives[0]);
        }
        result += shortened;
        i = j;
      } else {
        result += char;
        i++;
      }
    }

    return result;
  }

  function splitTopLevel(str, sep) {
    const parts = [];
    let depth = 0, last = 0;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '(') depth++;
      else if (str[i] === ')') depth--;
      else if (str[i] === sep && depth === 0) {
        parts.push(str.slice(last, i));
        last = i + 1;
      }
    }
    parts.push(str.slice(last));
    return parts;
  }
  
  const normalized = text
    .replace(/\s+/g, ' ')
    .replace(/\s*\[\s*/g, ' [')
    .replace(/\s*\]\s*/g, '] ')
    .trim();
  
  const shortened = processSegment(normalized);

  return shortened
    .replace(/\s+/g, ' ')
    .replace(/\s*\[\s*/g, ' [')
    .replace(/\s*\]\s*/g, ']')
    .trim();
}

const createSyntaxLines = (syntax, category) => {
  if (!syntax) return '';

  const lines = syntax.split('\n');
  return lines.map((line, index) => `
    <div style="margin-left: 1ch; margin-bottom: 0.25lh; display: flex; align-items: flex-start; gap: 0.5ch;">
      ${category !== 'Function' ? createToggleButton(line, index) : ''}
      <code style="${STYLES.code}" data-full="${escapeHtml(line)}" data-short="${escapeHtml(shortenSyntax(line))}">
        ${formatSyntaxLine(line)}
      </code>
      ${createCopyButton(line, index)}
    </div>
  `).join('');
};

const generateResultId = (result) => {
  const str = `${result.title}-${result.category}-${result.addon || ''}`;
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
};

const renderResult = (result) => {
  const color = getColor(result.category);
  const resultId = generateResultId(result);
  
  return `
    <div id="result-${resultId}" style="${STYLES.resultBlock(color)}">
      ${createSection(`
        <h2 style="${STYLES.title(color)}">${escapeHtml(result.title)}</h2>
        <span style="color: ${color}">${escapeHtml(result.category)}</span>
        ${createMetadata(result.addon, result.since)}
        ${createLinkButton(resultId)}
      `, STYLES.header)}
      ${createSyntaxLines(result.syntax, result.category)}
      ${createParagraph(formatMarkdown(result.description), STYLES.description)}
    </div>
  `;
};

const normalizeType = (type) => type.replace(REGEX.pluralEnding, '');

const handleTypeClick = (performSearch) => (e) => {
  e.preventDefault();
  const type = normalizeType(e.currentTarget.dataset.type);
  const searchbar = document.getElementById(SELECTORS.searchbar);
  searchbar.value = type;
  performSearch(type);
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

const attachTypeLinks = (performSearch) => {
  document.querySelectorAll(SELECTORS.typeLink).forEach(link => {
    link.addEventListener('click', handleTypeClick(performSearch));
  });
};

const handleCopyClick = (e) => {
  const button = e.currentTarget;
  const syntax = button.dataset.syntax;
  
  navigator.clipboard.writeText(syntax).then(() => {
    const originalText = button.textContent;
    button.textContent = MESSAGES.copied;
    setTimeout(() => {
      button.textContent = originalText;
    }, 500);
  });
};

const attachCopyButtons = () => {
  document.querySelectorAll(SELECTORS.copyButton).forEach(button => {
    button.addEventListener('click', handleCopyClick);
    button.addEventListener('mouseenter', (e) => {
      e.currentTarget.style.backgroundColor = STYLE.on;
    });
    button.addEventListener('mouseleave', (e) => {
      e.currentTarget.style.backgroundColor =  STYLE.off;
    });
  });
  
  document.querySelectorAll('.link-button').forEach(button => {
    button.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const resultId = btn.dataset.resultId;
      const url = new URL(window.location);
      url.searchParams.set('id', resultId);
      
      navigator.clipboard.writeText(url.toString()).then(() => {
        const originalText = btn.textContent;
        btn.textContent = MESSAGES.linkCopied;
        setTimeout(() => {
          btn.textContent = originalText;
        }, 500);
      });
    });
    
    button.addEventListener('mouseenter', (e) => {
      e.currentTarget.style.backgroundColor = STYLE.on;
    });
    button.addEventListener('mouseleave', (e) => {
      e.currentTarget.style.backgroundColor = STYLE.off;
    });
  });
  
  document.querySelectorAll('.toggle-button').forEach(button => {
    button.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const codeElement = btn.parentElement.querySelector('code');
      const currentMode = btn.dataset.mode;
      
      if (currentMode === 'full') {
        const shortSyntax = codeElement.dataset.short;
        codeElement.innerHTML = formatSyntaxLine(shortSyntax);
        btn.dataset.mode = 'short';
        btn.textContent = MESSAGES.full;
        btn.nextElementSibling.dataset.syntax = shortSyntax;
      } else {
        const fullSyntax = codeElement.dataset.full;
        codeElement.innerHTML = formatSyntaxLine(fullSyntax);
        btn.dataset.mode = 'full';
        btn.textContent = MESSAGES.short;
        btn.nextElementSibling.dataset.syntax = fullSyntax;
      }
    });
    
    button.addEventListener('mouseenter', (e) => {
      e.currentTarget.style.backgroundColor = STYLE.on;
    });
    button.addEventListener('mouseleave', (e) => {
      e.currentTarget.style.backgroundColor = STYLE.off;
    });
  });
};

const createResultsHTML = (results, duration) => `
  ${MESSAGES.results(duration, results.length)}
  ${results.map(renderResult).join('')}
`;

const scrollToResultIfNeeded = () => {
  const resultId = loadResultIdFromURL();
  if (resultId) {
    setTimeout(() => {
      const element = document.getElementById(`result-${resultId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        element.style.backgroundColor = STYLE.on;
        setTimeout(() => {
          element.style.backgroundColor = '';
        }, 2000);
      }
    }, 100);
  }
};

const displayResults = (results, duration, container, performSearch) => {
  window.scrollTo({ top: 0 });
  
  if (!results.length) {
    container.innerHTML = MESSAGES.noResults;
    return;
  }
  
  container.innerHTML = createResultsHTML(results, duration);
  
  attachTypeLinks(performSearch);
  attachCopyButtons();
  
  scrollToResultIfNeeded();
};

const isExactTypeMatch = (result, normalizedQuery) =>
  result.category === 'Type' && (
    normalizeType(result.title.toLowerCase()) === normalizedQuery ||
    (result.syntax && result.syntax.toLowerCase().includes(normalizedQuery))
  );

const extractResults = (fuseResults, query) => {
  const results = fuseResults.map(r => r.item);
  const normalizedQuery = normalizeType(query.toLowerCase().trim());
  
  return results.sort((a, b) => {
    const aMatch = isExactTypeMatch(a, normalizedQuery);
    const bMatch = isExactTypeMatch(b, normalizedQuery);
    
    return aMatch === bMatch ? 0 : aMatch ? -1 : 1;
  });
};

const getSearchHistory = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
};

const saveSearchHistory = (query) => {
  const history = getSearchHistory();
  const filtered = history.filter(q => q !== query);
  const updated = [query, ...filtered].slice(0, MAX_HISTORY);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
};

const updateURL = (query) => {
  const url = new URL(window.location);
  if (query) {
    url.searchParams.set('q', query);
  } else {
    url.searchParams.delete('q');
  }
  url.searchParams.delete('id');
  window.history.pushState({}, '', url);
};

const loadData = async () => {
  try {
    const response = await fetch("https://skript-api-backend.onrender.com/all");
    const data = await response.json();

    cachedData = data.results || data;
    fuseInstance = new Fuse(cachedData, FUSE_CONFIG);
    
    return true;
  } catch (error) {
    return false;
  }
};

const performSearch = async (query, updateHistory = true) => {
  const container = document.getElementById(SELECTORS.container);

  if (!cachedData || !fuseInstance) {
    container.innerHTML = MESSAGES.loading;
    const loaded = await loadData();
    if (!loaded) {
      container.innerHTML = MESSAGES.error;
      return;
    }
  }
  
  container.innerHTML = MESSAGES.searching;

  try {
    const start = performance.now();

    const fuseResults = fuseInstance.search(query);
    const results = extractResults(fuseResults, query);
    const duration = Math.round(performance.now() - start);
    
    displayResults(results, duration, container, performSearch);
    
    if (updateHistory) {
      saveSearchHistory(query);
      updateURL(query);
    }
  } catch (error) {
    container.innerHTML = MESSAGES.error;
  }
};

const isEnterKey = (e) => e.key === EVENTS.enter;

const handleSearch = (performSearch) => (e) => {
  if (!isEnterKey(e)) return;
  
  const query = e.target.value.trim();
  if (query) performSearch(query);
};

const debounce = (func, delay) => {
  return (...args) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => func(...args), delay);
  };
};

const handleInput = debounce((e, performSearch) => {
  const query = e.target.value.trim();
  if (query.length >= 2) {
    performSearch(query);
  }
}, DEBOUNCE_DELAY);

const createHistoryDropdown = (history) => {
  if (!history.length) return '';
  
  return `
    <div id="${SELECTORS.historyDropdown}" style="${STYLES.historyDropdown}">
      ${history.map(query => `
        <div class="history-item" data-query="${escapeHtml(query)}" style="${STYLES.historyItem}">
          ${escapeHtml(query)}
        </div>
      `).join('')}
    </div>
  `;
};

const showHistoryDropdown = (searchbar, performSearch) => {
  const history = getSearchHistory();
  if (!history.length) return;
  
  const existing = document.getElementById(SELECTORS.historyDropdown);
  if (existing) existing.remove();
  
  const dropdown = document.createElement('div');
  dropdown.innerHTML = createHistoryDropdown(history);
  searchbar.parentElement.style.position = 'relative';
  searchbar.parentElement.appendChild(dropdown.firstElementChild);
  
  document.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', () => {
      const query = item.dataset.query;
      searchbar.value = query;
      performSearch(query);
      hideHistoryDropdown();
    });
    
    item.addEventListener('mouseenter', (e) => {
      e.currentTarget.style.backgroundColor = STYLE.on;
    });
    item.addEventListener('mouseleave', (e) => {
      e.currentTarget.style.backgroundColor = STYLE.off;
    });
  });
};

const hideHistoryDropdown = () => {
  const dropdown = document.getElementById(SELECTORS.historyDropdown);
  if (dropdown) dropdown.remove();
};

const setupClearButton = (searchbar) => {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = STYLES.searchWrapper;
  
  searchbar.parentNode.insertBefore(wrapper, searchbar);
  wrapper.appendChild(searchbar);
  
  const clearButton = document.createElement('button');
  clearButton.textContent = '×';
  clearButton.style.cssText = STYLES.clearButton;
  clearButton.style.display = 'none';
  clearButton.className = 'clear-search-button';
  
  clearButton.addEventListener('click', () => {
    searchbar.value = '';
    clearButton.style.display = 'none';
    const container = document.getElementById(SELECTORS.container);
    container.innerHTML = MESSAGES.emptyState;
    updateURL('');
    searchbar.focus();
  });
  
  clearButton.addEventListener('mouseenter', () => {
    clearButton.style.backgroundColor = STYLE.on;
  });
  
  clearButton.addEventListener('mouseleave', () => {
    clearButton.style.backgroundColor = "#00000000";
  });
  
  wrapper.appendChild(clearButton);
  
  searchbar.addEventListener('input', () => {
    clearButton.style.display = searchbar.value ? 'block' : 'none';
  });
  
  return clearButton;
};

const loadQueryFromURL = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get('q');
};

const loadResultIdFromURL = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
};

document.addEventListener('DOMContentLoaded', async () => {
  const searchbar = document.getElementById(SELECTORS.searchbar);
  const container = document.getElementById(SELECTORS.container);

  container.innerHTML = MESSAGES.loading;
  const clearButton = setupClearButton(searchbar);

  const loaded = await loadData();
  if (!loaded) {
    container.innerHTML = MESSAGES.error;
    return;
  }
  
  container.innerHTML = MESSAGES.emptyState;
  
  searchbar.addEventListener('keypress', handleSearch(performSearch));
  searchbar.addEventListener('input', (e) => handleInput(e, performSearch));
  searchbar.addEventListener('focus', () => showHistoryDropdown(searchbar, performSearch));
  
  document.addEventListener('click', (e) => {
    if (!searchbar.contains(e.target) && !document.getElementById(SELECTORS.historyDropdown)?.contains(e.target)) {
      hideHistoryDropdown();
    }
  });
  
  const initialQuery = loadQueryFromURL();
  if (initialQuery) {
    searchbar.value = initialQuery;
    clearButton.style.display = 'block';
    performSearch(initialQuery, false);
  }
});