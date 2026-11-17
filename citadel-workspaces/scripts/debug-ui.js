#!/usr/bin/env node

/**
 * UI Debug Script
 * 
 * This script helps debug UI issues by:
 * 1. Starting the development server
 * 2. Opening a browser with DevTools enabled
 * 3. Capturing and displaying console logs
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const APP_URL = 'http://localhost:1420';
const LOG_FILE = path.join(__dirname, '../ui-debug.log');

// Clear previous log file
if (fs.existsSync(LOG_FILE)) {
  fs.unlinkSync(LOG_FILE);
}

// Helper to write logs
function log(message) {
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, formattedMessage);
  console.log(message);
}

// Start dev server
log('Starting development server...');
const devServer = spawn('npm', ['run', 'dev'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'pipe'
});

devServer.stdout.on('data', (data) => {
  const output = data.toString();
  console.log(output);
  if (output.includes('Local:   http://localhost:1420/')) {
    startBrowserCapture();
  }
});

devServer.stderr.on('data', (data) => {
  console.error(`Dev server error: ${data}`);
  log(`Dev server error: ${data}`);
});

// Start browser and capture console logs
async function startBrowserCapture() {
  log('Dev server started, launching browser...');
  
  try {
    const { chromium } = await import('playwright');

    const browser = await chromium.launch({
      headless: false,
      args: ['--window-size=1280,800', '--auto-open-devtools-for-tabs'],
    });
    
    const page = await browser.newPage();
    
    // Capture console logs
    page.on('console', (msg) => {
      const type = msg.type().toUpperCase();
      const text = msg.text();
      const logMessage = `[BROWSER ${type}] ${text}`;
      log(logMessage);
    });
    
    // Capture errors
    page.on('pageerror', (error) => {
      log(`[BROWSER ERROR] ${error.message}`);
    });
    
    // Capture network errors
    page.on('requestfailed', (request) => {
      log(`[NETWORK ERROR] ${request.url()} failed: ${request.failure()?.errorText ?? 'unknown'}`);
    });
    
    log('Navigating to app...');
    await page.goto(APP_URL);
    log(`Browser opened at ${APP_URL}`);
    log('Console logs are being captured to ui-debug.log');
    
    // Keep the script running
    process.on('SIGINT', async () => {
      log('Shutting down...');
      await browser.close();
      devServer.kill();
      process.exit(0);
    });
    
  } catch (error) {
    log(`Error launching browser: ${error.message}`);
    devServer.kill();
    process.exit(1);
  }
}

// Handle process termination
process.on('exit', () => {
  if (devServer) {
    devServer.kill();
  }
});
