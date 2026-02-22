# Ephileo

**Your personal Jarvis, running entirely on your machine.**

Ephileo is an AI agent that doesn't just chat — it *does things*. It reads your files, runs commands, browses the web, and writes down what it learns. All powered by AI models running locally on your hardware, so your data never leaves your machine.

Think of it like having a smart assistant that lives inside your terminal. You tell it what to do, and it figures out the steps, uses the right tools, and gets it done.

## What can it do?

Right now (Phase 1):

- **Chat** with a local AI model through your terminal
- **Read and write files** on your computer
- **Run shell commands** and show you the results
- **Learn and remember** — saves discoveries to a journal you can review
- **Think out loud** — watch the AI's reasoning process live as it works (press `h` to toggle)

Coming soon:

- **Browse the web** — search, read pages, extract information (Phase 2)
- **Run tasks in the background** — give it a job and check back later (Phase 3)
- **Control IoT devices** — smart home, sensors, automation (Phase 4)
- **Connect with other apps** — calendar, email, notes, and more (Phase 5)

## How it works

```
You type a request
        |
        v
   ┌─────────┐
   │  Ephileo │  Looks at your request and decides what to do
   │  (Brain) │  Picks a tool, runs it, reads the result
   │          │  Repeats until the task is complete
   └────┬─────┘
        │
   ┌────┴─────────────────────────┐
   │         Available Tools       │
   │                               │
   │  read_file    write_file     │
   │  shell        list_directory │
   │  save_learning               │
   │  (more coming soon)          │
   └───────────────────────────────┘
        │
   ┌────┴─────┐
   │ Local LLM │  Runs on your machine (exo, ollama, etc.)
   │ No cloud  │  Your data stays private
   └───────────┘
```

## Quick start

**You need:**
- [Node.js](https://nodejs.org/) 22 or newer
- A local LLM running — either [exo](https://github.com/exo-explore/exo) or [ollama](https://ollama.com/)

**Steps:**

```bash
# 1. Clone the repo
git clone https://github.com/yourusername/ephileo.git
cd ephileo

# 2. Install dependencies
cd core
npm install

# 3. Set up your config
cp ../config/config.example.yaml ../config/config.yaml
# Edit config.yaml to match your LLM setup (see Configuration below)

# 4. Run it
npx tsx src/cli/index.ts
```

You should see:

```
Ephileo v0.1 — Local AI Agent
Provider: exo (mlx-community/Qwen3-30B-A3B-4bit)
Tools: read_file, write_file, list_directory, shell, save_learning
Press h while thinking to toggle thought visibility.
Type "quit" to exit.

you>
```

Type something like `what files are in my home directory?` and watch it work.

## Configuration

All settings live in `config/config.yaml`. Copy the example to get started:

```bash
cp config/config.example.yaml config/config.yaml
```

### Switch between AI providers

Change one line to switch which AI model Ephileo uses:

```yaml
# Use your local exo cluster
provider: exo

# Or switch to ollama
provider: ollama

# Or use a cloud provider via OpenRouter
provider: openrouter
```

### Add providers

```yaml
providers:
  exo:
    baseUrl: http://localhost:52415/v1
    model: mlx-community/Qwen3-30B-A3B-4bit

  ollama:
    baseUrl: http://localhost:11434/v1
    model: qwen3:30b-a3b

  openrouter:
    baseUrl: https://openrouter.ai/api/v1
    model: anthropic/claude-sonnet-4
    apiKey: sk-or-your-key-here

  gemini:
    baseUrl: https://generativelanguage.googleapis.com/v1beta/openai
    model: gemini-2.5-flash
    apiKey: your-key-here
```

You can also override settings with environment variables:

```bash
EPHILEO_PROVIDER=ollama npx tsx src/cli/index.ts
```

## Project structure

```
ephileo/
├── config/                  # Configuration
│   ├── config.example.yaml  # Template (edit and copy to config.yaml)
│   ├── config.yaml          # Your config (gitignored, may contain keys)
│   └── loader.ts            # Reads config, exports typed object
│
├── core/                    # TypeScript — the brain
│   └── src/
│       ├── agent/           # The agent loop (the heart of everything)
│       ├── llm/             # Talks to AI models (OpenAI-compatible API)
│       ├── tools/           # What the agent can do (file ops, shell, etc.)
│       ├── cli/             # Terminal interface
│       ├── daemon/          # (coming) Background task runner
│       └── memory/          # (coming) Conversation persistence
│
├── workers/                 # Python — the hands (coming)
│   ├── browser/             # Web browsing via Playwright
│   └── iot/                 # IoT device control
│
└── memory/                  # What Ephileo has learned
    └── learnings.md         # Auto-generated journal of discoveries
```

## Keyboard shortcuts

While Ephileo is thinking:

| Key | Action |
|-----|--------|
| `h` | Toggle thinking visibility (show/hide the AI's reasoning) |
| `Ctrl+C` | Stop and exit |

## Roadmap

| Phase | What | Status |
|-------|------|--------|
| 1 | CLI agent with tools, streaming, config | Done |
| 2 | Browser automation (Playwright) | Next |
| 3 | Background daemon + task queue | Planned |
| 4 | IoT device integration | Planned |
| 5 | App integrations (calendar, email) | Planned |
| 6 | Web UI dashboard | Planned |
| 7 | Voice interface | Planned |

## Contributing

This project is in early development. If you're interested in building a local-first AI agent, contributions are welcome.

- **Found a bug?** Open an issue.
- **Want to add a tool?** Look at `core/src/tools/basic.ts` for examples — each tool is a simple function with a JSON schema.
- **Want to add a provider?** Add an entry to `config/config.example.yaml` — any OpenAI-compatible API works.

## License

MIT
