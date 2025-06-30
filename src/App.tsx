import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';
import Layout from './components/Layout';
import InstancesList from './components/instances/InstancesList';

const queryClient = new QueryClient();

function App() {
  const [activeTab, setActiveTab] = useState('instances');

  const renderContent = () => {
    switch (activeTab) {
      case 'instances':
        return <InstancesList />;
      case 'security-groups':
        return <div>Security Groups (Coming Soon)</div>;
      case 'keypairs':
        return <div>Key Pairs (Coming Soon)</div>;
      case 'volumes':
        return <div>Volumes (Coming Soon)</div>;
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