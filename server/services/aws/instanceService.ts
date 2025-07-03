import {
  EC2Client,
  RunInstancesCommand,
  TerminateInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  DescribeInstancesCommand,
  DescribeInstanceStatusCommand,
  Instance,
} from '@aws-sdk/client-ec2';
import { createEC2Client, isAWSConfigured } from './awsClient.js';
import { InstanceCreationRequest, EC2Instance } from '../../../src/types/aws.js';

export class InstanceService {
  constructor() {
    if (!isAWSConfigured()) {
      throw new Error('AWS credentials not configured');
    }
  }

  // ==========================================
  // INSTANCE MANAGEMENT
  // ==========================================
  async getAllInstances(): Promise<EC2Instance[]> {
    const ec2Client = createEC2Client();
    if (!ec2Client) {
      throw new Error('Failed to create AWS client');
    }

    try {
      console.log('📋 Fetching all instances from AWS...');
      
      const command = new DescribeInstancesCommand({
        Filters: [
          {
            Name: 'instance-state-name',
            Values: ['pending', 'running', 'shutting-down', 'terminated', 'stopping', 'stopped']
          }
        ]
      });

      const response = await ec2Client.send(command);
      const instances: EC2Instance[] = [];

      console.log(`📊 Found ${response.Reservations?.length || 0} reservations`);

      if (response.Reservations) {
        for (const reservation of response.Reservations) {
          if (reservation.Instances) {
            for (const instance of reservation.Instances) {
              console.log(`🔍 Processing instance: ${instance.InstanceId} - State: ${instance.State?.Name}`);
              
              const nameTag = instance.Tags?.find(tag => tag.Key === 'Name');
              const instanceName = nameTag?.Value || instance.InstanceId || 'Unnamed';

              const tags: Record<string, string> = {};
              instance.Tags?.forEach(tag => {
                if (tag.Key && tag.Value) {
                  tags[tag.Key] = tag.Value;
                }
              });

              const volumes = instance.BlockDeviceMappings?.map(bdm => ({
                id: bdm.Ebs?.VolumeId || '',
                type: 'gp2' as const,
                size: 8,
                encrypted: false,
                deleteOnTermination: bdm.Ebs?.DeleteOnTermination || false,
              })) || [];

              let statusChecks = undefined;
              if (instance.State?.Name === 'running') {
                try {
                  statusChecks = await this.getInstanceStatusChecks(instance.InstanceId!);
                } catch (statusError) {
                  console.warn(`⚠️ Failed to get status checks for ${instance.InstanceId}:`, statusError.message);
                }
              }

              let actualState = this.mapInstanceState(instance.State?.Name || 'unknown');
              if (actualState === 'running' && statusChecks && !statusChecks.isSSHReady) {
                actualState = 'initializing';
              }

              const ec2Instance: EC2Instance = {
                id: instance.InstanceId!,
                name: instanceName,
                instanceType: instance.InstanceType!,
                state: actualState,
                region: instance.Placement?.AvailabilityZone?.slice(0, -1) || 'us-east-1',
                availabilityZone: instance.Placement?.AvailabilityZone || 'us-east-1a',
                publicIp: instance.PublicIpAddress,
                privateIp: instance.PrivateIpAddress || '10.0.0.1',
                keyPairName: instance.KeyName || 'N/A',
                securityGroups: instance.SecurityGroups?.map(sg => sg.GroupId!) || [],
                securityGroupNames: instance.SecurityGroups?.map(sg => sg.GroupName!) || [],
                volumes,
                isSpotInstance: !!instance.SpotInstanceRequestId,
                launchTime: instance.LaunchTime || new Date(),
                tags,
                statusChecks,
              };

              instances.push(ec2Instance);
            }
          }
        }
      }

      console.log(`✅ Processed ${instances.length} instances total`);
      
      instances.sort((a, b) => new Date(b.launchTime).getTime() - new Date(a.launchTime).getTime());
      
      return instances;
    } catch (error) {
      console.error('❌ Failed to get instances from AWS:', error);
      throw error;
    }
  }

