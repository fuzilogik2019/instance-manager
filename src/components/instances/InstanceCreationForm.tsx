import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Plus, HardDrive, AlertCircle, CheckCircle, Link } from 'lucide-react';
import { AWSRegion, InstanceType, SecurityGroup, SSHKeyPair, EBSVolume } from '../../types/aws';
import { getRegions, getInstanceTypes, getSecurityGroups, getKeyPairs, getVolumes, createInstance } from '../../services/api';
import LoadingSpinner from '../ui/LoadingSpinner';
import Button from '../ui/Button';
import Select from '../ui/Select';
import Input from '../ui/Input';
import Card from '../ui/Card';

interface FormData {
  name: string;
  region: string;
  instanceType: string;
  keyPairId: string;
  securityGroupIds: string[];
  isSpotInstance: boolean;
  userData: string;
}

interface InstanceCreationFormProps {
  onInstanceCreated: () => void;
  onClose: () => void;
}

export default function InstanceCreationForm({ onInstanceCreated, onClose }: InstanceCreationFormProps) {
  const [regions, setRegions] = useState<AWSRegion[]>([]);
  const [instanceTypes, setInstanceTypes] = useState<InstanceType[]>([]);
  const [securityGroups, setSecurityGroups] = useState<SecurityGroup[]>([]);
  const [keyPairs, setKeyPairs] = useState<SSHKeyPair[]>([]);
  const [availableVolumes, setAvailableVolumes] = useState<EBSVolume[]>([]);
  const [volumes, setVolumes] = useState<Omit<EBSVolume, 'id'>[]>([]);
  const [selectedExistingVolumes, setSelectedExistingVolumes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>();
  const selectedRegion = watch('region');
  const selectedInstanceType = watch('instanceType');

  useEffect(() => {
    loadRegions();
    loadKeyPairs();
  }, []);

  useEffect(() => {
    if (selectedRegion) {
      loadInstanceTypes(selectedRegion);
      loadSecurityGroups(selectedRegion);
      loadAvailableVolumes(selectedRegion);
    }
  }, [selectedRegion]);

  const loadRegions = async () => {
    try {
      const data = await getRegions();
      setRegions(data);
    } catch (error) {
      console.error('Failed to load regions:', error);
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
      deleteOnTermination: true,
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

  const onSubmit = async (data: FormData) => {
    try {
      setCreating(true);
      
      // Add root volume if no volumes are specified
      let finalVolumes = volumes;
      if (volumes.length === 0 && selectedExistingVolumes.length === 0) {
        finalVolumes = [{
          type: 'gp3',
          size: 20,
          encrypted: true,
          deleteOnTermination: true,
        }];
      }

      await createInstance({
        ...data,
        securityGroupIds: data.securityGroupIds || [],
        volumes: finalVolumes,
        existingVolumeIds: selectedExistingVolumes,
        tags: { Name: data.name },
      });
      onInstanceCreated();
      onClose();
    } catch (error) {
      console.error('Failed to create instance:', error);
    } finally {
      setCreating(false);
    }
  };

  const selectedInstanceTypeDetails = instanceTypes.find(type => type.name === selectedInstanceType);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto">
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
                options={keyPairs.map(kp => ({ value: kp.name, label: kp.name }))}
                placeholder="Select key pair"
              />

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

          <Card title="Storage Configuration">
            <div className="space-y-6">
              {/* New Volumes Section */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-medium text-gray-900">Create New Volumes</h4>
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
                    <p>No new volumes configured</p>
                    <p className="text-sm">Root volume will be created automatically</p>
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
                  placeholder="#!/bin/bash&#10;yum update -y&#10;# Add your initialization commands here"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Script to run when the instance starts. Useful for installing software and configuring the system.
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