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
  CreateSecurityGroupCommand,
  CreateKeyPairCommand,
  ImportKeyPairCommand,
  DeleteKeyPairCommand,
  DeleteSecurityGroupCommand,
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
      const command = new RunInstancesCommand({
        ImageId: this.getAMIForRegion(request.region), // Default Amazon Linux 2 AMI
        InstanceType: request.instanceType as any,
        MinCount: 1,
        MaxCount: 1,
        KeyName: request.keyPairId,
        SecurityGroupIds: request.securityGroupIds,
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
            Tags: Object.entries(request.tags).map(([key, value]) => ({
              Key: key,
              Value: value,
            })),
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
        throw new Error('Failed to launch instance');
      }

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
      const command = new StartInstancesCommand({
        InstanceIds: [instanceId],
      });

      await this.ec2Client.send(command);
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
      const command = new StopInstancesCommand({
        InstanceIds: [instanceId],
      });

      await this.ec2Client.send(command);
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

  private getAMIForRegion(region: string): string {
    // Default Amazon Linux 2 AMI IDs for different regions
    const amiMap: Record<string, string> = {
      'us-east-1': 'ami-0abcdef1234567890',
      'us-east-2': 'ami-0abcdef1234567891',
      'us-west-1': 'ami-0abcdef1234567892',
      'us-west-2': 'ami-0abcdef1234567893',
      'eu-west-1': 'ami-0abcdef1234567894',
      'eu-west-2': 'ami-0abcdef1234567895',
      'eu-central-1': 'ami-0abcdef1234567896',
      'ap-southeast-1': 'ami-0abcdef1234567897',
      'ap-southeast-2': 'ami-0abcdef1234567898',
      'ap-northeast-1': 'ami-0abcdef1234567899',
    };

    return amiMap[region] || amiMap['us-east-1'];
  }
}

export default AWSService;