let processCounter = 0;
const activeProcesses = new Map(); // Maps process IDs to their cancellation status

async function getSettings() {
  const defaultSettings = {
    apiUrl: "https://api.openai.com/v1/chat/completions",
    apiKey: "",
    model: "gpt-4o",
    chunkSize: 1000,
    font: "Arial",
    fontSize: 14,
    textColor: "#e6db74",
    backgroundColor: "#263238",
    buttonColor: "#9dff00",
    buttonTextColor: "#263238",
  };

  const settings = await browser.storage.local.get(defaultSettings);
  if (!settings.apiKey) {
    throw new Error(
      "API key not configured. Please set it in the extension options."
    );
  }
  return settings;
}

async function getVideoTranscript(processId) {
  try {
    const getVideoId = () => {
      if (activeProcesses.get(processId))
        throw new Error("Operation cancelled");
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get("v");
    };

    const fetchCaptionTracks = async (videoId) => {
      if (activeProcesses.get(processId))
        throw new Error("Operation cancelled");
      const response = await fetch(
        `https://www.youtube.com/watch?v=${videoId}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch video page.");
      }
      const pageSource = await response.text();
      const captionsRegex = /"captions":({.*?})\s*,\s*"videoDetails"/s;
      const captionsMatch = pageSource.match(captionsRegex);
      if (!captionsMatch || captionsMatch.length < 2) {
        throw new Error("No captions metadata found.");
      }
      const rawCaptionsJson = captionsMatch[1];
      let captionsData;
      try {
        captionsData = JSON.parse(rawCaptionsJson);
      } catch (parseError) {
        throw new Error("Failed to parse captions metadata.");
      }
      return captionsData.playerCaptionsTracklistRenderer.captionTracks || [];
    };

    const fetchTranscriptXML = async (baseUrl) => {
      if (activeProcesses.get(processId))
        throw new Error("Operation cancelled");
      const response = await fetch(baseUrl);
      if (!response.ok) {
        throw new Error("Failed to fetch the transcript.");
      }
      const transcriptXml = await response.text();
      if (!transcriptXml.trim()) {
        throw new Error("No transcript available.");
      }
      return transcriptXml;
    };

    const parseTranscriptXML = (xmlString) => {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, "text/xml");
      if (xmlDoc.querySelector("parsererror")) {
        throw new Error("Error parsing transcript XML.");
      }
      const texts = xmlDoc.getElementsByTagName("text");
      let transcript = [];
      for (let text of texts) {
        transcript.push(text.textContent.trim());
      }
      return transcript.join(" ");
    };

    const videoId = getVideoId();
    if (!videoId) {
      throw new Error("No video ID found in the URL.");
    }

    const captionTracks = await fetchCaptionTracks(videoId);
    if (captionTracks.length === 0) {
      throw new Error("No caption tracks available.");
    }

    let selectedTrack = captionTracks.find(
      (track) => track.languageCode === "en" && !track.kind
    );
    if (!selectedTrack) {
      selectedTrack = captionTracks.find(
        (track) => track.languageCode === "en" && track.kind === "asr"
      );
    }
    if (!selectedTrack) {
      throw new Error(
        "No suitable caption track found (manual or auto-generated)."
      );
    }

    const transcriptXml = await fetchTranscriptXML(selectedTrack.baseUrl);
    if (activeProcesses.get(processId)) throw new Error("Operation cancelled");
    return parseTranscriptXML(transcriptXml);
  } finally {
  }
}

async function sendToAI(text, processId) {
  if (activeProcesses.get(processId)) throw new Error("Operation cancelled");

  try {
    const settings = await getSettings();
    const isAnthropicAPI = settings.apiUrl.includes("api.anthropic.com");

    await browser.runtime.sendMessage({
      type: "GETTING_SUMMARY",
    });

    const chunks = chunkText(text, settings.chunkSize);
    console.log(`Split transcript into ${chunks.length} chunks`);

    const progressBoxes = new Array(chunks.length).fill("▯");
    await browser.runtime.sendMessage({
      type: "GETTING_SUMMARY",
      detail: `Getting chunk summaries: ${progressBoxes.join("|")}`,
    });

    const chunkTasks = chunks.map((chunk, index) => {
      const isFirst = index === 0;
      const chunkNumber = index + 1;

      const prompt = isFirst
        ? `Please summarize this video transcript section (${chunkNumber}/${chunks.length}). This section may contain the video introduction. Focus on main points and keep the style structured in bullets, lists, etc as much as is logical, labeling any key sections you identify. Ignore sponsorships, include important details and steps of processes. Here is the section to summarize:\n\n${chunk}`
        : `Please summarize this independent section (${chunkNumber}/${chunks.length}) of a video transcript. This may be from any point in the video. Focus on main points and keep the style structured in bullets, lists, etc as much as is logical, labeling any key sections you identify. Ignore sponsorships, include important details and steps of processes. Here is the section to summarize:\n\n${chunk}`;

      const systemMessage = `You are summarizing part ${chunkNumber} of ${chunks.length} from a video transcript. Each part is being processed independently. Focus on clearly identifying the topics and information in your assigned section without making assumptions about other sections. Use clear section labels and structured formatting.`;

      return async () => {
        if (activeProcesses.get(processId))
          throw new Error("Operation cancelled");
        try {
          let requestBody;
          let headers;

          if (isAnthropicAPI) {
            // Anthropic API format
            requestBody = {
              model: settings.model,
              messages: [
                {
                  role: "user",
                  content: `${systemMessage}\n\n${prompt}`,
                },
              ],
              max_tokens: 1000,
            };

            headers = {
              "Content-Type": "application/json",
              "x-api-key": settings.apiKey,
              "anthropic-version": "2023-06-01",
            };
          } else {
            // OpenAI API format
            requestBody = {
              model: settings.model,
              messages: [
                {
                  role: "system",
                  content: systemMessage,
                },
                {
                  role: "user",
                  content: prompt,
                },
              ],
              max_tokens: 1000,
            };

            headers = {
              "Content-Type": "application/json",
              Authorization: `Bearer ${settings.apiKey}`,
            };
          }

          const response = await fetch(settings.apiUrl, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            throw new Error(
              `API error for chunk ${chunkNumber}: ${
                response.status
              } - ${await response.text()}`
            );
          }

          const data = await response.json();
          let summaryContent;

          if (isAnthropicAPI) {
            if (!data.content?.[0]?.text) {
              throw new Error(`Invalid API response for chunk ${chunkNumber}`);
            }
            summaryContent = data.content[0].text;
          } else {
            if (!data.choices?.[0]?.message?.content) {
              throw new Error(`Invalid API response for chunk ${chunkNumber}`);
            }
            summaryContent = data.choices[0].message.content;
          }

          progressBoxes[index] = "▮";
          await browser.runtime.sendMessage({
            type: "GETTING_SUMMARY",
            detail: `Getting chunk summaries: ${progressBoxes.join("|")}`,
          });

          return {
            index,
            summary: summaryContent,
          };
        } catch (error) {
          progressBoxes[index] = "✕";
          await browser.runtime.sendMessage({
            type: "GETTING_SUMMARY",
            detail: `Getting chunk summaries: ${progressBoxes.join("|")}`,
          });
          console.error(`Error processing chunk ${chunkNumber}:`, error);
          throw error;
        }
      };
    });

    if (activeProcesses.get(processId)) throw new Error("Operation cancelled");

    const concurrencyLimit = 10;
    const summaryResults = await runWithConcurrencyLimit(
      chunkTasks,
      concurrencyLimit
    );

    if (activeProcesses.get(processId)) throw new Error("Operation cancelled");

    const orderedSummaries = summaryResults
      .sort((a, b) => a.index - b.index)
      .map((result) => result.summary);

    await browser.runtime.sendMessage({
      type: "GETTING_SUMMARY",
      detail: "Getting complete summary...",
    });

    if (activeProcesses.get(processId)) throw new Error("Operation cancelled");

    const combinedSummary = await combineParallelSummaries(
      orderedSummaries,
      settings
    );

    if (!activeProcesses.get(processId)) {
      await browser.runtime.sendMessage({
        type: "SUMMARY_COMPLETE",
        summary: combinedSummary,
      });
    }
  } catch (error) {
    if (error.message === "Operation cancelled") {
      console.log("Processing cancelled by user");
      return;
    }
    console.error("AI API error:", error);
    if (!activeProcesses.get(processId)) {
      await browser.runtime.sendMessage({
        type: "SUMMARY_ERROR",
        error: error.message,
      });
    }
  }
}

// Helper function to run promises with concurrency limit
async function runWithConcurrencyLimit(tasks, limit) {
  const results = [];
  const executing = new Set();

  for (const task of tasks) {
    const promise = task().then((result) => {
      executing.delete(promise);
      return result;
    });

    executing.add(promise);
    results.push(promise);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

async function combineParallelSummaries(summaries, settings) {
  const isAnthropicAPI = settings.apiUrl.includes("api.anthropic.com");

  const combinedText = summaries
    .map((summary, index) => `Part ${index + 1}:\n${summary}`)
    .join("\n\n");

  const systemMessage =
    "You are combining independently summarized sections of a video transcript. Focus on clearly identifying the topics and information given to create a cohesive final summary that eliminates redundancy. Use clear section labels and structured formatting, maintaining consistent formatting and structure.";

  const userMessage = `Please combine these independent video transcript summary sections into a single, cohesive summary. Eliminate redundancies, keep the style structured in bullets, lists, etc as much as is logical, and ensure good logical cohesion that can be followed. Include important details and steps of processes. Here is the text of the independent summary sections to combine:\n\n${combinedText}`;

  let requestBody;
  let headers;

  if (isAnthropicAPI) {
    // Anthropic API format
    requestBody = {
      model: settings.model,
      messages: [
        {
          role: "user",
          content: `${systemMessage}\n\n${userMessage}`,
        },
      ],
      max_tokens: 2000,
    };

    headers = {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
    };
  } else {
    // OpenAI API format
    requestBody = {
      model: settings.model,
      messages: [
        {
          role: "system",
          content: systemMessage,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
      max_tokens: 2000,
    };

    headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    };
  }

  const response = await fetch(settings.apiUrl, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(
      `API error in combining summaries: ${
        response.status
      } - ${await response.text()}`
    );
  }

  const data = await response.json();

  if (isAnthropicAPI) {
    if (!data.content?.[0]?.text) {
      throw new Error("Invalid API response when combining summaries");
    }
    return data.content[0].text;
  } else {
    if (!data.choices?.[0]?.message?.content) {
      throw new Error("Invalid API response when combining summaries");
    }
    return data.choices[0].message.content;
  }
}

// Splitting text into chunks based on token estimation
function chunkText(text, maxTokens) {
  if (!maxTokens) {
    maxTokens = 1000; // Default if not provided
  }
  // Define an approximate token estimation function
  const estimateTokens = (str) => Math.ceil(str.length / 4); // Rough estimate: 1 token ≈ 4 characters

  const chunks = [];
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  let currentChunk = "";
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);

    // Check if adding this sentence would exceed the max tokens
    if (currentTokens + sentenceTokens > maxTokens) {
      if (currentChunk) {
        chunks.push(currentChunk.trim()); // Push the current chunk
        currentChunk = ""; // Reset chunk
        currentTokens = 0; // Reset token count
      }
    }

    // Add sentence to the current chunk
    currentChunk += sentence + " ";
    currentTokens += sentenceTokens;
  }

  // Push the final chunk if it exists
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

function convertHTMLStringToDOM(htmlString) {
  // Parse the HTML string without using innerHTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");
  const result = document.createElement("div");

  // Helper to create a clean copy of a node using only DOM methods
  function createCleanNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent);
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      // Create a new element of the same type
      const newElement = document.createElement(node.tagName);

      // Copy attributes
      Array.from(node.attributes).forEach((attr) => {
        // Only copy safe attributes (add more as needed)
        if (["class", "id", "style"].includes(attr.name)) {
          newElement.setAttribute(attr.name, attr.value);
        }
      });

      // Recursively handle child nodes
      Array.from(node.childNodes).forEach((child) => {
        newElement.appendChild(createCleanNode(child));
      });

      return newElement;
    }

    // Ignore other node types
    return null;
  }

  // Convert all child nodes from the body
  Array.from(doc.body.childNodes).forEach((node) => {
    const cleanNode = createCleanNode(node);
    if (cleanNode) {
      result.appendChild(cleanNode);
    }
  });

  return result;
}
function cleanupAllPopups() {
  const popups = document.querySelectorAll('[id^="transcript-summary-popup"]');
  popups.forEach((popup) => {
    popup.remove();
  });
  const styles = document.querySelectorAll("style[data-popup-style]");
  styles.forEach((style) => {
    style.remove();
  });
}
async function createPopup(message) {
  cleanupAllPopups();

  try {
    const settings = await getSettings();

    const popup = document.createElement("div");
    popup.id = "transcript-summary-popup";

    // Calculate half viewport width and ensure minimum/maximum sizes
    const halfViewport = Math.max(
      300,
      Math.min(800, Math.floor(window.innerWidth / 2))
    );
    const topMargin = 20; // Define margin explicitly for reuse
    const padding = 15; // Define padding explicitly for reuse

    popup.style.cssText = `
        position: fixed;
        top: ${topMargin}px;
        right: 20px;
        width: ${halfViewport}px;
        max-height: calc(100vh - ${(topMargin + padding) * 2}px);
        overflow-y: auto;
        background: ${settings.backgroundColor};
        padding-top: ${padding}px;
        padding-bottom: ${padding}px;
        padding-left: ${padding * 2}px;
        padding-right: ${padding * 2}px;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 10000;
        font-family: ${settings.font}, sans-serif;
        font-size: ${settings.fontSize}px;
        color: ${settings.textColor};
      `;

    const content = document.createElement("div");
    content.style.cssText = `
        margin-bottom: 10px;
        white-space: normal;
      `;

    // Convert markdown to HTML string, then to DOM
    const htmlString = parseMarkdown(message);
    const domContent = convertHTMLStringToDOM(htmlString);
    content.appendChild(domContent);

    // Calculate relative header sizes based on base font size
    const headerSizes = {
      h1: settings.fontSize * 2, // 200% of base size
      h2: settings.fontSize * 1.5, // 150% of base size
      h3: settings.fontSize * 1.25, // 125% of base size
      h4: settings.fontSize * 1.1, // 110% of base size
      h5: settings.fontSize * 1, // Same as base size
      h6: settings.fontSize * 0.9, // 90% of base size
    };

    // Add CSS for markdown styling
    const style = document.createElement("style");
    style.setAttribute("data-popup-style", "true");
    style.textContent = `
        #transcript-summary-popup h1 {
          font-size: ${headerSizes.h1}px;
          margin: ${headerSizes.h1 * 1.0}px 0 ${headerSizes.h1 * 1.0}px 0;
          font-weight: bold;
        }
        #transcript-summary-popup h2 {
          font-size: ${headerSizes.h2}px;
          margin: ${headerSizes.h2 * 1.0}px 0 ${headerSizes.h2 * 1.0}px 0;
          font-weight: bold;
        }
        #transcript-summary-popup h3 {
          font-size: ${headerSizes.h3}px;
          margin: ${headerSizes.h3 * 1.0}px 0 ${headerSizes.h3 * 1.0}px 0;
          font-weight: bold;
        }
        #transcript-summary-popup h4 {
          font-size: ${headerSizes.h4}px;
          margin: ${headerSizes.h4 * 1.0}px 0 ${headerSizes.h4 * 1.0}px 0;
          font-weight: bold;
        }
        #transcript-summary-popup h5 {
          font-size: ${headerSizes.h5}px;
          margin: ${headerSizes.h5 * 1.0}px 0 ${headerSizes.h5 * 1.0}px 0;
          font-weight: bold;
        }
        #transcript-summary-popup h6 {
          font-size: ${headerSizes.h6}px;
          margin: ${headerSizes.h6 * 1.0}px 0 ${headerSizes.h6 * 1.0}px 0;
          font-weight: bold;
        }
        #transcript-summary-popup ul, #transcript-summary-popup ol {
          margin: ${settings.fontSize * 0.5}px 0;
          padding-left: ${settings.fontSize * 1.0}px;
        }
        #transcript-summary-popup li {
          margin: ${settings.fontSize * 0.5}px 0;
          line-height: ${settings.fontSize * 1.2}px;
        }
        #transcript-summary-popup ul > li {
          list-style-type: disc;
        }
        #transcript-summary-popup ul > li > ul > li {
          list-style-type: circle;
        }
        #transcript-summary-popup ul > li > ul > li > ul > li {
          list-style-type: square;
        }
        #transcript-summary-popup ol > li {
          list-style-type: decimal;
        }
        #transcript-summary-popup ol > li > ol > li {
          list-style-type: lower-alpha;
        }
        #transcript-summary-popup ol > li > ol > li > ol > li {
          list-style-type: lower-roman;
        }
        #transcript-summary-popup p {
          margin: ${settings.fontSize * 0.5}px 0;
          line-height: ${settings.fontSize * 1.2}px;
        }
        #transcript-summary-popup strong {
          font-weight: bold;
        }
        #transcript-summary-popup em {
          font-style: italic;
        }
      `;
    document.head.appendChild(style);

    const closeButton = document.createElement("button");
    closeButton.textContent = "Close";
    closeButton.style.cssText = `
        padding: 5px 10px;
        background: ${settings.buttonColor};
        color: ${settings.buttonTextColor} !important;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        float: right;
        font-family: ${settings.font}, sans-serif;
        font-size: ${settings.fontSize}px;
      `;
    closeButton.onclick = () => {
      // Mark all active processes as cancelled
      for (const [processId, cancelled] of activeProcesses.entries()) {
        if (!cancelled) {
          activeProcesses.set(processId, true);
        }
      }

      cleanupAllPopups();
      window.removeEventListener("resize", updatePopupWidth);
    };

    popup.appendChild(content);
    popup.appendChild(closeButton);
    document.body.appendChild(popup);

    function updatePopupWidth() {
      const newHalfViewport = Math.max(
        300,
        Math.min(800, Math.floor(window.innerWidth / 2))
      );
      popup.style.width = `${newHalfViewport}px`;
    }

    window.addEventListener("resize", updatePopupWidth);
  } catch (error) {
    console.error("Error creating popup:", error);
    cleanupAllPopups();
    const errorPopup = document.createElement("div");
    errorPopup.id = "transcript-summary-popup";
    errorPopup.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        width: 300px;
        padding: 15px;
        background: #ffffff;
        color: #ff0000;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 10000;
      `;
    errorPopup.textContent = `Error loading settings: ${error.message}`;
    document.body.appendChild(errorPopup);
  }
}

