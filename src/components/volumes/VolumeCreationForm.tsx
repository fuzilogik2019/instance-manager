import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { HardDrive, Info } from 'lucide-react';
import { createVolume } from '../../services/api';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import LoadingSpinner from '../ui/LoadingSpinner';

interface FormData {
  type: 'gp2' | 'gp3' | 'io1' | 'io2' | 'st1' | 'sc1';
  size: number;
  iops?: number;
  throughput?: number;
  encrypted: boolean;
}

interface VolumeCreationFormProps {
  region: string;
  onVolumeCreated: () => void;
  onClose: () => void;
}

export default function VolumeCreationForm({ region, onVolumeCreated, onClose }: VolumeCreationFormProps) {
  const [creating, setCreating] = useState(false);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    defaultValues: {
      type: 'gp3',
      size: 20,
      encrypted: true,
    }
  });

  const selectedType = watch('type');
  const selectedSize = watch('size');

  const onSubmit = async (data: FormData) => {
    try {
      setCreating(true);
      await createVolume({
        ...data,
        region,
        deleteOnTermination: false,
      });
      onVolumeCreated();
      onClose();
    } catch (error) {
      console.error('Failed to create volume:', error);
    } finally {
      setCreating(false);
    }
  };

  const getVolumeTypeInfo = (type: string) => {
    switch (type) {
      case 'gp3':
        return {
          name: 'General Purpose SSD (gp3)',
          description: 'Latest generation general purpose SSD with configurable IOPS and throughput',
          minSize: 1,
          maxSize: 16384,
          baseIops: 3000,
          maxIops: 16000,
          baseThroughput: 125,
          maxThroughput: 1000,
        };
      case 'gp2':
        return {
          name: 'General Purpose SSD (gp2)',
          description: 'Previous generation general purpose SSD with burstable performance',
          minSize: 1,
          maxSize: 16384,
          baseIops: Math.min(3000, selectedSize * 3),
          maxIops: 16000,
        };
      case 'io1':
        return {
          name: 'Provisioned IOPS SSD (io1)',
          description: 'High performance SSD with provisioned IOPS',
          minSize: 4,
          maxSize: 16384,
          minIops: 100,
          maxIops: 64000,
        };
      case 'io2':
        return {
          name: 'Provisioned IOPS SSD (io2)',
          description: 'Latest generation high performance SSD with higher durability',
          minSize: 4,
          maxSize: 16384,
          minIops: 100,
          maxIops: 64000,
        };
      case 'st1':
        return {
          name: 'Throughput Optimized HDD (st1)',
          description: 'Low cost HDD for frequently accessed, throughput-intensive workloads',
          minSize: 125,
          maxSize: 16384,
        };
      case 'sc1':
        return {
          name: 'Cold HDD (sc1)',
          description: 'Lowest cost HDD for less frequently accessed workloads',
          minSize: 125,
          maxSize: 16384,
        };
      default:
        return null;
    }
  };

  const typeInfo = getVolumeTypeInfo(selectedType);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Create EBS Volume</h2>
          <p className="text-sm text-gray-600 mt-1">Create a new Elastic Block Store volume in {region}</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          <Select
            label="Volume Type"
            {...register('type', { required: 'Volume type is required' })}
            error={errors.type?.message}
            options={[
              { value: 'gp3', label: 'gp3 - General Purpose SSD (Latest)' },
              { value: 'gp2', label: 'gp2 - General Purpose SSD' },
              { value: 'io1', label: 'io1 - Provisioned IOPS SSD' },
              { value: 'io2', label: 'io2 - Provisioned IOPS SSD (Latest)' },
              { value: 'st1', label: 'st1 - Throughput Optimized HDD' },
              { value: 'sc1', label: 'sc1 - Cold HDD' },
            ]}
          />

          {typeInfo && (
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="flex items-start space-x-3">
                <Info className="w-5 h-5 text-blue-600 mt-0.5" />
                <div>
                  <h4 className="font-medium text-blue-900">{typeInfo.name}</h4>
                  <p className="text-sm text-blue-800 mt-1">{typeInfo.description}</p>
                  <div className="text-sm text-blue-800 mt-2">
                    <span>Size range: {typeInfo.minSize} GB - {typeInfo.maxSize} GB</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <Input
            label="Size (GB)"
            type="number"
            {...register('size', { 
              required: 'Size is required',
              min: { value: typeInfo?.minSize || 1, message: `Minimum size is ${typeInfo?.minSize || 1} GB` },
              max: { value: typeInfo?.maxSize || 16384, message: `Maximum size is ${typeInfo?.maxSize || 16384} GB` }
            })}
            error={errors.size?.message}
            min={typeInfo?.minSize || 1}
            max={typeInfo?.maxSize || 16384}
          />

          {(selectedType === 'io1' || selectedType === 'io2') && (
            <Input
              label="Provisioned IOPS"
              type="number"
              {...register('iops', { 
                required: 'IOPS is required for provisioned IOPS volumes',
                min: { value: typeInfo?.minIops || 100, message: `Minimum IOPS is ${typeInfo?.minIops || 100}` },
                max: { value: typeInfo?.maxIops || 64000, message: `Maximum IOPS is ${typeInfo?.maxIops || 64000}` }
              })}
              error={errors.iops?.message}
              min={typeInfo?.minIops || 100}
              max={typeInfo?.maxIops || 64000}
              helpText={`Range: ${typeInfo?.minIops || 100} - ${typeInfo?.maxIops || 64000} IOPS`}
            />
          )}

          {selectedType === 'gp3' && (
            <>
              <Input
                label="IOPS (Optional)"
                type="number"
                {...register('iops')}
                min={3000}
                max={16000}
                placeholder="3000"
                helpText="Default: 3000 IOPS (Range: 3000 - 16000)"
              />
              <Input
                label="Throughput (MB/s) (Optional)"
                type="number"
                {...register('throughput')}
                min={125}
                max={1000}
                placeholder="125"
                helpText="Default: 125 MB/s (Range: 125 - 1000)"
              />
            </>
          )}

          <div className="space-y-3">
            <label className="flex items-center">
              <input
                type="checkbox"
                {...register('encrypted')}
                className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
              />
              <span className="ml-2 text-sm text-gray-700">Enable encryption</span>
            </label>
            <p className="text-xs text-gray-500">
              Encryption protects your data at rest and in transit between the volume and the instance.
            </p>
          </div>

          <div className="bg-yellow-50 p-4 rounded-lg">
            <div className="flex items-start space-x-3">
              <HardDrive className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-yellow-900">Pricing Information</h4>
                <p className="text-sm text-yellow-800 mt-1">
                  You will be charged for the provisioned storage even if the volume is not attached to an instance.
                  Additional charges apply for provisioned IOPS and throughput above the baseline.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end space-x-3 pt-6 border-t">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? (
                <>
                  <LoadingSpinner size="sm" />
                  <span className="ml-2">Creating Volume...</span>
                </>
              ) : (
                'Create Volume'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}