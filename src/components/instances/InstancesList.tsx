import React, { useState, useEffect } from 'react';
import { Server, Play, Square, Trash2, RefreshCw, Plus, ExternalLink } from 'lucide-react';
import { EC2Instance } from '../../types/aws';
import { getInstances, startInstance, stopInstance, terminateInstance } from '../../services/api';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import Card from '../ui/Card';
import LoadingSpinner from '../ui/LoadingSpinner';
import InstanceCreationForm from './InstanceCreationForm';

export default function InstancesList() {
  const [instances, setInstances] = useState<EC2Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    loadInstances();
  }, []);

  const loadInstances = async () => {
    try {
      setLoading(true);
      const data = await getInstances();
      setInstances(data);
    } catch (error) {
      console.error('Failed to load instances:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async (instanceId: string) => {
    try {
      setActionLoading(instanceId);
      await startInstance(instanceId);
      await loadInstances();
    } catch (error) {
      console.error('Failed to start instance:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async (instanceId: string) => {
    try {
      setActionLoading(instanceId);
      await stopInstance(instanceId);
      await loadInstances();
    } catch (error) {
      console.error('Failed to stop instance:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const handleTerminate = async (instanceId: string) => {
    if (!confirm('Are you sure you want to terminate this instance? This action cannot be undone.')) {
      return;
    }

    try {
      setActionLoading(instanceId);
      await terminateInstance(instanceId);
      await loadInstances();
    } catch (error) {
      console.error('Failed to terminate instance:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const getStateColor = (state: string) => {
    switch (state) {
      case 'running': return 'success';
      case 'stopped': return 'secondary';
      case 'pending': return 'warning';
      case 'stopping': return 'warning';
      case 'terminated': return 'danger';
      default: return 'secondary';
    }
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
          <h2 className="text-2xl font-bold text-gray-900">EC2 Instances</h2>
          <p className="text-gray-600 mt-1">Manage your EC2 instances</p>
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="secondary" onClick={loadInstances}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={() => setShowCreateForm(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Launch Instance
          </Button>
        </div>
      </div>

      {instances.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <Server className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No instances found</h3>
            <p className="text-gray-600 mb-4">Get started by launching your first EC2 instance</p>
            <Button onClick={() => setShowCreateForm(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Launch Instance
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-6">
          {instances.map((instance) => (
            <Card key={instance.id}>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <Server className="w-5 h-5 text-blue-600" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{instance.name}</h3>
                    <div className="flex items-center space-x-4 text-sm text-gray-600 mt-1">
                      <span>{instance.instanceType}</span>
                      <span>{instance.region}</span>
                      <span>{instance.availabilityZone}</span>
                      {instance.isSpotInstance && (
                        <Badge variant="warning" size="sm">Spot</Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <Badge variant={getStateColor(instance.state)}>
                    {instance.state}
                  </Badge>
                  <div className="flex items-center space-x-2">
                    {instance.state === 'stopped' && (
                      <Button
                        size="sm"
                        variant="success"
                        onClick={() => handleStart(instance.id)}
                        disabled={actionLoading === instance.id}
                      >
                        {actionLoading === instance.id ? (
                          <LoadingSpinner size="sm" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </Button>
                    )}
                    {instance.state === 'running' && (
                      <Button
                        size="sm"
                        variant="warning"
                        onClick={() => handleStop(instance.id)}
                        disabled={actionLoading === instance.id}
                      >
                        {actionLoading === instance.id ? (
                          <LoadingSpinner size="sm" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </Button>
                    )}
                    {instance.state !== 'terminated' && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleTerminate(instance.id)}
                        disabled={actionLoading === instance.id}
                      >
                        {actionLoading === instance.id ? (
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
                  <span className="text-gray-600">Instance ID:</span>
                  <span className="ml-2 font-mono">{instance.id}</span>
                </div>
                <div>
                  <span className="text-gray-600">Private IP:</span>
                  <span className="ml-2 font-mono">{instance.privateIp}</span>
                </div>
                <div>
                  <span className="text-gray-600">Public IP:</span>
                  <span className="ml-2 font-mono">{instance.publicIp || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-gray-600">Key Pair:</span>
                  <span className="ml-2">{instance.keyPairName}</span>
                </div>
                <div>
                  <span className="text-gray-600">Launch Time:</span>
                  <span className="ml-2">{new Date(instance.launchTime).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-gray-600">Volumes:</span>
                  <span className="ml-2">{instance.volumes.length}</span>
                </div>
              </div>

              {instance.volumes.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Attached Volumes</h4>
                  <div className="space-y-2">
                    {instance.volumes.map((volume, index) => (
                      <div key={volume.id} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                        <span className="text-sm text-gray-700">
                          {volume.type.toUpperCase()} - {volume.size} GB
                          {volume.encrypted && <Badge variant="success" size="sm" className="ml-2">Encrypted</Badge>}
                        </span>
                        <span className="text-xs text-gray-500 font-mono">{volume.id}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {showCreateForm && (
        <InstanceCreationForm
          onInstanceCreated={loadInstances}
          onClose={() => setShowCreateForm(false)}
        />
      )}
    </div>
  );
}