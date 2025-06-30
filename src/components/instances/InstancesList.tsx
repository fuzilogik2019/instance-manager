import React, { useState, useEffect } from 'react';
import { Server, Play, Square, Trash2, RefreshCw, Plus, ExternalLink, AlertTriangle } from 'lucide-react';
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
    const instance = instances.find(i => i.id === instanceId);
    
    if (instance?.isSpotInstance) {
      alert('Cannot start Spot instances. Spot instances are terminated when stopped and cannot be restarted. You need to launch a new instance.');
      return;
    }

    try {
      setActionLoading(instanceId);
      await startInstance(instanceId);
      await loadInstances();
    } catch (error) {
      console.error('Failed to start instance:', error);
      if (error.message?.includes('Spot')) {
        alert('Cannot start Spot instances. Spot instances are terminated when stopped and cannot be restarted.');
      } else {
        alert('Failed to start instance. Please check the console for details.');
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async (instanceId: string) => {
    const instance = instances.find(i => i.id === instanceId);
    
    if (instance?.isSpotInstance) {
      if (!confirm('Spot instances cannot be stopped - they can only be terminated. This will permanently destroy the instance. Are you sure you want to continue?')) {
        return;
      }
      // For spot instances, terminate instead of stop
      await handleTerminate(instanceId);
      return;
    }

    try {
      setActionLoading(instanceId);
      await stopInstance(instanceId);
      await loadInstances();
    } catch (error) {
      console.error('Failed to stop instance:', error);
      if (error.message?.includes('Spot')) {
        alert('Cannot stop Spot instances. Spot instances can only be terminated.');
      } else {
        alert('Failed to stop instance. Please check the console for details.');
      }
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
      alert('Failed to terminate instance. Please check the console for details.');
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

  const getInstanceActions = (instance: EC2Instance) => {
    const actions = [];

    // Start button - only for stopped regular instances
    if (instance.state === 'stopped' && !instance.isSpotInstance) {
      actions.push(
        <Button
          key="start"
          size="sm"
          variant="success"
          onClick={() => handleStart(instance.id)}
          disabled={actionLoading === instance.id}
          title="Start instance"
        >
          {actionLoading === instance.id ? (
            <LoadingSpinner size="sm" />
          ) : (
            <Play className="w-4 h-4" />
          )}
        </Button>
      );
    }

    // Stop button - only for running regular instances
    if (instance.state === 'running' && !instance.isSpotInstance) {
      actions.push(
        <Button
          key="stop"
          size="sm"
          variant="warning"
          onClick={() => handleStop(instance.id)}
          disabled={actionLoading === instance.id}
          title="Stop instance"
        >
          {actionLoading === instance.id ? (
            <LoadingSpinner size="sm" />
          ) : (
            <Square className="w-4 h-4" />
          )}
        </Button>
      );
    }

    // Terminate button - always available for non-terminated instances
    if (instance.state !== 'terminated') {
      const isSpotRunning = instance.isSpotInstance && instance.state === 'running';
      actions.push(
        <Button
          key="terminate"
          size="sm"
          variant="danger"
          onClick={() => handleTerminate(instance.id)}
          disabled={actionLoading === instance.id}
          title={isSpotRunning ? "Terminate Spot instance (cannot be stopped)" : "Terminate instance"}
        >
          {actionLoading === instance.id ? (
            <LoadingSpinner size="sm" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
        </Button>
      );
    }

    return actions;
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
                    {getInstanceActions(instance)}
                  </div>
                </div>
              </div>

              {instance.isSpotInstance && instance.state === 'running' && (
                <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <div className="flex items-start space-x-2">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-yellow-900">Spot Instance Notice</h4>
                      <p className="text-sm text-yellow-800 mt-1">
                        This is a Spot instance. It cannot be stopped - only terminated. 
                        AWS may terminate it at any time if capacity is needed or the Spot price exceeds your bid.
                      </p>
                    </div>
                  </div>
                </div>
              )}

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