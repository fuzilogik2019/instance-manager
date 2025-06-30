import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'lucide-react';
import { EBSVolume, EC2Instance } from '../../types/aws';
import { getInstances, attachVolume } from '../../services/api';
import Button from '../ui/Button';
import Select from '../ui/Select';
import LoadingSpinner from '../ui/LoadingSpinner';

interface FormData {
  instanceId: string;
  device: string;
}

interface VolumeAttachFormProps {
  volume: EBSVolume;
  onVolumeAttached: () => void;
  onClose: () => void;
}

export default function VolumeAttachForm({ volume, onVolumeAttached, onClose }: VolumeAttachFormProps) {
  const [instances, setInstances] = useState<EC2Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [attaching, setAttaching] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>();

  useEffect(() => {
    loadInstances();
  }, []);

  const loadInstances = async () => {
    try {
      const data = await getInstances();
      // Filter running instances in the same region
      const runningInstances = data.filter(instance => 
        instance.state === 'running' && instance.region === volume.region
      );
      setInstances(runningInstances);
    } catch (error) {
      console.error('Failed to load instances:', error);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (data: FormData) => {
    try {
      setAttaching(true);
      await attachVolume(volume.id, data.instanceId, data.device);
      onVolumeAttached();
      onClose();
    } catch (error) {
      console.error('Failed to attach volume:', error);
    } finally {
      setAttaching(false);
    }
  };

  const getAvailableDevices = () => {
    // Common device names for Linux instances
    return [
      { value: '/dev/sdf', label: '/dev/sdf' },
      { value: '/dev/sdg', label: '/dev/sdg' },
      { value: '/dev/sdh', label: '/dev/sdh' },
      { value: '/dev/sdi', label: '/dev/sdi' },
      { value: '/dev/sdj', label: '/dev/sdj' },
      { value: '/dev/sdk', label: '/dev/sdk' },
      { value: '/dev/sdl', label: '/dev/sdl' },
      { value: '/dev/sdm', label: '/dev/sdm' },
      { value: '/dev/sdn', label: '/dev/sdn' },
      { value: '/dev/sdo', label: '/dev/sdo' },
      { value: '/dev/sdp', label: '/dev/sdp' },
    ];
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Attach Volume</h2>
          <p className="text-sm text-gray-600 mt-1">Attach volume {volume.id} to an instance</p>
        </div>

        {loading ? (
          <div className="p-6 flex items-center justify-center">
            <LoadingSpinner size="lg" />
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
            <div className="bg-gray-50 p-4 rounded-lg">
              <h4 className="font-medium text-gray-900 mb-2">Volume Details</h4>
              <div className="text-sm text-gray-600 space-y-1">
                <div>ID: {volume.id}</div>
                <div>Type: {volume.type.toUpperCase()}</div>
                <div>Size: {volume.size} GB</div>
                <div>Region: {volume.region}</div>
              </div>
            </div>

            {instances.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-gray-600">No running instances found in this region.</p>
                <p className="text-sm text-gray-500 mt-1">
                  Launch an instance first to attach this volume.
                </p>
              </div>
            ) : (
              <>
                <Select
                  label="Target Instance"
                  {...register('instanceId', { required: 'Please select an instance' })}
                  error={errors.instanceId?.message}
                  options={instances.map(instance => ({
                    value: instance.id,
                    label: `${instance.name} (${instance.id}) - ${instance.instanceType}`
                  }))}
                  placeholder="Select an instance"
                />

                <Select
                  label="Device Name"
                  {...register('device', { required: 'Please select a device name' })}
                  error={errors.device?.message}
                  options={getAvailableDevices()}
                  placeholder="Select device name"
                  helpText="The device name as it will appear in the instance"
                />

                <div className="bg-blue-50 p-4 rounded-lg">
                  <h4 className="font-medium text-blue-900 mb-2">Important Notes</h4>
                  <ul className="text-sm text-blue-800 space-y-1">
                    <li>• The volume and instance must be in the same Availability Zone</li>
                    <li>• You may need to format and mount the volume inside the instance</li>
                    <li>• Device names may appear differently inside the instance (e.g., /dev/xvdf)</li>
                  </ul>
                </div>
              </>
            )}

            <div className="flex items-center justify-end space-x-3 pt-6 border-t">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              {instances.length > 0 && (
                <Button type="submit" disabled={attaching}>
                  {attaching ? (
                    <>
                      <LoadingSpinner size="sm" />
                      <span className="ml-2">Attaching...</span>
                    </>
                  ) : (
                    <>
                      <Link className="w-4 h-4 mr-2" />
                      Attach Volume
                    </>
                  )}
                </Button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}