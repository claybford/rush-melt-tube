# Rush Melt Tube - YouTube Summarizer
![](icons/icon-128.png)

---

**Rush Melt Tube** is a simple YouTube summarizer, which pulls the English transcript of the video if available - either one the creator uploaded, or an automatically-generated one - and processes it with an AI tool to summarize it.

The extension is ready to work with many AI API endpoints:
- Locally-hosted AI ([LM Studio](https://lmstudio.ai/), [Ollama](https://ollama.com/))
  - ```http://127.0.0.1:{port number}/v1/chat/completions```
- OpenAI (GPT-4o, etc) ([How to get an OpenAI API key](https://www.geeksforgeeks.org/how-to-get-your-own-openai-api-key/))
  - ```https://api.openai.com/v1/chat/completions```
- Anthropic (Claude 3.5 Sonnet, etc) ([Anthropic API key info](https://docs.anthropic.com/en/api/getting-started))
  - ```https://api.anthropic.com/v1/messages```
- Google (Gemini, etc)
  - ```https://generativelanguage.googleapis.com/v1beta/openai/chat/completions```
- Nvidia
  - ```https://integrate.api.nvidia.com/v1/chat/completions```
- Groq
  - ```https://api.groq.com/openai/v1/chat/completions```
- Huggingface inference endpoints (running on AWS)
  - ```https://*.aws.endpoints.huggingface.cloud/*```

***IMPORTANT*: The extension will not work without valid AI API endpoint settings, from one of these listed providers.**

To set up the extension with your AI API endpoint of choice:
- Open your Firefox settings.
- Select "Extensions and Themes" in the lower-left.
- Select "Extensions" in the top-left.
- Find Rush Melt Tube in the list and click on it.
- Select the "Options" tab.
- Input your:
  - ```AI API endpoint URL```
  - API key
  - Model Name
- Hit the save button and you are ready to go!

**To summarize a YouTube video in your current tab, simply click the extension's icon!** *Will only work on youtube.com.*

---
GPLv3

*Clayton Ford, 2024*

[Link to the Rush Melt Tube Firefox Add-On Page](https://addons.mozilla.org/en-US/firefox/addon/rush-melt-tube-yt-summarizer/)