  async launchInstance(request: InstanceCreationRequest): Promise<{ instanceId: string; publicIp?: string; privateIp: string; availabilityZone: string }> {
    const ec2Client = createEC2Client(request.region);
    if (!ec2Client) {
      throw new Error('Failed to create AWS client for region: ' + request.region);
    }

    try {
      console.log(`🚀 Launching instance with AMI: ${request.amiId} in region: ${request.region}`);
      console.log(`📦 Volumes configuration:`, request.volumes);

      // Prepare user data script
      let userData = request.userData || '';
      
      // Add Docker installation script if requested
      if (request.installDocker) {
        const dockerScript = this.generateDockerInstallScript(request.dockerImageToPull);
        userData = userData ? `${userData}\n\n${dockerScript}` : dockerScript;
      }

      // Prepare tags
      const tags = [];
      tags.push({
        Key: 'Name',
        Value: request.name,
      });

      Object.entries(request.tags).forEach(([key, value]) => {
        if (key !== 'Name') {
          tags.push({
            Key: key,
            Value: value,
          });
        }
      });

      // CRITICAL FIX: Only use the FIRST volume (root volume) to prevent additional volumes
      const rootVolume = request.volumes[0];
      if (!rootVolume) {
        throw new Error('No root volume configuration provided');
      }

      console.log(`🔧 Using ONLY root volume configuration:`, rootVolume);

      const command = new RunInstancesCommand({
        ImageId: request.amiId,
        InstanceType: request.instanceType as any,
        MinCount: 1,
        MaxCount: 1,
        KeyName: request.keyPairId,
        SecurityGroupIds: request.securityGroupIds.length > 0 ? request.securityGroupIds : ['default'],
        UserData: userData ? Buffer.from(userData).toString('base64') : undefined,
        // CRITICAL: Only specify ONE block device mapping for the root volume
        BlockDeviceMappings: [
          {
            DeviceName: '/dev/xvda', // Root volume device name
            Ebs: {
              VolumeSize: rootVolume.size,
              VolumeType: rootVolume.type,
              Encrypted: rootVolume.encrypted,
              DeleteOnTermination: rootVolume.deleteOnTermination,
              Iops: rootVolume.iops,
              Throughput: rootVolume.throughput,
            },
          }
          // NO additional volumes - this prevents the second volume issue
        ],
        TagSpecifications: [
          {
            ResourceType: 'instance',
            Tags: tags,
          },
        ],
        InstanceMarketOptions: request.isSpotInstance ? {
          MarketType: 'spot',
          SpotOptions: {
            SpotInstanceType: 'one-time',
          },
        } : undefined,
      });

      console.log(`📋 Final launch command block device mappings:`, command.BlockDeviceMappings);

      const response = await ec2Client.send(command);
      const instance = response.Instances?.[0];

      if (!instance) {
        throw new Error('Failed to launch instance - no instance returned');
      }

      console.log(`✅ Instance launched successfully: ${instance.InstanceId}`);
      console.log(`📦 Instance volumes:`, instance.BlockDeviceMappings);

      await new Promise(resolve => setTimeout(resolve, 2000));

      return {
        instanceId: instance.InstanceId!,
        privateIp: instance.PrivateIpAddress || '10.0.0.1',
        publicIp: instance.PublicIpAddress,
        availabilityZone: instance.Placement?.AvailabilityZone || `${request.region}a`,
      };
    } catch (error) {
      console.error('❌ Failed to launch instance:', error);
      throw error;
    }
  }

  async terminateInstance(instanceId: string): Promise<void> {
    const ec2Client = createEC2Client();
    if (!ec2Client) {
      throw new Error('Failed to create AWS client');
    }

    try {
      const command = new TerminateInstancesCommand({
        InstanceIds: [instanceId],
      });

      await ec2Client.send(command);
      console.log(`✅ Instance ${instanceId} termination initiated`);
    } catch (error) {
      console.error('❌ Failed to terminate instance:', error);
      throw error;
    }
  }

  async startInstance(instanceId: string): Promise<void> {
    const ec2Client = createEC2Client();
    if (!ec2Client) {
      throw new Error('Failed to create AWS client');
    }

    try {
      const instance = await this.getInstanceDetails(instanceId);
      
      if (instance?.SpotInstanceRequestId) {
        throw new Error('Cannot start Spot instances. Spot instances are terminated when stopped and cannot be restarted. You need to launch a new instance.');
      }

      const command = new StartInstancesCommand({
        InstanceIds: [instanceId],
      });

      await ec2Client.send(command);
      console.log(`✅ Instance ${instanceId} start initiated`);
    } catch (error) {
      console.error('❌ Failed to start instance:', error);
      throw error;
    }
  }

