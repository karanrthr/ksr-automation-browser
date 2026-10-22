import { loadJob, saveJob, transition, clearJob } from './automation/job-storage.js';
import { alreadyHandled, safeProjectName } from './automation/duplicate-detector.js';
import { scanUpward } from './adapters/gemini/scroll-controller.js';
import { isLibraryUrl, libraryTargetCount } from './adapters/gemini/library-adapter.js';
import { START_LIBRARY_MESSAGE } from './common/messages.js';

const HOST = 'com.ksr.automation';
const state = {
  IDLE: 'IDLE',
  VALIDATING: 'VALIDATING_PAGE',
  SCANNING: 'SCANNING',
  LIBRARY: 'SCANNING_LIBRARY',
  OPENING: 'OPENING_VIEWER',
  DOWNLOADING: 'WAITING_FOR_DOWNLOAD',
  PAUSED: 'PAUSED',
  MANUAL: 'MANUAL_ACTION_REQUIRED',
  DONE: 'COMPLETED',
  STOPPED: 'STOPPED',
  FAILED: 'FAILED'
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ automationStatus: state.IDLE, imagesDownloaded: 0, duplicatesSkipped: 0, downloadsFailed: 0 });
});

function native(command, extra = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(HOST, { command, ...extra }, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

async function logLine(message) {
  try {
    await native('writeLog', { message: `[KSR Controller] ${new Date().toISOString()} ${message}` });
  } catch {
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function tab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active;
}

async function contentById(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

async function content(target, message) {
  return contentById(target.id, message);
}

async function ensureContentReady(tabId, attempts = 8) {
  let lastError = '';
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await contentById(tabId, { type: 'content-ping' });
      if (response?.success) return response;
      lastError = response?.error || 'content-ping failed';
    } catch (error) {
      lastError = String(error?.message || error);
    }
    await wait(350);
  }
  throw new Error(`Library content script did not respond: ${lastError}`);
}

async function waitForTabReady(tabId, timeoutMs = 9000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const current = await chrome.tabs.get(tabId);
    if (current.status === 'complete') {
      try {
        await ensureContentReady(tabId, 2);
        return current;
      } catch {
      }
    }
    await wait(300);
  }
  return chrome.tabs.get(tabId);
}

function libraryFingerprints(items = []) {
  return new Set(items.map(item => typeof item === 'string' ? item : item?.fingerprint).filter(Boolean));
}

function stampForFile() {
  const d = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function status() {
  const active = await tab();
  const job = await loadJob();
  return {
    ...await chrome.storage.local.get(),
    currentUrl: active?.url,
    currentTitle: active?.title,
    geminiDetected: /^https:\/\/gemini\.google\.com\//.test(active?.url || ''),
    job
  };
}

async function begin(projectName) {
  const active = await tab();
  if (!active || !/^https:\/\/gemini\.google\.com\//.test(active.url || '')) throw new Error('Open the required Gemini chat first.');
  if (/\/library|\/settings|\/$/.test(new URL(active.url).pathname)) throw new Error('Open the required Gemini chat first.');
  let path = '';
  try {
    path = (await native('getDownloadPath')).path || '';
  } catch (error) {
    throw new Error('Native Host connection failed: ' + error.message);
  }
  const job = {
    id: crypto.randomUUID(),
    tabId: active.id,
    chatUrl: active.url,
    chatTitle: active.title || 'Gemini chat',
    projectName: safeProjectName(projectName),
    downloadPath: path,
    startedAt: new Date().toISOString(),
    state: state.SCANNING,
    candidates: [],
    completed: [],
    skipped: [],
    failed: [],
    retries: {},
    currentAction: 'Scanning current chat'
  };
  await saveJob(job);
  await chrome.storage.local.set({ automationStatus: job.state, imagesDownloaded: 0, duplicatesSkipped: 0, downloadsFailed: 0, lastError: '' });
  await scan(job);
  return job;
}

async function scan(job) {
  await transition(job, state.SCANNING, 'Scanning visible Gemini response images');
  await ensureContentReady(job.tabId);
  const response = await contentById(job.tabId, { type: 'gemini-scan' });
  if (!response?.success) throw new Error(response?.error || 'Gemini scan failed');
  let added = 0;
  for (const candidate of response.candidates || []) {
    if (!job.candidates.some(item => item.fingerprint === candidate.fingerprint)) {
      job.candidates.push(candidate);
      added += 1;
    }
  }
  await saveJob(job);
  await chrome.storage.local.set({ imagesDetected: job.candidates.length });
  return added;
}

async function scanLibrary(job) {
  await ensureContentReady(job.tabId);
  const response = await contentById(job.tabId, { type: 'library-scan' });
  if (!response?.success || !response.scannerExecuted) throw new Error(response?.error || 'Library scan failed');
  if (!Array.isArray(response.candidates)) throw new Error('Library scan response did not include candidates');
  job.lastLibraryScan = {
    at: new Date().toISOString(),
    totalImagesOnPage: response.totalImagesOnPage || 0,
    candidateElementsChecked: response.candidateElementsChecked || 0,
    mediaCardsFound: response.mediaCardsFound || 0
  };
  job.discoveredLibraryCards ||= [];
  let added = 0;
  for (const candidate of response.candidates) {
    if (!job.discoveredLibraryCards.some(item => item.fingerprint === candidate.fingerprint)) {
      job.discoveredLibraryCards.push(candidate);
      added += 1;
    }
  }
  await saveJob(job);
  await chrome.storage.local.set({
    libraryTotalImagesOnPage: job.lastLibraryScan.totalImagesOnPage,
    libraryCandidateElementsChecked: job.lastLibraryScan.candidateElementsChecked,
    libraryMediaCardsFound: job.lastLibraryScan.mediaCardsFound
  });
  await logLine(`Library scan response cards=${job.lastLibraryScan.mediaCardsFound} added=${added}`);
  return added;
}

async function startLibrary() {
  const active = await tab();
  if (!active || !isLibraryUrl(active.url)) throw new Error('Open Gemini Library first.');
  const path = (await native('getDownloadPath')).path || '';
  const job = {
    id: crypto.randomUUID(),
    mode: 'library',
    tabId: active.id,
    libraryUrl: 'https://gemini.google.com/library',
    downloadPath: path,
    startedAt: new Date().toISOString(),
    state: state.LIBRARY,
    targetCount: libraryTargetCount,
    libraryTargetCount,
    discoveredLibraryCards: [],
    completedLibraryCards: [],
    skippedLibraryCards: [],
    failedLibraryDownloads: [],
    duplicateLibraryHashes: [],
    currentLibraryCard: null,
    skipped: [],
    failed: [],
    files: [],
    successfulLibraryDownloads: 0,
    currentAction: 'Scanning Library',
    realBrowserAttemptsUsed: 1
  };
  await saveJob(job);
  await chrome.storage.local.set({
    automationStatus: state.LIBRARY,
    imagesDownloaded: 0,
    downloadsFailed: 0,
    lastError: '',
    libraryRunStartedAt: job.startedAt
  });
  await logLine('Library job saved; scanner starting');
  runLibraryNext().catch(async error => {
    const current = await loadJob() || job;
    await transition(current, state.MANUAL, String(error?.message || error));
    await chrome.storage.local.set({ lastError: String(error?.message || error), automationStatus: state.MANUAL });
    await logLine(`Library scanner failed ${String(error?.message || error)}`);
  });
  return job;
}

function selectNextLibraryCandidate(job) {
  const completed = libraryFingerprints(job.completedLibraryCards);
  const skipped = libraryFingerprints([...(job.skippedLibraryCards || []), ...(job.failedLibraryDownloads || [])]);
  return (job.discoveredLibraryCards || []).find(candidate =>
    !completed.has(candidate.fingerprint) &&
    !skipped.has(candidate.fingerprint) &&
    candidate.fingerprint !== job.inFlight
  );
}

async function restoreLibrary(job) {
  let closeResult = null;
  try {
    closeResult = await contentById(job.tabId, { type: 'gemini-close-viewer' });
  } catch (error) {
    closeResult = { success: false, error: String(error?.message || error) };
  }
  await wait(450);
  const current = await chrome.tabs.get(job.tabId);
  if (!isLibraryUrl(current.url || '')) {
    await chrome.tabs.update(job.tabId, { url: job.libraryUrl || 'https://gemini.google.com/library' });
    await waitForTabReady(job.tabId);
  } else {
    await ensureContentReady(job.tabId);
  }
  job.libraryRestored = true;
  job.lastViewerClose = closeResult;
  await saveJob(job);
  await logLine(`Library restored closeSuccess=${Boolean(closeResult?.success)}`);
  return closeResult;
}

async function clickLibraryDownload(job) {
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await waitForTabReady(job.tabId, attempt === 0 ? 3500 : 7000);
      const response = await contentById(job.tabId, { type: 'gemini-download' });
      if (response?.success) return response;
      lastError = response?.error || 'Download click returned unsuccessful response';
    } catch (error) {
      lastError = String(error?.message || error);
    }
    await wait(800);
  }
  throw new Error(lastError || 'Gemini viewer Download button was not available');
}

async function runLibraryNext() {
  let job = await loadJob();
  if (!job || job.mode !== 'library' || job.successfulLibraryDownloads >= libraryTargetCount) return job;
  await transition(job, state.LIBRARY, 'Scanning visible Library Media cards');
  await scanLibrary(job);
  let candidate = selectNextLibraryCandidate(job);
  if (!candidate) {
    await transition(job, state.MANUAL, 'No safe unprocessed visible Library Media card found');
    await chrome.storage.local.set({ automationStatus: state.MANUAL });
    return job;
  }
  try {
    job.inFlight = candidate.fingerprint;
    job.currentLibraryCard = {
      fingerprint: candidate.fingerprint,
      index: candidate.index,
      visualIndex: candidate.visualIndex,
      src: candidate.src,
      href: candidate.href || ''
    };
    job.libraryOpenAttempts = (job.libraryOpenAttempts || 0) + 1;
    await saveJob(job);
    await transition(job, state.OPENING, 'Opening Library Media card');
    await logLine(`Opening Library card visualIndex=${candidate.visualIndex} fingerprint=${candidate.fingerprint}`);
    const openResponse = await contentById(job.tabId, { type: 'library-open', candidate });
    job = await loadJob();
    job.lastLibraryOpenResponse = openResponse || null;
    await saveJob(job);
    if (!openResponse?.success || !openResponse.opened) throw new Error(openResponse?.error || 'Library card did not open');
    await transition(job, state.DOWNLOADING, 'Starting Library image download');
    const downloadResponse = await clickLibraryDownload(job);
    job = await loadJob();
    job.lastLibraryDownloadClickResponse = downloadResponse;
    job.downloadRequestedAt = new Date().toISOString();
    await saveJob(job);
    await chrome.storage.local.set({ automationStatus: state.DOWNLOADING });
    await logLine(`Library download clicked fingerprint=${candidate.fingerprint}`);
    setTimeout(recoverStalledDownload, 4500);
  } catch (error) {
    job = await loadJob() || job;
    job.failedLibraryDownloads ||= [];
    job.failedLibraryDownloads.push({ fingerprint: candidate.fingerprint, error: String(error?.message || error) });
    job.failed ||= [];
    job.failed.push({ fingerprint: candidate.fingerprint, error: String(error?.message || error) });
    job.inFlight = null;
    job.currentLibraryCard = null;
    await saveJob(job);
    await transition(job, state.MANUAL, String(error?.message || error));
    await chrome.storage.local.set({ downloadsFailed: job.failedLibraryDownloads.length, automationStatus: state.MANUAL, lastError: String(error?.message || error) });
    await logLine(`Library card failed ${String(error?.message || error)}`);
  }
  return loadJob();
}

async function completeLibraryDownload(job, id) {
  const [download] = await chrome.downloads.search({ id });
  if (!download?.filename) throw new Error('Completed Library download has no filename');
  await native('waitUntilUnlocked', { path: download.filename, timeoutMs: 15000 });
  const valid = await native('validateImage', { path: download.filename });
  if (!valid.success) throw new Error(valid.error || 'Library file validation failed');
  const hash = await native('getFileHash', { path: download.filename });
  let dimensions = { success: false, width: 0, height: 0 };
  try {
    dimensions = await native('getImageDimensions', { path: download.filename });
  } catch {
  }
  const existingHashes = new Set((job.files || []).map(file => file.sha256).filter(Boolean));
  if (existingHashes.has(hash.sha256)) {
    job.duplicateHashEncountered = true;
    job.duplicateLibraryHashes ||= [];
    job.duplicateLibraryHashes.push(hash.sha256);
    job.skippedLibraryCards ||= [];
    job.skippedLibraryCards.push({ fingerprint: job.inFlight, reason: 'duplicate-hash', sha256: hash.sha256 });
    job.inFlight = null;
    job.currentLibraryCard = null;
    job.activeDownloadId = null;
    await saveJob(job);
    await restoreLibrary(job);
    return runLibraryNext();
  }
  const ext = (download.filename.match(/\.[a-z0-9]+$/i) || ['.png'])[0].toLowerCase();
  const serial = String((job.successfulLibraryDownloads || 0) + 1).padStart(3, '0');
  const folder = `${job.downloadPath}\\Library_First_2_Test`;
  const filename = `Gemini_Library_Image_${serial}_${stampForFile()}${ext}`;
  const destination = `${folder}\\${filename}`;
  await native('createFolder', { path: folder });
  await native('moveFile', { path: download.filename, destination });
  job.completedLibraryCards ||= [];
  job.completedLibraryCards.push(job.inFlight);
  job.files ||= [];
  job.files.push({
    fingerprint: job.inFlight,
    filename,
    path: destination,
    size: download.fileSize || download.totalBytes || 0,
    sha256: hash.sha256,
    width: dimensions.width || 0,
    height: dimensions.height || 0
  });
  job.successfulLibraryDownloads = (job.successfulLibraryDownloads || 0) + 1;
  job.inFlight = null;
  job.currentLibraryCard = null;
  job.activeDownloadId = null;
  await saveJob(job);
  await chrome.storage.local.set({ imagesDownloaded: job.successfulLibraryDownloads, automationStatus: state.SCANNING });
  await logLine(`Library image completed count=${job.successfulLibraryDownloads} file=${filename}`);
  await restoreLibrary(job);
  if (job.successfulLibraryDownloads >= libraryTargetCount) {
    job = await loadJob() || job;
    job.finalJobState = state.DONE;
    job.currentAction = 'Two different Library images downloaded';
    job.state = state.DONE;
    await saveJob(job);
    await chrome.storage.local.set({ automationStatus: state.DONE, imagesDownloaded: job.successfulLibraryDownloads });
    await logLine('Library job completed after two images');
    return job;
  }
  return runLibraryNext();
}

async function closeAndAdvance(job) {
  await transition(job, state.SCANNING, 'Closing Gemini image viewer');
  const closed = await contentById(job.tabId, { type: 'gemini-close-viewer' });
  if (!closed.success || !closed.verified) throw new Error(closed.error || 'Gemini viewer close was not verified');
  await transition(job, state.SCANNING, 'Rescanning for the next image');
  await scan(job);
  return downloadNext();
}

async function completeDownload(job, id) {
  const [download] = await chrome.downloads.search({ id });
  if (!download?.filename) throw new Error('Completed download has no local filename');
  const valid = await native('validateImage', { path: download.filename });
  if (!valid.success) throw new Error(valid.error || 'Downloaded file is not a valid image');
  const ext = (download.filename.match(/\.[a-z0-9]+$/i) || ['.png'])[0].toLowerCase();
  const serial = String((job.completed?.length || 0) + 1).padStart(3, '0');
  const folder = `${job.downloadPath}\\${job.projectName}\\Downloaded Images`;
  const filename = `Gemini_${job.projectName}_Image_${serial}_${stampForFile()}${ext}`;
  const destination = `${folder}\\${filename}`;
  await native('createFolder', { path: folder });
  await native('waitUntilUnlocked', { path: download.filename, timeoutMs: 15000 });
  await native('moveFile', { path: download.filename, destination });
  const hash = await native('getFileHash', { path: destination });
  const dimensions = await native('getImageDimensions', { path: destination });
  job.completed.push(job.inFlight);
  job.files ??= [];
  job.files.push({ filename, path: destination, sha256: hash.sha256, width: dimensions.width, height: dimensions.height });
  job.inFlight = null;
  job.activeDownloadId = null;
  await transition(job, state.SCANNING, 'Image validated and renamed');
  await chrome.storage.local.set({ imagesDownloaded: job.completed.length, automationStatus: state.SCANNING });
  return closeAndAdvance(job);
}

async function recoverStalledDownload() {
  const job = await loadJob();
  if (!job?.inFlight || job.activeDownloadId) return;
  const since = new Date(job.downloadRequestedAt || job.startedAt);
  const hits = await chrome.downloads.search({ state: 'complete', orderBy: ['-startTime'], limit: 8 });
  const download = hits.find(item => new Date(item.startTime) >= since);
  if (!download) return;
  try {
    if (job.mode === 'library') await completeLibraryDownload(job, download.id);
    else await completeDownload(job, download.id);
  } catch (error) {
    const current = await loadJob() || job;
    await transition(current, state.MANUAL, String(error?.message || error));
    await chrome.storage.local.set({ lastError: String(error?.message || error), automationStatus: state.MANUAL });
    await logLine(`Recover stalled download failed ${String(error?.message || error)}`);
  }
}

async function repairCompletedDownload() {
  const job = await loadJob();
  if (!job || job.mode === 'library' || job.inFlight || !job.completed?.length || job.files?.length) return;
  const hits = await chrome.downloads.search({ state: 'complete', orderBy: ['-startTime'], limit: 5 });
  const download = hits.find(item => new Date(item.startTime) >= new Date(job.startedAt));
  if (!download?.filename) return;
  try {
    const valid = await native('validateImage', { path: download.filename });
    if (!valid.success) throw new Error(valid.error || 'Downloaded file is not a valid image');
    const ext = (download.filename.match(/\.[a-z0-9]+$/i) || ['.png'])[0].toLowerCase();
    const folder = `${job.downloadPath}\\${job.projectName}\\Downloaded Images`;
    const destination = `${folder}\\Gemini_${job.projectName}_Image_${String(job.completed.length).padStart(3, '0')}_${stampForFile()}${ext}`;
    await native('createFolder', { path: folder });
    await native('waitUntilUnlocked', { path: download.filename, timeoutMs: 15000 });
    await native('moveFile', { path: download.filename, destination });
    const hash = await native('getFileHash', { path: destination });
    const dimensions = await native('getImageDimensions', { path: destination });
    job.files = [{ path: destination, sha256: hash.sha256, width: dimensions.width, height: dimensions.height }];
    await transition(job, state.DONE, 'Completed file validated and renamed');
  } catch (error) {
    await transition(job, state.MANUAL, String(error?.message || error));
    await chrome.storage.local.set({ lastError: String(error?.message || error), automationStatus: state.MANUAL });
  }
}

async function downloadNext() {
  const job = await loadJob();
  if (!job || [state.PAUSED, state.STOPPED, state.DONE].includes(job.state)) return job;
  let candidate = job.candidates.find(item => !alreadyHandled(job, item.fingerprint));
  if (!candidate) {
    await scan(job);
    candidate = job.candidates.find(item => !alreadyHandled(job, item.fingerprint));
    if (!candidate) {
      const result = await scanUpward({
        scrollStep: async () => {
          const response = await contentById(job.tabId, { type: 'gemini-scroll-step' });
          if (!response.success) throw new Error(response.error);
          return response;
        },
        waitForLazyLoad: () => wait(900),
        scan: () => scan(job)
      }, 3);
      candidate = job.candidates.find(item => !alreadyHandled(job, item.fingerprint));
      if (!candidate && !result.foundNew) {
        await transition(job, state.DONE, 'Whole-chat scan exhausted with no new images');
        await chrome.storage.local.set({ automationStatus: state.DONE });
        return job;
      }
    }
  }
  try {
    job.inFlight = candidate.fingerprint;
    await transition(job, state.OPENING, 'Opening next unprocessed Gemini image');
    let response = await contentById(job.tabId, { type: 'gemini-open', candidate });
    if (!response.success) throw new Error(response.error);
    await wait(600);
    await transition(job, state.DOWNLOADING, 'Starting browser download');
    response = await contentById(job.tabId, { type: 'gemini-download' });
    if (!response.success) throw new Error(response.error);
    job.downloadRequestedAt = new Date().toISOString();
    await saveJob(job);
    setTimeout(recoverStalledDownload, 2500);
  } catch (error) {
    job.failed.push({ fingerprint: candidate.fingerprint, error: String(error?.message || error) });
    job.inFlight = null;
    await transition(job, state.MANUAL, String(error?.message || error));
    await chrome.storage.local.set({ automationStatus: state.MANUAL, lastError: String(error?.message || error), downloadsFailed: job.failed.length });
  }
  return job;
}

chrome.downloads.onCreated.addListener(async download => {
  const job = await loadJob();
  if (job?.inFlight) {
    job.activeDownloadId = download.id;
    await saveJob(job);
    await logLine(`Download created id=${download.id}`);
  }
});

chrome.downloads.onChanged.addListener(async delta => {
  const job = await loadJob();
  if (!job || delta.id !== job.activeDownloadId) return;
  if (delta.state?.current === 'complete') {
    try {
      if (job.mode === 'library') await completeLibraryDownload(job, delta.id);
      else await completeDownload(job, delta.id);
    } catch (error) {
      const current = await loadJob() || job;
      await transition(current, state.MANUAL, String(error?.message || error));
      await chrome.storage.local.set({ lastError: String(error?.message || error), automationStatus: state.MANUAL });
      await logLine(`Download completion failed ${String(error?.message || error)}`);
    }
  } else if (delta.error?.current) {
    job.failed ||= [];
    job.failed.push({ fingerprint: job.inFlight, error: delta.error.current });
    if (job.mode === 'library') {
      job.failedLibraryDownloads ||= [];
      job.failedLibraryDownloads.push({ fingerprint: job.inFlight, error: delta.error.current });
    }
    job.inFlight = null;
    job.activeDownloadId = null;
    await transition(job, state.MANUAL, 'Download interrupted: ' + delta.error.current);
    await chrome.storage.local.set({ downloadsFailed: job.failed.length, automationStatus: state.MANUAL, lastError: delta.error.current });
    await logLine(`Download interrupted ${delta.error.current}`);
  }
});

recoverStalledDownload();
repairCompletedDownload();

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  (async () => {
    try {
      if (message.type === 'status') {
        reply(await status());
      } else if (message.type === 'start-current-chat') {
        reply({ success: true, job: await begin(message.projectName) });
      } else if (message.type === START_LIBRARY_MESSAGE || message.type === 'start-library') {
        await logLine('Library start message received');
        const job = await startLibrary();
        reply({ success: true, mode: 'library', state: state.LIBRARY, job });
      } else if (message.type === 'next') {
        const job = await loadJob();
        reply({ success: true, job: job?.mode === 'library' ? await runLibraryNext() : await downloadNext() });
      } else if (message.type === 'skip') {
        const job = await loadJob();
        if (!job?.inFlight) throw new Error('No current image is available to skip.');
        job.skipped.push(job.inFlight);
        job.inFlight = null;
        await transition(job, state.SCANNING, 'Image skipped by operator');
        reply({ success: true, job: await downloadNext() });
      } else if (message.type === 'control') {
        const job = await loadJob();
        if (job) {
          await transition(job, message.action, message.action);
          await chrome.storage.local.set({ automationStatus: message.action });
        }
        reply({ success: true });
      } else if (message.type === 'native') {
        reply(await native(message.command, message.extra));
      } else if (message.type === 'reset') {
        await clearJob();
        await chrome.storage.local.set({ automationStatus: state.IDLE });
        reply({ success: true });
      }
    } catch (error) {
      await chrome.storage.local.set({ lastError: String(error?.message || error), automationStatus: state.MANUAL });
      await logLine(`Message failed ${message.type} ${String(error?.message || error)}`);
      reply({ success: false, error: String(error?.message || error) });
    }
  })();
  return true;
});