function parseMarkdown(text) {
  const escapeHtml = (str) => {
    const entityMap = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return str.replace(/[&<>"']/g, (s) => entityMap[s]);
  };

  function processInlineFormatting(text) {
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__(.+?)__/g, "<strong>$1</strong>");
    text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
    text = text.replace(/_(.+?)_/g, "<em>$1</em>");
    return text;
  }

  const lines = text.split("\n");
  let html = "";
  let listStack = []; // Stack to keep track of list levels and types
  let lastIndentLevel = 0;
  let inList = false; // Track if we're in a list context
  let lastLineWasList = false; // Track if the previous line was a list item

  function getListIndentLevel(spaces) {
    return Math.floor(spaces.length / 2) + 1;
  }

  function closeListsToLevel(targetLevel) {
    let closingTags = "";
    while (listStack.length > targetLevel) {
      closingTags +=
        "</li>\n" +
        "  ".repeat(Math.max(0, listStack.length)) +
        "</" +
        listStack.pop() +
        ">\n";
    }
    return closingTags;
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // Headers
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      html += closeListsToLevel(0);
      inList = false;
      const level = headerMatch[1].length;
      const content = processInlineFormatting(
        escapeHtml(headerMatch[2].trim())
      );
      html += `<h${level}>${content}</h${level}>\n`;
      lastLineWasList = false;
      continue;
    }

    // Lists
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const [_, spaces, marker, content] = listMatch;
      const currentIndentLevel = getListIndentLevel(spaces);
      const isOrdered = /^\d+\./.test(marker);
      const listType = isOrdered ? "ol" : "ul";

      // If we're starting a new list
      if (
        !inList ||
        (lastLineWasList && currentIndentLevel === 1 && listStack.length === 0)
      ) {
        html += closeListsToLevel(0);
        inList = true;
        lastIndentLevel = 1;
        html += `<${listType} style="list-style-type: ${
          isOrdered ? "decimal" : "disc"
        }">\n`;
        listStack.push(listType);
        html += "  <li>" + processInlineFormatting(escapeHtml(content.trim()));
      } else if (currentIndentLevel > lastIndentLevel) {
        // Starting a nested list
        const indent = "  ".repeat(Math.max(0, lastIndentLevel));
        html = html.trimEnd();
        html +=
          "\n" +
          indent +
          `<${listType} style="list-style-type: ${
            isOrdered ? "decimal" : "disc"
          }">\n` +
          "  ".repeat(currentIndentLevel);
        listStack.push(listType);
        html += "<li>" + processInlineFormatting(escapeHtml(content.trim()));
      } else if (currentIndentLevel < lastIndentLevel) {
        // Moving back to a less nested level
        html += closeListsToLevel(currentIndentLevel);
        const indent = "  ".repeat(Math.max(0, currentIndentLevel));
        html +=
          indent + "<li>" + processInlineFormatting(escapeHtml(content.trim()));
      } else {
        // Same level, new list item
        const indent = "  ".repeat(Math.max(0, currentIndentLevel));
        html +=
          "</li>\n" +
          indent +
          "<li>" +
          processInlineFormatting(escapeHtml(content.trim()));
      }
      lastIndentLevel = currentIndentLevel;
      lastLineWasList = true;
      continue;
    }

    // Empty line - don't close the list if it's just a blank line between list items
    if (line.trim() === "") {
      if (!lastLineWasList) {
        html += closeListsToLevel(0);
        inList = false;
        lastIndentLevel = 0;
      }
      continue;
    }

    // Regular paragraph
    if (line.trim() !== "") {
      if (!lastLineWasList) {
        html += closeListsToLevel(0);
        inList = false;
        lastIndentLevel = 0;
        html += `<p>${processInlineFormatting(escapeHtml(line.trim()))}</p>\n`;
      } else {
        // This is content belonging to the last list item
        html += " " + processInlineFormatting(escapeHtml(line.trim()));
      }
    }
    lastLineWasList = false;
  }

  // Close any remaining open lists
  html += closeListsToLevel(0);
  return html;
}

// Handle messages from background script
browser.runtime.onMessage.addListener(async (message) => {
  if (message.action === "START_SUMMARY") {
    try {
      const processId = processCounter++;
      activeProcesses.set(processId, false); // false means not cancelled

      createPopup("Retrieving transcript...");
      const transcript = await getVideoTranscript(processId);
      if (!activeProcesses.get(processId)) {
        createPopup("Getting summary...");
        await sendToAI(transcript, processId);
      }
    } catch (error) {
      if (error.message !== "Operation cancelled") {
        console.error("Error:", error);
        createPopup(`Error: ${error.message}`);
      }
    }
  } else if (message.action === "UPDATE_POPUP") {
    const hasActiveProcess = Array.from(activeProcesses.values()).some(
      (cancelled) => !cancelled
    );
    if (hasActiveProcess) {
      createPopup(message.message);
    }
  }
});
