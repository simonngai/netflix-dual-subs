const enabledEl = document.getElementById('enabled');
const primaryEl = document.getElementById('primaryLang');
const secondaryEl = document.getElementById('secondaryLang');
const positionEl = document.getElementById('position');
const posValEl = document.getElementById('posVal');
const fontSizeEl = document.getElementById('fontSize');
const sizeValEl = document.getElementById('sizeVal');
const opacityEl = document.getElementById('opacity');
const opValEl = document.getElementById('opVal');

// Load saved settings
chrome.storage.sync.get(['enabled', 'primaryLang', 'secondaryLang', 'position', 'fontSize', 'bgOpacity'], (data) => {
  enabledEl.checked = data.enabled !== false;
  if (data.primaryLang) primaryEl.value = data.primaryLang;
  if (data.secondaryLang) secondaryEl.value = data.secondaryLang;
  if (data.position) {
    positionEl.value = data.position;
    posValEl.textContent = data.position + '%';
  }
  if (data.fontSize) {
    fontSizeEl.value = data.fontSize;
    sizeValEl.textContent = data.fontSize + 'px';
  }
  if (data.bgOpacity) {
    opacityEl.value = data.bgOpacity;
    opValEl.textContent = data.bgOpacity + '%';
  }
});

// Save on change
enabledEl.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: enabledEl.checked });
});

primaryEl.addEventListener('change', () => {
  chrome.storage.sync.set({ primaryLang: primaryEl.value });
});

secondaryEl.addEventListener('change', () => {
  chrome.storage.sync.set({ secondaryLang: secondaryEl.value });
});

positionEl.addEventListener('input', () => {
  posValEl.textContent = positionEl.value + '%';
  chrome.storage.sync.set({ position: parseInt(positionEl.value) });
});

fontSizeEl.addEventListener('input', () => {
  sizeValEl.textContent = fontSizeEl.value + 'px';
  chrome.storage.sync.set({ fontSize: parseInt(fontSizeEl.value) });
});

opacityEl.addEventListener('input', () => {
  opValEl.textContent = opacityEl.value + '%';
  chrome.storage.sync.set({ bgOpacity: parseInt(opacityEl.value) });
});
