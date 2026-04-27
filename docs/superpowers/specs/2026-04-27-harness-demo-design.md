# Harness Engineering Demo Design

## Summary

This project is a teaching-oriented full-stack demo built around a deliberately simple TODO product. Its primary purpose is to make Harness Engineering visible. The application should show how an engineer designs the environment, clarifies intent, and builds feedback loops so an agent can act reliably.

The demo targets two audiences at once:
- Internal engineering teams that want a practical reference implementation
- External viewers who need a fast, concrete explanation of the pattern

The product surface stays intentionally small. The harness surface is the main feature.

## Goals

- Deliver a complete front end and back end application that is easy to run locally
- Show a visible harness lifecycle: intent normalization, planning, execution, checks, approval, and final state mutation
- Support two execution modes:
  - Demo mode with deterministic local execution for reliable presentations
  - Live mode with optional OpenAI API integration
- Keep business state and harness state clearly separated in both architecture and UI
- Make evaluation and intervention points legible to users without requiring them to inspect source code

## Non-Goals

- Building a feature-rich productivity app
- Simulating a general multi-agent operating system
- Hiding the control layer behind a polished but opaque UX
- Depending on live API access for the default experience

## Design Principles

The design follows the public OpenAI framing from February 11, 2026:
- Repository-local artifacts should be the system of record
- Constraints should be encoded as explicit, checkable rules
- The valuable engineering work is in scaffolding, not hand-writing application logic

In this demo, those principles translate to:
- Clear runtime boundaries between application state and harness state
- Structured intent and structured outcomes instead of free-form hidden behavior
- Evaluation before mutation
- Human review for risky changes
- Event traces that explain why the system acted the way it did

## User Experience

The application has two primary surfaces shown side by side on desktop and stacked on mobile.

### 1. Todo Workspace

This is the minimal product:
- Create, edit, complete, reprioritize, and archive tasks
- Set due dates and list membership
- View task status and simple metadata

This surface exists to provide believable state for the harness to act on. It should feel functional, but not dominate the demo.

### 2. Harness Panel

This is the teaching surface:
- Intent input for natural-language goals
- Structured intent summary showing goal, constraints, assumptions, and risk level
- Plan summary showing proposed actions
- Execution timeline showing each step and outcome
- Check results showing schema validation, policy validation, and scenario evaluation
- Approval drawer for gated actions
- Final mutation summary explaining exactly what changed

The harness panel should make it obvious that the system is not directly applying user text to business state.

## Core Interaction Flow

The main path is:

1. User submits a high-level intent such as "clean up overdue tasks" or "prepare next week's sprint board"
2. The back end converts that request into an `IntentSpec`
3. The harness engine creates an execution plan
4. The executor proposes business mutations
5. The evaluation loop runs before any write is committed
6. The system either applies safe changes, retries bounded failures, rejects invalid actions, or requests approval for risky actions
7. The timeline records every decision and outcome

This flow should be visible in the UI as:
- `Intent -> Plan -> Execute -> Check -> Approve`

## System Architecture

The project uses a separated front end and back end:
- Front end: React + TypeScript application
- Back end: FastAPI application
- Persistence: SQLite for local development and demo reliability

The back end is divided into two top-level domains.

### Todo Domain

Responsibility:
- Store and mutate canonical task data
- Enforce ordinary business rules unrelated to agent orchestration

Key capabilities:
- CRUD for tasks and task lists
- Bulk archive and status updates
- Audit-friendly mutation endpoints used by the harness engine

### Harness Engine

Responsibility:
- Turn user intent into structured execution
- Route execution through validation and approval loops
- Persist the observable control-plane history

Key capabilities:
- Intent normalization
- Plan creation
- Execution mode dispatch
- Policy evaluation
- Scenario evaluation
- Retry and approval decisions
- Event timeline persistence

### Separation Rule

TODO entities and harness entities must be stored separately. Business state answers "what tasks exist now?" Harness state answers "how did the system decide what to do?" That separation is central to the teaching value of the demo.

## Execution Modes

### Demo Mode

Default mode for local use and presentations.

Characteristics:
- No external API dependency
- Deterministic planner and executor behavior
- Stable sample outputs for known intent patterns
- Full compatibility with the same validation and approval pipeline used in live mode

Purpose:
- Make the app reliably demoable
- Let users inspect the harness behavior without provisioning credentials

### Live Mode

Optional mode enabled by configuration.

Characteristics:
- Uses OpenAI API for plan and execution proposal generation
- Must still produce structured outputs compatible with the same downstream checks
- Must never bypass policy validation, scenario evaluation, or approval gates