  async stopInstance(instanceId: string): Promise<void> {
    const ec2Client = createEC2Client();
    if (!ec2Client) {
      throw new Error('Failed to create AWS client');
    }

    try {
      const instance = await this.getInstanceDetails(instanceId);
      
      if (instance?.SpotInstanceRequestId) {
        throw new Error('Cannot stop Spot instances. Spot instances can only be terminated. Use the terminate action instead.');
      }

      const command = new StopInstancesCommand({
        InstanceIds: [instanceId],
      });

      await ec2Client.send(command);
      console.log(`✅ Instance ${instanceId} stop initiated`);
    } catch (error) {
      console.error('❌ Failed to stop instance:', error);
      throw error;
    }
  }

  async getInstanceDetails(instanceId: string): Promise<Instance | null> {
    const ec2Client = createEC2Client();
    if (!ec2Client) {
      return null;
    }

    try {
      const command = new DescribeInstancesCommand({
        InstanceIds: [instanceId],
      });

      const response = await ec2Client.send(command);
      const reservation = response.Reservations?.[0];
      return reservation?.Instances?.[0] || null;
    } catch (error) {
      console.error('❌ Failed to get instance details:', error);
      return null;
    }
  }

  // ==========================================
  // HELPER METHODS
  // ==========================================
  private async getInstanceStatusChecks(instanceId: string) {
    const ec2Client = createEC2Client();
    if (!ec2Client) return null;

    try {
      const command = new DescribeInstanceStatusCommand({
        InstanceIds: [instanceId],
        IncludeAllInstances: true
      });

      const response = await ec2Client.send(command);
      const status = response.InstanceStatuses?.[0];

      if (!status) {
        return {
          instanceStatus: 'unknown',
          systemStatus: 'unknown',
          isSSHReady: false
        };
      }

      const instanceStatus = status.InstanceStatus?.Status || 'unknown';
      const systemStatus = status.SystemStatus?.Status || 'unknown';
      const isSSHReady = instanceStatus === 'ok' && systemStatus === 'ok';

      return {
        instanceStatus,
        systemStatus,
        isSSHReady
      };
    } catch (error) {
      console.warn('⚠️ Failed to get instance status checks:', error);
      return {
        instanceStatus: 'unknown',
        systemStatus: 'unknown',
        isSSHReady: false
      };
    }
  }

  private mapInstanceState(awsState: string): EC2Instance['state'] {
    switch (awsState) {
      case 'pending': return 'pending';
      case 'running': return 'running';
      case 'shutting-down': return 'stopping';
      case 'terminated': return 'terminated';
      case 'stopping': return 'stopping';
      case 'stopped': return 'stopped';
      default: return 'pending';
    }
  }

