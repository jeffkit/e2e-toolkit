---
name: init-e2e
description: Initialize ArgusAI E2E testing configuration for the current project
argument-hint: ""
---

# ArgusAI E2E Project Initialization

Help the user set up ArgusAI E2E testing for their project.

## Instructions

1. Check if `e2e.yaml` already exists in the current project directory
   - If yes: inform the user and ask if they want to update it
   - If no: proceed with initialization

2. Analyze the project to understand:
   - What language/framework is used (check package.json, requirements.txt, go.mod, etc.)
   - Where the Dockerfile is located
   - What port the service listens on
   - Whether the service has a health check endpoint

3. Generate an `e2e.yaml` file tailored to the project:
   - Set appropriate `service.build` configuration based on the Dockerfile
   - Configure `service.container` with correct ports and environment
   - Add a healthcheck if the service has a health endpoint
   - Create a basic test suite

4. Generate a sample test file in `tests/health.yaml`:
   - Include a health check test case
   - Include one basic API test case based on the project's routes

5. Generate a `.env.example` with any environment variables the service needs

6. Summarize what was created and provide next steps:
   - How to edit the configuration
   - How to run the first test (`/run-tests`)
