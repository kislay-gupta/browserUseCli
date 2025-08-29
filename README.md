## Browser Automation CLI (Playwright + OpenAI Agents)

Automates filling and submitting web forms using Playwright and the OpenAI Agents SDK. It launches a Chromium browser, navigates to a target page, auto-detects relevant form fields, fills them with user-provided input, and submits. Screenshots are saved locally for each run.

### Features

- Auto-detects the primary form on a page and fills by label/name/placeholder
- Heuristic mapping for common fields: first name, last name, email, password, confirm password
- Falls back to robust selectors if labels are ambiguous
- Clicks submit buttons by visible text or submit input types
- Saves a screenshot after actions

### Prerequisites

- Node.js 18+ (tested with Node 23)
- A valid OpenAI API key
- Windows, macOS, or Linux with Chromium available (Playwright downloads it automatically)

### Installation

```bash
npm install
```

### Environment

Create a `.env` file in the project root:

```bash
OPENAI_API_KEY=your_openai_api_key_here
```

### Run

```bash
node app.js
```

Follow the prompts:

- First Name
- Last Name
- Email
- Password (hidden)

The app will:

1. Launch Chromium
2. Navigate to `https://ui.chaicode.com/auth/signup`
3. Use `auto_fill_form` to detect and fill the form
4. Submit the form
5. Save a screenshot like `screenshot-<timestamp>.png` in the project root

### Project Structure

- `app.js` — Main script; defines tools and the agent, and runs the flow
- `package.json` — Dependencies and project metadata
- `screenshot-*.png` — Output screenshots from runs

### Key Tools (Internal)

- `auto_fill_form` — Detects the main form, maps and fills fields from provided data, then submits
- `fill_field` — Fills a single field by label/placeholder/name/id heuristics
- `click_by_text` — Clicks a button by visible text
- `get_dom` — Extracts simplified DOM info of inputs/buttons (no args)
- `screenshot` — Saves a PNG screenshot to disk

### Troubleshooting

- 400 Invalid schema errors: The Agents API enforces strict JSON schema. All tools define `parameters` with `type`, `properties`, `required`, and `additionalProperties: false`. If you add or modify tools, ensure:
  - Every `properties` object has a `required` array listing keys that must be present
  - Include `additionalProperties: false` on each object level (including nested ones)
  - For zero-argument tools, set `properties: {}`, `required: []`
- Navigation timeouts: Re-run; ensure the target URL is reachable. You can increase waits or change `waitUntil` strategy in `open_url`.
- Inputs not filled: The page might use non-standard markup. Add specific heuristics or selectors to `auto_fill_form`/`fill_field`.

### Notes

- The model used is `gpt-4.1-mini` via the OpenAI Agents SDK.
- Browser is run non-headless for visibility; adjust in `app.js` if needed.

### License

MIT
