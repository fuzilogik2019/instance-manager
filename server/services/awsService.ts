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
  DescribeInstanceStatusCommand,
  AuthorizeSecurityGroupIngressCommand,
  RevokeSecurityGroupIngressCommand,
  Instance,
  InstanceType as AWSInstanceType,
} from '@aws-sdk/client-ec2';
import { createEC2Client, isAWSConfigured } from '../config/aws.js';
import { InstanceCreationRequest, EC2Instance, AWSRegion, InstanceType, AMI } from '../../src/types/aws.js';

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

  // Get all instances from AWS with status checks
  async getAllInstances(): Promise<EC2Instance[]> {
    if (this.mockMode) {
      return this.getMockInstances();
    }

    if (!this.ec2Client) {
      throw new Error('AWS client not configured');
    }

    try {
      console.log('Fetching all instances from AWS...');
      
      const command = new DescribeInstancesCommand({
        // Don't filter by state - get ALL instances including terminated ones
        Filters: [
          {
            Name: 'instance-state-name',
            Values: ['pending', 'running', 'shutting-down', 'terminated', 'stopping', 'stopped']
          }
        ]
      });

      const response = await this.ec2Client.send(command);
      const instances: EC2Instance[] = [];

      console.log(`Found ${response.Reservations?.length || 0} reservations`);

      if (response.Reservations) {
        for (const reservation of response.Reservations) {
          if (reservation.Instances) {
            for (const instance of reservation.Instances) {
              console.log(`Processing instance: ${instance.InstanceId} - State: ${instance.State?.Name}`);
              
              // Get instance name from tags
              const nameTag = instance.Tags?.find(tag => tag.Key === 'Name');
              const instanceName = nameTag?.Value || instance.InstanceId || 'Imported Instance';

              // Get all tags
              const tags: Record<string, string> = {};
              instance.Tags?.forEach(tag => {
                if (tag.Key && tag.Value) {
                  tags[tag.Key] = tag.Value;
                }
              });

              // Map volumes
              const volumes = instance.BlockDeviceMappings?.map(bdm => ({
                id: bdm.Ebs?.VolumeId || '',
                type: 'gp2' as const, // Default, would need separate call to get actual type
                size: 8, // Default, would need separate call to get actual size
                encrypted: false, // Default, would need separate call to get actual encryption
                deleteOnTermination: bdm.Ebs?.DeleteOnTermination || false,
              })) || [];

              // Get status checks for running instances
              let statusChecks = undefined;
              if (instance.State?.Name === 'running') {
                try {
                  statusChecks = await this.getInstanceStatusChecks(instance.InstanceId!);
                } catch (statusError) {
                  console.warn(`Failed to get status checks for ${instance.InstanceId}:`, statusError.message);
                }
              }

              // Determine the actual state including initialization
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

      console.log(`Processed ${instances.length} instances total`);
      
      // Sort by launch time, newest first
      instances.sort((a, b) => new Date(b.launchTime).getTime() - new Date(a.launchTime).getTime());
      
      return instances;
    } catch (error) {
      console.error('Failed to get instances from AWS:', error);
      throw error;
    }
  }

  // Get instance status checks
  private async getInstanceStatusChecks(instanceId: string) {
    if (!this.ec2Client) return null;

    try {
      const command = new DescribeInstanceStatusCommand({
        InstanceIds: [instanceId],
        IncludeAllInstances: true
      });

      const response = await this.ec2Client.send(command);
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
      
      // SSH is ready when both instance and system status are 'ok'
      const isSSHReady = instanceStatus === 'ok' && systemStatus === 'ok';

      return {
        instanceStatus,
        systemStatus,
        isSSHReady
      };
    } catch (error) {
      console.warn('Failed to get instance status checks:', error);
      return {
        instanceStatus: 'unknown',
        systemStatus: 'unknown',
        isSSHReady: false
      };
    }
  }

  // Map AWS instance states to our internal states
  private mapInstanceState(awsState: string): EC2Instance['state'] {
    switch (awsState) {
      case 'pending':
        return 'pending';
      case 'running':
        return 'running';
      case 'shutting-down':
        return 'stopping';
      case 'terminated':
        return 'terminated';
      case 'stopping':
        return 'stopping';
      case 'stopped':
        return 'stopped';
      default:
        return 'pending';
    }
  }

  // Get available AMIs for a region with robust fetching strategy
  async getAMIs(region: string): Promise<AMI[]> {
    if (this.mockMode) {
      return this.getMockAMIs();
    }

    const regionClient = createEC2Client(region);
    if (!regionClient) {
      throw new Error('AWS client not configured');
    }

    try {
      console.log(`🔍 Starting robust AMI fetching for region: ${region}`);
      
      // Fetch AMIs from different sources in parallel
      const amiPromises = [
        this.fetchUbuntuAMIs(regionClient),
        this.fetchAmazonLinuxAMIs(regionClient),
        this.fetchWindowsAMIs(regionClient),
        this.fetchOtherLinuxAMIs(regionClient),
      ];

      const amiResults = await Promise.allSettled(amiPromises);
      const allAMIs: AMI[] = [];

      amiResults.forEach((result, index) => {
        const types = ['Ubuntu', 'Amazon Linux', 'Windows', 'Other Linux'];
        if (result.status === 'fulfilled') {
          allAMIs.push(...result.value);
          console.log(`✅ Found ${result.value.length} ${types[index]} AMIs`);
        } else {
          console.warn(`❌ Failed to get ${types[index]} AMIs:`, result.reason);
        }
      });

      // Remove duplicates based on AMI ID
      const uniqueAMIs = allAMIs.filter((ami, index, self) => 
        index === self.findIndex(a => a.id === ami.id)
      );

      // Sort AMIs with Ubuntu 22.04 first, then by OS type and creation date
      uniqueAMIs.sort((a, b) => {
        // Ubuntu 22.04 gets highest priority
        if (a.osType === 'ubuntu' && a.osVersion === '22.04' && !(b.osType === 'ubuntu' && b.osVersion === '22.04')) {
          return -1;
        }
        if (b.osType === 'ubuntu' && b.osVersion === '22.04' && !(a.osType === 'ubuntu' && a.osVersion === '22.04')) {
          return 1;
        }
        
        // Then Ubuntu 24.04
        if (a.osType === 'ubuntu' && a.osVersion === '24.04' && !(b.osType === 'ubuntu' && b.osVersion === '24.04')) {
          return -1;
        }
        if (b.osType === 'ubuntu' && b.osVersion === '24.04' && !(a.osType === 'ubuntu' && a.osVersion === '24.04')) {
          return 1;
        }
        
        // Then Ubuntu 20.04
        if (a.osType === 'ubuntu' && a.osVersion === '20.04' && !(b.osType === 'ubuntu' && b.osVersion === '20.04')) {
          return -1;
        }
        if (b.osType === 'ubuntu' && b.osVersion === '20.04' && !(a.osType === 'ubuntu' && a.osVersion === '20.04')) {
          return 1;
        }
        
        // Then by OS type
        if (a.osType !== b.osType) {
          return a.osType.localeCompare(b.osType);
        }
        
        // Finally by creation date (newest first)
        return new Date(b.creationDate).getTime() - new Date(a.creationDate).getTime();
      });

      console.log(`📊 Returning ${uniqueAMIs.length} AMIs for region ${region}`);
      
      // Log Ubuntu counts
      const ubuntu2204Count = uniqueAMIs.filter(ami => ami.osType === 'ubuntu' && ami.osVersion === '22.04').length;
      const ubuntu2404Count = uniqueAMIs.filter(ami => ami.osType === 'ubuntu' && ami.osVersion === '24.04').length;
      const ubuntu2004Count = uniqueAMIs.filter(ami => ami.osType === 'ubuntu' && ami.osVersion === '20.04').length;
      
      console.log(`🐧 Ubuntu 22.04 AMIs: ${ubuntu2204Count}`);
      console.log(`🐧 Ubuntu 24.04 AMIs: ${ubuntu2404Count}`);
      console.log(`🐧 Ubuntu 20.04 AMIs: ${ubuntu2004Count}`);
      
      if (uniqueAMIs.length > 0) {
        return uniqueAMIs;
      } else {
        console.warn('⚠️ No AMIs found from AWS, falling back to mock data');
        return this.getMockAMIs();
      }
    } catch (error) {
      console.error('Failed to get AMIs:', error);
      return this.getMockAMIs();
    }
  }

  // Fetch Ubuntu AMIs with multiple patterns
  private async fetchUbuntuAMIs(client: EC2Client): Promise<AMI[]> {
    const ubuntuPatterns = [
      // Canonical official patterns
      { owner: '099720109477', pattern: 'ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*' },
      { owner: '099720109477', pattern: 'ubuntu/images/hvm-ssd/ubuntu-noble-24.04-amd64-server-*' },
      { owner: '099720109477', pattern: 'ubuntu/images/hvm-ssd/ubuntu-focal-20.04-amd64-server-*' },
      // Alternative patterns
      { owner: '099720109477', pattern: 'ubuntu-jammy-22.04-amd64-server-*' },
      { owner: '099720109477', pattern: 'ubuntu-noble-24.04-amd64-server-*' },
      { owner: '099720109477', pattern: 'ubuntu-focal-20.04-amd64-server-*' },
      // Broader patterns
      { owner: '099720109477', pattern: '*ubuntu*22.04*amd64*' },
      { owner: '099720109477', pattern: '*ubuntu*24.04*amd64*' },
      { owner: '099720109477', pattern: '*ubuntu*20.04*amd64*' },
    ];

    const allUbuntuAMIs: AMI[] = [];

    for (const { owner, pattern } of ubuntuPatterns) {
      try {
        const amis = await this.getAMIsByOwnerAndName(client, owner, pattern, 'ubuntu');
        allUbuntuAMIs.push(...amis);
      } catch (error) {
        console.warn(`Failed to fetch Ubuntu AMIs with pattern ${pattern}:`, error.message);
      }
    }

    // Remove duplicates and return
    const uniqueAMIs = allUbuntuAMIs.filter((ami, index, self) => 
      index === self.findIndex(a => a.id === ami.id)
    );

    console.log(`🐧 Found ${uniqueAMIs.length} Ubuntu AMIs total`);
    return uniqueAMIs;
  }

  // Fetch Amazon Linux AMIs
  private async fetchAmazonLinuxAMIs(client: EC2Client): Promise<AMI[]> {
    const patterns = [
      { owner: 'amazon', pattern: 'al2023-ami-*-x86_64' },
      { owner: 'amazon', pattern: 'amzn2-ami-hvm-*-x86_64-gp2' },
      { owner: 'amazon', pattern: 'amzn-ami-hvm-*-x86_64-gp2' },
    ];

    const allAMIs: AMI[] = [];

    for (const { owner, pattern } of patterns) {
      try {
        const amis = await this.getAMIsByOwnerAndName(client, owner, pattern, 'amazon-linux');
        allAMIs.push(...amis);
      } catch (error) {
        console.warn(`Failed to fetch Amazon Linux AMIs with pattern ${pattern}:`, error.message);
      }
    }

    return allAMIs.filter((ami, index, self) => 
      index === self.findIndex(a => a.id === ami.id)
    );
  }

  // Fetch Windows AMIs
  private async fetchWindowsAMIs(client: EC2Client): Promise<AMI[]> {
    const patterns = [
      { owner: 'amazon', pattern: 'Windows_Server-2022-English-Full-Base-*' },
      { owner: 'amazon', pattern: 'Windows_Server-2019-English-Full-Base-*' },
      { owner: 'amazon', pattern: 'Windows_Server-2016-English-Full-Base-*' },
    ];

    const allAMIs: AMI[] = [];

    for (const { owner, pattern } of patterns) {
      try {
        const amis = await this.getAMIsByOwnerAndName(client, owner, pattern, 'windows');
        allAMIs.push(...amis);
      } catch (error) {
        console.warn(`Failed to fetch Windows AMIs with pattern ${pattern}:`, error.message);
      }
    }

    return allAMIs.filter((ami, index, self) => 
      index === self.findIndex(a => a.id === ami.id)
    );
  }

  // Fetch other Linux distributions
  private async fetchOtherLinuxAMIs(client: EC2Client): Promise<AMI[]> {
    const patterns = [
      // Red Hat
      { owner: '309956199498', pattern: 'RHEL-*-x86_64-*', osType: 'redhat' },
      // SUSE
      { owner: '013907871322', pattern: 'suse-sles-*-v*-hvm-ssd-x86_64', osType: 'suse' },
      // Debian
      { owner: '136693071363', pattern: 'debian-*-amd64-*', osType: 'debian' },
    ];

    const allAMIs: AMI[] = [];

    for (const { owner, pattern, osType } of patterns) {
      try {
        const amis = await this.getAMIsByOwnerAndName(client, owner, pattern, osType);
        allAMIs.push(...amis);
      } catch (error) {
        console.warn(`Failed to fetch ${osType} AMIs with pattern ${pattern}:`, error.message);
      }
    }

    return allAMIs.filter((ami, index, self) => 
      index === self.findIndex(a => a.id === ami.id)
    );
  }

  private async getAMIsByOwnerAndName(client: EC2Client, owner: string, namePattern: string, osType: string): Promise<AMI[]> {
    try {
      const command = new DescribeImagesCommand({
        Owners: [owner],
        Filters: [
          {
            Name: 'name',
            Values: [namePattern],
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
        MaxResults: osType === 'ubuntu' ? 50 : 20, // More results for Ubuntu
      });

      const response = await client.send(command);
      
      if (!response.Images) {
        return [];
      }

      // Sort by creation date and take the most recent ones
      const sortedImages = response.Images
        .sort((a, b) => {
          const dateA = new Date(a.CreationDate || 0);
          const dateB = new Date(b.CreationDate || 0);
          return dateB.getTime() - dateA.getTime();
        })
        .slice(0, osType === 'ubuntu' ? 20 : 10); // Keep more Ubuntu AMIs

      return sortedImages.map(image => ({
        id: image.ImageId!,
        name: image.Name!,
        description: image.Description || '',
        platform: this.getPlatformFromImage(image, osType),
        osType: osType as any,
        osVersion: this.extractVersionFromName(image.Name!, osType),
        architecture: image.Architecture as 'x86_64' | 'arm64',
        virtualizationType: image.VirtualizationType as 'hvm' | 'paravirtual',
        defaultUsername: this.getDefaultUsername(osType),
        isPublic: image.Public || false,
        creationDate: image.CreationDate!,
        imageLocation: image.ImageLocation,
      }));
    } catch (error) {
      console.warn(`Failed to get AMIs for ${osType}:`, error);
      return [];
    }
  }

  private getPlatformFromImage(image: any, osType: string): 'linux' | 'windows' | 'macos' {
    if (osType === 'windows' || image.Platform === 'windows') {
      return 'windows';
    }
    return 'linux';
  }

  private extractVersionFromName(name: string, osType: string): string {
    switch (osType) {
      case 'amazon-linux':
        if (name.includes('al2023')) return '2023';
        if (name.includes('amzn2')) return '2';
        if (name.includes('amzn-ami')) return '1';
        return '2023';
      case 'ubuntu':
        // Prioritize Ubuntu 22.04 detection
        if (name.includes('jammy') || name.includes('22.04')) return '22.04';
        if (name.includes('noble') || name.includes('24.04')) return '24.04';
        if (name.includes('focal') || name.includes('20.04')) return '20.04';
        
        // Fallback to regex
        const ubuntuMatch = name.match(/ubuntu-(\d+\.\d+)/i);
        if (ubuntuMatch) return ubuntuMatch[1];
        
        // Default to 22.04 for Ubuntu
        return '22.04';
      case 'windows':
        if (name.includes('2022')) return '2022';
        if (name.includes('2019')) return '2019';
        if (name.includes('2016')) return '2016';
        return '2022';
      case 'redhat':
        const rhelMatch = name.match(/RHEL-(\d+)/i);
        return rhelMatch ? rhelMatch[1] : '9';
      case 'suse':
        const suseMatch = name.match(/sles-(\d+)/i);
        return suseMatch ? suseMatch[1] : '15';
      case 'debian':
        const debianMatch = name.match(/debian-(\d+)/i);
        return debianMatch ? debianMatch[1] : '12';
      default:
        return 'Latest';
    }
  }

  private getDefaultUsername(osType: string): string {
    switch (osType) {
      case 'amazon-linux':
        return 'ec2-user';
      case 'ubuntu':
        return 'ubuntu';
      case 'windows':
        return 'Administrator';
      case 'redhat':
        return 'ec2-user';
      case 'suse':
        return 'ec2-user';
      case 'debian':
        return 'admin';
      default:
        return 'ubuntu'; // Default to ubuntu since it's our recommended choice
    }
  }

  // Mock instances for development
  private getMockInstances(): EC2Instance[] {
    return [
      {
        id: 'i-1234567890abcdef0',
        name: 'Mock Web Server',
        instanceType: 't3.micro',
        state: 'running',
        region: 'us-east-1',
        availabilityZone: 'us-east-1a',
        publicIp: '54.123.45.67',
        privateIp: '10.0.1.100',
        keyPairName: 'my-key-pair',
        securityGroups: ['sg-12345678'],
        volumes: [
          {
            id: 'vol-1234567890abcdef0',
            type: 'gp3',
            size: 20,
            encrypted: true,
            deleteOnTermination: true,
          }
        ],
        isSpotInstance: false,
        launchTime: new Date(Date.now() - 3600000), // 1 hour ago
        tags: { Name: 'Mock Web Server', Environment: 'Development', DockerInstalled: 'true' },
        statusChecks: {
          instanceStatus: 'ok',
          systemStatus: 'ok',
          isSSHReady: true
        }
      },
      {
        id: 'i-0987654321fedcba0',
        name: 'Mock Game Server',
        instanceType: 't3.small',
        state: 'stopped',
        region: 'us-east-1',
        availabilityZone: 'us-east-1b',
        privateIp: '10.0.1.101',
        keyPairName: 'game-server-key',
        securityGroups: ['sg-87654321'],
        volumes: [
          {
            id: 'vol-0987654321fedcba0',
            type: 'gp2',
            size: 30,
            encrypted: false,
            deleteOnTermination: false,
          }
        ],
        isSpotInstance: true,
        launchTime: new Date(Date.now() - 7200000), // 2 hours ago
        tags: { Name: 'Mock Game Server', Environment: 'Production' },
      }
    ];
  }

  private getMockAMIs(): AMI[] {
    return [
      // Ubuntu 22.04 LTS (RECOMMENDED - First in list)
      {
        id: 'ami-0a634ae95e11c6f91',
        name: 'ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-20231207',
        description: 'Canonical, Ubuntu, 22.04 LTS, amd64 jammy image build on 2023-12-07',
        platform: 'linux',
        osType: 'ubuntu',
        osVersion: '22.04',
        architecture: 'x86_64',
        virtualizationType: 'hvm',
        defaultUsername: 'ubuntu',
        isPublic: true,
        creationDate: '2023-12-07T00:00:00.000Z',
      },
      // Ubuntu 24.04 LTS
      {
        id: 'ami-0123456789abcdef1',
        name: 'ubuntu/images/hvm-ssd/ubuntu-noble-24.04-amd64-server-20231120',
        description: 'Canonical, Ubuntu, 24.04 LTS, amd64 noble image build on 2023-11-20',
        platform: 'linux',
        osType: 'ubuntu',
        osVersion: '24.04',
        architecture: 'x86_64',
        virtualizationType: 'hvm',
        defaultUsername: 'ubuntu',
        isPublic: true,
        creationDate: '2023-11-20T00:00:00.000Z',
      },
      // Ubuntu 20.04 LTS
      {
        id: 'ami-0123456789abcdef0',
        name: 'ubuntu/images/hvm-ssd/ubuntu-focal-20.04-amd64-server-20231120',
        description: 'Canonical, Ubuntu, 20.04 LTS, amd64 focal image build on 2023-11-20',
        platform: 'linux',
        osType: 'ubuntu',
        osVersion: '20.04',
        architecture: 'x86_64',
        virtualizationType: 'hvm',
        defaultUsername: 'ubuntu',
        isPublic: true,
        creationDate: '2023-11-20T00:00:00.000Z',
      },
      // Amazon Linux 2023
      {
        id: 'ami-0abcdef1234567890',
        name: 'al2023-ami-2023.2.20231116.0-kernel-6.1-x86_64',
        description: 'Amazon Linux 2023 AMI (HVM) - Kernel 6.1, SSD Volume Type',
        platform: 'linux',
        osType: 'amazon-linux',
        osVersion: '2023',
        architecture: 'x86_64',
        virtualizationType: 'hvm',
        defaultUsername: 'ec2-user',
        isPublic: true,
        creationDate: '2023-11-16T00:00:00.000Z',
      },
      // Amazon Linux 2
      {
        id: 'ami-0abcdef1234567891',
        name: 'amzn2-ami-hvm-2.0.20231116.0-x86_64-gp2',
        description: 'Amazon Linux 2 AMI (HVM) - Kernel 5.10, SSD Volume Type',
        platform: 'linux',
        osType: 'amazon-linux',
        osVersion: '2',
        architecture: 'x86_64',
        virtualizationType: 'hvm',
        defaultUsername: 'ec2-user',
        isPublic: true,
        creationDate: '2023-11-16T00:00:00.000Z',
      },
      // Windows Server 2022
      {
        id: 'ami-0fedcba9876543210',
        name: 'Windows_Server-2022-English-Full-Base-2023.11.15',
        description: 'Microsoft Windows Server 2022 Full Locale English AMI provided by Amazon',
        platform: 'windows',
        osType: 'windows',
        osVersion: '2022',
        architecture: 'x86_64',
        virtualizationType: 'hvm',
        defaultUsername: 'Administrator',
        isPublic: true,
        creationDate: '2023-11-15T00:00:00.000Z',
      },
      // Red Hat Enterprise Linux 9
      {
        id: 'ami-0redhat123456789',
        name: 'RHEL-9.2.0_HVM-20231101-x86_64-0-Hourly2-GP2',
        description: 'Red Hat Enterprise Linux 9.2 (HVM), SSD Volume Type',
        platform: 'linux',
        osType: 'redhat',
        osVersion: '9',
        architecture: 'x86_64',
        virtualizationType: 'hvm',
        defaultUsername: 'ec2-user',
        isPublic: true,
        creationDate: '2023-11-01T00:00:00.000Z',
      },
      // SUSE Linux Enterprise Server 15
      {
        id: 'ami-0suse123456789',
        name: 'suse-sles-15-sp5-v20231101-hvm-ssd-x86_64',
        description: 'SUSE Linux Enterprise Server 15 SP5 (HVM), SSD Volume Type',
        platform: 'linux',
        osType: 'suse',
        osVersion: '15',
        architecture: 'x86_64',
        virtualizationType: 'hvm',
        defaultUsername: 'ec2-user',
        isPublic: true,
        creationDate: '2023-11-01T00:00:00.000Z',
      },
      // Debian 12
      {
        id: 'ami-0debian123456789',
        name: 'debian-12-amd64-20231013-1532',
        description: 'Debian 12 (bookworm) amd64 build 20231013-1532',
        platform: 'linux',
        osType: 'debian',
        osVersion: '12',
        architecture: 'x86_64',
        virtualizationType: 'hvm',
        defaultUsername: 'admin',
        isPublic: true,
        creationDate: '2023-10-13T00:00:00.000Z',
      },
    ];
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
      console.log(`Launching instance with AMI: ${request.amiId} in region: ${request.region}`);

      // Prepare tags - avoid duplicates
      const tags = [];
      
      // Add Name tag first
      tags.push({
        Key: 'Name',
        Value: request.name,
      });

      // Add Docker installation tag if enabled
      if (request.installDocker) {
        tags.push({
          Key: 'DockerInstalled',
          Value: 'true',
        });
      }

      // Add other tags, but skip if Name already exists
      Object.entries(request.tags).forEach(([key, value]) => {
        if (key !== 'Name' && key !== 'DockerInstalled') {
          tags.push({
            Key: key,
            Value: value,
          });
        }
      });

      // Prepare user data script
      let userData = request.userData || '';
      
      // Add Docker installation script if requested
      if (request.installDocker) {
        const dockerScript = this.generateDockerInstallScript(request.dockerImageToPull);
        userData = userData ? `${userData}\n\n${dockerScript}` : dockerScript;
      }

      const command = new RunInstancesCommand({
        ImageId: request.amiId,
        InstanceType: request.instanceType as any,
        MinCount: 1,
        MaxCount: 1,
        KeyName: request.keyPairId,
        SecurityGroupIds: request.securityGroupIds.length > 0 ? request.securityGroupIds : ['default'],
        UserData: userData ? Buffer.from(userData).toString('base64') : undefined,
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

  // Generate Docker installation script
  private generateDockerInstallScript(dockerImageToPull?: string): string {
    let script = `#!/bin/bash

# Docker Installation Script
echo "🐳 Starting Docker installation..."

# Update system
apt-get update -y

# Install required packages
apt-get install -y \\
    ca-certificates \\
    curl \\
    gnupg \\
    lsb-release

# Add Docker's official GPG key
mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Set up the repository
echo \\
  "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \\
  \$(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# Update package index
apt-get update -y

# Install Docker Engine
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start and enable Docker
systemctl start docker
systemctl enable docker

# Add ubuntu user to docker group
usermod -aG docker ubuntu

# Verify installation
docker --version
docker compose version

echo "✅ Docker installation completed!"

# Create docker-compose.yml directory
mkdir -p /home/ubuntu/docker
chown ubuntu:ubuntu /home/ubuntu/docker
`;

    // Add Docker image pull and run if specified
    if (dockerImageToPull) {
      script += `
# Pull and run specified Docker image
echo "🚀 Pulling and starting Docker image: ${dockerImageToPull}"

# Pull the image
docker pull ${dockerImageToPull}

# Create a basic docker-compose.yml for the image
cat > /home/ubuntu/docker/docker-compose.yml << EOF
version: '3.8'
services:
  app:
    image: ${dockerImageToPull}
    restart: unless-stopped
    ports:
      - "80:80"
      - "25565:25565"
      - "19132:19132/udp"
    volumes:
      - ./data:/data
    environment:
      - EULA=TRUE
EOF

# Change ownership
chown ubuntu:ubuntu /home/ubuntu/docker/docker-compose.yml

# Start the container
cd /home/ubuntu/docker
docker compose up -d

echo "🎮 Docker container started with image: ${dockerImageToPull}"
echo "📁 Docker Compose file created at: /home/ubuntu/docker/docker-compose.yml"
`;
    }

    script += `
echo "🎉 Setup completed! Docker is ready to use."
echo "💡 Use 'docker ps' to see running containers"
echo "💡 Use 'docker compose up -d' in /home/ubuntu/docker to start services"
`;

    return script;
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
}

export default AWSService;