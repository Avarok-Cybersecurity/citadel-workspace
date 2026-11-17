/**
 * Citadel Workspace Integration Test Library
 *
 * Re-exports all utilities for Playwright-based integration tests.
 */

// Types
export type {
  TestConfig,
  UxSeverity,
  UxCategory,
  UxIssue,
  CreateAccountOptions,
  BrowserOptions,
  BrowserSetup,
  DebugObservation,
  TestReport,
} from './types.js';

// Configuration
export { config, isCI, isHeaded } from './config.js';

// Utilities
export {
  sleep,
  generateTestId,
  isTcpPortOpen,
  isServiceAlive,
  waitForServicesAlive,
} from './utils.js';
export { isVisibleWithin, isHiddenWithin , pollUntil} from './utils.js';

// UX Tracking
export { UxIssueTracker } from './ux-tracker.js';

// Debug Observation
export { logObservation } from './observation.js';

// Screenshots
export { ensureScreenshotsDir, takeScreenshot } from './screenshots.js';

// Modals and Dialogs
export {
  closeAnyModals,
  checkForErrors,
  waitForWorkspaceLoaded,
  waitForTreeDataLoaded,
  checkToastState,
  assertNoToastConflict,
  dismissAllToasts,
} from './modals.js';
export type { ToastState } from './modals.js';

// Browser
export {
  createBrowser,
  setupConsoleCapture,
  clearBrowserStorage,
  waitForAppReady,
  wakeUpTab,
  createIsolatedContexts,
  createSeparateBrowsers,
  recoverUnresponsiveTab,
  wakeUpTabWithRecovery,
} from './browser.js';
export type { MultiBrowserSetup } from './browser.js';

// Reports
export { writeTestReport } from './report.js';

// Account Management
export { createAccount } from './account.js';

// P2P Operations
export {
  p2pRegister,
  acceptP2PRequest,
  openConversation,
  connectP2P,        // Explicitly connect to registered P2P peer
  disconnectP2P,     // Disconnect from P2P peer (C2S stays active)
  waitForP2PConnection, // Wait for P2P connection to be established (Map check only)
  waitForP2PChannelReady, // Wait for P2P channel READY (proven bidirectional message flow)
  disconnectViaNavbar,
  disconnectViaTopBar,
  disconnectViaTcpDrop,
  assertSessionNotInOrphanNavbar,
  assertSessionInOrphanNavbar,
  loginAfterDisconnect,
  reconnectViaClaimSession,
  verifyConnectedBadgeInModal,  // Verify "Connected" badge in Peer Discovery modal
  closePeerDiscoveryModal,      // Close Peer Discovery modal
} from './p2p.js';
export type { P2PRegisterOptions } from './p2p.js';

// Messaging
export { sendMessage, verifyMessageReceived, verifyMessageOrder, verifyMessagesSeen, waitForAllMessages, sendAndVerifyMessage, waitForP2PReady, verifyOfflineMessagesWithRetry } from './messaging.js';

// Live Documents
export {
  CHAT_DOCUMENT_MS,
  chatDocumentPane,
  expectCanvasOpen,
  createChatDocument,
  openChatDocument,
  typeInChatDocument,
  chatDocumentSays,
  chatDocumentText,
} from './live-docs.js';

// Group Chat
export {
  navigateToOffice,
  navigateToRoom,
  switchToChatTab,
  switchToContentTab,
  isChatEnabled,
  sendGroupMessage,
  verifyGroupMessageReceived,
  getMessageCount,
  checkMessageTimestamps,
  loadOlderMessages,
  checkRulesBanner,
  hasOffices,
  createOffice,
  createRoom,
} from './group-chat.js';

// Diagnostics - Console error/warning collector and white-screen detector
export {
  startDiagnostics,
  printDiagnosticsReport,
  isWhiteScreen,
} from './diagnostics.js';
export type {
  ConsoleMessage,
  ConsoleMessageType,
  WhiteScreenCheck,
  DiagnosticsReport,
  DiagnosticsHandle,
} from './diagnostics.js';

// Service Helpers - Backend service management
export { restartBackendServices } from './service-helpers.js';
export { withServerUnreachable } from './server-link.js';

// Test Harness - Reduces init/finalize boilerplate in test files
export { TestHarness, runTestMain } from './test-harness.js';
export type { TestHarnessConfig } from './test-harness.js';

// Group Chat Test Helpers - Parameterized multi-user group tests
export {
  createNUsers,
  navigateAllToOffice,
  navigateAllToRoom,
  switchAllToChatTab,
  testBidirectionalMessaging,
  printGroupTestResults,
  calculateAllPassed,
} from './group-helpers.js';
export type {
  UserSession,
  GroupTestConfig,
  GroupTestResults,
  MessageTestResult,
} from './group-helpers.js';

// Tree Helpers - Protocol-level tree operations (may not work without exposed service)
export {
  executeTreeProtocolRequest,
  createNodeViaProtocol,
  getNodeViaProtocol,
  updateNodeViaProtocol,
  moveNodeViaProtocol,
  deleteNodeViaProtocol,
  listNodesViaProtocol,
  getTreeStructure,
  getWorkspaceRootId,
  getTreeSchema,
  updateTreeSchema,
  createNodeType,
  listNodeTypes,
  verifyNodeDepth,
  verifyNodeParent,
  verifyNodeExists,
  verifyNodeDeleted,
  createDeepHierarchy,
  createSiblingNodes,
  countTreeNodes,
  findNodeInTree,
  getAllNodeIds,
  getDescendantIds,
  // UI-based helpers (use these instead of protocol ones)
  createOfficeViaUI,
  createRoomViaUI,
  pickChildTypeIfAsked,
  navigateToNodeViaUI,
  navigateToOfficeViaUI,
  deleteNodeViaUI,
  nodeExistsInUI,
  nodeGoneFromUI,
} from './tree-helpers.js';
// The focused hierarchy sidebar: reaching a node by clicking down its path.
export { hierarchyTree, treeRow, rootRow, rowNodeId, revealNode, revealPeekToggle, selectRoot, openNodeMenu } from './focused-tree.js';
export type {
  NodeEntityType,
  DomainNode,
  TreeNode,
  TreeSchema,
  NestingRule,
  CustomNodeType,
  WorkspaceProtocolResponse,
  CreateNodeResult,
  MoveNodeResult,
  DeleteNodeResult,
} from './tree-helpers.js';

// Workspace admin registered by global-setup (see src/global-setup.ts).
export { adminCredentials, hasWorkspaceAdmin, type AdminCredentials } from './admin.js';
export { activateTab, type TabActivation } from './tabs.js';
export { navigateInApp, navigateToDirectory } from './navigation.js';
export { adminDialog, openNodeContextMenu, openAdminPanel, activateAdminTab } from './admin-panel.js';
export { WORKSPACE_ROOT_SENTINEL } from './tree-helpers.js';

export { settleServerAutoConnect } from './p2p/session.js';
export * from './file-manager.js';
