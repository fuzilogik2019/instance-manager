import {
  EC2Client,
  RunInstancesCommand,
  TerminateInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  DescribeInstancesCommand,
  DescribeRegionsCommand,
  DescribeInstanceTypesCommand,
  DescribeSecurityGroupsCommand,
  DescribeKeyPairsCommand,
  DescribeVolumesCommand,
  CreateVolumeCommand,
  AttachVolumeCommand,
  DetachVolumeCommand,
  DeleteVolumeCommand,
  CreateSecurityGroupCommand,
  CreateKeyPairCommand,
  ImportKeyPairCommand,
  DeleteKeyPairCommand,
  DeleteSecurityGroupCommand,
  DescribeImagesCommand,
  DescribeAvailabilityZonesCommand,
  AuthorizeSecurityGroupIngressCommand,
  RevokeSecurityGroupIngressCommand,
  Instance,
  InstanceType as AWSInstanceType,
} from '@aws-sdk/client-ec2';
import { createEC2Client, isAWSConfigured } from '../config/aws.js';
import { InstanceCreationRequest, EC2Instance, AWSRegion, InstanceType } from '../../src/types/aws.js';

export class AWSService {
  private ec2Client: EC2Client | null;
  private mockMode: boolean;

  constructor(region?: string) {
    this.mockMode = !isAWSConfigured();
    this.ec2Client = this.mockMode ? null : createEC2Client(region);
    
    if (this.mockMode) {
      console.log('AWS Service running in mock mode - no real AWS operations will be performed');
    }
  }

