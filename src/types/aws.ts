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

export interface EBSVolume {
  id: string;
  type: 'gp2' | 'gp3' | 'io1' | 'io2' | 'st1' | 'sc1';
  size: number;
  iops?: number;
  throughput?: number;
  encrypted: boolean;
  deleteOnTermination: boolean;
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
  state: 'pending' | 'running' | 'stopping' | 'stopped' | 'terminated';
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
}

export interface InstanceCreationRequest {
  name: string;
  region: string;
  instanceType: string;
  keyPairId: string;
  securityGroupIds: string[];
  volumes: Omit<EBSVolume, 'id'>[];
  isSpotInstance: boolean;
  userData?: string;
  tags: Record<string, string>;
}