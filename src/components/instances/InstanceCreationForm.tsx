import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Plus, HardDrive, AlertCircle, CheckCircle, Link, Monitor, Server, Smartphone, Star, Package, Container } from 'lucide-react';
import { AWSRegion, InstanceType, SecurityGroup, SSHKeyPair, EBSVolume, AMI } from '../../types/aws';
import { getRegions, getInstanceTypes, getSecurityGroups, getKeyPairs, getVolumes, getAMIs, createInstance } from '../../services/api';
import LoadingSpinner from '../ui/LoadingSpinner';
import Button from '../ui/Button';
import Select from '../ui/Select';
import Input from '../ui/Input';
import Card from '../ui/Card';
import Badge from '../ui/Badge';

interface FormData {
  name: string;
  region: string;
  amiId: string;
  instanceType: string;
  keyPairId: string;
  securityGroupIds: string[];
  isSpotInstance: boolean;
  userData: string;
  rootVolumeSize: number;
  rootVolumeType: 'gp2' | 'gp3' | 'io1' | 'io2';
  rootVolumeEncrypted: boolean;
  installDocker: boolean;
  dockerImageToPull: string;
}

interface InstanceCreationFormProps {
  onInstanceCreated: () => void;
  onClose: () => void;
}

export default function InstanceCreationForm({ onInstanceCreated, onClose }: InstanceCreationFormProps) {
  const [regions, setRegions] = useState<AWSRegion[]>([]);
  const [amis, setAMIs] = useState<AMI[]>([]);
  const [instanceTypes, setInstanceTypes] = useState<InstanceType[]>([]);
  const [securityGroups, setSecurityGroups] = useState<SecurityGroup[]>([]);
  const [keyPairs, setKeyPairs] = useState<SSHKeyPair[]>([]);
  const [availableVolumes, setAvailableVolumes] = useState<EBSVolume[]>([]);
  const [volumes, setVolumes] = useState<Omit<EBSVolume, 'id'>[]>([]);
  const [selectedExistingVolumes, setSelectedExistingVolumes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [amiFilter, setAmiFilter] = useState<string>('all');

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    defaultValues: {
      rootVolumeSize: 8,
      rootVolumeType: 'gp3',
      rootVolumeEncrypted: true,
      installDocker: false,
      dockerImageToPull: '',
    }
  });
  
  const selectedRegion = watch('region');
  const selectedAMI = watch('amiId');
  const selectedInstanceType = watch('instanceType');
  const rootVolumeSize = watch('rootVolumeSize');
  const rootVolumeType = watch('rootVolumeType');
  const installDocker = watch('installDocker');

  useEffect(() => {
    loadRegions();
    loadKeyPairs();
  }, []);

  useEffect(() => {
    if (selectedRegion) {
      loadAMIs(selectedRegion);
      loadInstanceTypes(selectedRegion);
      loadSecurityGroups(selectedRegion);
      loadAvailableVolumes(selectedRegion);
    }
  }, [selectedRegion]);

  // Auto-select Ubuntu 22.04 when AMIs are loaded
  useEffect(() => {
    if (amis.length > 0 && !selectedAMI) {
      // Find Ubuntu 22.04 LTS AMI (should be first due to our sorting)
      const ubuntu2204 = amis.find(ami => 
        ami.osType === 'ubuntu' && ami.osVersion === '22.04'
      );
      
      if (ubuntu2204) {
        setValue('amiId', ubuntu2204.id);
        console.log(`🎯 Auto-selected Ubuntu 22.04 LTS: ${ubuntu2204.name}`);
      }
    }
  }, [amis, selectedAMI, setValue]);

  const loadRegions = async () => {
    try {
      const data = await getRegions();
      setRegions(data);
    } catch (error) {
      console.error('Failed to load regions:', error);
    }
  };

  const loadAMIs = async (region: string) => {
    try {
      setLoading(true);
      const data = await getAMIs(region);
      setAMIs(data);
      console.log(`Loaded ${data.length} AMIs for region ${region}`);
      
      // Log Ubuntu 22.04 availability
      const ubuntu2204Count = data.filter(ami => ami.osType === 'ubuntu' && ami.osVersion === '22.04').length;
      console.log(`Found ${ubuntu2204Count} Ubuntu 22.04 LTS AMIs`);
    } catch (error) {
      console.error('Failed to load AMIs:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadInstanceTypes = async (region: string) => {
    try {
      setLoading(true);
      const data = await getInstanceTypes(region);
      setInstanceTypes(data);
    } catch (error) {
      console.error('Failed to load instance types:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSecurityGroups = async (region: string) => {
    try {
      const data = await getSecurityGroups(region);
      setSecurityGroups(data);
    } catch (error) {
      console.error('Failed to load security groups:', error);
    }
  };

  const loadKeyPairs = async () => {
    try {
      const data = await getKeyPairs();
      setKeyPairs(data);
    } catch (error) {
      console.error('Failed to load key pairs:', error);
    }
  };

  const loadAvailableVolumes = async (region: string) => {
    try {
      const data = await getVolumes(region);
      // Filter only available volumes
      const available = data.filter(volume => volume.state === 'available');
      setAvailableVolumes(available);
    } catch (error) {
      console.error('Failed to load volumes:', error);
    }
  };

  const addVolume = () => {
    setVolumes([...volumes, {
      type: 'gp3',
      size: 20,
      encrypted: true,
      deleteOnTermination: false, // Additional volumes should not delete on termination by default
    }]);
  };

  const removeVolume = (index: number) => {
    setVolumes(volumes.filter((_, i) => i !== index));
  };

  const updateVolume = (index: number, field: string, value: any) => {
    const updatedVolumes = volumes.map((volume, i) => 
      i === index ? { ...volume, [field]: value } : volume
    );
    setVolumes(updatedVolumes);
  };

  const toggleExistingVolume = (volumeId: string) => {
    setSelectedExistingVolumes(prev => 
      prev.includes(volumeId) 
        ? prev.filter(id => id !== volumeId)
        : [...prev, volumeId]
    );
  };

  const getOSIcon = (osType: string) => {
    switch (osType) {
      case 'windows':
        return <Monitor className="w-5 h-5 text-blue-600" />;
      case 'macos':
        return <Smartphone className="w-5 h-5 text-gray-600" />;
      default:
        return <Server className="w-5 h-5 text-green-600" />;
    }
  };

  const getOSColor = (osType: string) => {
    switch (osType) {
      case 'amazon-linux': return 'bg-orange-100 text-orange-800';
      case 'ubuntu': return 'bg-orange-100 text-orange-800';
      case 'windows': return 'bg-blue-100 text-blue-800';
      case 'redhat': return 'bg-red-100 text-red-800';
      case 'suse': return 'bg-green-100 text-green-800';
      case 'debian': return 'bg-purple-100 text-purple-800';
      case 'macos': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getFilteredAMIs = () => {
    if (amiFilter === 'all') return amis;
    return amis.filter(ami => ami.osType === amiFilter);
  };

  const isRecommendedAMI = (ami: AMI) => {
    return ami.osType === 'ubuntu' && ami.osVersion === '22.04';
  };

  const selectedAMIDetails = amis.find(ami => ami.id === selectedAMI);
  const selectedInstanceTypeDetails = instanceTypes.find(type => type.name === selectedInstanceType);

  const onSubmit = async (data: FormData) => {
    try {
      setCreating(true);
      
      // Create the root volume configuration
      const rootVolume: Omit<EBSVolume, 'id'> = {
        type: data.rootVolumeType,
        size: data.rootVolumeSize,
        encrypted: data.rootVolumeEncrypted,
        deleteOnTermination: true, // Root volume should delete on termination
      };

      // Combine root volume with additional volumes
      const allVolumes = [rootVolume, ...volumes];

      await createInstance({
        ...data,
        securityGroupIds: data.securityGroupIds || [],
        volumes: allVolumes,
        existingVolumeIds: selectedExistingVolumes,
        tags: { Name: data.name },
        installDocker: data.installDocker,
        dockerImageToPull: data.dockerImageToPull || undefined,
      });
      onInstanceCreated();
      onClose();
    } catch (error) {
      console.error('Failed to create instance:', error);
      alert('Error creating instance: ' + (error.message || 'Unknown error'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Launch New EC2 Instance</h2>
          <p className="text-sm text-gray-600 mt-1">Configure your new EC2 instance with the options below</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input
              label="Instance Name"
              {...register('name', { required: 'Instance name is required' })}
              error={errors.name?.message}
              placeholder="my-web-server"
            />

            <Select
              label="AWS Region"
              {...register('region', { required: 'Region is required' })}
              error={errors.region?.message}
              options={regions.map(region => ({ value: region.code, label: `${region.name} (${region.code})` }))}
              placeholder="Select a region"
            />
          </div>

          {selectedRegion && (
            <Card title="🖥️ Operating System Selection">
              <div className="space-y-4">
                {/* Recommended AMI Banner */}
                <div className="bg-gradient-to-r from-blue-50 to-green-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start space-x-3">
                    <Star className="w-6 h-6 text-yellow-500 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-blue-900 mb-2">🎯 Recommended: Ubuntu 22.04 LTS</h4>
                      <p className="text-sm text-blue-800 mb-2">
                        Ubuntu 22.04 LTS is our recommended choice for most applications. It offers:
                      </p>
                      <ul className="text-sm text-blue-700 space-y-1">
                        <li>• <strong>Long Term Support</strong> until April 2027</li>
                        <li>• <strong>Latest features</strong> and improved performance</li>
                        <li>• <strong>Strong community support</strong> and extensive documentation</li>
                        <li>• <strong>Perfect for containers</strong>, web servers, and modern workloads</li>
                        <li>• <strong>SSH Terminal ready</strong> with username: <code className="bg-blue-100 px-1 rounded">ubuntu</code></li>
                        <li>• <strong>Docker compatible</strong> with excellent container support</li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* AMI Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Operating System</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: 'all', label: 'All Operating Systems', count: amis.length },
                      { value: 'ubuntu', label: 'Ubuntu (Recommended)', count: amis.filter(a => a.osType === 'ubuntu').length },
                      { value: 'amazon-linux', label: 'Amazon Linux', count: amis.filter(a => a.osType === 'amazon-linux').length },
                      { value: 'windows', label: 'Windows', count: amis.filter(a => a.osType === 'windows').length },
                      { value: 'redhat', label: 'Red Hat', count: amis.filter(a => a.osType === 'redhat').length },
                      { value: 'suse', label: 'SUSE', count: amis.filter(a => a.osType === 'suse').length },
                      { value: 'debian', label: 'Debian', count: amis.filter(a => a.osType === 'debian').length },
                    ].filter(filter => filter.count > 0).map((filter) => (
                      <button
                        key={filter.value}
                        type="button"
                        onClick={() => setAmiFilter(filter.value)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          amiFilter === filter.value
                            ? 'bg-blue-600 text-white'
                            : filter.value === 'ubuntu'
                            ? 'bg-green-100 text-green-700 hover:bg-green-200 border border-green-300'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {filter.label} ({filter.count})
                        {filter.value === 'ubuntu' && <Star className="w-3 h-3 inline ml-1 text-yellow-500" />}
                      </button>
                    ))}
                  </div>
                </div>

                {/* AMI Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Choose AMI (Amazon Machine Image)
                  </label>
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <LoadingSpinner size="md" />
                      <span className="ml-2 text-gray-600">Loading AMIs...</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-4">
                      {getFilteredAMIs().map((ami) => (
                        <label
                          key={ami.id}
                          className={`flex items-start space-x-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                            selectedAMI === ami.id
                              ? 'border-blue-500 bg-blue-50'
                              : isRecommendedAMI(ami)
                              ? 'border-green-300 bg-green-50 hover:border-green-400'
                              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="radio"
                            value={ami.id}
                            {...register('amiId', { required: 'Please select an AMI' })}
                            className="mt-1"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2 mb-1">
                              {getOSIcon(ami.osType)}
                              <span className="font-medium text-gray-900">{ami.name}</span>
                              {isRecommendedAMI(ami) && (
                                <Badge variant="success" size="sm" className="bg-green-100 text-green-800">
                                  <Star className="w-3 h-3 mr-1" />
                                  RECOMMENDED
                                </Badge>
                              )}
                              <Badge variant="secondary" size="sm" className={getOSColor(ami.osType)}>
                                {ami.osType.replace('-', ' ').toUpperCase()}
                              </Badge>
                              <Badge variant="secondary" size="sm">
                                {ami.osVersion}
                              </Badge>
                              <Badge variant="secondary" size="sm">
                                {ami.architecture}
                              </Badge>
                            </div>
                            <p className="text-sm text-gray-600 mb-2">{ami.description}</p>
                            <div className="flex items-center space-x-4 text-xs text-gray-500">
                              <span>Default User: {ami.defaultUsername}</span>
                              <span>Platform: {ami.platform}</span>
                              <span>Created: {new Date(ami.creationDate).toLocaleDateString()}</span>
                            </div>
                            {isRecommendedAMI(ami) && (
                              <div className="mt-2 text-xs text-green-700 bg-green-100 px-2 py-1 rounded">
                                ✨ Perfect for containers, web development, and modern server workloads
                              </div>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                  {errors.amiId && (
                    <p className="text-sm text-red-600 mt-1">{errors.amiId.message}</p>
                  )}
                </div>

                {/* Selected AMI Details */}
                {selectedAMIDetails && (
                  <div className={`border rounded-lg p-4 ${
                    isRecommendedAMI(selectedAMIDetails) 
                      ? 'bg-green-50 border-green-200' 
                      : 'bg-gray-50 border-gray-200'
                  }`}>
                    <div className="flex items-start space-x-3">
                      {getOSIcon(selectedAMIDetails.osType)}
                      <div>
                        <div className="flex items-center space-x-2 mb-1">
                          <h4 className={`font-medium ${
                            isRecommendedAMI(selectedAMIDetails) ? 'text-green-900' : 'text-gray-900'
                          }`}>
                            Selected Operating System
                          </h4>
                          {isRecommendedAMI(selectedAMIDetails) && (
                            <Star className="w-4 h-4 text-yellow-500" />
                          )}
                        </div>
                        <p className={`text-sm mt-1 ${
                          isRecommendedAMI(selectedAMIDetails) ? 'text-green-800' : 'text-gray-800'
                        }`}>
                          <strong>{selectedAMIDetails.name}</strong> - {selectedAMIDetails.osVersion}
                        </p>
                        <p className={`text-sm mt-1 ${
                          isRecommendedAMI(selectedAMIDetails) ? 'text-green-700' : 'text-gray-700'
                        }`}>
                          Default SSH user: <code className={`px-1 rounded ${
                            isRecommendedAMI(selectedAMIDetails) ? 'bg-green-100' : 'bg-gray-100'
                          }`}>{selectedAMIDetails.defaultUsername}</code>
                        </p>
                        {selectedAMIDetails.platform === 'windows' && (
                          <p className="text-sm text-blue-700 mt-1">
                            💡 Windows instances use RDP (Remote Desktop) instead of SSH for remote access.
                          </p>
                        )}
                        {isRecommendedAMI(selectedAMIDetails) && (
                          <p className="text-sm text-green-700 mt-2 font-medium">
                            🎯 Excellent choice! This AMI is optimized for modern workloads and container support.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {selectedRegion && selectedAMI && (
            <Card title="Instance Configuration">
              <div className="space-y-4">
                <Select
                  label="Instance Type"
                  {...register('instanceType', { required: 'Instance type is required' })}
                  error={errors.instanceType?.message}
                  options={instanceTypes.map(type => ({ 
                    value: type.name, 
                    label: `${type.name} - ${type.vcpu} vCPU, ${type.memory} GB RAM` 
                  }))}
                  placeholder="Select instance type"
                />

                {selectedInstanceTypeDetails && (
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h4 className="font-medium text-gray-900 mb-2">Pricing Information</h4>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">On-Demand:</span>
                        <span className="ml-2 font-medium">${selectedInstanceTypeDetails.onDemandPrice}/hour</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Spot Price:</span>
                        <span className="ml-2 font-medium text-green-600">${selectedInstanceTypeDetails.spotPrice}/hour</span>
                      </div>
                    </div>
                    <div className="mt-3">
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          {...register('isSpotInstance')}
                          className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                        />
                        <span className="ml-2 text-sm text-gray-700">Launch as Spot Instance (up to 90% savings)</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card title="Security & Access">
            <div className="space-y-4">
              <Select
                label="SSH Key Pair"
                {...register('keyPairId', { required: 'Key pair is required' })}
                error={errors.keyPairId?.message}
                options={keyPairs.map(kp => ({ 
                  value: kp.name, 
                  label: `${kp.name}${kp.privateKey ? ' (SSH Terminal Ready)' : ' (Public Key Only)'}` 
                }))}
                placeholder="Select key pair"
              />

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">💡 SSH Terminal Access</h4>
                <p className="text-sm text-blue-800">
                  To use the built-in SSH terminal, make sure your key pair includes the private key (.pem file content). 
                  Key pairs marked as "SSH Terminal Ready" can be used for browser-based SSH access.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Security Groups</label>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {securityGroups.map(sg => (
                    <label key={sg.id} className="flex items-center">
                      <input
                        type="checkbox"
                        value={sg.id}
                        {...register('securityGroupIds')}
                        className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                      />
                      <span className="ml-2 text-sm text-gray-700">{sg.name} - {sg.description}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <Card title="🐳 Docker & Container Setup">
            <div className="space-y-6">
              {/* Docker Installation Option */}
              <div className="bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-200 rounded-lg p-6">
                <div className="flex items-start space-x-4">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                      <Container className="w-6 h-6 text-blue-600" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-3">
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          {...register('installDocker')}
                          className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50 w-5 h-5"
                        />
                        <span className="ml-3 text-lg font-semibold text-gray-900">
                          🚀 Install Docker & Docker Compose
                        </span>
                      </label>
                    </div>
                    <p className="text-sm text-gray-700 mb-4">
                      Automatically install Docker Engine and Docker Compose on your instance. Perfect for running 
                      containerized applications, game servers, and microservices.
                    </p>
                    
                    {installDocker && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                        <div className="flex items-center space-x-2 mb-2">
                          <CheckCircle className="w-5 h-5 text-green-600" />
                          <h4 className="font-medium text-green-900">Docker Installation Enabled</h4>
                        </div>
                        <ul className="text-sm text-green-800 space-y-1">
                          <li>• Latest Docker Engine will be installed</li>
                          <li>• Docker Compose v2 will be available</li>
                          <li>• User will be added to docker group</li>
                          <li>• Docker service will start automatically</li>
                          <li>• Ready to run containers immediately after boot</li>
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Docker Image Configuration */}
              {installDocker && (
                <div className="space-y-4">
                  <div className="border-t border-gray-200 pt-4">
                    <h4 className="font-medium text-gray-900 mb-3 flex items-center">
                      <Package className="w-5 h-5 mr-2 text-blue-600" />
                      Container Image Setup (Optional)
                    </h4>
                    
                    <Input
                      label="Docker Image to Pull"
                      {...register('dockerImageToPull')}
                      placeholder="e.g., nginx:latest, minecraft-server:latest, node:18-alpine"
                      helpText="Specify a Docker image to automatically pull and run after installation"
                    />

                    <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <div className="flex items-start space-x-3">
                        <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                        <div>
                          <h5 className="font-medium text-yellow-900">Popular Game Server Images</h5>
                          <div className="text-sm text-yellow-800 mt-2 space-y-1">
                            <p><strong>Minecraft Java:</strong> <code className="bg-yellow-100 px-1 rounded">itzg/minecraft-server:latest</code></p>
                            <p><strong>Minecraft Bedrock:</strong> <code className="bg-yellow-100 px-1 rounded">itzg/minecraft-bedrock-server:latest</code></p>
                            <p><strong>Palworld:</strong> <code className="bg-yellow-100 px-1 rounded">thijsvanloef/palworld-server-docker:latest</code></p>
                            <p><strong>Valheim:</strong> <code className="bg-yellow-100 px-1 rounded">lloesche/valheim-server:latest</code></p>
                            <p><strong>CS2:</strong> <code className="bg-yellow-100 px-1 rounded">joedwards32/cs2:latest</code></p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {selectedAMIDetails?.platform === 'windows' && (
                      <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4">
                        <div className="flex items-start space-x-3">
                          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                          <div>
                            <h5 className="font-medium text-red-900">Windows Not Supported</h5>
                            <p className="text-sm text-red-800 mt-1">
                              Docker installation is only available for Linux-based AMIs. Please select a Linux distribution 
                              like Ubuntu, Amazon Linux, or Debian to use this feature.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card title="Storage Configuration">
            <div className="space-y-6">
              {/* Root Volume Configuration */}
              <div>
                <h4 className="font-medium text-gray-900 mb-4">Root Volume (Boot Drive)</h4>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                  <div className="flex items-start space-x-3">
                    <HardDrive className="w-5 h-5 text-yellow-600 mt-0.5" />
                    <div>
                      <h5 className="font-medium text-yellow-900">Root Volume Configuration</h5>
                      <p className="text-sm text-yellow-800 mt-1">
                        This is the main drive where the operating system will be installed. 
                        Default size is 8 GB for most AMIs, but you can increase it if needed.
                        {installDocker && (
                          <span className="block mt-1 font-medium">
                            💡 Consider at least 20 GB when using Docker for container storage.
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Select
                    label="Root Volume Type"
                    {...register('rootVolumeType')}
                    options={[
                      { value: 'gp3', label: 'gp3 (General Purpose SSD - Latest)' },
                      { value: 'gp2', label: 'gp2 (General Purpose SSD)' },
                      { value: 'io1', label: 'io1 (Provisioned IOPS SSD)' },
                      { value: 'io2', label: 'io2 (Provisioned IOPS SSD - Latest)' },
                    ]}
                  />

                  <Input
                    label="Root Volume Size (GB)"
                    type="number"
                    {...register('rootVolumeSize', { 
                      required: 'Root volume size is required',
                      min: { value: 8, message: 'Minimum size is 8 GB' },
                      max: { value: 16384, message: 'Maximum size is 16384 GB' }
                    })}
                    error={errors.rootVolumeSize?.message}
                    min="8"
                    max="16384"
                  />

                  <div className="flex items-center space-x-4 pt-6">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        {...register('rootVolumeEncrypted')}
                        className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                      />
                      <span className="ml-2 text-sm text-gray-700">Encrypt root volume</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Additional Volumes Section */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-medium text-gray-900">Additional Storage Volumes</h4>
                  <Button type="button" variant="secondary" size="sm" onClick={addVolume}>
                    <Plus className="w-4 h-4 mr-1" />
                    Add Volume
                  </Button>
                </div>

                {volumes.map((volume, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <Select
                        label="Volume Type"
                        value={volume.type}
                        onChange={(e) => updateVolume(index, 'type', e.target.value)}
                        options={[
                          { value: 'gp3', label: 'gp3 (General Purpose SSD)' },
                          { value: 'gp2', label: 'gp2 (General Purpose SSD)' },
                          { value: 'io1', label: 'io1 (Provisioned IOPS SSD)' },
                          { value: 'io2', label: 'io2 (Provisioned IOPS SSD)' },
                          { value: 'st1', label: 'st1 (Throughput Optimized HDD)' },
                          { value: 'sc1', label: 'sc1 (Cold HDD)' },
                        ]}
                      />

                      <Input
                        label="Size (GB)"
                        type="number"
                        value={volume.size}
                        onChange={(e) => updateVolume(index, 'size', parseInt(e.target.value))}
                        min="1"
                        max="16384"
                      />

                      <div className="flex items-center space-x-4">
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={volume.encrypted}
                            onChange={(e) => updateVolume(index, 'encrypted', e.target.checked)}
                            className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                          />
                          <span className="ml-2 text-sm text-gray-700">Encrypted</span>
                        </label>
                      </div>

                      <div className="flex items-center justify-end">
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={() => removeVolume(index)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}

                {volumes.length === 0 && (
                  <div className="text-center py-6 text-gray-500 border-2 border-dashed border-gray-300 rounded-lg">
                    <HardDrive className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                    <p>No additional volumes configured</p>
                    <p className="text-sm">Only the root volume will be created</p>
                  </div>
                )}
              </div>

              {/* Existing Volumes Section */}
              {availableVolumes.length > 0 && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-4">Attach Existing Volumes</h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-4">
                    {availableVolumes.map(volume => (
                      <label key={volume.id} className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg">
                        <div className="flex items-center">
                          <input
                            type="checkbox"
                            checked={selectedExistingVolumes.includes(volume.id)}
                            onChange={() => toggleExistingVolume(volume.id)}
                            className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                          />
                          <div className="ml-3">
                            <div className="text-sm font-medium text-gray-900">{volume.id}</div>
                            <div className="text-sm text-gray-500">
                              {volume.type.toUpperCase()} - {volume.size} GB
                              {volume.encrypted && <span className="ml-2 text-green-600">Encrypted</span>}
                            </div>
                          </div>
                        </div>
                        <Link className="w-4 h-4 text-gray-400" />
                      </label>
                    ))}
                  </div>
                  {selectedExistingVolumes.length > 0 && (
                    <div className="mt-2 text-sm text-blue-600">
                      {selectedExistingVolumes.length} volume(s) selected for attachment
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>

          <Card title="Advanced Configuration (Optional)">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">User Data Script</label>
                <textarea
                  {...register('userData')}
                  rows={4}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm font-mono"
                  placeholder="#!/bin/bash&#10;apt update -y&#10;# Add your initialization commands here"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Script to run when the instance starts. {installDocker && 'Docker installation script will be automatically added.'}
                </p>
              </div>
            </div>
          </Card>

          <div className="flex items-center justify-end space-x-3 pt-6 border-t">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? (
                <>
                  <LoadingSpinner size="sm" />
                  <span className="ml-2">Creating Instance...</span>
                </>
              ) : (
                'Launch Instance'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}