  // Instance Management
  async launchInstance(request: InstanceCreationRequest): Promise<{ instanceId: string; publicIp?: string; privateIp: string; availabilityZone: string }> {
    if (this.mockMode) {
      return this.mockLaunchInstance(request);
    }

    if (!this.ec2Client) {
      throw new Error('AWS client not configured');
    }

    try {
      // Get the latest Amazon Linux 2 AMI for the region
      const amiId = await this.getLatestAmazonLinuxAMI(request.region);
      
      console.log(`Launching instance with AMI: ${amiId} in region: ${request.region}`);

      // Prepare tags - avoid duplicates
      const tags = [];
      
      // Add Name tag first
      tags.push({
        Key: 'Name',
        Value: request.name,
      });

      // Add other tags, but skip if Name already exists
      Object.entries(request.tags).forEach(([key, value]) => {
        if (key !== 'Name') {
          tags.push({
            Key: key,
            Value: value,
          });
        }
      });

      const command = new RunInstancesCommand({
        ImageId: amiId,
        InstanceType: request.instanceType as any,
        MinCount: 1,
        MaxCount: 1,
        KeyName: request.keyPairId,
        SecurityGroupIds: request.securityGroupIds.length > 0 ? request.securityGroupIds : ['default'],
        UserData: request.userData ? Buffer.from(request.userData).toString('base64') : undefined,
        BlockDeviceMappings: request.volumes.map((volume, index) => ({
          DeviceName: index === 0 ? '/dev/xvda' : `/dev/xvd${String.fromCharCode(98 + index)}`,
          Ebs: {
            VolumeSize: volume.size,
            VolumeType: volume.type,
            Encrypted: volume.encrypted,
            DeleteOnTermination: volume.deleteOnTermination,
            Iops: volume.iops,
            Throughput: volume.throughput,
          },
        })),
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

      const response = await this.ec2Client.send(command);
      const instance = response.Instances?.[0];

      if (!instance) {
        throw new Error('Failed to launch instance - no instance returned');
      }

      console.log(`Instance launched successfully: ${instance.InstanceId}`);

      // If we have existing volumes to attach, do it after instance is running
      if (request.existingVolumeIds && request.existingVolumeIds.length > 0) {
        console.log(`Will attach ${request.existingVolumeIds.length} existing volumes after instance starts`);
        
        // Wait for instance to be running before attaching volumes
        setTimeout(async () => {
          try {
            await this.waitForInstanceRunning(instance.InstanceId!);
            await this.attachExistingVolumes(instance.InstanceId!, request.existingVolumeIds!);
          } catch (error) {
            console.error('Failed to attach existing volumes:', error);
          }
        }, 10000); // Wait 10 seconds before trying to attach
      }

      // Wait a moment for the instance to initialize
      await new Promise(resolve => setTimeout(resolve, 2000));

      return {
        instanceId: instance.InstanceId!,
        privateIp: instance.PrivateIpAddress || '10.0.0.1',
        publicIp: instance.PublicIpAddress,
        availabilityZone: instance.Placement?.AvailabilityZone || `${request.region}a`,
      };
    } catch (error) {
      console.error('Failed to launch instance:', error);
      throw error;
    }
  }

  // Wait for instance to be in running state
  private async waitForInstanceRunning(instanceId: string, maxWaitTime = 300000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const instance = await this.getInstanceDetails(instanceId);
        if (instance?.State?.Name === 'running') {
          console.log(`Instance ${instanceId} is now running`);
          return;
        }
        console.log(`Instance ${instanceId} state: ${instance?.State?.Name}, waiting...`);
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
      } catch (error) {
        console.error('Error checking instance state:', error);
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
    
    throw new Error(`Instance ${instanceId} did not reach running state within ${maxWaitTime/1000} seconds`);
  }

  // Attach existing volumes to instance
  private async attachExistingVolumes(instanceId: string, volumeIds: string[]): Promise<void> {
    console.log(`Attaching ${volumeIds.length} volumes to instance ${instanceId}`);
    
    for (let i = 0; i < volumeIds.length; i++) {
      const volumeId = volumeIds[i];
      // Use device names starting from /dev/sdf (AWS recommended for additional volumes)
      const device = `/dev/sd${String.fromCharCode(102 + i)}`; // f, g, h, i, etc.
      
      try {
        await this.attachVolume(volumeId, instanceId, device);
        console.log(`Successfully attached volume ${volumeId} to ${instanceId} as ${device}`);
      } catch (error) {
        console.error(`Failed to attach volume ${volumeId}:`, error);
      }
    }
  }

  private async getLatestAmazonLinuxAMI(region: string): Promise<string> {
    const regionClient = createEC2Client(region);
    if (!regionClient) {
      throw new Error('AWS client not configured');
    }

    try {
      const command = new DescribeImagesCommand({
        Owners: ['amazon'],
        Filters: [
          {
            Name: 'name',
            Values: ['amzn2-ami-hvm-*-x86_64-gp2'],
          },
          {
            Name: 'state',
            Values: ['available'],
          },
          {
            Name: 'architecture',
            Values: ['x86_64'],
          },
        ],
      });

      const response = await regionClient.send(command);
      
      if (!response.Images || response.Images.length === 0) {
        throw new Error('No Amazon Linux 2 AMIs found');
      }

      // Sort by creation date and get the latest
      const sortedImages = response.Images.sort((a, b) => {
        const dateA = new Date(a.CreationDate || 0);
        const dateB = new Date(b.CreationDate || 0);
        return dateB.getTime() - dateA.getTime();
      });

      const latestAMI = sortedImages[0];
      console.log(`Using AMI: ${latestAMI.ImageId} (${latestAMI.Name})`);
      
      return latestAMI.ImageId!;
    } catch (error) {
      console.error('Failed to get latest AMI, using fallback:', error);
      // Fallback to known AMI IDs
      return this.getAMIForRegion(region);
    }
  }

  async terminateInstance(instanceId: string): Promise<void> {
    if (this.mockMode) {
      console.log(`Mock: Terminating instance ${instanceId}`);
      return;
    }

    if (!this.ec2Client) {
      throw new Error('AWS client not configured');
    }

    try {
      const command = new TerminateInstancesCommand({
        InstanceIds: [instanceId],
      });

      await this.ec2Client.send(command);
      console.log(`Instance ${instanceId} termination initiated`);
    } catch (error) {
      console.error('Failed to terminate instance:', error);
      throw error;
    }
  }

  async startInstance(instanceId: string): Promise<void> {
    if (this.mockMode) {
      console.log(`Mock: Starting instance ${instanceId}`);
      return;
    }

    if (!this.ec2Client) {
      throw new Error('AWS client not configured');
    }

    try {
      // First check if this is a spot instance
      const instance = await this.getInstanceDetails(instanceId);
      
      if (instance?.SpotInstanceRequestId) {
        throw new Error('Cannot start Spot instances. Spot instances are terminated when stopped and cannot be restarted. You need to launch a new instance.');
      }

      const command = new StartInstancesCommand({
        InstanceIds: [instanceId],
      });

      await this.ec2Client.send(command);
      console.log(`Instance ${instanceId} start initiated`);
    } catch (error) {
      console.error('Failed to start instance:', error);
      throw error;
    }
  }

  async stopInstance(instanceId: string): Promise<void> {
    if (this.mockMode) {
      console.log(`Mock: Stopping instance ${instanceId}`);
      return;
    }

    if (!this.ec2Client) {
      throw new Error('AWS client not configured');
    }

    try {
      // First check if this is a spot instance
      const instance = await this.getInstanceDetails(instanceId);
      
      if (instance?.SpotInstanceRequestId) {
        throw new Error('Cannot stop Spot instances. Spot instances can only be terminated. Use the terminate action instead.');
      }

      const command = new StopInstancesCommand({
        InstanceIds: [instanceId],
      });

      await this.ec2Client.send(command);
      console.log(`Instance ${instanceId} stop initiated`);
    } catch (error) {
      console.error('Failed to stop instance:', error);
      throw error;
    }
  }

  async getInstanceDetails(instanceId: string): Promise<Instance | null> {
    if (this.mockMode) {
      return null;
    }

    if (!this.ec2Client) {
      throw new Error('AWS client not configured');
    }

    try {
      const command = new DescribeInstancesCommand({
        InstanceIds: [instanceId],
      });

      const response = await this.ec2Client.send(command);
      const reservation = response.Reservations?.[0];
      return reservation?.Instances?.[0] || null;
    } catch (error) {
      console.error('Failed to get instance details:', error);
      return null;
    }
  }

  // Check if instance is a spot instance
  async isSpotInstance(instanceId: string): Promise<boolean> {
    if (this.mockMode) {
      return false;
    }

    try {
      const instance = await this.getInstanceDetails(instanceId);
      return !!(instance?.SpotInstanceRequestId);
    } catch (error) {
      console.error('Failed to check if instance is spot:', error);
      return false;
    }
  }

  // Get availability zones for a region
  async getAvailabilityZones(region: string): Promise<string[]> {
    if (this.mockMode) {
      return [`${region}a`, `${region}b`, `${region}c`];
    }

    const regionClient = createEC2Client(region);
    if (!regionClient) {
      throw new Error('AWS client not configured');
    }

    try {
      const command = new DescribeAvailabilityZonesCommand({});
      const response = await regionClient.send(command);

      return response.AvailabilityZones?.map(az => az.ZoneName!) || [`${region}a`];
    } catch (error) {
      console.error('Failed to get availability zones:', error);
      return [`${region}a`, `${region}b`, `${region}c`];
    }
  }

  // Region and Instance Type Information
  async getRegions(): Promise<AWSRegion[]> {
    if (this.mockMode) {
      return this.getMockRegions();
    }

    if (!this.ec2Client) {
      throw new Error('AWS client not configured');
    }

    try {
      const command = new DescribeRegionsCommand({});
      const response = await this.ec2Client.send(command);

      return response.Regions?.map(region => ({
        code: region.RegionName!,
        name: region.RegionName!,
        location: region.RegionName!,
      })) || [];
    } catch (error) {
      console.error('Failed to get regions:', error);
      return this.getMockRegions();
    }
  }

  async getInstanceTypes(region: string): Promise<InstanceType[]> {
    if (this.mockMode) {
      return this.getMockInstanceTypes();
    }

    const regionClient = createEC2Client(region);
    if (!regionClient) {
      throw new Error('AWS client not configured');
    }

    try {
      const command = new DescribeInstanceTypesCommand({
        InstanceTypes: [
          't3.nano', 't3.micro', 't3.small', 't3.medium', 't3.large', 't3.xlarge',
          'm5.large', 'm5.xlarge', 'm5.2xlarge',
          'c5.large', 'c5.xlarge',
          'r5.large', 'r5.xlarge'
        ],
      });

      const response = await regionClient.send(command);

      return response.InstanceTypes?.map(type => ({
        name: type.InstanceType!,
        vcpu: type.VCpuInfo?.DefaultVCpus || 0,
        memory: type.MemoryInfo?.SizeInMiB ? type.MemoryInfo.SizeInMiB / 1024 : 0,
        storage: type.InstanceStorageInfo?.TotalSizeInGB ? `${type.InstanceStorageInfo.TotalSizeInGB} GB` : 'EBS-Only',
        network: type.NetworkInfo?.NetworkPerformance || 'Unknown',
        onDemandPrice: 0, // Would need to call AWS Pricing API
        spotPrice: 0, // Would need to call AWS EC2 Spot Price API
      })) || [];
    } catch (error) {
      console.error('Failed to get instance types:', error);
      return this.getMockInstanceTypes();
    }
  }

  // Security Groups
  async getSecurityGroups(region: string): Promise<any[]> {
    if (this.mockMode) {
      return [{
        id: 'sg-default',
        name: 'default',
        description: 'Default security group',
        region,
        rules: []
      }];
    }

    const regionClient = createEC2Client(region);
    if (!regionClient) {
      throw new Error('AWS client not configured');
    }

    try {
      const command = new DescribeSecurityGroupsCommand({});
      const response = await regionClient.send(command);

      return response.SecurityGroups?.map(sg => ({
        id: sg.GroupId!,
        name: sg.GroupName!,
        description: sg.Description!,
        region,
        rules: sg.IpPermissions?.map(rule => ({
          id: `${sg.GroupId}-${rule.IpProtocol}-${rule.FromPort}-${rule.ToPort}`,
          protocol: rule.IpProtocol!,
          fromPort: rule.FromPort || 0,
          toPort: rule.ToPort || 0,
          source: rule.IpRanges?.[0]?.CidrIp || '0.0.0.0/0',
          description: rule.IpRanges?.[0]?.Description || '',
        })) || [],
      })) || [];
    } catch (error) {
      console.error('Failed to get security groups:', error);
      return [];
    }
  }

  async createSecurityGroup(securityGroup: any): Promise<any> {
    if (this.mockMode) {
      return {
        id: `sg-${Math.random().toString(36).substr(2, 17)}`,
        ...securityGroup,
      };
    }

    const regionClient = createEC2Client(securityGroup.region);
    if (!regionClient) {
      throw new Error('AWS client not configured');
    }

    try {
      const command = new CreateSecurityGroupCommand({
        GroupName: securityGroup.name,
        Description: securityGroup.description,
      });

      const response = await regionClient.send(command);
      const groupId = response.GroupId!;

      // Add rules if provided
      if (securityGroup.rules && securityGroup.rules.length > 0) {
        await this.updateSecurityGroupRules(groupId, [], securityGroup.rules, securityGroup.region);
      }

      return {
        id: groupId,
        name: securityGroup.name,
        description: securityGroup.description,
        region: securityGroup.region,
        rules: securityGroup.rules || [],
      };
    } catch (error) {
      console.error('Failed to create security group in AWS:', error);
      throw error;
    }
  }

  async updateSecurityGroup(id: string, updates: any): Promise<any> {
    if (this.mockMode) {
      return { id, ...updates };
    }

    // Note: AWS doesn't allow updating name/description of existing security groups
    // We can only update rules
    if (updates.rules) {
      // Get current rules first
      const currentSG = await this.getSecurityGroupById(id);
      if (currentSG) {
        await this.updateSecurityGroupRules(id, currentSG.rules, updates.rules, currentSG.region);
      }
    }

    return { id, ...updates };
  }

  private async getSecurityGroupById(id: string): Promise<any> {
    if (!this.ec2Client) {
      throw new Error('AWS client not configured');
    }

    try {
      const command = new DescribeSecurityGroupsCommand({
        GroupIds: [id],
      });

      const response = await this.ec2Client.send(command);
      const sg = response.SecurityGroups?.[0];

      if (!sg) return null;

      return {
        id: sg.GroupId!,
        name: sg.GroupName!,
        description: sg.Description!,
        rules: sg.IpPermissions?.map(rule => ({
          id: `${sg.GroupId}-${rule.IpProtocol}-${rule.FromPort}-${rule.ToPort}`,
          protocol: rule.IpProtocol!,
          fromPort: rule.FromPort || 0,
          toPort: rule.ToPort || 0,
          source: rule.IpRanges?.[0]?.CidrIp || '0.0.0.0/0',
          description: rule.IpRanges?.[0]?.Description || '',
        })) || [],
      };
    } catch (error) {
      console.error('Failed to get security group by ID:', error);
      return null;
    }
  }

  private async updateSecurityGroupRules(groupId: string, currentRules: any[], newRules: any[], region: string): Promise<void> {
    const regionClient = createEC2Client(region);
    if (!regionClient) {
      throw new Error('AWS client not configured');
    }

    console.log(`Updating security group: ${groupId}`);
    console.log(`Current rules:`, currentRules);
    console.log(`New rules:`, newRules);

    // Create a function to normalize rules for comparison
    const normalizeRule = (rule: any) => ({
      protocol: rule.protocol,
      fromPort: rule.fromPort,
      toPort: rule.toPort,
      source: rule.source,
    });

    // Find rules to remove (in current but not in new)
    const rulesToRemove = currentRules.filter(currentRule => {
      const normalizedCurrent = normalizeRule(currentRule);
      return !newRules.some(newRule => {
        const normalizedNew = normalizeRule(newRule);
        return JSON.stringify(normalizedCurrent) === JSON.stringify(normalizedNew);
      });
    });

    // Find rules to add (in new but not in current)
    const rulesToAdd = newRules.filter(newRule => {
      const normalizedNew = normalizeRule(newRule);
      return !currentRules.some(currentRule => {
        const normalizedCurrent = normalizeRule(currentRule);
        return JSON.stringify(normalizedNew) === JSON.stringify(normalizedCurrent);
      });
    });

    console.log(`Rules to remove:`, rulesToRemove);
    console.log(`Rules to add:`, rulesToAdd);

    // Remove old rules
    if (rulesToRemove.length > 0) {
      try {
        const revokeCommand = new RevokeSecurityGroupIngressCommand({
          GroupId: groupId,
          IpPermissions: rulesToRemove.map(rule => ({
            IpProtocol: rule.protocol,
            FromPort: rule.fromPort,
            ToPort: rule.toPort,
            IpRanges: [{ CidrIp: rule.source, Description: rule.description }],
          })),
        });

        await regionClient.send(revokeCommand);
        console.log(`Successfully revoked ${rulesToRemove.length} rules`);
      } catch (error) {
        console.warn('Failed to revoke some security group rules:', error);
      }
    }

    // Add new rules
    if (rulesToAdd.length > 0) {
      try {
        const authorizeCommand = new AuthorizeSecurityGroupIngressCommand({
          GroupId: groupId,
          IpPermissions: rulesToAdd.map(rule => ({
            IpProtocol: rule.protocol,
            FromPort: rule.fromPort,
            ToPort: rule.toPort,
            IpRanges: [{ CidrIp: rule.source, Description: rule.description }],
          })),
        });

        await regionClient.send(authorizeCommand);
        console.log(`Successfully authorized ${rulesToAdd.length} rules`);
      } catch (error) {
        console.error('Failed to authorize security group rules:', error);
        throw error;
      }
    }
  }

  async deleteSecurityGroup(id: string): Promise<void> {
    if (this.mockMode) {
      console.log(`Mock: Deleting security group ${id}`);
      return;
    }

    if (!this.ec2Client) {
      throw new Error('AWS client not configured');
    }

    try {
      const command = new DeleteSecurityGroupCommand({
        GroupId: id,
      });

      await this.ec2Client.send(command);
    } catch (error) {
      console.error('Failed to delete security group from AWS:', error);
      throw error;
    }
  }

  // Key Pairs
  async getKeyPairs(): Promise<any[]> {
    if (this.mockMode) {
      return [{
        id: 'kp-demo',
        name: 'demo-keypair',
        publicKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC...',
        fingerprint: '12:34:56:78:90:ab:cd:ef:12:34:56:78:90:ab:cd:ef',
        createdAt: new Date().toISOString()
      }];
    }

    if (!this.ec2Client) {
      throw new Error('AWS client not configured');
    }

    try {
      const command = new DescribeKeyPairsCommand({});
      const response = await this.ec2Client.send(command);

      return response.KeyPairs?.map(kp => ({
        id: kp.KeyPairId!,
        name: kp.KeyName!,
        publicKey: kp.PublicKeyMaterial || '',
        fingerprint: kp.KeyFingerprint!,
        createdAt: kp.CreateTime || new Date(),
      })) || [];
    } catch (error) {
      console.error('Failed to get key pairs:', error);
      return [];
    }
  }

  async createKeyPair(name: string): Promise<any> {
    if (this.mockMode) {
      return null;
    }

    if (!this.ec2Client) {
      throw new Error('AWS client not configured');
    }

    try {
      const command = new CreateKeyPairCommand({
        KeyName: name,
      });

      const response = await this.ec2Client.send(command);

      return {
        id: response.KeyPairId!,
        name: response.KeyName!,
        publicKey: response.PublicKeyMaterial || '',
        privateKey: response.KeyMaterial || '',
        fingerprint: response.KeyFingerprint!,
        createdAt: new Date(),
      };
    } catch (error) {
      console.error('Failed to create key pair in AWS:', error);
      return null;
    }
  }

  async importKeyPair(name: string, publicKey: string): Promise<any> {
    if (this.mockMode) {
      return null;
    }

    if (!this.ec2Client) {
      throw new Error('AWS client not configured');
    }

    try {
      const command = new ImportKeyPairCommand({
        KeyName: name,
        PublicKeyMaterial: Buffer.from(publicKey),
      });

      const response = await this.ec2Client.send(command);

      return {
        id: response.KeyPairId!,
        name: response.KeyName!,
        publicKey: publicKey,
        fingerprint: response.KeyFingerprint!,
        createdAt: new Date(),
      };
    } catch (error) {
      console.error('Failed to import key pair to AWS:', error);
      return null;
    }
  }

  async deleteKeyPair(keyName: string): Promise<void> {
    if (this.mockMode) {
      return;
    }

    if (!this.ec2Client) {
      throw new Error('AWS client not configured');
    }

    try {
      const command = new DeleteKeyPairCommand({
        KeyName: keyName,
      });

      await this.ec2Client.send(command);
    } catch (error) {
      console.error('Failed to delete key pair from AWS:', error);
      throw error;
    }
  }

  // Volumes
  async getVolumes(region: string): Promise<any[]> {
    if (this.mockMode) {
      return this.getMockVolumes(region);
    }

    const regionClient = createEC2Client(region);
    if (!regionClient) {
      throw new Error('AWS client not configured');
    }

    try {
      const command = new DescribeVolumesCommand({});
      const response = await regionClient.send(command);

      return response.Volumes?.map(volume => ({
        id: volume.VolumeId!,
        type: volume.VolumeType!,
        size: volume.Size!,
        state: volume.State!,
        region: region,
        encrypted: volume.Encrypted || false,
        instanceId: volume.Attachments?.[0]?.InstanceId,
        device: volume.Attachments?.[0]?.Device,
        createdAt: volume.CreateTime || new Date(),
        deleteOnTermination: volume.Attachments?.[0]?.DeleteOnTermination || false,
        iops: volume.Iops,
        throughput: volume.Throughput,
      })) || [];
    } catch (error) {
      console.error('Failed to get volumes:', error);
      return [];
    }
  }

  async createVolume(volumeConfig: any): Promise<any> {
    if (this.mockMode) {
      return this.mockCreateVolume(volumeConfig);
    }

    const regionClient = createEC2Client(volumeConfig.region);
    if (!regionClient) {
      throw new Error('AWS client not configured');
    }

    try {
      // Get the first availability zone for the region
      const availabilityZones = await this.getAvailabilityZones(volumeConfig.region);
      const availabilityZone = availabilityZones[0];

      console.log(`Creating volume in availability zone: ${availabilityZone}`);

      // Prepare command parameters based on volume type
      const commandParams: any = {
        VolumeType: volumeConfig.type,
        Size: volumeConfig.size,
        AvailabilityZone: availabilityZone,
        Encrypted: volumeConfig.encrypted || false,
      };

      // Only add IOPS for volume types that support it
      if ((volumeConfig.type === 'io1' || volumeConfig.type === 'io2') && volumeConfig.iops) {
        commandParams.Iops = volumeConfig.iops;
      } else if (volumeConfig.type === 'gp3' && volumeConfig.iops && volumeConfig.iops !== 3000) {
        // Only set IOPS for gp3 if it's different from default (3000)
        commandParams.Iops = volumeConfig.iops;
      }

      // Only add Throughput for gp3 volumes
      if (volumeConfig.type === 'gp3' && volumeConfig.throughput && volumeConfig.throughput !== 125) {
        // Only set throughput for gp3 if it's different from default (125)
        commandParams.Throughput = volumeConfig.throughput;
      }

      console.log('Creating volume with parameters:', commandParams);

      const command = new CreateVolumeCommand(commandParams);
      const response = await regionClient.send(command);

      return {
        id: response.VolumeId!,
        type: response.VolumeType!,
        size: response.Size!,
        state: response.State!,
        region: volumeConfig.region,
        encrypted: response.Encrypted || false,
        createdAt: response.CreateTime || new Date(),
        deleteOnTermination: false,
        iops: response.Iops,
        throughput: response.Throughput,
      };
    } catch (error) {
      console.error('Failed to create volume in AWS:', error);
      throw error;
    }
  }

  async attachVolume(volumeId: string, instanceId: string, device: string): Promise<void> {
    if (this.mockMode) {
      console.log(`Mock: Attaching volume ${volumeId} to instance ${instanceId} as ${device}`);
      return;
    }

    if (!this.ec2Client) {
      throw new Error('AWS client not configured');
    }

    try {
      const command = new AttachVolumeCommand({
        VolumeId: volumeId,
        InstanceId: instanceId,
        Device: device,
      });

      await this.ec2Client.send(command);
      console.log(`Volume ${volumeId} attached to instance ${instanceId} as ${device}`);
    } catch (error) {
      console.error('Failed to attach volume:', error);
      throw error;
    }
  }

  async detachVolume(volumeId: string): Promise<void> {
    if (this.mockMode) {
      console.log(`Mock: Detaching volume ${volumeId}`);
      return;
    }

    if (!this.ec2Client) {
      throw new Error('AWS client not configured');
    }

    try {
      console.log(`Detaching volume ${volumeId} from AWS`);
      
      const command = new DetachVolumeCommand({
        VolumeId: volumeId,
        Force: false, // Set to true only if you want to force detach
      });

      await this.ec2Client.send(command);
      console.log(`Volume ${volumeId} detached successfully`);
    } catch (error) {
      console.error('Failed to detach volume:', error);
      throw error;
    }
  }

  async deleteVolume(volumeId: string): Promise<void> {
    if (this.mockMode) {
      console.log(`Mock: Deleting volume ${volumeId}`);
      return;
    }

    if (!this.ec2Client) {
      throw new Error('AWS client not configured');
    }

    try {
      console.log(`Deleting volume ${volumeId} from AWS`);
      
      const command = new DeleteVolumeCommand({
        VolumeId: volumeId,
      });

      await this.ec2Client.send(command);
      console.log(`Volume ${volumeId} deleted successfully`);
    } catch (error) {
      console.error('Failed to delete volume:', error);
      throw error;
    }
  }

  // Helper methods for mock data
  private async mockLaunchInstance(request: InstanceCreationRequest) {
    console.log(`Mock: Launching instance with request:`, request);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return {
      instanceId: `i-${Math.random().toString(36).substr(2, 17)}`,
      publicIp: `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      privateIp: `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      availabilityZone: `${request.region}a`,
    };
  }

  private getMockRegions(): AWSRegion[] {
    return [
      { code: 'us-east-1', name: 'US East (N. Virginia)', location: 'N. Virginia' },
      { code: 'us-east-2', name: 'US East (Ohio)', location: 'Ohio' },
      { code: 'us-west-1', name: 'US West (N. California)', location: 'N. California' },
      { code: 'us-west-2', name: 'US West (Oregon)', location: 'Oregon' },
      { code: 'eu-west-1', name: 'Europe (Ireland)', location: 'Ireland' },
      { code: 'eu-west-2', name: 'Europe (London)', location: 'London' },
      { code: 'eu-central-1', name: 'Europe (Frankfurt)', location: 'Frankfurt' },
      { code: 'ap-southeast-1', name: 'Asia Pacific (Singapore)', location: 'Singapore' },
      { code: 'ap-southeast-2', name: 'Asia Pacific (Sydney)', location: 'Sydney' },
      { code: 'ap-northeast-1', name: 'Asia Pacific (Tokyo)', location: 'Tokyo' },
    ];
  }

  private getMockInstanceTypes(): InstanceType[] {
    return [
      { name: 't3.nano', vcpu: 2, memory: 0.5, storage: 'EBS-Only', network: 'Up to 5 Gigabit', onDemandPrice: 0.0052, spotPrice: 0.0016 },
      { name: 't3.micro', vcpu: 2, memory: 1, storage: 'EBS-Only', network: 'Up to 5 Gigabit', onDemandPrice: 0.0104, spotPrice: 0.0031 },
      { name: 't3.small', vcpu: 2, memory: 2, storage: 'EBS-Only', network: 'Up to 5 Gigabit', onDemandPrice: 0.0208, spotPrice: 0.0062 },
      { name: 't3.medium', vcpu: 2, memory: 4, storage: 'EBS-Only', network: 'Up to 5 Gigabit', onDemandPrice: 0.0416, spotPrice: 0.0125 },
      { name: 't3.large', vcpu: 2, memory: 8, storage: 'EBS-Only', network: 'Up to 5 Gigabit', onDemandPrice: 0.0832, spotPrice: 0.0250 },
      { name: 't3.xlarge', vcpu: 4, memory: 16, storage: 'EBS-Only', network: 'Up to 5 Gigabit', onDemandPrice: 0.1664, spotPrice: 0.0499 },
      { name: 'm5.large', vcpu: 2, memory: 8, storage: 'EBS-Only', network: 'Up to 10 Gigabit', onDemandPrice: 0.096, spotPrice: 0.0288 },
      { name: 'm5.xlarge', vcpu: 4, memory: 16, storage: 'EBS-Only', network: 'Up to 10 Gigabit', onDemandPrice: 0.192, spotPrice: 0.0576 },
      { name: 'm5.2xlarge', vcpu: 8, memory: 32, storage: 'EBS-Only', network: 'Up to 10 Gigabit', onDemandPrice: 0.384, spotPrice: 0.1152 },
      { name: 'c5.large', vcpu: 2, memory: 4, storage: 'EBS-Only', network: 'Up to 10 Gigabit', onDemandPrice: 0.085, spotPrice: 0.0255 },
      { name: 'c5.xlarge', vcpu: 4, memory: 8, storage: 'EBS-Only', network: 'Up to 10 Gigabit', onDemandPrice: 0.17, spotPrice: 0.051 },
      { name: 'r5.large', vcpu: 2, memory: 16, storage: 'EBS-Only', network: 'Up to 10 Gigabit', onDemandPrice: 0.126, spotPrice: 0.0378 },
      { name: 'r5.xlarge', vcpu: 4, memory: 32, storage: 'EBS-Only', network: 'Up to 10 Gigabit', onDemandPrice: 0.252, spotPrice: 0.0756 },
    ];
  }

  private getMockVolumes(region: string): any[] {
    return [
      {
        id: `vol-${Math.random().toString(36).substr(2, 17)}`,
        type: 'gp3',
        size: 20,
        state: 'available',
        region: region,
        encrypted: true,
        createdAt: new Date(),
        deleteOnTermination: false,
        iops: 3000,
        throughput: 125,
      },
      {
        id: `vol-${Math.random().toString(36).substr(2, 17)}`,
        type: 'gp2',
        size: 100,
        state: 'in-use',
        region: region,
        encrypted: false,
        instanceId: `i-${Math.random().toString(36).substr(2, 17)}`,
        device: '/dev/sdf',
        createdAt: new Date(Date.now() - 86400000), // 1 day ago
        deleteOnTermination: false,
      },
    ];
  }

  private mockCreateVolume(volumeConfig: any): any {
    return {
      id: `vol-${Math.random().toString(36).substr(2, 17)}`,
      type: volumeConfig.type,
      size: volumeConfig.size,
      state: 'creating',
      region: volumeConfig.region,
      encrypted: volumeConfig.encrypted || false,
      createdAt: new Date(),
      deleteOnTermination: false,
      iops: volumeConfig.iops,
      throughput: volumeConfig.throughput,
    };
  }

  private getAMIForRegion(region: string): string {
    // Updated Amazon Linux 2 AMI IDs for different regions (as of 2024)
    const amiMap: Record<string, string> = {
      'us-east-1': 'ami-0c02fb55956c7d316',
      'us-east-2': 'ami-0f924dc71d44d23e2',
      'us-west-1': 'ami-0d382e80be7ffdae5',
      'us-west-2': 'ami-0c2d3e23d757c2c99',
      'eu-west-1': 'ami-0c9c942bd7bf113a2',
      'eu-west-2': 'ami-0fb391cce7a602d1f',
      'eu-central-1': 'ami-0e7e134863fac4946',
      'ap-southeast-1': 'ami-0c802847a7dd848c0',
      'ap-southeast-2': 'ami-0b7dcd6e6fd797935',
      'ap-northeast-1': 'ami-0218d08a1f9dac831',
    };

    return amiMap[region] || amiMap['us-east-1'];
  }
}

export default AWSService;