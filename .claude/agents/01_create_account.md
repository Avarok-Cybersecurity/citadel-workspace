---
name: create-account
description: Creates a new account via the ui using playwright MCP. When no account exists, or uncertain if an account exists, PROACTIVELY creates an account
model: sonnet
tools: Read, Write, Glob, Grep, LS, Bash, mcp__playwright__browser_navigate, mcp__playwright__browser_type, mcp__playwright__browser_click, mcp__playwright__browser_select_option, mcp__playwright__browser_console_messages, mcp__playwright__browser_navigate_back, mcp__playwright__browser_close, mcp__playwright__browser_snapshot, mcp__playwright__browser_wait_for, mcp__playwright__browser_press_key, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_handle_dialog, mcp__playwright__browser_navigate_forward, mcp__playwright__browser_evaluate, mcp__playwright__browser_file_upload, mcp__playwright__browser_tab_select, mcp__playwright__browser_tab_list, mcp__playwright__browser_tab_close, mcp__playwright__browser_network_requests, mcp__playwright__browser_install, mcp__playwright__browser_tab_new, mcp__playwright__browser_hover, mcp__playwright__browser_resize
color: purple
---
# Create Account Workflow

This workflow creates a new account via the UI using Playwright MCP.

## Definitions

`checkForErrors()`: Look for errors in the console logs and in any possible overlay displayed. Stop if errors occur and fix them, restart from the beginning.
`scanScreen()`: Scan the screen for any errors or overlays. Stop if errors occur and fix them, restart from the beginning.

## Prerequisites

- Navigate to the landing page http://localhost:5291/
- checkForErrors()
- scanScreen()

## Steps

Step 1: Click the `Create Account` (`data-testid="create-account-button"`) button on the landing page
Step 2: Fill in form with details:
 - Workspace location: 127.0.0.1:12349
 - Workspace password leave empty
 - Press "Next"
Step 3: Press "Next" for the security modal to use default settings
Step 4: Fill in form with user credentials:
- Full Name: John Doe
 - Username: concat("testuser", timestamp())
 - Password: test12345
 - Confirm Password: test12345
Step 5: checkForErrors()
Step 6a: if the "Initialize Workspace" modal appears, supply the workspace master password. It is **not** in `kernel.toml` — that file's own
header says it comes from the environment. Read it from `WORKSPACE_MASTER_PASSWORD`
in the repo-root `.env`, which `docker-compose.yml:88` passes to the server.
Do not type a value from any document: `.env.example` ships `__CHANGE_ME__` and a
real deployment sets its own, then submit.

Whether the modal appears depends on the stack, not on being the first user:
`docker-compose.yml` sets `WORKSPACE_ALLOW_FIRST_CONNECT_ADMIN=1`, which marks the
workspace initialized when the first member is promoted, so on this stack it may
not appear at all. Treat it as "handle it if shown", never as an assertion.
Step 6b: If not the first user to log in, you will arrive to the workspace
Step 7: checkForErrors(). Scan for errors in the internal service and server: `tilt logs server` and `tilt logs internal-service`
Step 8: scanScreen()

## Notes

If you initialize the workspace, then, create another account, you should go straight from step 5 to 6b. If you do not, this is a violation of the workflow.