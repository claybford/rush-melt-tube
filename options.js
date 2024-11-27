// Validate hex color code
function isValidHex(hex) {
  return /^#[0-9A-Fa-f]{6}$/.test(hex);
}

// Get available system fonts
function getSystemFonts() {
  // Default web-safe fonts as fallback
  let fonts = [
    "Arial",
    "Arial Black",
    "Comic Sans MS",
    "Courier New",
    "Georgia",
    "Impact",
    "Times New Roman",
    "Trebuchet MS",
    "Verdana",
  ];

  // Try to get system fonts if available
  if (window.queryLocalFonts) {
    window
      .queryLocalFonts()
      .then((fontData) => {
        fonts = Array.from(
          new Set([...fonts, ...fontData.map((font) => font.family)])
        ).sort();
        populateFontDatalist(fonts);
      })
      .catch((err) => {
        console.warn("Could not query system fonts:", err);
        populateFontDatalist(fonts);
      });
  } else {
    populateFontDatalist(fonts);
  }
}

// Populate the datalist with font options
function populateFontDatalist(fonts) {
  const datalist = document.getElementById("systemFonts");
  datalist.innerHTML = "";
  fonts.forEach((font) => {
    const option = document.createElement("option");
    option.value = font;
    datalist.appendChild(option);
  });
}

// Update color preview elements
function updateColorPreview(inputId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(`${inputId}Preview`);
  const color = input.value;

  if (isValidHex(color)) {
    preview.style.backgroundColor = color;
    input.style.borderColor = "#ccc";
  } else {
    preview.style.backgroundColor = "transparent";
    input.style.borderColor = "#ff0000";
  }
}

// Update font preview
function updateFontPreview() {
  const fontInput = document.getElementById("font");
  const preview = document.getElementById("fontPreview");
  const fontFamily = fontInput.value;

  // Check if the font exists
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  const testText = "mmmmmmmmmmlli";
  const fallbackWidth = context.measureText(testText).width;

  context.font = `16px ${fontFamily}, 'invalid-font'`;
  const testWidth = context.measureText(testText).width;

  const fontExists = testWidth !== fallbackWidth;

  preview.style.fontFamily = `${fontFamily}, sans-serif`;
  preview.style.color = fontExists ? "inherit" : "#999";
  fontInput.style.borderColor = fontExists ? "#ccc" : "#ff9999";
}

// Live preview functionality
function updatePreview() {
  const preview = document.getElementById("preview");
  const previewButton = document.getElementById("previewButton");

  const fontFamily = document.getElementById("font").value;
  const fontSize = `${document.getElementById("fontSize").value}px`;

  // Apply font settings to both the preview container and button
  preview.style.fontFamily = `${fontFamily}, sans-serif`;
  preview.style.fontSize = fontSize;
  previewButton.style.fontFamily = `${fontFamily}, sans-serif`;
  previewButton.style.fontSize = fontSize;

  const textColor = document.getElementById("textColor").value;
  const backgroundColor = document.getElementById("backgroundColor").value;
  const buttonColor = document.getElementById("buttonColor").value;
  const buttonTextColor = document.getElementById("buttonTextColor").value;

  if (isValidHex(textColor)) {
    preview.style.color = textColor;
  }
  if (isValidHex(backgroundColor)) {
    preview.style.backgroundColor = backgroundColor;
  }
  if (isValidHex(buttonColor)) {
    previewButton.style.backgroundColor = buttonColor;
  }
  if (isValidHex(buttonTextColor)) {
    previewButton.style.color = buttonTextColor;
  }
}

// Save options to browser.storage
function saveOptions(e) {
  e.preventDefault();

  // Validate colors
  const colorInputs = [
    "textColor",
    "backgroundColor",
    "buttonColor",
    "buttonTextColor",
  ];
  for (const inputId of colorInputs) {
    const color = document.getElementById(inputId).value;
    if (!isValidHex(color)) {
      const status = document.getElementById("status");
      status.textContent = `Invalid hex color format for ${inputId}. Use format #RRGGBB`;
      status.className = "status error";
      status.style.display = "block";
      return;
    }
  }

  const settings = {
    apiUrl: document.getElementById("apiUrl").value,
    apiKey: document.getElementById("apiKey").value,
    model: document.getElementById("model").value,
    chunkSize: parseInt(document.getElementById("chunkSize").value),
    concurrentRequestLimit: parseInt(document.getElementById("concurrentRequestLimit").value),
    font: document.getElementById("font").value,
    fontSize: parseInt(document.getElementById("fontSize").value),
    textColor: document.getElementById("textColor").value,
    backgroundColor: document.getElementById("backgroundColor").value,
    buttonColor: document.getElementById("buttonColor").value,
    buttonTextColor: document.getElementById("buttonTextColor").value,
  };

  browser.storage.local
    .set(settings)
    .then(() => {
      const status = document.getElementById("status");
      status.textContent = "Settings saved successfully!";
      status.className = "status success";
      status.style.display = "block";
      setTimeout(() => {
        status.style.display = "none";
      }, 3000);
    })
    .catch((error) => {
      const status = document.getElementById("status");
      status.textContent = `Error saving settings: ${error.message}`;
      status.className = "status error";
      status.style.display = "block";
    });
}

// Restore options from browser.storage
function restoreOptions() {
  const defaultSettings = {
    apiUrl: "https://api.openai.com/v1/chat/completions",
    apiKey: "",
    model: "gpt-4o",
    chunkSize: 1000,
    concurrentRequestLimit: 10,
    font: "Arial",
    fontSize: 14,
    textColor: "#e6db74",
    backgroundColor: "#263238",
    buttonColor: "#9dff00",
    buttonTextColor: "#263238",
  };

  browser.storage.local
    .get(defaultSettings)
    .then((settings) => {
      // Restore all settings
      Object.keys(settings).forEach((key) => {
        const element = document.getElementById(key);
        if (element) {
          element.value = settings[key];
        }
      });

      // Update all previews
      updateFontPreview();
      [
        "textColor",
        "backgroundColor",
        "buttonColor",
        "buttonTextColor",
      ].forEach((id) => {
        updateColorPreview(id);
      });
      updatePreview();
    })
    .catch((error) => {
      console.error("Error loading settings:", error);
      const status = document.getElementById("status");
      status.textContent = `Error loading settings: ${error.message}`;
      status.className = "status error";
      status.style.display = "block";
    });
}

// Event listeners
document.addEventListener("DOMContentLoaded", () => {
  restoreOptions();
  getSystemFonts();
});

// Font input event listeners
const fontInput = document.getElementById("font");
fontInput.addEventListener("input", () => {
  updateFontPreview();
  updatePreview();
});

// Form submit listener
document
  .getElementById("settings-form")
  .addEventListener("submit", saveOptions);

// Color input event listeners
["textColor", "backgroundColor", "buttonColor", "buttonTextColor"].forEach(
  (id) => {
    const input = document.getElementById(id);
    input.addEventListener("input", () => {
      updateColorPreview(id);
      updatePreview();
    });
  }
);

// Font size input listener
document.getElementById("fontSize").addEventListener("input", updatePreview);