Purpose:
- Show that the harness is not a fake front end over static rules
- Demonstrate how the same environment can wrap a real model call

## Intent Model

Each user request is normalized into an `IntentSpec` with at least:
- Raw request text
- Goal
- Target scope
- Constraints
- Assumptions
- Risk level
- Success criteria
- Proposed action types

The UI should display this object in human-readable form so viewers can see the difference between raw intent and executable intent.

## Feedback Loop Design

The feedback loop is the core of the project.

### Schema Validation

Structured plan and action proposals must match expected shapes. Invalid structures stop execution immediately and are shown as blocked events.

### Policy Validation

The harness applies explicit rules such as:
- No destructive bulk action without approval
- No mutation of archived tasks unless explicitly requested
- No changes outside the inferred target scope
- No silent deletion of user-authored content

Policy failures should produce one of:
- Revise and retry
- Reject
- Approval required

### Scenario Evaluation

The system runs lightweight state-aware checks before commit. Examples:
- A cleanup request should not archive incomplete high-priority tasks
- A sprint setup request should not duplicate tasks already present in the target list
- A reschedule request should not create impossible dates

### Human Approval Gate

Risky actions should pause for review. The user can approve or reject with the result captured in the event timeline.

### Trace Timeline

Every stage writes structured events, including:
- Intent accepted
- Plan created
- Action proposed
- Validation passed or failed
- Retry requested
- Approval requested
- Mutation committed
- Mutation rejected

The timeline is both a debugging tool and the main teaching artifact.

## Data Model Direction

The initial implementation should include these entities.

Business entities:
- Task
- TaskList
- AuditEntry

Harness entities:
- IntentRun
- IntentSpec
- PlanStep
- ProposedMutation
- EvaluationResult
- ApprovalRequest
- TraceEvent

The implementation should keep these entities in separate modules and APIs where practical. `IntentSpec` may be stored either as a first-class table or as structured JSON attached to `IntentRun`, but the read API must expose it as its own object.

## API Shape

The initial implementation should include:
- Standard task CRUD endpoints
- Endpoint to submit a high-level intent
- Endpoint to fetch run details and timeline events
- Endpoint to approve or reject gated actions
- Endpoint to read the current execution mode
- Environment-based configuration to enable live mode when credentials are present

The API must make it obvious which endpoints belong to the product domain and which belong to the harness domain.

## Error Handling

The system should treat errors as observable control-plane events.

Requirements:
- Planner or executor failures must create trace events instead of silent 500-only failures
- Invalid live-mode model output must be surfaced as structured validation failure
- Retryable failures must stop after a bounded retry count and mark the run as failed
- Approval rejection must preserve the proposed mutation and reason for rejection in the run history
- Product-domain write errors must roll back the mutation and emit a failed commit event

## Front-End Behavior

The front end should prioritize legibility over flourish.

Requirements:
- Two clear surfaces: Todo Workspace and Harness Panel
- Fast visibility into what changed and why
- Distinct visual treatment for blocked, retried, approved, and committed states
- Responsive layout that preserves the teaching flow on smaller screens

The interface should feel like an operational tool, not a marketing site.

## Testing Strategy

The tests should prove not only that the TODO app works, but that the harness behaves correctly.

Required coverage areas:
- Intent normalization produces valid structured specs
- Demo mode execution produces stable proposed mutations for supported intents
- Policy rules block prohibited operations
- Approval gate blocks risky writes until user action
- Scenario evaluation catches invalid task mutations
- Business-state writes only happen after passing checks
- Front-end rendering reflects timeline and approval state correctly

The implementation should prefer focused tests around harness behavior over broad UI snapshot coverage.

## Documentation Requirements

The repository should include concise documentation that explains:
- What Harness Engineering means in the context of this demo
- Which parts of the application are product-plane vs control-plane
- How to run demo mode
- How to enable live mode
- Where feedback rules are defined

The repo should teach through local artifacts, not through external explanation alone.

## Acceptance Criteria

The project is successful when all of the following are true:
- A new user can run the project locally without external credentials
- The TODO app is functional enough to create realistic state
- A user can submit a natural-language goal and observe a full harness lifecycle
- Failed checks and approval gates are visible and understandable
- The same UI can demonstrate both demo mode and live mode
- The repository structure and documentation clearly express the engineering pattern being demonstrated

## Delivery Direction

The implementation should optimize for clarity, determinism, and demonstrability. When there is tension between adding product depth and making the harness easier to understand, the harness wins.
