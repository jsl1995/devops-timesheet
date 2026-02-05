// Content script to detect Azure DevOps theme
function detectTheme() {
  // Azure DevOps uses data-theme attribute on body
  const body = document.body;
  const dataTheme = body?.getAttribute('data-theme');
  
  // Also check for theme classes as fallback
  const isDarkClass = body?.classList.contains('dark-theme') || 
                      body?.classList.contains('vsts-dark');
  
  // Check computed background color as another fallback
  let isDarkBg = false;
  if (body) {
    const bg = getComputedStyle(body).backgroundColor;
    const match = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const [, r, g, b] = match.map(Number);
      // Dark theme typically has low RGB values
      isDarkBg = (r + g + b) / 3 < 128;
    }
  }
  
  // Determine theme
  if (dataTheme) {
    return dataTheme.toLowerCase().includes('dark') ? 'dark' : 'light';
  }
  if (isDarkClass) return 'dark';
  if (isDarkBg) return 'dark';
  
  return 'light';
}

function sendTheme() {
  const theme = detectTheme();
  chrome.runtime.sendMessage({ type: 'THEME_DETECTED', theme });
}

// Detect theme on load
sendTheme();

// Watch for theme changes (Azure DevOps can change theme dynamically)
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'attributes' && 
        (mutation.attributeName === 'data-theme' || mutation.attributeName === 'class')) {
      sendTheme();
      break;
    }
  }
});

if (document.body) {
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'class'] });
}
