# Feedback Facilitator

Collect structured feedback on prototypes, designs, and documents — then synthesize it with AI.

Built with React + Vite. Data stored in localStorage (with optional Supabase backend).

---

## Features

- **Feedback requests** — Create structured requests with titles, context, and embedded content (YouTube, Figma, Loom, images, PDFs, code, text)
- **Question types** — Likert scale, open-ended (with voice input), emoji reactions, multiple choice
- **Hotspots** — Draw attention to specific regions of your content per question
- **Pre-bias capture** — Collect unprimed reactions before showing the full brief
- **Reviewer experience** — No login required to leave feedback
- **AI synthesis** — Summarize responses into themes, sentiment, and action items via Claude
- **Slack distribution** — Share review links directly to Slack channels
- **Teams** — Create teams, invite members with shareable codes, manage roles
- **CSV export** — Export response data from results
- **Drag-and-drop reordering** — Rearrange content items and questions

---

## Getting Started

### Prerequisites

- Node.js 18+

### Install and run

```bash
npm install
npm run dev
```

The app runs at `http://localhost:5173/feedback-facilitator/`.

### Build for production

```bash
npm run build
npm run preview
```

---

## Configuration

Open **Settings** (gear icon in the top bar) to configure:

| Setting | Purpose |
|---------|---------|
| **Anthropic API key** | Powers AI synthesis of feedback responses using Claude |
| **Slack webhook URL** | Enables "Send to Slack" distribution for review links |

Both are stored in localStorage on the user's browser.

### Optional environment setup

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth sign-in (for @artium.ai users) |
| `SUPABASE_URL` + `SUPABASE_ANON_KEY` | Persistent backend storage (replaces localStorage) |

These are set as constants at the top of `src/App.jsx`.

---

## How It Works

### 1. Create a request

Navigate to **Create** and fill out:

- **Title & context** — what you're getting feedback on and why
- **Content** — add URLs (auto-embeds YouTube, Figma, Loom), upload images/PDFs, or paste text/code
- **Pre-bias questions** — optional questions shown before the content to capture unprimed thoughts
- **Questions** — build your question set using any combination of types
- **Hotspots** — optionally highlight a focus area per question
- **Sharing** — set visibility (private, team, external) and deadline

### 2. Collect feedback

Share the review link with reviewers. They walk through:

1. Name entry
2. Pre-bias questions (if any)
3. First impression (emoji reaction)
4. Each question with content preview
5. Closing thoughts
6. Submit

Reviewers do not need an account.

### 3. View results

Open **Results** for a request to see:

- Individual responses with full answer details
- Response count and new-response indicators
- AI synthesis (themes, sentiment, action items) — click **Synthesize** to generate
- CSV export of all response data

Results auto-poll for new responses every 30 seconds.

---

## Project Structure

```
src/
  App.jsx       # All components, views, styles, and logic
  main.jsx      # React DOM entry point
public/
  favicon.svg
index.html
vite.config.js
package.json
```

---

## Tech Stack

- **React 19** — UI framework
- **Vite** — Build tool and dev server
- **Claude API** — AI feedback synthesis (client-side, user provides key)
- **Web Speech API** — Voice input for open-ended questions
- **localStorage** — Default data persistence
