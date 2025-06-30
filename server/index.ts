import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { initializeDatabase } from './database/index.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import routes
import instanceRoutes from './routes/instances.js';
import securityGroupRoutes from './routes/securityGroups.js';
import keyPairRoutes from './routes/keyPairs.js';
import volumeRoutes from './routes/volumes.js';
import awsRoutes from './routes/aws.js';

// Routes
app.use('/api/instances', instanceRoutes);
app.use('/api/security-groups', securityGroupRoutes);
app.use('/api/keypairs', keyPairRoutes);
app.use('/api/volumes', volumeRoutes);
app.use('/api/aws', awsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    awsConfigured: !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
  });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Wrap server initialization in async function
async function startServer() {
  try {
    // Initialize database
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🔧 AWS Integration Status: ${process.env.AWS_ACCESS_KEY_ID ? '✅ Configured' : '⚠️  Mock Mode'}`);
      
      if (!process.env.AWS_ACCESS_KEY_ID) {
        console.log(`💡 To use real AWS operations, configure your credentials in .env file`);
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();