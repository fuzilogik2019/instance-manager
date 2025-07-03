export interface AWSRegion {
  code: string;
  name: string;
  location: string;
}

export interface InstanceType {
  name: string;
  vcpu: number;
  memory: number;
  storage: string;
  network: string;
  onDemandPrice: number;
  spotPrice: number;
}

export interface AMI {
  id: string;
  name: string;
  description: string;
  platform: 'linux' | 'windows' | 'macos';
  osType: 'amazon-linux' | 'ubuntu' | 'windows' | 'redhat' | 'suse' | 'debian' | 'macos';
  osVersion: string;
  architecture: 'x86_64' | 'arm64';
  virtualizationType: 'hvm' | 'paravirtual';
  defaultUsername: string;
  isPublic: boolean;
  creationDate: string;
  imageLocation?: string;
}

export interface EBSVolume {
  id: string;
  type: 'gp2' | 'gp3' | 'io1' | 'io2' | 'st1' | 'sc1';
  size: number;
  iops?: number;
  throughput?: number;
  encrypted: boolean;
  deleteOnTermination: boolean;
  state?: 'available' | 'in-use' | 'creating' | 'deleting';
  region?: string;
  instanceId?: string;
  device?: string;
  createdAt?: Date;
}

export interface SecurityGroupRule {
  id: string;
  protocol: 'tcp' | 'udp' | 'icmp' | 'all';
  fromPort: number;
  toPort: number;
  source: string;
  description: string;
}

export interface SecurityGroup {
  id: string;
  name: string;
  description: string;
  rules: SecurityGroupRule[];
}

export interface SSHKeyPair {
  id: string;
  name: string;
  publicKey: string;
  privateKey?: string;
  fingerprint: string;
  createdAt: Date;
}

export interface EC2Instance {
  id: string;
  name: string;
  instanceType: string;
  state: 'pending' | 'running' | 'stopping' | 'stopped' | 'terminated' | 'initializing';
  region: string;
  availabilityZone: string;
  publicIp?: string;
  privateIp: string;
  keyPairName: string;
  securityGroups: string[];
  volumes: EBSVolume[];
  isSpotInstance: boolean;
  launchTime: Date;
  tags: Record<string, string>;
  ami?: AMI;
  statusChecks?: {
    instanceStatus: string;
    systemStatus: string;
    isSSHReady: boolean;
  };
}

export interface InstanceCreationRequest {
  name: string;
  region: string;
  amiId: string;
  instanceType: string;
  keyPairId: string;
  securityGroupIds: string[];
  volumes: Omit<EBSVolume, 'id'>[];
  existingVolumeIds?: string[];
  isSpotInstance: boolean;
  userData?: string;
  tags: Record<string, string>;
  installDocker?: boolean;
  dockerImageToPull?: string;
}