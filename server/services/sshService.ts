import { Client } from 'ssh2';
import { Server as SocketIOServer } from 'socket.io';
import db from '../database/index.js';

interface SSHConnection {
  instanceId: string;
  host: string;
  username: string;
  privateKey: string;
  socket: any;
  sshClient: Client;
  stream?: any;
  connectionId: string;
  isAuthenticated: boolean;
}

class SSHService {
  private connections: Map<string, SSHConnection> = new Map();
  private io: SocketIOServer;

  constructor(io: SocketIOServer) {
    this.io = io;
    this.setupSocketHandlers();
  }

  private setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`🔌 SSH Terminal client connected: ${socket.id}`);

      socket.on('ssh:connect', async (data) => {
        await this.handleSSHConnect(socket, data);
      });

      socket.on('ssh:input', (data) => {
        this.handleSSHInput(socket, data);
      });

      socket.on('ssh:resize', (data) => {
        this.handleSSHResize(socket, data);
      });

      socket.on('disconnect', () => {
        console.log(`🔌 SSH Terminal client disconnected: ${socket.id}`);
        this.handleDisconnect(socket);
      });
    });
  }

  private async handleSSHConnect(socket: any, data: { instanceId: string; keyPairName: string; username?: string }) {
    const connectionId = `${socket.id}-${data.instanceId}`;
    
    try {
      console.log(`🚀 SSH connection request for instance: ${data.instanceId}`);
      console.log(`🔑 Looking for key pair: ${data.keyPairName}`);

      // Get instance details from database
      const instance = await db.getAsync(
        'SELECT * FROM instances WHERE id = ? OR aws_instance_id = ?',
        [data.instanceId, data.instanceId]
      );

      if (!instance) {
        console.error(`❌ Instance not found: ${data.instanceId}`);
        socket.emit('ssh:error', { message: 'Instance not found' });
        return;
      }

      console.log(`✅ Found instance: ${instance.name} (${instance.id})`);
      console.log(`📊 Instance state: ${instance.state}`);
      console.log(`🌐 Public IP: ${instance.public_ip}`);
      console.log(`🏠 Private IP: ${instance.private_ip}`);

      if (instance.state !== 'running') {
        console.error(`❌ Instance not running: ${instance.state}`);
        socket.emit('ssh:error', { message: 'Instance is not running' });
        return;
      }

      if (!instance.public_ip && !instance.private_ip) {
        console.error(`❌ Instance has no IP address`);
        socket.emit('ssh:error', { message: 'Instance has no IP address' });
        return;
      }

      // Get SSH key pair - improved search strategy
      console.log(`🔍 Searching for key pair: ${data.keyPairName}`);
      
      // Strategy 1: Exact name match
      let keyPair = await db.getAsync(
        'SELECT * FROM key_pairs WHERE name = ?',
        [data.keyPairName]
      );

      // Strategy 2: Case-insensitive search
      if (!keyPair) {
        console.log(`🔍 Trying case-insensitive search for: ${data.keyPairName}`);
        keyPair = await db.getAsync(
          'SELECT * FROM key_pairs WHERE LOWER(name) = LOWER(?)',
          [data.keyPairName]
        );
      }

      // Strategy 3: Partial match (in case of slight differences)
      if (!keyPair) {
        console.log(`🔍 Trying partial match search for: ${data.keyPairName}`);
        keyPair = await db.getAsync(
          'SELECT * FROM key_pairs WHERE name LIKE ? OR ? LIKE name',
          [`%${data.keyPairName}%`, `%${data.keyPairName}%`]
        );
      }

      // Strategy 4: Try to find any key pair with private key
      if (!keyPair) {
        console.log(`🔍 Looking for any key pair with private key...`);
        keyPair = await db.getAsync(
          'SELECT * FROM key_pairs WHERE private_key IS NOT NULL AND private_key != "" ORDER BY created_at DESC LIMIT 1'
        );
        
        if (keyPair) {
          console.log(`🔄 Using alternative key pair: ${keyPair.name}`);
        }
      }

      // If still not found, list all available key pairs for debugging
      if (!keyPair) {
        console.log(`🔍 Key pair not found, listing all available key pairs:`);
        const allKeyPairs = await db.allAsync('SELECT id, name, CASE WHEN private_key IS NOT NULL AND private_key != "" THEN "YES" ELSE "NO" END as has_private_key FROM key_pairs');
        allKeyPairs.forEach((kp: any) => {
          console.log(`  - ${kp.name} (${kp.id}) - Private Key: ${kp.has_private_key}`);
        });
        
        const availableNames = allKeyPairs.map((kp: any) => kp.name).join(', ');
        const withPrivateKey = allKeyPairs.filter((kp: any) => kp.has_private_key === 'YES').map((kp: any) => kp.name).join(', ');
        
        socket.emit('ssh:error', { 
          message: `SSH key pair '${data.keyPairName}' not found.\n\nAvailable key pairs: ${availableNames || 'None'}\n\nKey pairs with private keys: ${withPrivateKey || 'None'}\n\nTo use SSH terminal, upload a key pair that includes the private key (.pem file content).` 
        });
        return;
      }

      console.log(`✅ Found key pair: ${keyPair.name} (${keyPair.id})`);
      console.log(`🔐 Has private key: ${keyPair.private_key ? 'YES' : 'NO'}`);

      if (!keyPair.private_key) {
        console.error(`❌ No private key found for: ${keyPair.name}`);
        socket.emit('ssh:error', { 
          message: `SSH private key not found for '${keyPair.name}'.\n\nTo use the SSH terminal:\n1. Go to Key Pairs section\n2. Upload your .pem file\n3. Make sure to include the private key content\n\nThe key pair needs both public and private keys for SSH terminal functionality.` 
        });
        return;
      }

      // Determine connection details
      const host = instance.public_ip || instance.private_ip;
      const username = data.username || this.getDefaultUsername(instance.instance_type);

      console.log(`🔑 Connecting to ${username}@${host} using key: ${keyPair.name}`);
      console.log(`🔐 Private key length: ${keyPair.private_key.length} characters`);

      // Validate and clean private key format
      const cleanedPrivateKey = this.cleanPrivateKey(keyPair.private_key);
      if (!cleanedPrivateKey) {
        console.error(`❌ Invalid private key format for: ${keyPair.name}`);
        socket.emit('ssh:error', { 
          message: 'Invalid private key format. Please ensure you uploaded a valid .pem file with proper formatting:\n\n-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n\nOr:\n\n-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----' 
        });
        return;
      }

      console.log(`🔐 Using cleaned private key (${cleanedPrivateKey.length} chars)`);

      // Create SSH connection with unique connection ID
      const sshClient = new Client();

      console.log(`🔗 Creating SSH connection with ID: ${connectionId}`);

      const connection: SSHConnection = {
        instanceId: data.instanceId,
        host,
        username,
        privateKey: cleanedPrivateKey,
        socket,
        sshClient,
        connectionId,
        isAuthenticated: false,
      };

      // Store connection IMMEDIATELY - this is critical
      this.connections.set(connectionId, connection);
      console.log(`📝 Stored connection: ${connectionId}`);
      console.log(`📊 Total active connections: ${this.connections.size}`);

      // Set up SSH client event handlers BEFORE connecting
      sshClient.on('ready', () => {
        console.log(`✅ SSH connection established to ${host} (${connectionId})`);
        
        // Update connection status
        const storedConnection = this.connections.get(connectionId);
        if (storedConnection) {
          storedConnection.isAuthenticated = true;
          console.log(`🔐 Updated authentication status for: ${connectionId}`);
        }
        
        socket.emit('ssh:connected', { 
          message: `Connected to ${username}@${host}`,
          instanceId: data.instanceId,
          host,
          username 
        });

        // Start shell session with proper configuration
        sshClient.shell({ 
          term: 'xterm-256color',
          cols: 80,
          rows: 24,
          modes: {
            // Enable proper terminal modes
            ECHO: 1,
            ICANON: 0,
            ISIG: 1,
            ICRNL: 1,
            OPOST: 1,
            ONLCR: 1,
          }
        }, (err, stream) => {
          if (err) {
            console.error('❌ Failed to start shell:', err);
            socket.emit('ssh:error', { message: 'Failed to start shell session' });
            this.cleanupConnection(connectionId);
            return;
          }

          console.log(`🐚 Shell session started for connection: ${connectionId}`);

          // Store stream reference in the connection - CRITICAL FIX
          const currentConnection = this.connections.get(connectionId);
          if (currentConnection) {
            currentConnection.stream = stream;
            console.log(`📝 Stream stored successfully for connection: ${connectionId}`);
            console.log(`🔍 Connection verification: ${currentConnection.connectionId}, socket: ${currentConnection.socket.id}`);
            // Emitir evento shell-ready
            socket.emit('ssh:shell-ready', { message: 'Shell session is ready', instanceId: data.instanceId });
          } else {
            console.error(`❌ Connection not found when storing stream: ${connectionId}`);
            console.log(`📊 Available connections: ${Array.from(this.connections.keys()).join(', ')}`);
            // Try to recreate the connection entry
            connection.stream = stream;
            connection.isAuthenticated = true;
            this.connections.set(connectionId, connection);
            console.log(`🔄 Recreated connection entry: ${connectionId}`);
            // Emitir evento shell-ready
            socket.emit('ssh:shell-ready', { message: 'Shell session is ready', instanceId: data.instanceId });
          }

          // Handle shell data output
          stream.on('data', (data: Buffer) => {
            const output = data.toString();
            socket.emit('ssh:data', output);
          });

          // Handle shell close
          stream.on('close', () => {
            console.log(`🐚 Shell session closed for connection: ${connectionId}`);
            socket.emit('ssh:disconnected', { message: 'Shell session ended' });
            this.cleanupConnection(connectionId);
          });

          // Handle shell errors
          stream.on('error', (error: Error) => {
            console.error(`🐚 Shell error for connection ${connectionId}:`, error);
            socket.emit('ssh:error', { message: `Shell error: ${error.message}` });
          });

          // Handle stderr
          stream.stderr.on('data', (data: Buffer) => {
            const output = data.toString();
            socket.emit('ssh:data', output);
          });

          // Send initial prompt
          setTimeout(() => {
            if (stream && !stream.destroyed) {
              // Send a newline to get the initial prompt
              stream.write('\n');
            }
          }, 500);
        });
      });

      sshClient.on('error', (err) => {
        console.error(`❌ SSH connection error for ${connectionId}:`, err);
        let errorMessage = `Connection failed: ${err.message}`;
        
        // Provide more specific error messages
        if (err.message.includes('ECONNREFUSED')) {
          errorMessage = 'Connection refused. The instance may still be initializing or SSH service is not running.\n\nTroubleshooting:\n• Wait 2-3 minutes for instance to fully boot\n• Check security group allows port 22\n• Verify instance status checks are passing';
        } else if (err.message.includes('ENOTFOUND')) {
          errorMessage = 'Host not found. Check if the instance has a valid IP address.';
        } else if (err.message.includes('ETIMEDOUT')) {
          errorMessage = 'Connection timeout. This usually means:\n\n• Security group is blocking SSH (port 22)\n• Instance is still booting up\n• Network connectivity issues\n\nSolutions:\n• Check security group has SSH rule (port 22) from 0.0.0.0/0\n• Wait for instance to complete initialization\n• Verify instance has public IP if connecting from internet';
        } else if (err.message.includes('authentication') || err.message.includes('Authentication') || err.message.includes('All configured authentication methods failed')) {
          errorMessage = 'SSH Authentication failed. This means:\n\n• The private key doesn\'t match the instance key pair\n• Wrong username for this AMI type\n• Key format issues\n\nSolutions:\n• Verify you\'re using the correct .pem file\n• Try username "ubuntu" for Ubuntu instances\n• Try username "ec2-user" for Amazon Linux\n• Re-upload the private key ensuring proper format\n• Check the key pair name matches the instance';
        } else if (err.message.includes('key')) {
          errorMessage = 'SSH key error. Please check that the private key is valid and matches the instance key pair.\n\nTips:\n• Ensure the .pem file is not corrupted\n• Verify the key pair name matches\n• Try re-uploading the private key';
        }
        
        socket.emit('ssh:error', { 
          message: errorMessage,
          details: err.message 
        });
        this.cleanupConnection(connectionId);
      });

      sshClient.on('close', () => {
        console.log(`🔌 SSH connection closed for ${connectionId}`);
        socket.emit('ssh:disconnected', { message: 'Connection closed' });
        this.cleanupConnection(connectionId);
      });

      // Connect to SSH with improved configuration and multiple username attempts
      console.log(`🚀 Initiating SSH connection for ${connectionId}...`);
      
      // Try different usernames based on common AMI types
      const usernamesToTry = this.getUsernamesForInstance(username, instance);
      
      this.trySSHConnection(sshClient, {
        host,
        port: 22,
        privateKey: cleanedPrivateKey,
        usernames: usernamesToTry,
        readyTimeout: 30000,
        keepaliveInterval: 30000,
        keepaliveCountMax: 3,
        algorithms: {
          kex: [
            'diffie-hellman-group14-sha256',
            'diffie-hellman-group14-sha1',
            'diffie-hellman-group16-sha512',
            'diffie-hellman-group18-sha512',
            'ecdh-sha2-nistp256',
            'ecdh-sha2-nistp384',
            'ecdh-sha2-nistp521'
          ],
          cipher: [
            'aes128-ctr',
            'aes192-ctr', 
            'aes256-ctr',
            'aes128-gcm',
            'aes256-gcm'
          ],
          hmac: [
            'hmac-sha2-256',
            'hmac-sha2-512',
            'hmac-sha1'
          ],
          compress: ['none']
        }
      }, 0, connectionId);

    } catch (error) {
      console.error('❌ SSH connection setup failed:', error);
      socket.emit('ssh:error', { 
        message: 'Failed to setup SSH connection',
        details: error.message 
      });
      // Clean up any partial connection
      this.cleanupConnection(connectionId);
    }
  }

  private cleanPrivateKey(privateKey: string): string | null {
    try {
      // Remove any extra whitespace and normalize line endings
      let cleaned = privateKey.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      
      // Check for common private key formats
      const validHeaders = [
        '-----BEGIN RSA PRIVATE KEY-----',
        '-----BEGIN PRIVATE KEY-----',
        '-----BEGIN OPENSSH PRIVATE KEY-----',
        '-----BEGIN EC PRIVATE KEY-----',
        '-----BEGIN DSA PRIVATE KEY-----'
      ];
      
      const validFooters = [
        '-----END RSA PRIVATE KEY-----',
        '-----END PRIVATE KEY-----',
        '-----END OPENSSH PRIVATE KEY-----',
        '-----END EC PRIVATE KEY-----',
        '-----END DSA PRIVATE KEY-----'
      ];
      
      // Find matching header and footer
      let hasValidFormat = false;
      for (let i = 0; i < validHeaders.length; i++) {
        if (cleaned.includes(validHeaders[i]) && cleaned.includes(validFooters[i])) {
          hasValidFormat = true;
          break;
        }
      }
      
      if (!hasValidFormat) {
        console.error('❌ Private key does not have valid header/footer');
        return null;
      }
      
      // Ensure proper line breaks after header and before footer
      validHeaders.forEach(header => {
        if (cleaned.includes(header)) {
          cleaned = cleaned.replace(header, header + '\n');
        }
      });
      
      validFooters.forEach(footer => {
        if (cleaned.includes(footer)) {
          cleaned = cleaned.replace(footer, '\n' + footer);
        }
      });
      
      // Remove duplicate newlines
      cleaned = cleaned.replace(/\n\n+/g, '\n');
      
      // Ensure it ends with a newline
      if (!cleaned.endsWith('\n')) {
        cleaned += '\n';
      }
      
      console.log(`🔐 Private key cleaned successfully (${cleaned.length} chars)`);
      return cleaned;
      
    } catch (error) {
      console.error('❌ Error cleaning private key:', error);
      return null;
    }
  }

  private getUsernamesForInstance(defaultUsername: string, instance: any): string[] {
    // Common usernames for different AMI types
    const commonUsernames = [
      defaultUsername,
      'ec2-user',    // Amazon Linux, Amazon Linux 2, Red Hat, SUSE
      'ubuntu',      // Ubuntu
      'admin',       // Debian
      'centos',      // CentOS
      'fedora',      // Fedora
      'root'         // Some custom AMIs (less common)
    ];
    
    // Remove duplicates and return
    return [...new Set(commonUsernames)];
  }

  private trySSHConnection(sshClient: Client, config: any, usernameIndex: number, connectionId: string) {
    if (usernameIndex >= config.usernames.length) {
      // All usernames failed
      console.error(`❌ All usernames failed for SSH connection: ${connectionId}`);
      return;
    }
    
    const currentUsername = config.usernames[usernameIndex];
    console.log(`🔑 Trying SSH connection with username: ${currentUsername} (attempt ${usernameIndex + 1}/${config.usernames.length}) for ${connectionId}`);
    
    const connectionConfig = {
      host: config.host,
      port: config.port,
      username: currentUsername,
      privateKey: config.privateKey,
      readyTimeout: config.readyTimeout,
      keepaliveInterval: config.keepaliveInterval,
      keepaliveCountMax: config.keepaliveCountMax,
      algorithms: config.algorithms,
      debug: (info: string) => {
        console.log(`🔍 SSH Debug (${currentUsername}): ${info}`);
      }
    };
    
    // Remove previous listeners to avoid conflicts
    sshClient.removeAllListeners('error');
    
    // Add error handler for this attempt
    sshClient.once('error', (err) => {
      console.log(`❌ SSH attempt ${usernameIndex + 1} failed with ${currentUsername} for ${connectionId}: ${err.message}`);
      
      if (err.message.includes('authentication') || err.message.includes('Authentication')) {
        // Authentication failed, try next username
        console.log(`🔄 Authentication failed for ${currentUsername}, trying next username...`);
        setTimeout(() => {
          this.trySSHConnection(sshClient, config, usernameIndex + 1, connectionId);
        }, 1000);
      } else {
        // Other error, don't retry
        console.error(`❌ Non-authentication error for ${connectionId}: ${err.message}`);
      }
    });
    
    sshClient.connect(connectionConfig);
  }

  private handleSSHInput(socket: any, data: { input: string }) {
    const connectionId = this.findConnectionBySocket(socket.id);
    
    console.log(`📝 SSH Input received from socket ${socket.id}`);
    console.log(`🔍 Looking for connection ID: ${connectionId}`);
    console.log(`📊 Current connections: ${Array.from(this.connections.keys()).join(', ')}`);
    
    if (!connectionId) {
      console.warn(`⚠️ No connection ID found for socket: ${socket.id}`);
      console.log(`📊 Available connections:`);
      this.connections.forEach((conn, id) => {
        console.log(`  - ${id}: socket ${conn.socket.id}, instance ${conn.instanceId}, authenticated: ${conn.isAuthenticated}, hasStream: ${!!conn.stream}`);
      });
      socket.emit('ssh:error', { message: 'No active SSH connection found. Please reconnect.' });
      return;
    }

    const connection = this.connections.get(connectionId);
    if (!connection) {
      console.warn(`⚠️ Connection not found for ID: ${connectionId}`);
      socket.emit('ssh:error', { message: 'SSH connection not found. Please reconnect.' });
      return;
    }

    if (!connection.isAuthenticated) {
      console.warn(`⚠️ Connection not authenticated yet: ${connectionId}`);
      socket.emit('ssh:error', { message: 'SSH connection not ready. Please wait for authentication to complete.' });
      return;
    }

    if (!connection.stream) {
      console.warn(`⚠️ Stream not available for connection: ${connectionId}`);
      socket.emit('ssh:error', { message: 'Shell session not available. Please reconnect.' });
      return;
    }

    if (connection.stream.destroyed) {
      console.warn(`⚠️ Stream destroyed for connection: ${connectionId}`);
      socket.emit('ssh:error', { message: 'Shell session has been closed. Please reconnect.' });
      return;
    }

    try {
      console.log(`✅ Sending input to stream for connection: ${connectionId}`);
      console.log(`📝 Input data: ${JSON.stringify(data.input)} (length: ${data.input.length})`);
      connection.stream.write(data.input);
    } catch (error) {
      console.error(`❌ Error writing to stream for ${connectionId}:`, error);
      socket.emit('ssh:error', { message: 'Failed to send input to shell. Please reconnect.' });
    }
  }

  private handleSSHResize(socket: any, data: { cols: number; rows: number }) {
    const connectionId = this.findConnectionBySocket(socket.id);
    if (!connectionId) {
      console.warn(`⚠️ No connection found for resize from socket: ${socket.id}`);
      return;
    }

    const connection = this.connections.get(connectionId);
    if (connection && connection.stream && !connection.stream.destroyed) {
      console.log(`📐 Resizing terminal: ${data.cols}x${data.rows} for connection: ${connectionId}`);
      try {
        connection.stream.setWindow(data.rows, data.cols);
      } catch (error) {
        console.error(`❌ Error resizing terminal for ${connectionId}:`, error);
      }
    }
  }

  private handleDisconnect(socket: any) {
    console.log(`🔌 Handling disconnect for socket: ${socket.id}`);
    
    // Find all connections for this socket
    const connectionsToCleanup: string[] = [];
    this.connections.forEach((connection, connectionId) => {
      if (connection.socket.id === socket.id) {
        connectionsToCleanup.push(connectionId);
      }
    });

    console.log(`🧹 Found ${connectionsToCleanup.length} connections to cleanup for socket ${socket.id}`);
    
    // Cleanup all connections for this socket
    connectionsToCleanup.forEach(connectionId => {
      this.cleanupConnection(connectionId);
    });
  }

  private findConnectionBySocket(socketId: string): string | null {
    console.log(`🔍 Finding connection for socket: ${socketId}`);
    console.log(`📊 Searching through ${this.connections.size} connections`);
    
    for (const [connectionId, connection] of this.connections) {
      console.log(`  - Checking connection ${connectionId}: socket ${connection.socket.id}, authenticated: ${connection.isAuthenticated}`);
      if (connection.socket.id === socketId) {
        console.log(`✅ Found connection: ${connectionId}`);
        return connectionId;
      }
    }
    
    console.log(`❌ No connection found for socket: ${socketId}`);
    return null;
  }

  private cleanupConnection(connectionId: string) {
    console.log(`🧹 Cleaning up connection: ${connectionId}`);
    
    const connection = this.connections.get(connectionId);
    if (connection) {
      try {
        if (connection.stream && !connection.stream.destroyed) {
          console.log(`🔚 Ending stream for connection: ${connectionId}`);
          connection.stream.end();
        }
        if (connection.sshClient) {
          console.log(`🔚 Ending SSH client for connection: ${connectionId}`);
          connection.sshClient.end();
        }
      } catch (error) {
        console.error(`❌ Error cleaning up SSH connection ${connectionId}:`, error);
      }
      
      this.connections.delete(connectionId);
      console.log(`✅ Connection ${connectionId} cleaned up successfully`);
      console.log(`📊 Remaining connections: ${this.connections.size}`);
    } else {
      console.warn(`⚠️ Connection ${connectionId} not found for cleanup`);
    }
  }

  private getDefaultUsername(instanceType: string): string {
    // Default usernames for different AMI types
    // Amazon Linux 2 uses 'ec2-user'
    // Ubuntu uses 'ubuntu'
    // CentOS uses 'centos'
    // For simplicity, we'll default to 'ec2-user' since we're using Amazon Linux 2
    return 'ec2-user';
  }

  // Public method to get active connections count
  public getActiveConnectionsCount(): number {
    return this.connections.size;
  }

  // Public method to disconnect all connections for an instance
  public disconnectInstance(instanceId: string) {
    console.log(`🔌 Disconnecting all connections for instance: ${instanceId}`);
    
    const connectionsToDisconnect: string[] = [];
    this.connections.forEach((connection, connectionId) => {
      if (connection.instanceId === instanceId) {
        connectionsToDisconnect.push(connectionId);
      }
    });

    console.log(`🔌 Found ${connectionsToDisconnect.length} connections to disconnect for instance ${instanceId}`);
    
    connectionsToDisconnect.forEach(connectionId => {
      const connection = this.connections.get(connectionId);
      if (connection) {
        connection.socket.emit('ssh:disconnected', { 
          message: 'Instance connection terminated by server' 
        });
        this.cleanupConnection(connectionId);
      }
    });
  }
}

export default SSHService;