import React, { useState, useEffect } from 'react';
import { HardDrive, Plus, RefreshCw, Trash2, Link, Unlink } from 'lucide-react';
import { EBSVolume, AWSRegion } from '../../types/aws';
import { getVolumes, deleteVolume, attachVolume, detachVolume, getRegions } from '../../services/api';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import Card from '../ui/Card';
import Select from '../ui/Select';
import LoadingSpinner from '../ui/LoadingSpinner';
import VolumeCreationForm from './VolumeCreationForm';
import VolumeAttachForm from './VolumeAttachForm';

export default function VolumesList() {
  const [volumes, setVolumes] = useState<EBSVolume[]>([]);
  const [regions, setRegions] = useState<AWSRegion[]>([]);
  const [selectedRegion, setSelectedRegion] = useState('us-east-1');
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showAttachForm, setShowAttachForm] = useState(false);
  const [selectedVolume, setSelectedVolume] = useState<EBSVolume | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    loadRegions();
  }, []);

  useEffect(() => {
    if (selectedRegion) {
      loadVolumes();
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

  const loadVolumes = async () => {
    try {
      setLoading(true);
      const data = await getVolumes(selectedRegion);
      setVolumes(data);
    } catch (error) {
      console.error('Failed to load volumes:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (volumeId: string) => {
    const volume = volumes.find(v => v.id === volumeId);
    
    if (volume?.state === 'in-use') {
      alert('Cannot delete attached volume. Please detach it first.');
      return;
    }

    if (!confirm('Are you sure you want to delete this volume? This action cannot be undone and all data will be lost.')) {
      return;
    }

    try {
      setActionLoading(volumeId);
      console.log(`Attempting to delete volume: ${volumeId}`);
      await deleteVolume(volumeId);
      console.log(`Volume ${volumeId} deleted successfully`);
      await loadVolumes();
    } catch (error) {
      console.error('Failed to delete volume:', error);
      alert('Failed to delete volume. Please check the console for details.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDetach = async (volumeId: string) => {
    if (!confirm('Are you sure you want to detach this volume from the instance?')) {
      return;
    }

    try {
      setActionLoading(volumeId);
      console.log(`Attempting to detach volume: ${volumeId}`);
      await detachVolume(volumeId);
      console.log(`Volume ${volumeId} detached successfully`);
      await loadVolumes();
    } catch (error) {
      console.error('Failed to detach volume:', error);
      alert('Failed to detach volume. Please check the console for details.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAttach = (volume: EBSVolume) => {
    setSelectedVolume(volume);
    setShowAttachForm(true);
  };

  const getVolumeStateColor = (state: string) => {
    switch (state) {
      case 'available': return 'success';
      case 'in-use': return 'primary';
      case 'creating': return 'warning';
      case 'deleting': return 'danger';
      default: return 'secondary';
    }
  };

  const formatVolumeSize = (size: number) => {
    if (size >= 1024) {
      return `${(size / 1024).toFixed(1)} TB`;
    }
    return `${size} GB`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">EBS Volumes</h2>
          <p className="text-gray-600 mt-1">Manage your Elastic Block Store volumes</p>
        </div>
        <div className="flex items-center space-x-3">
          <Select
            value={selectedRegion}
            onChange={(e) => setSelectedRegion(e.target.value)}
            options={regions.map(region => ({ value: region.code, label: region.name }))}
            className="w-48"
          />
          <Button variant="secondary" onClick={loadVolumes}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={() => setShowCreateForm(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Volume
          </Button>
        </div>
      </div>

      {volumes.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <HardDrive className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No volumes found</h3>
            <p className="text-gray-600 mb-4">Create your first EBS volume to provide storage for your instances</p>
            <Button onClick={() => setShowCreateForm(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Volume
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-6">
          {volumes.map((volume) => (
            <Card key={volume.id}>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                      <HardDrive className="w-5 h-5 text-purple-600" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{volume.id}</h3>
                    <div className="flex items-center space-x-4 text-sm text-gray-600 mt-1">
                      <span>{volume.type.toUpperCase()}</span>
                      <span>{formatVolumeSize(volume.size)}</span>
                      <span>{selectedRegion}</span>
                      {volume.encrypted && (
                        <Badge variant="success" size="sm">Encrypted</Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <Badge variant={getVolumeStateColor(volume.state || 'available')}>
                    {volume.state || 'available'}
                  </Badge>
                  <div className="flex items-center space-x-2">
                    {volume.state === 'available' && (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => handleAttach(volume)}
                        title="Attach to instance"
                      >
                        <Link className="w-4 h-4" />
                      </Button>
                    )}
                    {volume.state === 'in-use' && (
                      <Button
                        size="sm"
                        variant="warning"
                        onClick={() => handleDetach(volume.id)}
                        disabled={actionLoading === volume.id}
                        title="Detach from instance"
                      >
                        {actionLoading === volume.id ? (
                          <LoadingSpinner size="sm" />
                        ) : (
                          <Unlink className="w-4 h-4" />
                        )}
                      </Button>
                    )}
                    {(volume.state === 'available' || !volume.state) && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleDelete(volume.id)}
                        disabled={actionLoading === volume.id}
                        title="Delete volume"
                      >
                        {actionLoading === volume.id ? (
                          <LoadingSpinner size="sm" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Volume ID:</span>
                  <span className="ml-2 font-mono">{volume.id}</span>
                </div>
                <div>
                  <span className="text-gray-600">State:</span>
                  <span className="ml-2">{volume.state || 'available'}</span>
                </div>
                <div>
                  <span className="text-gray-600">Created:</span>
                  <span className="ml-2">{new Date(volume.createdAt || Date.now()).toLocaleString()}</span>
                </div>
                {volume.instanceId && (
                  <>
                    <div>
                      <span className="text-gray-600">Attached to:</span>
                      <span className="ml-2 font-mono">{volume.instanceId}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Device:</span>
                      <span className="ml-2 font-mono">{volume.device}</span>
                    </div>
                  </>
                )}
              </div>

              {volume.type === 'io1' || volume.type === 'io2' ? (
                <div className="mt-4 bg-blue-50 p-3 rounded-lg">
                  <div className="text-sm">
                    <span className="text-gray-600">Provisioned IOPS:</span>
                    <span className="ml-2 font-medium">{volume.iops || 'N/A'}</span>
                  </div>
                </div>
              ) : null}

              {volume.type === 'gp3' && (
                <div className="mt-4 bg-blue-50 p-3 rounded-lg">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">IOPS:</span>
                      <span className="ml-2 font-medium">{volume.iops || '3000'}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Throughput:</span>
                      <span className="ml-2 font-medium">{volume.throughput || '125'} MB/s</span>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {showCreateForm && (
        <VolumeCreationForm
          region={selectedRegion}
          onVolumeCreated={loadVolumes}
          onClose={() => setShowCreateForm(false)}
        />
      )}

      {showAttachForm && selectedVolume && (
        <VolumeAttachForm
          volume={selectedVolume}
          onVolumeAttached={loadVolumes}
          onClose={() => {
            setShowAttachForm(false);
            setSelectedVolume(null);
          }}
        />
      )}
    </div>
  );
}