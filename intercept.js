// Runs in MAIN world — intercepts Netflix subtitle manifest data

(function () {
  'use strict';

  const originalParse = JSON.parse;

  JSON.parse = function () {
    const result = originalParse.apply(this, arguments);
    try {
      let tracks = null;
      let movieId = null;

      if (result && result.result && result.result.timedtexttracks) {
        tracks = result.result.timedtexttracks;
        movieId = result.result.movieId;
      } else if (result && result.timedtexttracks) {
        tracks = result.timedtexttracks;
        movieId = result.movieId;
      }

      if (tracks && Array.isArray(tracks) && tracks.length > 0) {
        // Build track list — Netflix 2026 structure:
        // - language field (not bcp47) e.g. "zh-Hant", "ja", "en"
        // - ttDownloadables.{format}.urls = [{cdn_id, url}, ...]
        // - Prefer text formats (simplesdh, dfxp-ls-sdh, imsc1.1) over image (nflx-cmisc)
        const trackList = tracks
          .filter(t => t.language && t.ttDownloadables && Object.keys(t.ttDownloadables).length > 0)
          .map(t => {
            let url = null;
            let format = null;
            let isImage = false;
            const dl = t.ttDownloadables;

            // Prefer text-based formats over image-based
            const textFormats = ['webvtt-lssdh-ios8', 'simplesdh', 'dfxp-ls-sdh', 'imsc1.1'];
            const imageFormats = ['nflx-cmisc'];
            const allFormats = Object.keys(dl);

            // Try known text formats first, then any unknown format, then image
            const tryOrder = [
              ...textFormats.filter(f => allFormats.includes(f)),
              ...allFormats.filter(f => !textFormats.includes(f) && !imageFormats.includes(f)),
              ...imageFormats.filter(f => allFormats.includes(f)),
            ];

            for (const fmt of tryOrder) {
              if (dl[fmt] && dl[fmt].urls && dl[fmt].urls.length > 0) {
                url = dl[fmt].urls[0].url;
                format = fmt;
                isImage = dl[fmt].isImage === true || imageFormats.includes(fmt);
                break;
              }
            }

            return {
              language: t.language,
              displayName: t.languageDescription,
              trackType: t.trackType,
              isForced: t.isForcedNarrative,
              url: url,
              format: format,
              isImage: isImage,
            };
          })
          .filter(t => t.url);

        console.log('[DualSubs:MAIN] Found', trackList.length, 'tracks with URLs:',
          trackList.map(t => `${t.language}(${t.format}${t.isImage ? ',img' : ''})`).join(', '));

        window.postMessage({
          type: 'DUAL_SUBS_TRACKS',
          tracks: trackList,
          movieId: movieId,
        }, '*');
      }
    } catch (e) {
      console.error('[DualSubs:MAIN] Error:', e);
    }
    return result;
  };

  const originalStringify = JSON.stringify;
  JSON.stringify = function (data) {
    try {
      if (data && data.params && data.params.showAllSubDubTracks !== undefined) {
        data.params.showAllSubDubTracks = true;
      }
    } catch (e) {}
    return originalStringify.apply(this, arguments);
  };

  // Keyboard shortcuts — hijack addEventListener to wrap Netflix's keydown handlers
  const ourKeys = new Set(['d', 's', 'e']);

  function handleOurKey(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return false;
    if (ourKeys.has(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.stopImmediatePropagation();
      e.preventDefault();
      window.postMessage({ type: 'DUAL_SUBS_KEY', key: e.key }, '*');
      return true;
    }
    return false;
  }

  // Register on window capture phase (earliest possible)
  window.addEventListener('keydown', handleOurKey, true);

  // Wrap addEventListener so ANY element's keydown listener checks our keys first
  const origAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (type === 'keydown' && typeof listener === 'function') {
      const wrapped = function (e) {
        if (handleOurKey(e)) return; // swallow if it's our key
        return listener.call(this, e);
      };
      return origAddEventListener.call(this, type, wrapped, options);
    }
    return origAddEventListener.call(this, type, listener, options);
  };

  console.log('[DualSubs:MAIN] Intercept installed');
})();
