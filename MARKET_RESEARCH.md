# Market Research — Multi-Agent CLI Orchestration

## Competitive Landscape

### Direct Competitors (CLI Agent Orchestration)

#### 1. MCO (Multi-CLI Orchestrator)
- **Repo**: github.com/mco-org/mco — ~215 stars, MIT License
- **What it does**: Neutral orchestration layer that dispatches prompts to multiple AI
  coding agent CLIs in parallel, aggregates results, returns structured output.
- **Agents supported**: Claude Code, Codex CLI, Gemini CLI, OpenCode, Qwen Code
- **Coordination modes**: Parallel, Chain, Debate, Divide
- **Consensus engine (v0.9)**: Tracks agreement ratio, consensus score, confidence
- **Install**: `npm i -g @tt-a1i/mco`
- **Differentiation from our project**: MCO focuses on code review/analysis aggregation.
  Our project focuses on task decomposition and parallel implementation with git isolation.

#### 2. AWS CLI Agent Orchestrator (CAO)
- **Repo**: github.com/awslabs/cli-agent-orchestrator — ~333 stars
- **What it does**: Hierarchical supervisor-worker system managing multiple AI agent
  sessions in tmux terminals.
- **Agents supported**: Kiro CLI, Claude Code, Codex CLI, Gemini CLI, Kimi CLI, Copilot CLI
- **Orchestration patterns**: Handoff (sync), Assign (async), Send Message (direct)
- **Key differentiator**: Session-based isolation via tmux, flow scheduling
- **Install**: Python 3.10+, tmux 3.3+
- **Differentiation from our project**: CAO uses tmux for isolation; we use git worktrees.
  CAO is Python-based; we're Node.js. CAO requires tmux; we don't.

#### 3. VS Code Multi-Agent Development
- Native VS Code feature (Feb 2026) supporting Claude, Codex, Copilot, Gemini
  agents side-by-side in the Agent Sessions view.
- IDE-integrated, not CLI-based. Different target audience.

#### 4. DIY Swarm Pattern
- Documented practitioner pattern using Claude Code as orchestrator, delegating
  to Gemini CLI and Codex CLI via git worktrees and tmux.
- See: dev.to/elophanto — "How I Orchestrate Claude Code, Codex, and Gemini CLI as a Swarm"
- Ad-hoc scripts, not a reusable tool. Our project productizes this pattern.

---

### Framework-Level Solutions (Not CLI-Specific)

| Framework | Stars | CLI Agent Support | Verdict |
|-----------|-------|-------------------|---------|
| **AutoGen** (Microsoft) | High | No native CLI support. Wrappable. | Not a competitor |
| **CrewAI** | 44,300+ | No native CLI support. Role-based Python agents. | Different domain |
| **LangGraph** | High | Could wrap CLIs as tool nodes. Flexible. | Possible foundation |
| **AWS Agent Squad** | — | Routes conversations to specialized agents | API-level, not CLI |

**None of these natively orchestrate CLI agents.** They orchestrate LLM API calls
programmatically. CLI tools need custom wrappers. Our project is purpose-built for CLIs.

---

### Protocols & Standards

#### Google A2A (Agent-to-Agent Protocol)
- **Spec**: a2a-protocol.org — v0.3, 50+ partner companies
- **Design**: HTTP + SSE + JSON-RPC 2.0; v0.3 adds gRPC
- **Key concepts**: Agent Cards (capability discovery), Client-Remote model, Task lifecycle
- **Partners**: Atlassian, Confluent, Datadog, JetBrains, LangChain, Salesforce, SAP
- **Relevance**: The emerging standard for inter-agent communication. Heavy for local
  CLI orchestration, but essential for distributed/enterprise scenarios.
- **Our v2 opportunity**: Implementing A2A compliance would make our orchestrator
  interoperable with the broader agent ecosystem.

#### AGNTCY SLIM Protocol
- **Spec**: IETF Internet-Draft — purpose-built transport for agent protocols
- **Design**: gRPC over HTTP/2 and HTTP/3 with MLS encryption
- **Relevance**: Transport layer for A2A/MCP. Too early and too heavy for our POC.

---

### Market Size & Demand

| Metric | Value | Source |
|--------|-------|--------|
| Global AI agent market (2025) | $7.6-7.8B | Multiple analysts |
| Projected (2026) | $8.5-10.9B | Deloitte TMT |
| Projected (2030) | $35-52B | Industry consensus |
| CAGR | 46.3% | — |
| Enterprise apps with AI agents by end 2026 | 40% (up from <5% in 2025) | Gartner |
| CIOs considering agent AI strategic priority | 89% | Industry survey |
| Enterprises deploying autonomous agents by 2027 | 50% (up from 25% in 2025) | Gartner |

### Target Users

1. **Development teams** — leverage strengths of different AI agents simultaneously
2. **Enterprises avoiding vendor lock-in** — multi-vendor provides redundancy
3. **CI/CD pipelines** — automated multi-agent code review pre-human-review
4. **Security teams** — multiple agents for scanning = better coverage
5. **Platform engineering** — internal dev platforms with AI-augmented workflows

### Market Gap

> No tool yet provides a polished, production-grade, protocol-standardized
> orchestration layer for heterogeneous CLI agents with A2A compliance.
> MCO and CAO are early-stage. This is a clear whitespace opportunity.

---

### Competitive Positioning

```
                    CLI-Native
                        │
            MCO ●       │       ● Our Project
                        │
  Review/Analysis ──────┼────── Implementation/Tasks
                        │
          CAO ●         │
                        │
                  Framework-Based
```

**Our differentiation**:
- Git worktree isolation (not tmux)
- Task decomposition + parallel implementation (not just review)
- Pluggable communication layer (file → MQTT → A2A)
- Node.js (smaller footprint than Python + tmux dependency)
- Designed for future A2A protocol compliance

---

### Recommendation

**Build it.** The space is early, demand is validated (MCO 215 stars, CAO 333 stars,
VS Code feature shipped), and no solution covers the full spectrum from task decomposition
through parallel implementation to git merge. Our approach of adapter-based architecture
with swappable communication is differentiated and future-proof.

Evaluate MCO and CAO source code during development — there may be reusable patterns
for CLI invocation, output parsing, and error handling.
