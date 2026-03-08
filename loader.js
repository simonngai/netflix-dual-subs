// Loader — injects intercept.js into page context via <script> tag
// This is the classic reliable method that works across all Chrome versions

(function () {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('intercept.js');
  script.onload = function () {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
})();
