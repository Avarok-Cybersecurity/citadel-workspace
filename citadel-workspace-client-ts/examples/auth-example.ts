import { WorkspaceClient } from '../src';
import type { WorkspaceProtocolResponse } from '../src';

async function main() {
  // Create a new workspace client
  const client = new WorkspaceClient({
    websocketUrl: 'ws://localhost:8080',
    messageHandler: (message) => {
      console.log('Received message:', message);
      
      // Handle workspace protocol messages
      if ('WorkspaceNotification' in message) {
        const payload = message.WorkspaceNotification.payload;
        if ('Response' in payload) {
          handleWorkspaceResponse(payload.Response);
        }
      } else if ('WorkspaceDelivered' in message) {
        const payload = message.WorkspaceDelivered.payload;
        if ('Response' in payload) {
          handleWorkspaceResponse(payload.Response);
        }
      }
    },
    errorHandler: (error) => {
      console.error('Client error:', error);
    }
  });

  // Initialize the client
  await client.init();

  // Example 1: Register a new user
  try {
    const registerResult = await client.auth.register({
      request_id: crypto.randomUUID(),
      server_addr: 'localhost:8080',
      full_name: 'Test User',
      username: 'testuser',
      proposed_password: Array.from(new TextEncoder().encode('password123')),
      connect_after_register: true,
      session_security_settings: 'Standard',
      server_password: null
    });
    
    console.log('Registration successful:', registerResult);
    console.log('Current CID:', client.auth.getCurrentCid());
  } catch (error) {
    console.error('Registration failed:', error);
  }

  // Example 2: Connect with existing credentials
  try {
    const connectResult = await client.auth.connect({
      request_id: crypto.randomUUID(),
      username: 'testuser',
      password: Array.from(new TextEncoder().encode('password123')),
      connect_mode: 'Reliable',
      udp_mode: 'Disabled',
      keep_alive_timeout: null,
      session_security_settings: 'Standard',
      server_password: null
    });
    
    console.log('Connection successful:', connectResult);
  } catch (error) {
    console.error('Connection failed:', error);
  }

  // Example 3: Create a workspace
  const cid = client.auth.getCurrentCid();
  if (cid) {
    try {
      await client.createWorkspace(
        cid,
        'My Workspace',
        'A test workspace',
        'workspace_password_123'
      );
      console.log('Workspace creation request sent');
    } catch (error) {
      console.error('Failed to create workspace:', error);
    }
  }

  // Example 4: Get workspace details
  if (cid) {
    try {
      await client.getWorkspace(cid);
      console.log('Get workspace request sent');
    } catch (error) {
      console.error('Failed to get workspace:', error);
    }
  }

  // Example 5: Monitor session changes
  const unsubscribeAuth = client.auth.onSessionChange((session) => {
    console.log('Auth session changed:', session);
  });

  const unsubscribeWorkspace = client.session.onWorkspaceSessionChange((session) => {
    console.log('Workspace session changed:', session);
  });

  // Example 6: Disconnect
  setTimeout(async () => {
    console.log('Disconnecting...');
    await client.auth.disconnect();
    
    // Cleanup listeners
    unsubscribeAuth();
    unsubscribeWorkspace();
  }, 30000); // Disconnect after 30 seconds
}

function handleWorkspaceResponse(response: WorkspaceProtocolResponse) {
  if ('Workspace' in response) {
    console.log('Received workspace:', response.Workspace);
  } else if ('Success' in response) {
    console.log('Success:', response.Success);
  } else if ('Error' in response) {
    console.error('Error:', response.Error);
  }
}

// Run the example
main().catch(console.error);