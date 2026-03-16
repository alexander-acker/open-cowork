---
name: plan-review-mode
description: >
  Structured plan review workflow that must complete BEFORE any code changes.
  Enforces Step 0 (restate goal + survey current state), a 100% coverage test
  diagram, and opinionated recommendations with tradeoff analysis. Use when:
  (1) user says "plan review mode", "review this plan", "review mode",
  (2) user says "review this spec", "before we implement", "let's plan this
  feature", "let's think before coding", "review before building",
  (3) user shares a feature spec or implementation plan and asks for review.
  Do NOT auto-trigger on every feature request -- only when review is explicitly
  requested or naturally implied by pre-implementation language.
---

# Plan Review Mode

Review the plan thoroughly before making any code changes. For every issue or
recommendation, explain concrete tradeoffs, give an opinionated recommendation,
and ask for user input before assuming a direction.

## Priority Hierarchy

If running low on context or asked to compress, preserve in this order:

1. **Step 0** (never skip)
2. **Test diagram** (never skip)
3. **Opinionated recommendations**
4. Everything else

## Workflow

### Step 0: Understand Before Analyzing

Complete BOTH parts before any recommendations or test planning.

**Step 0a -- Restate the goal.**
State what is being solved and why, in your own words. Confirm alignment with
the user before proceeding. If the goal is ambiguous, ask -- do not guess.

**Step 0b -- Survey current state.**
Identify what exists today that is relevant: code, architecture, constraints,
dependencies, prior art. Call out anything that conflicts with or already
solves part of the plan.

Format:
```
## Step 0a: Goal
[Restatement of what we're solving and why]

## Step 0b: Current State
- **Relevant code:** [files, modules, patterns]
- **Constraints:** [technical, product, timeline]
- **Prior art:** [existing solutions, partial implementations]
- **Conflicts:** [anything that contradicts the plan]
```

### Test Diagram: 100% Coverage Plan

Map every test case BEFORE writing code. Cover:

- Happy paths
- Edge cases and boundary conditions
- Error cases and failure modes
- Integration points between components
- Regression risks from the change

Format as a structured list or table:
```
## Test Diagram

| # | Scenario | Type | Covers |
|---|----------|------|--------|
| 1 | [description] | unit/integration/e2e | [what it proves] |
| 2 | ... | ... | ... |
```

Mark gaps explicitly: "No test exists for X -- adding one."

### Opinionated Recommendations

For every issue or decision point found during review, provide all three:

1. **Tradeoff analysis** -- concrete pros/cons of each option
2. **Opinionated recommendation** -- pick one and say why
3. **Question for user** -- ask before assuming the direction

Format:
```
### [Issue Title]

**Options:**
- A: [option] -- [pro] / [con]
- B: [option] -- [pro] / [con]

**Recommendation:** [A or B] because [reason].

**Your call:** [specific question]
```

## Engineering Preferences

Apply these as evaluation criteria when reviewing plans and making
recommendations:

- **DRY** -- flag repetition aggressively
- **Well-tested** -- too many tests > too few; testing is non-negotiable
- **Engineered enough** -- not fragile/hacky, not over-abstracted/complex
- **Edge cases** -- handle more, not fewer; thoughtfulness > speed
- **Explicit > clever** -- bias toward readable, obvious code
- **Minimal diff** -- achieve the goal with the fewest new abstractions and files touched

## Anti-Patterns

- Do not start writing code before completing Step 0 and the test diagram.
- Do not present recommendations without tradeoffs and a question.
- Do not assume a direction when two valid options exist -- ask.
- Do not skip edge cases to save time.
- Do not add abstractions that the plan does not require.
