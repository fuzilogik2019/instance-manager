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
        let dockerScript = '';
        if (request.useDockerCompose && request.dockerComposePath && request.dockerComposeContent) {
          dockerScript = this.generateDockerInstallScript(undefined, request.dockerComposePath, request.dockerComposeContent);
        } else {
          dockerScript = this.generateDockerInstallScript(request.dockerImageToPull);
        }
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
            DeviceName: request.rootDeviceName || '/dev/xvda', // Usar el rootDeviceName del AMI
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

  private generateDockerInstallScript(dockerImage?: string, dockerComposePath?: string, dockerComposeContent?: string): string {
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
apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    wget \
    unzip

# Add Docker's official GPG key
echo "🔑 Adding Docker GPG key..."
mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Set up the repository
echo "📋 Setting up Docker repository..."
echo \
  "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
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

    // Si se usa docker-compose, crear el archivo y ejecutarlo
    if (dockerComposePath && dockerComposeContent) {
      script += `

# Crear directorio para docker-compose
mkdir -p ${dockerComposePath}
chown ubuntu:ubuntu ${dockerComposePath}

# Guardar el archivo docker-compose.yml
cat > ${dockerComposePath}/docker-compose.yml << 'EOF'
${dockerComposeContent}
EOF

# Ejecutar docker compose up -d
cd ${dockerComposePath}
docker compose up -d
chown -R ubuntu:ubuntu ${dockerComposePath}

# Mostrar estado de los contenedores
sleep 5
docker compose ps

echo "✅ docker-compose.yml desplegado y contenedores iniciados."
`;
      return script;
    }

    return script;
  }
}