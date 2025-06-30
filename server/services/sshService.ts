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

      // Validate private key format
      if (!this.isValidPrivateKey(keyPair.private_key)) {
        console.error(`❌ Invalid private key format for: ${keyPair.name}`);
        socket.emit('ssh:error', { 
          message: 'Invalid private key format. Please ensure you uploaded a valid .pem file with proper formatting:\n\n-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----' 
        });
        return;
      }

      // Create SSH connection
      const sshClient = new Client();
      const connectionId = `${socket.id}-${data.instanceId}`;

      const connection: SSHConnection = {
        instanceId: data.instanceId,
        host,
        username,
        privateKey: keyPair.private_key,
        socket,
        sshClient,
      };

      this.connections.set(connectionId, connection);

      sshClient.on('ready', () => {
        console.log(`✅ SSH connection established to ${host}`);
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
            return;
          }

          console.log('🐚 Shell session started');

          // Store stream reference
          connection.stream = stream;

          // Handle shell data output
          stream.on('data', (data: Buffer) => {
            const output = data.toString();
            socket.emit('ssh:data', output);
          });

          // Handle shell close
          stream.on('close', () => {
            console.log('🐚 Shell session closed');
            socket.emit('ssh:disconnected', { message: 'Shell session ended' });
            this.cleanupConnection(connectionId);
          });

          // Handle shell errors
          stream.on('error', (error: Error) => {
            console.error('🐚 Shell error:', error);
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
        console.error('❌ SSH connection error:', err);
        let errorMessage = `Connection failed: ${err.message}`;
        
        // Provide more specific error messages
        if (err.message.includes('ECONNREFUSED')) {
          errorMessage = 'Connection refused. Check if SSH service is running on the instance and security group allows port 22.';
        } else if (err.message.includes('ENOTFOUND')) {
          errorMessage = 'Host not found. Check if the instance has a valid IP address.';
        } else if (err.message.includes('ETIMEDOUT')) {
          errorMessage = 'Connection timeout. Check security group settings and instance network configuration.';
        } else if (err.message.includes('authentication') || err.message.includes('Authentication')) {
          errorMessage = 'Authentication failed. Verify the SSH key pair is correct for this instance.';
        } else if (err.message.includes('key')) {
          errorMessage = 'SSH key error. Please check that the private key is valid and matches the instance key pair.';
        }
        
        socket.emit('ssh:error', { 
          message: errorMessage,
          details: err.message 
        });
        this.cleanupConnection(connectionId);
      });

      sshClient.on('close', () => {
        console.log('🔌 SSH connection closed');
        socket.emit('ssh:disconnected', { message: 'Connection closed' });
        this.cleanupConnection(connectionId);
      });

      // Connect to SSH with improved configuration
      console.log(`🚀 Initiating SSH connection...`);
      sshClient.connect({
        host,
        port: 22,
        username,
        privateKey: keyPair.private_key,
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
      });

    } catch (error) {
      console.error('❌ SSH connection setup failed:', error);
      socket.emit('ssh:error', { 
        message: 'Failed to setup SSH connection',
        details: error.message 
      });
    }
  }

  private isValidPrivateKey(privateKey: string): boolean {
    // Check for common private key formats
    const validHeaders = [
      '-----BEGIN RSA PRIVATE KEY-----',
      '-----BEGIN PRIVATE KEY-----',
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      '-----BEGIN EC PRIVATE KEY-----',
      '-----BEGIN DSA PRIVATE KEY-----'
    ];
    
    const trimmedKey = privateKey.trim();
    return validHeaders.some(header => trimmedKey.startsWith(header));
  }

  private handleSSHInput(socket: any, data: { input: string }) {
    const connectionId = this.findConnectionBySocket(socket.id);
    if (!connectionId) {
      console.warn('⚠️ No active SSH connection for input');
      socket.emit('ssh:error', { message: 'No active SSH connection' });
      return;
    }

    const connection = this.connections.get(connectionId);
    if (connection && connection.stream && !connection.stream.destroyed) {
      connection.stream.write(data.input);
    } else {
      console.warn('⚠️ Stream not available for input');
      socket.emit('ssh:error', { message: 'Shell session not available' });
    }
  }

  private handleSSHResize(socket: any, data: { cols: number; rows: number }) {
    const connectionId = this.findConnectionBySocket(socket.id);
    if (!connectionId) return;

    const connection = this.connections.get(connectionId);
    if (connection && connection.stream && !connection.stream.destroyed) {
      console.log(`📐 Resizing terminal: ${data.cols}x${data.rows}`);
      connection.stream.setWindow(data.rows, data.cols);
    }
  }

  private handleDisconnect(socket: any) {
    const connectionId = this.findConnectionBySocket(socket.id);
    if (connectionId) {
      this.cleanupConnection(connectionId);
    }
  }

  private findConnectionBySocket(socketId: string): string | null {
    for (const [connectionId, connection] of this.connections) {
      if (connection.socket.id === socketId) {
        return connectionId;
      }
    }
    return null;
  }

  private cleanupConnection(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      try {
        if (connection.stream && !connection.stream.destroyed) {
          connection.stream.end();
        }
        if (connection.sshClient) {
          connection.sshClient.end();
        }
      } catch (error) {
        console.error('Error cleaning up SSH connection:', error);
      }
      this.connections.delete(connectionId);
      console.log(`🧹 Cleaned up SSH connection: ${connectionId}`);
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
    for (const [connectionId, connection] of this.connections) {
      if (connection.instanceId === instanceId) {
        connection.socket.emit('ssh:disconnected', { 
          message: 'Instance connection terminated by server' 
        });
        this.cleanupConnection(connectionId);
      }
    }
  }
}

export default SSHService;