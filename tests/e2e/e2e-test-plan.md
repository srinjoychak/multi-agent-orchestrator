# E2E Test Plan: MCP Server

## Overview
This document outlines the End-to-End (E2E) testing strategy for the Model Context Protocol (MCP) server. The server implements a JSON-RPC over stdio interface.

## JSON-RPC Interface
The MCP server communicates using JSON-RPC 2.0 over standard input and output (stdio).
- **Requests**: Sent via stdin as JSON objects containing `jsonrpc: "2.0"`, an `id`, a `method`, and optionally `params`.
- **Responses**: Sent via stdout as JSON objects matching the request `id`, containing either a `result` object or an `error` object.
- **Notifications**: Sent as JSON objects without an `id`.

## Special Server Behaviors
### 1. Single-Instance Guard Test
- **Given** an MCP server is already running.
- **When** a second instance of the MCP server is launched.
- **Then** the second server must exit immediately with exit code `1`.

### 2. Inode-Safety Test
- **Given** the Current Working Directory (CWD) of a process is inside the `stateDir`.
- **When** a reset or cleanup operation occurs on the `stateDir`.
- **Then** the operation must safely handle the open directory handle without crashing, ensuring inode integrity.

### 3. Agent Routing Test
- **Given** a series of tasks are submitted to the orchestration engine.
- **When** the router distributes these tasks.
- **Then** tasks must be routed correctly matching a 70% Gemini and 30% Claude distribution split.

## MCP Tools Testing

### 1. orchestrate
- **Purpose**: Start a new orchestrated task with the given parameters.
- **Inputs**: Task definition, parameters.
- **Expected Output**: A unique task ID and initial status.
- **Scenarios**:
  - **Happy Path**: 
    - **Given** valid task parameters.
    - **When** `orchestrate` is called.
    - **Then** the server returns a valid task ID and initiates the task.
  - **Error Case**: 
    - **Given** missing or invalid task parameters.
    - **When** `orchestrate` is called.
    - **Then** the server returns a JSON-RPC error indicating validation failure.

### 2. task_status
- **Purpose**: Retrieve the current status of an ongoing or completed task.
- **Inputs**: Task ID.
- **Expected Output**: Status details (e.g., running, completed, failed, pending).
- **Scenarios**:
  - **Happy Path**: 
    - **Given** an existing task ID.
    - **When** `task_status` is called.
    - **Then** the server returns the current status object.
  - **Error Case**: 
    - **Given** a non-existent task ID.
    - **When** `task_status` is called.
    - **Then** the server returns an error indicating the task was not found.

### 3. task_diff
- **Purpose**: Get the differences or changes proposed by a task.
- **Inputs**: Task ID.
- **Expected Output**: A diff representation (e.g., git patch or file differences).
- **Scenarios**:
  - **Happy Path**: 
    - **Given** a completed task that generated changes.
    - **When** `task_diff` is called.
    - **Then** the server returns the generated diff.
  - **Error Case**: 
    - **Given** a task that hasn't generated changes yet.
    - **When** `task_diff` is called.
    - **Then** the server returns an appropriate error or empty diff notification.

### 4. task_accept
- **Purpose**: Accept the changes proposed by a task.
- **Inputs**: Task ID.
- **Expected Output**: Confirmation of acceptance and application of changes.
- **Scenarios**:
  - **Happy Path**: 
    - **Given** a task with pending changes.
    - **When** `task_accept` is called.
    - **Then** changes are applied and success is returned.
  - **Error Case**: 
    - **Given** a task ID that is not in a reviewable state.
    - **When** `task_accept` is called.
    - **Then** the server returns an invalid state error.

### 5. task_reject
- **Purpose**: Reject the changes proposed by a task.
- **Inputs**: Task ID, optional rejection reason.
- **Expected Output**: Confirmation of rejection.
- **Scenarios**:
  - **Happy Path**: 
    - **Given** a task with pending changes.
    - **When** `task_reject` is called.
    - **Then** changes are discarded and success is returned.
  - **Error Case**: 
    - **Given** a task ID that has already been accepted/rejected.
    - **When** `task_reject` is called.
    - **Then** the server returns a state transition error.

### 6. task_logs
- **Purpose**: Retrieve the execution logs for a specific task.
- **Inputs**: Task ID, optional log range/pagination.
- **Expected Output**: Log entries as strings.
- **Scenarios**:
  - **Happy Path**: 
    - **Given** an existing task with logs.
    - **When** `task_logs` is called.
    - **Then** the server returns the requested log lines.
  - **Error Case**: 
    - **Given** an invalid task ID.
    - **When** `task_logs` is called.
    - **Then** an error is returned.

### 7. task_kill
- **Purpose**: Abort a currently running task.
- **Inputs**: Task ID.
- **Expected Output**: Confirmation that the task has been stopped.
- **Scenarios**:
  - **Happy Path**: 
    - **Given** a currently running task.
    - **When** `task_kill` is called.
    - **Then** the task process is terminated and status updates to aborted.
  - **Error Case**: 
    - **Given** a task that is already completed.
    - **When** `task_kill` is called.
    - **Then** the server returns a non-applicable error.

### 8. workforce_status
- **Purpose**: Retrieve the overall status of the orchestration workforce (agents available, load, etc.).
- **Inputs**: None.
- **Expected Output**: An object detailing active agents, queued tasks, and system load.
- **Scenarios**:
  - **Happy Path**: 
    - **Given** the server is running.
    - **When** `workforce_status` is called.
    - **Then** the server returns current workforce metrics.
  - **Error Case**: 
    - **Given** the workforce manager encounters an internal fault.
    - **When** `workforce_status` is called.
    - **Then** the server returns an internal error code.