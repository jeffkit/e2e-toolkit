---
name: run-tests
description: Run ArgusAI E2E tests for the current project (full cycle or targeted suite)
argument-hint: "[suite-id]"
---

# ArgusAI E2E Test Runner

Execute the ArgusAI E2E testing workflow for the current project.

## Instructions

1. Determine the **project path** — use the current working directory as the project root
2. Check if `e2e.yaml` exists in the project directory. If not, inform the user that this project has no ArgusAI configuration and offer to help create one
3. If an argument (suite ID) was provided, run only that suite; otherwise run all suites

## Execution Steps

### Step 1: Initialize
Call `argus_init` with the absolute project path to load configuration.

### Step 2: Check Status
Call `argus_status` to check if the environment is already running.

### Step 3: Build & Setup (if needed)
If the environment is NOT running:
- Call `argus_build` to build Docker images
- Call `argus_setup` to start the test environment
- Wait for health checks to pass

If the environment IS running:
- Skip build and setup
- Proceed directly to test execution

### Step 4: Run Tests
- If a suite ID argument was provided: call `argus_run_suite` with that suite ID
- Otherwise: call `argus_run` to execute all suites

### Step 5: Report Results
- Summarize test results clearly: total suites, passed, failed
- For any failures, show the failing test case name and assertion details
- If there are failures, offer to check container logs with `argus_logs`

### Step 6: Clean Up
Ask the user if they want to clean up the environment, or keep it running for further testing.

## Error Handling

- If `argus_build` fails: show the error and suggest checking the Dockerfile
- If `argus_setup` fails with health check timeout: show container logs and suggest checking the service startup
- If tests fail: show detailed failure information and offer diagnostic steps
