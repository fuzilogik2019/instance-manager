import React, { useState, useEffect } from 'react';
import { Server, Play, Square, Trash2, RefreshCw, Plus, ExternalLink, AlertTriangle, Terminal, Monitor, Smartphone, Clock, CheckCircle, XCircle, Container, Activity, Loader, Shield } from 'lucide-react';
import { EC2Instance } from '../../types/aws';
import { getInstances, startInstance, stopInstance, terminateInstance } from '../../services/api';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import Card from '../ui/Card';
import LoadingSpinner from '../ui/LoadingSpinner';
import InstanceCreationForm from './InstanceCreationForm';
import DockerServicesModal from './DockerServicesModal';

export default function InstancesList() {
  const [instances, setInstances] = useState<EC2Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showDockerServices, setShowDockerServices] = useState<string | null>(null);
  const [dockerStatuses, setDockerStatuses] = useState<Record<string, any>>({});

  useEffect(() => {
    loadInstances();
  }, []);

  // Check Docker status for instances that have Docker tags - IMPROVED
  useEffect(() => {
    const checkDockerStatuses = async () => {
      const dockerInstances = instances.filter(instance => hasDockerInstalled(instance));
      
      for (const instance of dockerInstances) {
        try {
          const response = await fetch(`http://localhost:3001/api/instances/${instance.id}/docker/status`);
          if (response.ok) {
            const status = await response.json();
            setDockerStatuses(prev => ({
              ...prev,
              [instance.id]: status
            }));
            console.log(`🐳 Docker status for ${instance.id}:`, status);
          }
        } catch (error) {
          console.warn(`Failed to check Docker status for ${instance.id}:`, error);
        }
      }
    };

    if (instances.length > 0) {
      checkDockerStatuses();
      // Check Docker status every 30 seconds for running instances
      const interval = setInterval(checkDockerStatuses, 30000);
      return () => clearInterval(interval);
    }
  }, [instances]);

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

  const handleOpenTerminal = (instance: EC2Instance) => {
    if (!instance.publicIp && !instance.privateIp) {
      alert('Instance has no IP address. Cannot establish SSH connection.');
      return;
    }

    if (instance.state !== 'running') {
      alert('Instance must be running to establish SSH connection.');
      return;
    }

    if (!instance.keyPairName || instance.keyPairName === 'N/A') {
      alert('Instance has no SSH key pair configured. Cannot establish SSH connection.');
      return;
    }

    if (instance.ami?.platform === 'windows') {
      alert('Windows instances use RDP (Remote Desktop Protocol) for remote access, not SSH. Please use an RDP client to connect.');
      return;
    }

    if (instance.statusChecks && !instance.statusChecks.isSSHReady) {
      alert('Instance is still initializing. Please wait for status checks to complete before attempting SSH connection.');
      return;
    }

    // Use the global terminal manager
    if ((window as any).openSSHTerminal) {
      (window as any).openSSHTerminal(
        instance.id,
        instance.name,
        instance.keyPairName,
        instance.publicIp || instance.privateIp
      );
    }
  };

  const handleViewDockerServices = (instanceId: string) => {
    setShowDockerServices(instanceId);
  };

  const getStateColor = (state: string) => {
    switch (state) {
      case 'running': return 'success';
      case 'stopped': return 'secondary';
      case 'pending': return 'warning';
      case 'stopping': return 'warning';
      case 'terminated': return 'danger';
      case 'initializing': return 'warning';
      default: return 'secondary';
    }
  };

  const getStateIcon = (state: string) => {
    switch (state) {
      case 'running': return <CheckCircle className="w-4 h-4" />;
      case 'initializing': return <Clock className="w-4 h-4" />;
      case 'pending': return <Clock className="w-4 h-4" />;
      case 'stopped': return <Square className="w-4 h-4" />;
      case 'terminated': return <XCircle className="w-4 h-4" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  const getOSIcon = (ami?: EC2Instance['ami']) => {
    if (!ami) return <Server className="w-5 h-5 text-gray-600" />;
    
    switch (ami.platform) {
      case 'windows':
        return <Monitor className="w-5 h-5 text-blue-600" />;
      case 'macos':
        return <Smartphone className="w-5 h-5 text-gray-600" />;
      default:
        return <Server className="w-5 h-5 text-green-600" />;
    }
  };

  const getOSBadgeColor = (osType?: string) => {
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

  const canUseSSHTerminal = (instance: EC2Instance) => {
    return instance.state === 'running' && 
           instance.keyPairName && 
           instance.keyPairName !== 'N/A' && 
           (instance.publicIp || instance.privateIp) &&
           instance.ami?.platform !== 'windows' &&
           (!instance.statusChecks || instance.statusChecks.isSSHReady);
  };

  const hasDockerInstalled = (instance: EC2Instance) => {
    // Check if instance was created with Docker installation
    return instance.tags?.DockerInstalled === 'true' || 
           instance.tags?.docker === 'true' ||
           instance.tags?.DockerInstallRequested === 'true';
  };

  const getDockerStatus = (instance: EC2Instance) => {
    const status = dockerStatuses[instance.id];
    if (!status) return null;

    return {
      status: status.dockerStatus,
      version: status.dockerVersion,
      installationStatus: status.installationStatus,
      dockerImage: status.dockerImage,
      minutesSinceLaunch: status.minutesSinceLaunch
    };
  };

  const getDockerBadge = (instance: EC2Instance) => {
    if (!hasDockerInstalled(instance)) return null;

    const dockerStatus = getDockerStatus(instance);
    
    if (!dockerStatus) {
      return (
        <Badge variant="secondary" size="sm">
          <Container className="w-3 h-3 mr-1" />
          Docker
        </Badge>
      );
    }

    switch (dockerStatus.status) {
      case 'running':
        return (
          <Badge variant="success" size="sm">
            <Container className="w-3 h-3 mr-1" />
            Docker Ready
          </Badge>
        );
      case 'installing':
        return (
          <Badge variant="warning" size="sm">
            <Loader className="w-3 h-3 mr-1 animate-spin" />
            Installing Docker
          </Badge>
        );
      case 'installation_failed':
        return (
          <Badge variant="danger" size="sm">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Docker Failed
          </Badge>
        );
      case 'not_installed':
        return (
          <Badge variant="secondary" size="sm">
            <Container className="w-3 h-3 mr-1" />
            Docker Requested
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" size="sm">
            <Container className="w-3 h-3 mr-1" />
            Docker
          </Badge>
        );
    }
  };

  const getStatusChecksBadge = (instance: EC2Instance) => {
    if (!instance.statusChecks) return null;

    const { instanceStatus, systemStatus, isSSHReady } = instance.statusChecks;

    if (isSSHReady) {
      return (
        <Badge variant="success" size="sm">
          <CheckCircle className="w-3 h-3 mr-1" />
          Ready
        </Badge>
      );
    }

    if (instanceStatus === 'initializing' || systemStatus === 'initializing') {
      return (
        <Badge variant="warning" size="sm">
          <Clock className="w-3 h-3 mr-1" />
          Initializing
        </Badge>
      );
    }

    return (
      <Badge variant="secondary" size="sm">
        <AlertTriangle className="w-3 h-3 mr-1" />
        Checking
      </Badge>
    );
  };

  const getInstanceActions = (instance: EC2Instance) => {
    const actions = [];
    const dockerStatus = getDockerStatus(instance);

    // Docker Services button - IMPROVED LOGIC
    if (instance.state === 'running' && hasDockerInstalled(instance)) {
      // Show Docker button if:
      // 1. Docker status is 'running' (confirmed working)
      // 2. OR if more than 5 minutes have passed since launch (likely installed)
      const shouldShowDockerButton = dockerStatus?.status === 'running' || 
        (dockerStatus?.minutesSinceLaunch && dockerStatus.minutesSinceLaunch >= 5);
      
      if (shouldShowDockerButton) {
        actions.push(
          <Button
            key="docker"
            size="sm"
            variant="primary"
            onClick={() => handleViewDockerServices(instance.id)}
            title="View Docker Services"
            className="bg-blue-600 hover:bg-blue-700 focus:ring-blue-500"
          >
            <Container className="w-4 h-4" />
          </Button>
        );
      }
    }

    // SSH Terminal button - only for running Linux instances with SSH key and ready status
    if (canUseSSHTerminal(instance)) {
      actions.push(
        <Button
          key="ssh"
          size="sm"
          variant="primary"
          onClick={() => handleOpenTerminal(instance)}
          title="Open SSH Terminal"
          className="bg-green-600 hover:bg-green-700 focus:ring-green-500"
        >
          <Terminal className="w-4 h-4" />
        </Button>
      );
    }

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
          {instances.map((instance) => {
            const dockerStatus = getDockerStatus(instance);
            
            return (
              <Card key={instance.id}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="flex-shrink-0">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        {getOSIcon(instance.ami)}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{instance.name}</h3>
                      <div className="flex items-center space-x-4 text-sm text-gray-600 mt-1">
                        <span>{instance.instanceType}</span>
                        <span>{instance.region}</span>
                        <span>{instance.availabilityZone}</span>
                        {instance.ami && (
                          <Badge variant="secondary" size="sm" className={getOSBadgeColor(instance.ami.osType)}>
                            {instance.ami.osType.replace('-', ' ').toUpperCase()} {instance.ami.osVersion}
                          </Badge>
                        )}
                        {instance.isSpotInstance && (
                          <Badge variant="warning" size="sm">Spot</Badge>
                        )}
                        {getDockerBadge(instance)}
                        {getStatusChecksBadge(instance)}
                        {canUseSSHTerminal(instance) && (
                          <Badge variant="success" size="sm">
                            <Terminal className="w-3 h-3 mr-1" />
                            SSH Ready
                          </Badge>
                        )}
                        {instance.ami?.platform === 'windows' && instance.state === 'running' && (
                          <Badge variant="primary" size="sm">
                            <Monitor className="w-3 h-3 mr-1" />
                            RDP Ready
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center space-x-2">
                      {getStateIcon(instance.state)}
                      <Badge variant={getStateColor(instance.state)}>
                        {instance.state === 'initializing' ? 'Initializing' : instance.state}
                      </Badge>
                    </div>
                    <div className="flex items-center space-x-2">
                      {getInstanceActions(instance)}
                    </div>
                  </div>
                </div>

                {/* Docker Services Info - IMPROVED */}
                {hasDockerInstalled(instance) && (
                  <div className="mt-4">
                    {dockerStatus?.status === 'running' && instance.state === 'running' && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <Container className="w-5 h-5 text-blue-600" />
                            <div>
                              <h4 className="font-medium text-blue-900">🐳 Docker Services Ready</h4>
                              <p className="text-sm text-blue-800">
                                Docker {dockerStatus.version} is running. 
                                {dockerStatus.dockerImage && ` Image: ${dockerStatus.dockerImage}`}
                              </p>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => handleViewDockerServices(instance.id)}
                            className="bg-blue-600 hover:bg-blue-700"
                          >
                            <Activity className="w-4 h-4 mr-1" />
                            View Services
                          </Button>
                        </div>
                      </div>
                    )}

                    {dockerStatus?.status === 'installing' && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                        <div className="flex items-center space-x-2">
                          <Loader className="w-5 h-5 text-yellow-600 animate-spin" />
                          <div>
                            <h4 className="font-medium text-yellow-900">🔄 Installing Docker</h4>
                            <p className="text-sm text-yellow-800">
                              Docker installation is in progress. This may take a few minutes.
                              {dockerStatus.dockerImage && ` Will deploy: ${dockerStatus.dockerImage}`}
                              {dockerStatus.minutesSinceLaunch && ` (${dockerStatus.minutesSinceLaunch} min elapsed)`}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {dockerStatus?.status === 'installation_failed' && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                        <div className="flex items-center space-x-2">
                          <AlertTriangle className="w-5 h-5 text-red-600" />
                          <div>
                            <h4 className="font-medium text-red-900">❌ Docker Installation Failed</h4>
                            <p className="text-sm text-red-800">
                              Docker installation encountered an error. Check the SSH terminal for details.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Show Docker button for instances that should have Docker ready */}
                    {instance.state === 'running' && hasDockerInstalled(instance) && 
                     dockerStatus?.minutesSinceLaunch && dockerStatus.minutesSinceLaunch >= 5 && 
                     dockerStatus.status !== 'running' && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <Container className="w-5 h-5 text-green-600" />
                            <div>
                              <h4 className="font-medium text-green-900">🐳 Docker Should Be Ready</h4>
                              <p className="text-sm text-green-800">
                                Docker installation time has elapsed. Services should be available.
                                {dockerStatus.dockerImage && ` Expected image: ${dockerStatus.dockerImage}`}
                              </p>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => handleViewDockerServices(instance.id)}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <Activity className="w-4 h-4 mr-1" />
                            Check Services
                          </Button>
                        </div>
                      </div>
                    )}

                    {dockerStatus?.status === 'not_installed' && dockerStatus?.installationStatus === 'not_requested' && (
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <div className="flex items-center space-x-2">
                          <Container className="w-5 h-5 text-gray-600" />
                          <div>
                            <h4 className="font-medium text-gray-900">📦 Docker Tagged</h4>
                            <p className="text-sm text-gray-800">
                              This instance is tagged for Docker but installation status is unknown.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

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

                {/* Status Checks Information */}
                {instance.state === 'running' && instance.statusChecks && !instance.statusChecks.isSSHReady && (
                  <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="flex items-start space-x-2">
                      <Clock className="w-5 h-5 text-blue-600 mt-0.5" />
                      <div>
                        <h4 className="font-medium text-blue-900">Instance Initializing</h4>
                        <p className="text-sm text-blue-800 mt-1">
                          The instance is running but still completing initialization. 
                          Status checks: Instance ({instance.statusChecks.instanceStatus}), System ({instance.statusChecks.systemStatus}).
                          SSH access will be available once all checks pass.
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

                {/* Security Groups Information */}
                {instance.securityGroups.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-sm font-medium text-gray-900 mb-2 flex items-center">
                      <Shield className="w-4 h-4 mr-1" />
                      Security Groups
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {instance.securityGroups.map((sgId, index) => (
                        <div key={sgId} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1">
                          <div className="text-sm">
                            <span className="font-medium text-gray-900">
                              {instance.securityGroupNames?.[index] || 'Unknown'}
                            </span>
                            <span className="text-gray-500 ml-2 font-mono text-xs">({sgId})</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* AMI Information */}
                {instance.ami && (
                  <div className="mt-4">
                    <h4 className="text-sm font-medium text-gray-900 mb-2">Operating System Details</h4>
                    <div className="bg-gray-50 p-3 rounded-lg">
                      <div className="flex items-center space-x-3">
                        {getOSIcon(instance.ami)}
                        <div>
                          <div className="font-medium text-gray-900">{instance.ami.name}</div>
                          <div className="text-sm text-gray-600">
                            {instance.ami.description} • Default user: <code className="bg-gray-200 px-1 rounded">{instance.ami.defaultUsername}</code>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {instance.volumes.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-sm font-medium text-gray-900 mb-2">Attached Volumes</h4>
                    <div className="space-y-2">
                      {instance.volumes.map((volume, index) => (
                        <div key={volume.id} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                          <span className="text-sm text-gray-700">
                            {volume.type.toUpperCase()} - {volume.size} GB
                            {volume.encrypted && <Badge variant="success" size="sm" className="ml-2">Encrypted</Badge>}
                            {index === 0 && <Badge variant="secondary" size="sm" className="ml-2">Root</Badge>}
                          </span>
                          <span className="text-xs text-gray-500 font-mono">{volume.id}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {showCreateForm && (
        <InstanceCreationForm
          onInstanceCreated={loadInstances}
          onClose={() => setShowCreateForm(false)}
        />
      )}

      {showDockerServices && (
        <DockerServicesModal
          instanceId={showDockerServices}
          instanceName={instances.find(i => i.id === showDockerServices)?.name || 'Unknown'}
          onClose={() => setShowDockerServices(null)}
        />
      )}
    </div>
  );
}