  private generateDockerInstallScript(dockerImage?: string): string {
    let script = `#!/bin/bash
set -e

# Redirect all output to log file and console
exec > >(tee -a /var/log/docker-install.log)
exec 2>&1

echo "🐳 Starting Docker installation and setup..."
echo "$(date): Docker installation started"

# Update system
echo "📦 Updating system packages..."
apt-get update -y

# Install Docker dependencies
echo "🔧 Installing Docker dependencies..."
apt-get install -y \\
    ca-certificates \\
    curl \\
    gnupg \\
    lsb-release \\
    wget \\
    unzip

# Add Docker's official GPG key
echo "🔑 Adding Docker GPG key..."
mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Set up the repository
echo "📋 Setting up Docker repository..."
echo \\
  "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \\
  \$(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
echo "🐳 Installing Docker Engine..."
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Start and enable Docker
echo "🚀 Starting Docker service..."
systemctl start docker
systemctl enable docker

# Add ubuntu user to docker group
echo "👤 Adding ubuntu user to docker group..."
usermod -aG docker ubuntu

# Install Docker Compose (standalone) - latest version
echo "🔧 Installing Docker Compose..."
DOCKER_COMPOSE_VERSION=\$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep 'tag_name' | cut -d'"' -f4)
curl -L "https://github.com/docker/compose/releases/download/\${DOCKER_COMPOSE_VERSION}/docker-compose-\$(uname -s)-\$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Create symlink for docker-compose
ln -sf /usr/local/bin/docker-compose /usr/bin/docker-compose

# Wait for Docker to be fully ready
echo "⏳ Waiting for Docker to be ready..."
sleep 15

# Test Docker installation
echo "🧪 Testing Docker installation..."
docker --version
docker-compose --version

# Test Docker functionality
echo "🔍 Testing Docker functionality..."
docker run --rm hello-world

echo "✅ Docker installation completed successfully!"
echo "$(date): Docker installation completed"`;

    if (dockerImage) {
      script += `

# Pull and run the specified Docker image
echo "📦 Pulling and running Docker image: ${dockerImage}"
echo "$(date): Starting Docker image deployment: ${dockerImage}"

# Pull the image first
echo "⬇️ Pulling Docker image..."
docker pull ${dockerImage}

# Wait for the pull to complete
sleep 10

echo "🚀 Starting container with image: ${dockerImage}"

# Auto-configure and run based on common images
if [[ "${dockerImage}" == *"minecraft"* ]]; then
    echo "🎮 Detected Minecraft server image"
    echo "$(date): Deploying Minecraft server"
    
    # Create minecraft data directory
    mkdir -p /opt/minecraft-data
    chown ubuntu:ubuntu /opt/minecraft-data
    
    # Stop any existing container
    docker stop minecraft-server 2>/dev/null || true
    docker rm minecraft-server 2>/dev/null || true
    
    # Run Minecraft server with proper configuration
    docker run -d \\
        --name minecraft-server \\
        --restart unless-stopped \\
        -p 25565:25565 \\
        -v /opt/minecraft-data:/data \\
        -e EULA=TRUE \\
        -e TYPE=VANILLA \\
        -e DIFFICULTY=normal \\
        -e MODE=survival \\
        -e MAX_PLAYERS=20 \\
        -e MEMORY=2G \\
        ${dockerImage}
    
    echo "🎮 Minecraft server started on port 25565"
    echo "📁 Data stored in: /opt/minecraft-data"
    
elif [[ "${dockerImage}" == *"palworld"* ]]; then
    echo "🦄 Detected Palworld server image"
    echo "$(date): Deploying Palworld server"
    
    # Create palworld data directory
    mkdir -p /opt/palworld-data
    chown ubuntu:ubuntu /opt/palworld-data
    
    # Stop any existing container
    docker stop palworld-server 2>/dev/null || true
    docker rm palworld-server 2>/dev/null || true
    
    # Run Palworld server
    docker run -d \\
        --name palworld-server \\
        --restart unless-stopped \\
        -p 8211:8211/udp \\
        -p 27015:27015/udp \\
        -v /opt/palworld-data:/palworld \\
        -e PUID=1000 \\
        -e PGID=1000 \\
        -e PLAYERS=16 \\
        -e SERVER_PASSWORD=changeme123 \\
        -e MULTITHREADING=true \\
        ${dockerImage}
    
    echo "🦄 Palworld server started on port 8211"
    echo "🔑 Default password: changeme123"
    echo "📁 Data stored in: /opt/palworld-data"
    
elif [[ "${dockerImage}" == *"valheim"* ]]; then
    echo "⚔️ Detected Valheim server image"
    echo "$(date): Deploying Valheim server"
    
    # Create valheim data directory
    mkdir -p /opt/valheim-data
    chown ubuntu:ubuntu /opt/valheim-data
    
    # Stop any existing container
    docker stop valheim-server 2>/dev/null || true
    docker rm valheim-server 2>/dev/null || true
    
    # Run Valheim server
    docker run -d \\
        --name valheim-server \\
        --restart unless-stopped \\
        -p 2456:2456/udp \\
        -p 2457:2457/udp \\
        -p 2458:2458/udp \\
        -v /opt/valheim-data:/config \\
        -e SERVER_NAME="My Valheim Server" \\
        -e WORLD_NAME="MyWorld" \\
        -e SERVER_PASS="changeme123" \\
        -e SERVER_PUBLIC=false \\
        ${dockerImage}
    
    echo "⚔️ Valheim server started on ports 2456-2458"
    echo "🔑 Default password: changeme123"
    echo "📁 Data stored in: /opt/valheim-data"
    
elif [[ "${dockerImage}" == *"nginx"* ]]; then
    echo "🌐 Detected Nginx web server"
    echo "$(date): Deploying Nginx server"
    
    # Create nginx content directory
    mkdir -p /opt/nginx-content
    chown ubuntu:ubuntu /opt/nginx-content
    
    # Create a simple index.html
    cat > /opt/nginx-content/index.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>Welcome to Nginx on AWS EC2</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f4f4f4; }
        .container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; }
        .status { background: #e8f5e8; padding: 15px; border-radius: 4px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Nginx Server Running Successfully!</h1>
        <div class="status">
            <strong>Status:</strong> ✅ Active and running<br>
            <strong>Server:</strong> Nginx in Docker container<br>
            <strong>Platform:</strong> AWS EC2 Instance
        </div>
        <p>Your Nginx web server is now running and accessible from the internet.</p>
        <p>You can replace this page by updating files in <code>/opt/nginx-content/</code></p>
    </div>
</body>
</html>
EOF
    
    # Stop any existing container
    docker stop nginx-server 2>/dev/null || true
    docker rm nginx-server 2>/dev/null || true
    
    # Run Nginx server
    docker run -d \\
        --name nginx-server \\
        --restart unless-stopped \\
        -p 80:80 \\
        -p 443:443 \\
        -v /opt/nginx-content:/usr/share/nginx/html \\
        ${dockerImage}
    
    echo "🌐 Nginx server started on port 80"
    echo "📁 Content directory: /opt/nginx-content"
    
elif [[ "${dockerImage}" == *"apache"* ]] || [[ "${dockerImage}" == *"httpd"* ]]; then
    echo "🌐 Detected Apache web server"
    echo "$(date): Deploying Apache server"
    
    # Create apache content directory
    mkdir -p /opt/apache-content
    chown ubuntu:ubuntu /opt/apache-content
    
    # Create a simple index.html
    cat > /opt/apache-content/index.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>Welcome to Apache on AWS EC2</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f4f4f4; }
        .container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; }
        .status { background: #e8f5e8; padding: 15px; border-radius: 4px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Apache Server Running Successfully!</h1>
        <div class="status">
            <strong>Status:</strong> ✅ Active and running<br>
            <strong>Server:</strong> Apache in Docker container<br>
            <strong>Platform:</strong> AWS EC2 Instance
        </div>
        <p>Your Apache web server is now running and accessible from the internet.</p>
        <p>You can replace this page by updating files in <code>/opt/apache-content/</code></p>
    </div>
</body>
</html>
EOF
    
    # Stop any existing container
    docker stop apache-server 2>/dev/null || true
    docker rm apache-server 2>/dev/null || true
    
    # Run Apache server
    docker run -d \\
        --name apache-server \\
        --restart unless-stopped \\
        -p 80:80 \\
        -p 443:443 \\
        -v /opt/apache-content:/usr/local/apache2/htdocs \\
        ${dockerImage}
    
    echo "🌐 Apache server started on port 80"
    echo "📁 Content directory: /opt/apache-content"
    
elif [[ "${dockerImage}" == *"postgres"* ]]; then
    echo "🗄️ Detected PostgreSQL database"
    echo "$(date): Deploying PostgreSQL database"
    
    # Create postgres data directory
    mkdir -p /opt/postgres-data
    chown ubuntu:ubuntu /opt/postgres-data
    
    # Stop any existing container
    docker stop postgres-db 2>/dev/null || true
    docker rm postgres-db 2>/dev/null || true
    
    # Run PostgreSQL
    docker run -d \\
        --name postgres-db \\
        --restart unless-stopped \\
        -p 5432:5432 \\
        -v /opt/postgres-data:/var/lib/postgresql/data \\
        -e POSTGRES_PASSWORD=changeme123 \\
        -e POSTGRES_DB=myapp \\
        ${dockerImage}
    
    echo "🗄️ PostgreSQL started on port 5432"
    echo "🔑 Default password: changeme123"
    echo "📁 Data stored in: /opt/postgres-data"
    
elif [[ "${dockerImage}" == *"mysql"* ]]; then
    echo "🗄️ Detected MySQL database"
    echo "$(date): Deploying MySQL database"
    
    # Create mysql data directory
    mkdir -p /opt/mysql-data
    chown ubuntu:ubuntu /opt/mysql-data
    
    # Stop any existing container
    docker stop mysql-db 2>/dev/null || true
    docker rm mysql-db 2>/dev/null || true
    
    # Run MySQL
    docker run -d \\
        --name mysql-db \\
        --restart unless-stopped \\
        -p 3306:3306 \\
        -v /opt/mysql-data:/var/lib/mysql \\
        -e MYSQL_ROOT_PASSWORD=changeme123 \\
        -e MYSQL_DATABASE=myapp \\
        ${dockerImage}
    
    echo "🗄️ MySQL started on port 3306"
    echo "🔑 Root password: changeme123"
    echo "📁 Data stored in: /opt/mysql-data"
    
elif [[ "${dockerImage}" == *"redis"* ]]; then
    echo "⚡ Detected Redis cache"
    echo "$(date): Deploying Redis cache"
    
    # Create redis data directory
    mkdir -p /opt/redis-data
    chown ubuntu:ubuntu /opt/redis-data
    
    # Stop any existing container
    docker stop redis-cache 2>/dev/null || true
    docker rm redis-cache 2>/dev/null || true
    
    # Run Redis
    docker run -d \\
        --name redis-cache \\
        --restart unless-stopped \\
        -p 6379:6379 \\
        -v /opt/redis-data:/data \\
        ${dockerImage} redis-server --appendonly yes
    
    echo "⚡ Redis started on port 6379"
    echo "📁 Data stored in: /opt/redis-data"
    
else
    echo "📦 Running generic container"
    echo "$(date): Deploying generic container"
    
    # Stop any existing container
    docker stop custom-service 2>/dev/null || true
    docker rm custom-service 2>/dev/null || true
    
    # For generic images, try to run with common configurations
    if [[ "${dockerImage}" == *"node"* ]] || [[ "${dockerImage}" == *"express"* ]] || [[ "${dockerImage}" == *"app"* ]]; then
        # Likely a web application
        docker run -d \\
            --name custom-service \\
            --restart unless-stopped \\
            -p 3000:3000 \\
            -p 8080:8080 \\
            ${dockerImage}
        echo "🌐 Application started on ports 3000 and 8080"
    else
        # Generic container
        docker run -d \\
            --name custom-service \\
            --restart unless-stopped \\
            ${dockerImage}
        echo "📦 Container started with image: ${dockerImage}"
    fi
fi

# Wait for container to start properly
echo "⏳ Waiting for container to start..."
sleep 15

# Verify container is running
echo "🔍 Verifying container status..."
RUNNING_CONTAINERS=\$(docker ps --format "table {{.Names}}\\t{{.Status}}" | grep -v NAMES)
if [ ! -z "\$RUNNING_CONTAINERS" ]; then
    echo "✅ Container(s) running successfully:"
    echo "\$RUNNING_CONTAINERS"
    echo "$(date): Container deployment completed successfully"
    
    # Show container details
    echo "📊 Container details:"
    docker ps --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}"
    
    # Show logs for verification
    echo "📋 Recent container logs:"
    CONTAINER_NAME=\$(docker ps --format "{{.Names}}" | head -1)
    if [ ! -z "\$CONTAINER_NAME" ]; then
        docker logs --tail 10 \$CONTAINER_NAME
    fi
else
    echo "⚠️ No containers appear to be running"
    echo "$(date): Container deployment may have failed"
    echo "📋 All containers status:"
    docker ps -a
    echo "📋 Recent logs:"
    docker logs \$(docker ps -aq | head -1) --tail 20 2>/dev/null || echo "No logs available"
fi

# Show final status
echo "📊 Final Docker status:"
docker --version
docker-compose --version
echo "🐳 Running containers:"
docker ps

echo "✅ Docker image deployment completed!"
echo "📋 Check /var/log/docker-install.log for detailed logs"
echo "🔧 Use 'docker ps' to see running containers"
echo "📊 Use 'docker logs <container-name>' to see container logs"

# Mark installation as complete
echo "DOCKER_INSTALLATION_COMPLETE" > /tmp/docker-install-complete
echo "$(date): Docker installation and deployment marked as complete"`;
    }

    return script;
  }
}