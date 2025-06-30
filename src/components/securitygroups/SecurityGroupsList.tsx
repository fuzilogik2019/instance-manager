import React, { useState, useEffect } from 'react';
import { Shield, Plus, RefreshCw, Edit, Trash2, Globe, Server, Gamepad2 } from 'lucide-react';
import { SecurityGroup, AWSRegion } from '../../types/aws';
import { getSecurityGroups, deleteSecurityGroup, getRegions } from '../../services/api';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import Card from '../ui/Card';
import Select from '../ui/Select';
import LoadingSpinner from '../ui/LoadingSpinner';
import SecurityGroupCreationForm from './SecurityGroupCreationForm';
import SecurityGroupEditForm from './SecurityGroupEditForm';

export default function SecurityGroupsList() {
  const [securityGroups, setSecurityGroups] = useState<SecurityGroup[]>([]);
  const [regions, setRegions] = useState<AWSRegion[]>([]);
  const [selectedRegion, setSelectedRegion] = useState('us-east-1');
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [selectedSecurityGroup, setSelectedSecurityGroup] = useState<SecurityGroup | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    loadRegions();
  }, []);

  useEffect(() => {
    if (selectedRegion) {
      loadSecurityGroups();
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

  const loadSecurityGroups = async () => {
    try {
      setLoading(true);
      const data = await getSecurityGroups(selectedRegion);
      setSecurityGroups(data);
    } catch (error) {
      console.error('Failed to load security groups:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (securityGroup: SecurityGroup) => {
    setSelectedSecurityGroup(securityGroup);
    setShowEditForm(true);
  };

  const handleDelete = async (securityGroupId: string) => {
    const securityGroup = securityGroups.find(sg => sg.id === securityGroupId);
    
    if (securityGroup?.name === 'default') {
      alert('Cannot delete the default security group.');
      return;
    }

    if (!confirm('Are you sure you want to delete this security group? This action cannot be undone.')) {
      return;
    }

    try {
      setActionLoading(securityGroupId);
      await deleteSecurityGroup(securityGroupId);
      await loadSecurityGroups();
    } catch (error) {
      console.error('Failed to delete security group:', error);
      alert('Failed to delete security group. It may be in use by instances.');
    } finally {
      setActionLoading(null);
    }
  };

  const getProtocolIcon = (protocol: string) => {
    switch (protocol.toLowerCase()) {
      case 'tcp':
        return <Server className="w-4 h-4 text-blue-600" />;
      case 'udp':
        return <Gamepad2 className="w-4 h-4 text-green-600" />;
      case 'icmp':
        return <Globe className="w-4 h-4 text-orange-600" />;
      default:
        return <Shield className="w-4 h-4 text-gray-600" />;
    }
  };

  const getPortDescription = (fromPort: number, toPort: number, protocol: string) => {
    if (fromPort === toPort) {
      return `Port ${fromPort}`;
    }
    if (fromPort === 0 && toPort === 65535) {
      return 'All Ports';
    }
    return `Ports ${fromPort}-${toPort}`;
  };

  const getCommonPortName = (port: number, protocol: string) => {
    const commonPorts: Record<string, string> = {
      '22-tcp': 'SSH',
      '80-tcp': 'HTTP',
      '443-tcp': 'HTTPS',
      '3389-tcp': 'RDP',
      '21-tcp': 'FTP',
      '25-tcp': 'SMTP',
      '53-tcp': 'DNS',
      '53-udp': 'DNS',
      '3306-tcp': 'MySQL',
      '5432-tcp': 'PostgreSQL',
      '6379-tcp': 'Redis',
      '27017-tcp': 'MongoDB',
      '25565-tcp': 'Minecraft',
      '7777-udp': 'Game Server',
      '27015-udp': 'Steam/Source',
      '19132-udp': 'Minecraft Bedrock',
    };

    return commonPorts[`${port}-${protocol.toLowerCase()}`] || '';
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
          <h2 className="text-2xl font-bold text-gray-900">Security Groups</h2>
          <p className="text-gray-600 mt-1">Manage firewall rules and port access for your instances</p>
        </div>
        <div className="flex items-center space-x-3">
          <Select
            value={selectedRegion}
            onChange={(e) => setSelectedRegion(e.target.value)}
            options={regions.map(region => ({ value: region.code, label: region.name }))}
            className="w-48"
          />
          <Button variant="secondary" onClick={loadSecurityGroups}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={() => setShowCreateForm(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Security Group
          </Button>
        </div>
      </div>

      {securityGroups.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <Shield className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No security groups found</h3>
            <p className="text-gray-600 mb-4">Create your first security group to control network access to your instances</p>
            <Button onClick={() => setShowCreateForm(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Security Group
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-6">
          {securityGroups.map((securityGroup) => (
            <Card key={securityGroup.id}>
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-4">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <Shield className="w-5 h-5 text-blue-600" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center space-x-3">
                      <h3 className="text-lg font-semibold text-gray-900">{securityGroup.name}</h3>
                      {securityGroup.name === 'default' && (
                        <Badge variant="secondary" size="sm">Default</Badge>
                      )}
                    </div>
                    <p className="text-gray-600 mt-1">{securityGroup.description}</p>
                    <div className="flex items-center space-x-4 text-sm text-gray-500 mt-2">
                      <span>ID: {securityGroup.id}</span>
                      <span>{securityGroup.rules.length} rule{securityGroup.rules.length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleEdit(securityGroup)}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  {securityGroup.name !== 'default' && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleDelete(securityGroup.id)}
                      disabled={actionLoading === securityGroup.id}
                    >
                      {actionLoading === securityGroup.id ? (
                        <LoadingSpinner size="sm" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  )}
                </div>
              </div>

              {securityGroup.rules.length > 0 && (
                <div className="mt-6">
                  <h4 className="text-sm font-medium text-gray-900 mb-3">Inbound Rules (Open Ports)</h4>
                  <div className="space-y-2">
                    {securityGroup.rules.map((rule, index) => {
                      const commonName = getCommonPortName(rule.fromPort, rule.protocol);
                      return (
                        <div key={rule.id || index} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                          <div className="flex items-center space-x-3">
                            {getProtocolIcon(rule.protocol)}
                            <div>
                              <div className="flex items-center space-x-2">
                                <span className="font-medium text-gray-900">
                                  {getPortDescription(rule.fromPort, rule.toPort, rule.protocol)}
                                </span>
                                {commonName && (
                                  <Badge variant="primary" size="sm">{commonName}</Badge>
                                )}
                              </div>
                              <div className="text-sm text-gray-600">
                                {rule.protocol.toUpperCase()} • Source: {rule.source}
                                {rule.description && ` • ${rule.description}`}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium text-gray-900">
                              {rule.source === '0.0.0.0/0' ? 'Anywhere' : 'Custom'}
                            </div>
                            <div className="text-xs text-gray-500">
                              {rule.source === '0.0.0.0/0' ? 'Public Access' : 'Restricted'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {securityGroup.rules.length === 0 && (
                <div className="mt-6 text-center py-6 bg-yellow-50 rounded-lg">
                  <Shield className="w-8 h-8 text-yellow-600 mx-auto mb-2" />
                  <p className="text-yellow-800 font-medium">No inbound rules configured</p>
                  <p className="text-yellow-700 text-sm mt-1">
                    This security group blocks all incoming traffic. Add rules to allow access.
                  </p>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {showCreateForm && (
        <SecurityGroupCreationForm
          region={selectedRegion}
          onSecurityGroupCreated={loadSecurityGroups}
          onClose={() => setShowCreateForm(false)}
        />
      )}

      {showEditForm && selectedSecurityGroup && (
        <SecurityGroupEditForm
          securityGroup={selectedSecurityGroup}
          onSecurityGroupUpdated={loadSecurityGroups}
          onClose={() => {
            setShowEditForm(false);
            setSelectedSecurityGroup(null);
          }}
        />
      )}
    </div>
  );
}