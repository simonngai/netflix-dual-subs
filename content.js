// Runs in ISOLATED world — manages the secondary subtitle overlay

(function () {
  'use strict';

  const DEBUG = false; // flip true for verbose logging

  let enabled = true;
  let secondaryLang = 'zh-Hant';
  let primaryLang = 'ja';
  let position = 5; // bottom %
  let fontSize = 16; // px
  let bgOpacity = 90; // %
  let tracks = [];
  let primaryCues = []; // JP cues (for capture — Netflix renders JP as images)
  let secondaryCues = [];
  let overlayEl = null;
  let statusEl = null;
  let videoEl = null;

  // --- Storage ---

  chrome.storage.sync.get(['enabled', 'primaryLang', 'secondaryLang', 'position', 'fontSize', 'bgOpacity'], (data) => {
    if (data.enabled !== undefined) enabled = data.enabled;
    if (data.primaryLang) primaryLang = data.primaryLang;
    if (data.secondaryLang) secondaryLang = data.secondaryLang;
    if (data.position) position = data.position;
    if (data.fontSize) fontSize = data.fontSize;
    if (data.bgOpacity) bgOpacity = data.bgOpacity;
    applyStyle();
  });

  function applyStyle() {
    if (!overlayEl) return;
    overlayEl.style.bottom = position + '%';
    overlayEl.style.fontSize = fontSize + 'px';
    overlayEl.style.background = `rgba(0, 0, 0, ${bgOpacity / 100 * 0.8})`;
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) {
      enabled = changes.enabled.newValue;
      if (overlayEl) overlayEl.style.display = enabled ? 'block' : 'none';
    }
    if (changes.primaryLang) {
      primaryLang = changes.primaryLang.newValue;
      loadSecondaryTrack();
    }
    if (changes.secondaryLang) {
      secondaryLang = changes.secondaryLang.newValue;
      loadSecondaryTrack();
    }
    if (changes.position) {
      position = changes.position.newValue;
      applyStyle();
    }
    if (changes.fontSize) {
      fontSize = changes.fontSize.newValue;
      applyStyle();
    }
    if (changes.bgOpacity) {
      bgOpacity = changes.bgOpacity.newValue;
      applyStyle();
    }
  });

  // --- Track Interception (via postMessage from MAIN world) ---

  window.addEventListener('message', (e) => {
    if (e.source !== window) return; // ignore messages from other windows/frames
    if (e.data && e.data.type === 'DUAL_SUBS_TRACKS') {
      tracks = e.data.tracks;
      const langs = tracks.map(t => `${t.language}${t.isImage ? '(img)' : ''}`).join(', ');
      DEBUG && console.log('[DualSubs] Tracks:', langs);
      showStatus(`${tracks.length} tracks: ${langs}`);
      loadPrimaryTrack();
      loadSecondaryTrack();
    }
  });

  function loadPrimaryTrack() {
    // Load primary (JP) track text for capture — Netflix renders JP as images
    const nonForced = tracks.filter(t => !t.isForced && t.displayName !== 'Off');
    // Prefer text track, fall back to image track
    let track = nonForced.find(t => t.language === primaryLang && !t.isImage);
    if (!track) {
      const prefix = primaryLang.split('-')[0];
      track = nonForced.find(t => t.language && t.language.startsWith(prefix) && !t.isImage);
    }
    // If only image track exists, still try (won't parse but at least we tried)
    if (!track) {
      track = nonForced.find(t => t.language === primaryLang);
      if (!track) {
        const prefix = primaryLang.split('-')[0];
        track = nonForced.find(t => t.language && t.language.startsWith(prefix));
      }
    }
    if (!track || !track.url) {
      console.warn(`[DualSubs] No primary track found for ${primaryLang}`);
      return;
    }
    if (track.isImage) {
      console.warn(`[DualSubs] Primary track (${primaryLang}) is image-only (${track.format}) — capture will use ZH overlay only`);
      return; // Don't try to fetch/parse image data
    }

    fetch(track.url)
      .then(r => r.ok ? r.text() : Promise.reject(`HTTP ${r.status}`))
      .then(text => {
        primaryCues = text.trim().startsWith('<') ? parseTTML(text) : parseWebVTT(text);
        DEBUG && console.log(`[DualSubs] Primary (${primaryLang}): ${primaryCues.length} cues loaded for capture`);
      })
      .catch(err => console.warn('[DualSubs] Primary track load failed:', err));
  }

  function loadSecondaryTrack() {
    // Match by language field — skip forced narrative ("Off") tracks
    const nonForced = tracks.filter(t => !t.isForced && t.displayName !== 'Off');
    const forced = tracks.filter(t => t.isForced || t.displayName === 'Off');

    // Prefer non-forced, fall back to forced
    let track = nonForced.find(t => t.language === secondaryLang);
    if (!track) {
      const prefix = secondaryLang.split('-')[0];
      track = nonForced.find(t => t.language && t.language.startsWith(prefix));
    }
    if (!track) {
      track = forced.find(t => t.language === secondaryLang);
    }
    if (!track) {
      showStatus(`"${secondaryLang}" not found`);
      return;
    }

    if (track.isImage) {
      DEBUG && console.log(`[DualSubs] "${track.language}" is image-based (nflx-cmisc), trying imsc1.1 fallback...`);
      // Image tracks also have imsc1.1 which is text-based XML
      // Re-check if we have a text version of this language
      const textTrack = tracks.find(t =>
        t.language === track.language && !t.isImage
      );
      if (textTrack) {
        track = textTrack;
      } else {
        showStatus(`"${track.language}" only has image subs (no text)`);
        return;
      }
    }

    DEBUG && console.log(`[DualSubs] Loading: ${track.displayName} (${track.format})`);
    showStatus(`Loading ${track.displayName}...`);

    fetch(track.url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(text => {
        if (track.format === 'simplesdh' || track.format === 'dfxp-ls-sdh' || track.format === 'imsc1.1') {
          secondaryCues = parseTTML(text);
        } else {
          // Try TTML first, fallback to WebVTT
          if (text.trim().startsWith('<') || text.includes('</tt>')) {
            secondaryCues = parseTTML(text);
          } else {
            secondaryCues = parseWebVTT(text);
          }
        }
        DEBUG && console.log(`[DualSubs] Parsed ${secondaryCues.length} cues`);
        showStatus(`${track.displayName}: ${secondaryCues.length} cues ✓`, 3000);
      })
      .catch(err => {
        console.error('[DualSubs] Failed:', err);
        showStatus(`Error: ${err.message}`, 5000);
      });
  }

  // --- Parsers ---

  function parseWebVTT(text) {
    const cues = [];
    const blocks = text.split(/\n\n+/);
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(
          /(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/
        );
        if (match) {
          const start = timeToSeconds(match[1]);
          const end = timeToSeconds(match[2]);
          const textLines = lines.slice(i + 1).join('\n');
          const cleanText = textLines.replace(/<[^>]+>/g, '').trim();
          if (cleanText) {
            cues.push({ start, end, text: cleanText });
          }
          break;
        }
      }
    }
    return cues;
  }

  function parseTTML(xml) {
    const cues = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const tickRate = parseInt(doc.documentElement.getAttribute('ttp:tickRate') || '10000000');

    const ps = doc.querySelectorAll('p');
    for (const p of ps) {
      const beginAttr = p.getAttribute('begin');
      const endAttr = p.getAttribute('end');
      if (!beginAttr || !endAttr) continue;

      const start = parseTTMLTime(beginAttr, tickRate);
      const end = parseTTMLTime(endAttr, tickRate);
      const text = p.textContent.trim();
      if (text) {
        cues.push({ start, end, text });
      }
    }
    return cues;
  }

  function parseTTMLTime(val, tickRate) {
    if (val.endsWith('t')) {
      return parseInt(val) / tickRate;
    }
    return timeToSeconds(val);
  }

  function timeToSeconds(str) {
    const parts = str.split(':');
    const seconds = parseFloat(parts[2]);
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + seconds;
  }

  // --- Overlay Rendering ---

  function getPlayerContainer() {
    // Netflix's fullscreen container — overlay must be inside this to show in fullscreen
    return document.querySelector('.watch-video--player-view')
      || document.querySelector('.NFPlayer')
      || document.querySelector('[data-uia="video-canvas"]')
      || document.body;
  }

  function createOverlay() {
    if (overlayEl && document.contains(overlayEl)) return;
    overlayEl = document.createElement('div');
    overlayEl.id = 'dual-subs-overlay';
    overlayEl.style.display = enabled ? 'block' : 'none';
    getPlayerContainer().appendChild(overlayEl);
    applyStyle();
  }

  function createStatus() {
    if (statusEl && document.contains(statusEl)) return;
    statusEl = document.createElement('div');
    statusEl.id = 'dual-subs-status';
    getPlayerContainer().appendChild(statusEl);
  }

  // Re-attach overlays when entering/exiting fullscreen
  document.addEventListener('fullscreenchange', () => {
    const container = getPlayerContainer();
    if (overlayEl && !container.contains(overlayEl)) {
      container.appendChild(overlayEl);
    }
    if (statusEl && !container.contains(statusEl)) {
      container.appendChild(statusEl);
    }
  });

  let statusTimeout = null;
  function showStatus(msg, autohide) {
    if (!statusEl) createStatus();
    statusEl.textContent = `[DualSubs] ${msg}`;
    statusEl.classList.add('visible');
    clearTimeout(statusTimeout);
    if (autohide) {
      statusTimeout = setTimeout(() => statusEl.classList.remove('visible'), autohide);
    }
  }

  function findCueAtTime(cues, time) {
    for (const cue of cues) {
      if (time >= cue.start && time <= cue.end) {
        return cue;
      }
    }
    return null;
  }

  function updateOverlay() {
    if (!overlayEl || !enabled || secondaryCues.length === 0) return;
    if (!videoEl) {
      videoEl = document.querySelector('video');
      if (!videoEl) return;
    }

    const time = videoEl.currentTime;
    const cue = findCueAtTime(secondaryCues, time);

    if (cue) {
      overlayEl.textContent = cue.text;
      overlayEl.classList.add('visible');
    } else {
      overlayEl.textContent = '';
      overlayEl.classList.remove('visible');
    }
  }

  // --- Main Loop ---

  function init() {
    createOverlay();
    createStatus();
    showStatus('Waiting for subtitle tracks...', 5000);

    let lastTime = -1;
    function tick() {
      if (videoEl && Math.abs(videoEl.currentTime - lastTime) > 0.05) {
        lastTime = videoEl.currentTime;
        updateOverlay();
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    const observer = new MutationObserver(() => {
      if (!videoEl || !document.contains(videoEl)) {
        videoEl = document.querySelector('video');
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    DEBUG && console.log('[DualSubs] Content script initialized');
  }

  // --- Capture ---

  function getJapaneseFromDOM() {
    // Try to read Netflix's native subtitle text from the DOM
    const timedText = document.querySelector('.player-timedtext');
    if (!timedText) return '';
    // Get all text spans (skip image-based subs)
    const spans = timedText.querySelectorAll('span');
    if (spans.length > 0) {
      return Array.from(spans).map(s => s.textContent).join('').trim();
    }
    // Fallback: get any text content
    const text = timedText.textContent.trim();
    return text;
  }

  function captureCurrentLine() {
    // Try DOM first, fall back to our loaded cues (JP subs are often image-based)
    let jp = getJapaneseFromDOM();
    if (!jp && videoEl && primaryCues.length > 0) {
      const cue = findCueAtTime(primaryCues, videoEl.currentTime);
      if (cue) jp = cue.text;
    }
    const zh = overlayEl ? overlayEl.textContent.trim() : '';
    const time = videoEl ? formatTime(videoEl.currentTime) : '';
    const show = document.querySelector('.video-title')?.textContent
      || document.title.replace(' | Netflix', '').trim();

    if (!jp && !zh) {
      showStatus('Nothing to capture — wait for subtitle to appear', 2000);
      return;
    }

    // Format for pasting into Claude Code
    let text = '';
    if (jp) text += `JP: ${jp}`;
    if (zh) text += `${jp ? '\n' : ''}ZH: ${zh}`;
    if (show || time) text += `\n(${show}${time ? ' ' + time : ''})`;

    // Copy to clipboard — try modern API first, fallback to execCommand
    const onCopied = () => {
      if (overlayEl) {
        overlayEl.style.color = '#0f0';
        setTimeout(() => { overlayEl.style.color = '#ccc'; }, 500);
      }
      showStatus('Copied!', 1500);
    };

    navigator.clipboard.writeText(text).then(onCopied).catch(() => {
      // Fallback: textarea + execCommand
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      onCopied();
    });
  }

  function exportAllCues() {
    const show = document.querySelector('.video-title')?.textContent
      || document.title.replace(' | Netflix', '').trim();

    if (primaryCues.length === 0 && secondaryCues.length === 0) {
      showStatus('No cues loaded — nothing to export', 2000);
      return;
    }

    // Build aligned subtitle pairs by matching timestamps
    let lines = [];
    lines.push(`# ${show}`);
    lines.push(`# Primary: ${primaryLang} (${primaryCues.length} cues), Secondary: ${secondaryLang} (${secondaryCues.length} cues)`);
    lines.push('');

    // Use whichever has more cues as the base
    const baseCues = primaryCues.length >= secondaryCues.length ? primaryCues : secondaryCues;
    const otherCues = baseCues === primaryCues ? secondaryCues : primaryCues;
    const baseLabel = baseCues === primaryCues ? 'JP' : 'ZH';
    const otherLabel = baseCues === primaryCues ? 'ZH' : 'JP';

    for (const cue of baseCues) {
      const time = formatTime(cue.start);
      lines.push(`[${time}] ${baseLabel}: ${cue.text}`);
      // Find matching cue in the other track by timestamp overlap
      const match = otherCues.find(c => c.start <= cue.end && c.end >= cue.start);
      if (match) {
        lines.push(`       ${otherLabel}: ${match.text}`);
      }
      lines.push('');
    }

    const text = lines.join('\n');

    // Sanitize show name for filename
    const safeName = show.replace(/[^a-zA-Z0-9\u3000-\u9FFF\u4E00-\u9FFF]/g, '_').replace(/_+/g, '_');
    const filename = `${safeName}_subs.txt`;

    // Direct download via blob URL + anchor click
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
    showStatus(`Exported ${baseCues.length} cues!`, 3000);
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // --- Keyboard shortcuts (relayed from MAIN world via postMessage) ---

  window.addEventListener('message', (e) => {
    if (e.source !== window) return; // ignore messages from other windows/frames
    if (e.data && e.data.type === 'DUAL_SUBS_KEY') {
      if (e.data.key === 'd') {
        enabled = !enabled;
        chrome.storage.sync.set({ enabled });
        if (overlayEl) overlayEl.style.display = enabled ? 'block' : 'none';
        showStatus(enabled ? 'Enabled' : 'Disabled', 2000);
      }
      if (e.data.key === 's') {
        captureCurrentLine();
      }
      if (e.data.key === 'e') {
        exportAllCues();
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
