# 🎙️ Vireo — AI Speech & Delivery Coach

**Vireo** is a real-time AI speech and delivery coach powered by the **Google Gemini Live API** (Multimodal WebSockets for live video, audio PCM, and real-time speech analysis) and **Gemini 3.6 Flash** (for comprehensive post-speech teardown reports).

> 🐦 **Why "Vireo"?**
> Named after the North American songbird known for its clear, melodious, and persistent singing. **Vireo** symbolizes articulate, confident, and engaging speech — empowering speakers to master their vocal delivery, cadence, and storytelling.

---

## 🚀 Quick Links & Local Testing URLs

When running locally (`npm run start`), access the services at:

| Component | URL | Description |
| :--- | :--- | :--- |
| **Web UI (Frontend)** | [`http://localhost:5173`](http://localhost:5173) | Interactive React + TypeScript user interface |
| **Backend Server** | [`http://localhost:3001`](http://localhost:3001) | Express REST API & session token authentication |
| **Health Check** | [`http://localhost:3001/api/health`](http://localhost:3001/api/health) | Verifies server status & API key configuration |
| **WebSocket Stream** | `ws://localhost:3001/ws/live` | Live WebSocket endpoint proxying to Gemini Live API |

---

## 🛠️ Codebase Language Breakdown

- **Client (`src/`)**: **100% TypeScript** (`.ts`, `.tsx`) with strict type definitions (`src/types/index.ts`).
- **Server (`server/`)**: **Node.js (ESM JavaScript)** with Express, `@google/genai` SDK, and native WebSocket proxying.
- **Styling**: Tailwind CSS with custom dark mode UI.

---

## ✨ Features

- 📹 **Live Media Streaming**: Captures camera video at 1 FPS (JPEG) and microphone audio at 16kHz PCM, sending real-time bi-directional chunks to Gemini Live.
- ⏱️ **Realtime Speech HUD**: Live feedback on speech pace (WPM), filler word rate, and structural pauses.
- 🤫 **Silent Live Mode & Active Rehearsal Mode**:
  - **Live Mode**: Silent coach that observes and transcribes without interrupting audio output.
  - **Rehearsal Mode**: Active voice coach that provides instant feedback when pacing exceeds thresholds.
- 📊 **Post-Session Teardown Analysis**: Powered by `gemini-3.6-flash`, analyzing speech structure, register/phrasing, wit/lightness, and generating actionable daily drills with exact transcript evidence verification.
- 🔄 **Transparent 15-Minute Session Chunking**: Automatically carries over conversation history across long-running sessions without dropping context.

---

## ⚙️ Getting Started

### 1. Prerequisites
- Node.js `v18+` or `v20+`
- A valid **Google Gemini API Key** ([Get your API key on Google AI Studio](https://aistudio.google.com/))

### 2. Environment Setup
Create a `.env` file in the root directory:
```env
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3001
```

### 3. Installation
Install root dependencies:
```bash
npm install
```

Install server dependencies:
```bash
cd server
npm install
cd ..
```

### 4. Running the Application
To launch both the backend server and frontend development server simultaneously:

```bash
npm run start
```

This will run:
- **Express Backend**: Listening on `http://localhost:3001`
- **Vite Dev Frontend**: Serving at `http://localhost:5173`

Open [`http://localhost:5173`](http://localhost:5173) in your browser, allow camera and microphone permissions, and start your coaching session!

---

## 🏗️ Project Architecture

```
vireo/
├── server/                   # Node.js WebSocket & Express Backend
│   ├── index.js              # Server entry point, Gemini Live WSS proxy & teardown endpoint
│   ├── prompts/              # Teardown & coaching system prompts
│   └── package.json
├── src/                      # 100% TypeScript React Frontend
│   ├── components/           # React Components (HUD, Story Bank, Bit Bank, Teardown)
│   ├── services/             # Live stream service & WebSockets management
│   ├── utils/                # Speech metrics engine, audio processor & video processor
│   ├── types/                # TypeScript interface and type declarations
│   ├── App.tsx               # Main application component
│   └── main.tsx              # React entry point
├── vite.config.ts            # Vite build configuration & WSS proxy rules
├── tsconfig.json             # TypeScript compiler settings
└── package.json              # Project scripts & dependencies
```

---

## 📜 License

MIT License
