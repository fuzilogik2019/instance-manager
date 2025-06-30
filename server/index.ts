import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { initializeDatabase } from './database/index.js';
import SSHService from './services/sshService.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Create HTTP server
const server = createServer(app);

// Setup Socket.IO
const io = new SocketIOServer(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Initialize SSH Service
let sshService: SSHService;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
});

// Import routes
import instanceRoutes from './routes/instances.js';
import securityGroupRoutes from './routes/securityGroups.js';
import keyPairRoutes from './routes/keyPairs.js';
import volumeRoutes from './routes/volumes.js';
import awsRoutes from './routes/aws.js';

// Routes
console.log('Setting up routes...');
app.use('/api/instances', instanceRoutes);
app.use('/api/security-groups', securityGroupRoutes);
app.use('/api/keypairs', keyPairRoutes);
app.use('/api/volumes', volumeRoutes);
app.use('/api/aws', awsRoutes);

// SSH Terminal status endpoint
app.get('/api/ssh/status', (req, res) => {
  res.json({
    status: 'active',
    activeConnections: sshService ? sshService.getActiveConnectionsCount() : 0,
    timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    awsConfigured: !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
    sshTerminal: sshService ? 'enabled' : 'disabled'
  });
});

// Debug route to list all routes
app.get('/api/debug/routes', (req, res) => {
  const routes: any[] = [];
  
  app._router.stack.forEach((middleware: any) => {
    if (middleware.route) {
      routes.push({
        path: middleware.route.path,
        methods: Object.keys(middleware.route.methods)
      });
    } else if (middleware.name === 'router') {
      middleware.handle.stack.forEach((handler: any) => {
        if (handler.route) {
          routes.push({
            path: middleware.regexp.source.replace('\\', '').replace('(?:', '').replace(')', '').replace('$', '') + handler.route.path,
            methods: Object.keys(handler.route.methods)
          });
        }
      });
    }
  });
  
  res.json({ routes });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'Route not found',
    method: req.method,
    path: req.originalUrl,
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Server Error:', err);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: err.message,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Wrap server initialization in async function
async function startServer() {
  try {
    // Initialize database
    await initializeDatabase();

    // Initialize SSH Service
    sshService = new SSHService(io);

    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🔧 Debug routes: http://localhost:${PORT}/api/debug/routes`);
      console.log(`🔧 AWS Integration Status: ${process.env.AWS_ACCESS_KEY_ID ? '✅ Configured' : '⚠️  Mock Mode'}`);
      console.log(`🖥️  SSH Terminal: ✅ Enabled`);
      console.log(`🔌 WebSocket Server: ✅ Running`);
      
      if (!process.env.AWS_ACCESS_KEY_ID) {
        console.log(`💡 To use real AWS operations, configure your credentials in .env file`);
      }
      
      console.log(`📋 Available routes:`);
      console.log(`   GET    /api/instances`);
      console.log(`   POST   /api/instances`);
      console.log(`   POST   /api/instances/:id/start`);
      console.log(`   POST   /api/instances/:id/stop`);
      console.log(`   DELETE /api/instances/:id`);
      console.log(`   GET    /api/ssh/status`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();