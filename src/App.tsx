import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';
import Layout from './components/Layout';
import InstancesList from './components/instances/InstancesList';
import SecurityGroupsList from './components/securitygroups/SecurityGroupsList';
import KeyPairsList from './components/keypairs/KeyPairsList';
import VolumesList from './components/volumes/VolumesList';

const queryClient = new QueryClient();

function App() {
  const [activeTab, setActiveTab] = useState('instances');

  const renderContent = () => {
    switch (activeTab) {
      case 'instances':
        return <InstancesList />;
      case 'security-groups':
        return <SecurityGroupsList />;
      case 'keypairs':
        return <KeyPairsList />;
      case 'volumes':
        return <VolumesList />;
      default:
        return <InstancesList />;
    }
  };

  return (
    <QueryClientProvider client={queryClient}>
      <Layout activeTab={activeTab} onTabChange={setActiveTab}>
        {renderContent()}
      </Layout>
    </QueryClientProvider>
  );
}

export default App;