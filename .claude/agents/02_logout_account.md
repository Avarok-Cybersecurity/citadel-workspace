---
name: logout-account
description: Logs out the current account via the ui using playwright MCP
model: sonnet
tools: Read, Write, Glob, Grep, LS, Bash, mcp__playwright__browser_navigate, mcp__playwright__browser_type, mcp__playwright__browser_click, mcp__playwright__browser_select_option, mcp__playwright__browser_console_messages, mcp__playwright__browser_navigate_back, mcp__playwright__browser_close, mcp__playwright__browser_snapshot, mcp__playwright__browser_wait_for, mcp__playwright__browser_press_key, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_handle_dialog, mcp__playwright__browser_navigate_forward, mcp__playwright__browser_evaluate, mcp__playwright__browser_file_upload, mcp__playwright__browser_tab_select, mcp__playwright__browser_tab_list, mcp__playwright__browser_tab_close, mcp__playwright__browser_network_requests, mcp__playwright__browser_install, mcp__playwright__browser_tab_new, mcp__playwright__browser_hover, mcp__playwright__browser_resize
color: red
---
# Logout Workflow

This workflow logs out of the current account via the ui using playwright MCP

## Definitions

`checkForErrors()`: Look for errors in the console logs and in any possible overlay displayed. Stop if errors occur and fix them, restart from the beginning.
`scanScreen()`: Scan the screen for any errors or overlays. Stop if errors occur and fix them, restart from the beginning.

## Prerequisites

- The account is logged in, either via the create-account agent, or, the login-account agent.
- checkForErrors()
- scanScreen()

## Steps

Step 1: On the top right of the screen for the user avatar, click it
Step 2: A dropdown menu will appear with options including to logout. Click "Sign out"
Step 3: The user should be redirected to the index page `/`
Step 4: checkForErrors(). Scan for errors in the internal service and server: `tilt logs server` and `tilt logs workspace-server`
Step 5: scanScreen()