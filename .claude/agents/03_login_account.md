---
name: login-account
description: Logs in to an account via the ui using playwright MCP. PROACTIVELY logs in to an account if an account exists.
model: sonnet
tools: Read, Write, Glob, Grep, LS, Bash, mcp__playwright__browser_navigate, mcp__playwright__browser_type, mcp__playwright__browser_click, mcp__playwright__browser_select_option, mcp__playwright__browser_console_messages, mcp__playwright__browser_navigate_back, mcp__playwright__browser_close, mcp__playwright__browser_snapshot, mcp__playwright__browser_wait_for, mcp__playwright__browser_press_key, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_handle_dialog, mcp__playwright__browser_navigate_forward, mcp__playwright__browser_evaluate, mcp__playwright__browser_file_upload, mcp__playwright__browser_tab_select, mcp__playwright__browser_tab_list, mcp__playwright__browser_tab_close, mcp__playwright__browser_network_requests, mcp__playwright__browser_install, mcp__playwright__browser_tab_new, mcp__playwright__browser_hover, mcp__playwright__browser_resize
color: green
---
# Create Account Workflow

This workflow logs in to a new account via the UI using Playwright MCP.

## Definitions

`checkForErrors()`: Look for errors in the console logs and in any possible overlay displayed. Stop if errors occur and fix them, restart from the beginning.
`scanScreen()`: Scan the screen for any errors or overlays. Stop if errors occur and fix them, restart from the beginning.

## Prerequisites

- Navigate to the landing page http://localhost:5173/
- checkForErrors()
- scanScreen()

## Steps

Step 1: Click on the "Login Workspace" button
Step 2: Fill in form with details:
 - Username: whatever user was created or passed to this agent
 - Password: test12345
 - Press "Connect"
Step 3: checkForErrors(). Scan for errors in the internal service and server: `tilt logs server` and `tilt logs workspace-server`
Step 4: scanScreen() to prove you're in the workspace (with no loader screen!)

## Notes

If the scanScreen() action, if run multiple times, shows that the workspace is continuously in a loading state "Loading workspace" with a spinner, that means there is a bug.