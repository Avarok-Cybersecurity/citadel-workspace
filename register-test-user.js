#!/usr/bin/env node

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

async function registerUser(username, password, serverAddr = '127.0.0.1:12349') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:12345');

    ws.on('open', () => {
      console.log('WebSocket connected');

      // Convert password string to byte array
      const passwordBytes = Array.from(Buffer.from(password, 'utf8'));

      const registerRequest = {
        Register: {
          request_id: uuidv4(),
          server_addr: serverAddr,
          full_name: username,
          username: username,
          proposed_password: passwordBytes,
          connect_after_register: false,
          session_security_settings: null,
          server_password: null
        }
      };

      console.log('Sending register request for user:', username);
      ws.send(JSON.stringify(registerRequest));
    });

    ws.on('message', (data) => {
      const response = JSON.parse(data.toString());
      console.log('Received response:', JSON.stringify(response, null, 2));

      if (response.RegisterSuccess) {
        console.log('✓ User registered successfully!');
        ws.close();
        resolve(response);
      } else if (response.RegisterFailure) {
        console.error('✗ Registration failed:', response.RegisterFailure.message);
        ws.close();
        reject(new Error(response.RegisterFailure.message));
      } else if (response.ServiceConnectionAccepted) {
        console.log('Service connection accepted, waiting for register response...');
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      reject(error);
    });

    ws.on('close', () => {
      console.log('WebSocket closed');
    });
  });
}

// Get username and password from command line args or use defaults
const username = process.argv[2] || 'testuser1761436165';
const password = process.argv[3] || 'test12345';

console.log(`Registering user: ${username}`);
registerUser(username, password)
  .then(() => {
    console.log('Registration complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Registration failed:', error.message);
    process.exit(1);
  });
