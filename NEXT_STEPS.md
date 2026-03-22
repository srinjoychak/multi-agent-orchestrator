# Next Steps — Multi-Agent Orchestrator

_Last updated: 2026-03-20 by Claude Sonnet 4.6 (Tech Lead)_

---

## Where We Are Now

- **171 tests pass** (170 pass, 1 skip)
- **Phase 3 chat-driven step commands** fully implemented and merged (PR #5)
- **Platform abstraction** centralised in `platform/detect.js` — single source of truth for `IS_WINDOWS`, `IS_LINUX`, `IS_MAC`, `platformExec()`
- **`_getChangedFiles`** in both adapters uses `platformExec` (T3 done)
- **`reject` verb** re-queues tasks as `pending` with rejection feedback appended (T1 done)
- **Session state** persists phase, reviews, and prompt across invocations in `.agent-team/session.json`
- **`agents.json`** controls capability routing without touching code

---

## Phase 3: Chat-Driven Orchestration ✅ DONE

All items complete:

- [x] Split orchestrator into `core.js` (library) + `index.js` (verb router)
- [x] Session state (`session.json`) — phases: decomposed → assigned → executing → reviewing → merged → complete
- [x] CLI verbs: `decompose`, `assign`, `execute`, `status`, `accept`, `reject`, `merge`, `report`, `run`
- [x] `reject` re-queues task as pending with rejection reason appended to description
- [x] `agents.json` — project-level capability config replaces hardcoded adapter arrays
- [x] `platform/detect.js` — centralised `IS_WINDOWS` + `platformExec()`
- [x] `_getChangedFiles` in `gemini.js` and `claude-code.js` uses `platformExec`
- [x] Step tests (`steps.test.js`) — 30 tests covering all step modules
- [x] CLI verb tests (`index.test.js`) — covers all verb routes in `index.js`
- [x] README updated for Phase 3 as primary usage model
- [x] `import.meta.url` guard — `main()` only runs when executed directly

---

## Phase 4: Stability & Hardening

| Task | Status | Notes |
|------|--------|-------|
| Decompose fallback (manual task seeding) | Todo | When LLM decompose fails, allow user to provide tasks.json directly |
| Session cleanup on new `decompose` | Todo | Running `decompose` twice should reset session + tasks cleanly |
| Gemini file-write reliability | Todo | Gemini CLI sometimes returns planning text without writing files; needs prompt hardening |
| `--output-format json` compatibility matrix | Todo | Validate Gemini + Claude output formats as CLI versions change |
| Retry count enforcement | Todo | `max_retries` is stored but not enforced in the execute step |
| Worktree cleanup on abort | Todo | Orphaned worktrees accumulate if tasks are interrupted |

---

## Phase 5: MQTT Transport (v2)

Replace `FileCommChannel` with `MqttCommChannel` (Mosquitto) to enable multi-machine agent teams.

| Item | Notes |
|------|-------|
| `src/comms/mqtt.js` | Implement `CommChannel` interface over MQTT.js |
| Topic structure | `team/{id}/tasks/created`, `claimed`, `status`, `agent/{name}/inbox`, `broadcast`, `heartbeat` |
| `docker-compose.yml` | Local Mosquitto broker for dev/test |
| Transport flag | `--transport mqtt` in CLI, falls back to file if no broker |
| Only after | Phase 4 stability work is complete |

---

## Phase 6: A2A Protocol

Implement Google's [Agent-to-Agent (A2A) protocol](https://github.com/google/A2A) so this orchestrator can interop with other A2A-compatible agent frameworks.

- Only after Phase 5 MQTT is stable
- The `CommChannel` interface makes this a transport swap, not an architecture change

---

## Decisions to Revisit

| Decision | Current State | Revisit When |
|----------|--------------|--------------|
| File locking via `lockfile` | Works; single-machine only | Before MQTT/multi-machine |
| `--dangerously-skip-permissions` | Required for worktree execution | When Claude adds worktree permission mode |
| Round-robin task assignment | Simple but ignores agent load | When >2 agents or long tasks |
| `results.json` as merge output | Flat file | When streaming results needed |
| `done: ['pending']` transition | Needed for reject re-queue | If task state machine is revisited |
