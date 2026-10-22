const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const libraryUrlPattern = /^https:\/\/gemini\.google\.com\/library\/?/;

function textOf(element) {
  return ((element?.innerText || element?.textContent || '') + ' ' +
    (element?.getAttribute?.('aria-label') || '') + ' ' +
    (element?.getAttribute?.('title') || '')).replace(/\s+/g, ' ').trim();
}

function nameOf(element) {
  return textOf(element).toLowerCase();
}

function stableFingerprint(parts) {
  const raw = parts.map(value => String(value || '').slice(0, 500)).join('|');
  return btoa(unescape(encodeURIComponent(raw))).replace(/=+$/g, '').slice(0, 240);
}

function visibleRect(rect) {
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
    rect.top < innerHeight && rect.left < innerWidth;
}

function nearestClickable(element) {
  return element?.closest?.('a[href],button,[role="button"],[tabindex],div[jsaction],div[data-test-id],div[aria-label]') ||
    element?.parentElement || element;
}

function hrefOf(element) {
  const anchor = element?.closest?.('a[href]');
  const href = anchor?.href || element?.getAttribute?.('href') || '';
  if (!href) return '';
  try {
    return new URL(href, location.href).href;
  } catch {
    return '';
  }
}

function findHeadingBounds() {
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,[role="heading"],div,span')]
    .map(element => ({ element, text: textOf(element).toLowerCase(), rect: element.getBoundingClientRect() }))
    .filter(item => item.text && visibleRect(item.rect))
    .sort((a, b) => a.rect.top - b.rect.top);
  const media = headings.find(item => /^media\b/.test(item.text));
  if (!media) return { mediaTop: null, mediaBottom: null };
  const next = headings.find(item => item.rect.top > media.rect.top + 8 &&
    /^(documents|chats|recent|files|notebooks|apps)\b/.test(item.text));
  return { mediaTop: media.rect.top, mediaBottom: next?.rect.top || null };
}

function scanGeneratedImages() {
  return [...document.images].map((img, index) => {
    const rect = img.getBoundingClientRect();
    const parent = img.closest('[data-message-author-role],[data-turn-role],article,section,div');
    const text = (textOf(parent) + ' ' + img.alt).toLowerCase();
    const src = img.currentSrc || img.src || '';
    return {
      fingerprint: stableFingerprint([src, Math.round(rect.width), Math.round(rect.height), index, text.slice(0, 160)]),
      src,
      alt: img.alt || '',
      index,
      assistant: /assistant|gemini|generated|response|image/.test(text),
      large: rect.width >= 160 && rect.height >= 120,
      excluded: /avatar|logo|profile|icon|thumbnail/.test(text),
      visible: visibleRect(rect)
    };
  }).filter(candidate => candidate.src && candidate.assistant && candidate.large && !candidate.excluded && candidate.visible);
}

function scanLibraryCards() {
  const images = [...document.images];
  const bounds = findHeadingBounds();
  const rows = images.map((img, domIndex) => {
    const rect = img.getBoundingClientRect();
    const clickTarget = nearestClickable(img);
    const container = clickTarget?.closest?.('article,li,a,button,[role="button"],[tabindex],div') || clickTarget;
    const text = (textOf(container) + ' ' + textOf(img) + ' ' + (img.alt || '')).toLowerCase();
    const src = img.currentSrc || img.src || '';
    const href = hrefOf(clickTarget) || hrefOf(container);
    const role = clickTarget?.getAttribute?.('role') || '';
    const cursor = getComputedStyle(clickTarget || img).cursor || '';
    const visible = visibleRect(rect);
    const largeEnough = rect.width >= 120 && rect.height >= 120;
    const inMediaBand = bounds.mediaTop === null ||
      (rect.top >= bounds.mediaTop - 30 && (bounds.mediaBottom === null || rect.top < bounds.mediaBottom - 8));
    const excluded = /logo|avatar|profile|icon|thumbnail|document|documents|notebook|pdf|docx|slides|sheet/.test(text);
    return {
      domIndex,
      src,
      href,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      naturalWidth: img.naturalWidth || 0,
      naturalHeight: img.naturalHeight || 0,
      top: Math.round(rect.top + scrollY),
      left: Math.round(rect.left + scrollX),
      alt: img.alt || '',
      ariaLabel: clickTarget?.getAttribute?.('aria-label') || img.getAttribute('aria-label') || '',
      title: clickTarget?.getAttribute?.('title') || img.getAttribute('title') || '',
      role,
      tabIndex: clickTarget?.getAttribute?.('tabindex') || '',
      cursor,
      visible,
      largeEnough,
      inMediaBand,
      excluded,
      clickable: Boolean(clickTarget),
      text: text.slice(0, 180)
    };
  });
  const candidates = rows
    .filter(row => row.src && row.visible && row.largeEnough && row.inMediaBand && !row.excluded)
    .sort((a, b) => (a.top - b.top) || (a.left - b.left))
    .map((row, visualIndex) => ({
      ...row,
      visualIndex,
      index: row.domIndex,
      fingerprint: stableFingerprint([
        row.src,
        row.href,
        row.alt,
        row.ariaLabel,
        row.title,
        row.naturalWidth || row.width,
        row.naturalHeight || row.height,
        visualIndex,
        row.text
      ])
    }));
  return {
    success: true,
    scannerExecuted: true,
    totalImagesOnPage: images.length,
    candidateElementsChecked: rows.filter(row => row.visible && row.largeEnough).length,
    mediaCardsFound: candidates.length,
    candidates,
    error: null
  };
}

function locateLibraryCandidate(candidate) {
  const scan = scanLibraryCards();
  let found = scan.candidates.find(item => item.fingerprint === candidate?.fingerprint);
  if (!found && candidate?.src) found = scan.candidates.find(item => item.src === candidate.src);
  if (!found && Number.isInteger(candidate?.visualIndex)) found = scan.candidates.find(item => item.visualIndex === candidate.visualIndex);
  if (!found && Number.isInteger(candidate?.index)) found = scan.candidates.find(item => item.domIndex === candidate.index);
  if (!found) return { found: null, image: null, clickTarget: null, scan };
  const image = document.images[found.domIndex] || null;
  return { found, image, clickTarget: nearestClickable(image), scan };
}

function viewerCloseButton() {
  const controls = [...document.querySelectorAll('button,[role="button"],a[role="button"]')];
  return controls.find(element => /^(close|dismiss)$/i.test((element.getAttribute('aria-label') || '').trim())) ||
    controls.find(element => /close|dismiss|back/i.test(nameOf(element) + ' ' + (element.getAttribute('data-tooltip') || '')));
}

function viewerOpen() {
  return Boolean(viewerCloseButton() ||
    document.querySelector('[role="dialog"][aria-modal="true"],[role="dialog"],[aria-modal="true"]'));
}

async function closeViewer() {
  const close = viewerCloseButton();
  if (close) close.click();
  else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  for (let i = 0; i < 16; i += 1) {
    await wait(150);
    if (!viewerOpen()) return { success: true, verified: true, error: null };
  }
  return { success: false, verified: false, error: 'Gemini image viewer did not close' };
}

function openCandidate(candidate) {
  const image = [...document.images].find((img, index) => index === candidate.index || (img.currentSrc || img.src) === candidate.src);
  if (!image) throw new Error('Candidate is no longer present');
  image.scrollIntoView({ block: 'center', inline: 'center' });
  image.click();
  return true;
}

async function openLibraryCard(candidate) {
  const beforeUrl = location.href;
  const located = locateLibraryCandidate(candidate);
  if (!located.image || !located.clickTarget) {
    return {
      success: false,
      opened: false,
      viewerDetected: false,
      beforeUrl,
      afterUrl: location.href,
      workerTabId: null,
      error: 'Library card is no longer present'
    };
  }
  located.image.scrollIntoView({ block: 'center', inline: 'center' });
  await wait(180);
  const target = located.clickTarget;
  target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
  target.click();
  for (let i = 0; i < 28; i += 1) {
    await wait(150);
    if (viewerOpen() || location.href !== beforeUrl) break;
  }
  const afterUrl = location.href;
  const viewerDetected = viewerOpen();
  const opened = viewerDetected || afterUrl !== beforeUrl;
  return {
    success: opened,
    opened,
    viewerDetected,
    beforeUrl,
    afterUrl,
    workerTabId: null,
    error: opened ? null : 'Library card click did not open a viewer or detail page'
  };
}

function findDownloadButton() {
  const controls = [...document.querySelectorAll('button,[role="button"],a[download],a[aria-label],div[role="button"]')];
  return controls.find(element => !element.disabled && /download/i.test(
    nameOf(element) + ' ' + (element.getAttribute('data-tooltip') || '') + ' ' + (element.getAttribute('aria-description') || '')
  ));
}

async function clickDownload() {
  for (let i = 0; i < 40; i += 1) {
    const button = findDownloadButton();
    if (button) {
      button.click();
      return { success: true, clicked: true, error: null };
    }
    await wait(150);
  }
  return { success: false, clicked: false, error: 'Gemini viewer Download button was not available' };
}

function scrollStep() {
  const before = scrollY;
  scrollBy({ top: -Math.max(450, innerHeight * 0.72), behavior: 'auto' });
  return { success: true, moved: scrollY !== before, before, after: scrollY };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'content-ping') {
        sendResponse({
          success: true,
          page: libraryUrlPattern.test(location.href) ? 'gemini-library' : 'gemini',
          url: location.href,
          documentReadyState: document.readyState,
          imageCount: document.images.length,
          error: null
        });
      } else if (message.type === 'gemini-scan') {
        sendResponse({ success: true, title: document.title, url: location.href, candidates: scanGeneratedImages(), scrollY });
      } else if (message.type === 'library-scan') {
        sendResponse(scanLibraryCards());
      } else if (message.type === 'library-open') {
        sendResponse(await openLibraryCard(message.candidate));
      } else if (message.type === 'gemini-open') {
        sendResponse({ success: openCandidate(message.candidate) });
      } else if (message.type === 'gemini-download') {
        sendResponse(await clickDownload());
      } else if (message.type === 'gemini-close-viewer') {
        sendResponse(await closeViewer());
      } else if (message.type === 'gemini-scroll-step') {
        sendResponse(scrollStep());
      } else if (message.type === 'gemini-scroll-top') {
        scrollTo({ top: 0, behavior: 'smooth' });
        sendResponse({ success: true });
      }
    } catch (error) {
      if (message.type === 'library-open') {
        sendResponse({
          success: false,
          opened: false,
          viewerDetected: false,
          beforeUrl: location.href,
          afterUrl: location.href,
          workerTabId: null,
          error: String(error?.message || error)
        });
      } else {
        sendResponse({ success: false, error: String(error?.message || error) });
      }
    }
  })();
  return true;
});

new MutationObserver(() => {
  chrome.runtime.sendMessage({ type: 'page-state', title: document.title, url: location.href }).catch(() => {});
}).observe(document.documentElement, { childList: true, subtree: true });
