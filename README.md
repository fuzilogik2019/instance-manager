# AWS EC2 Management Application

A modern web application for managing AWS EC2 instances with a beautiful React frontend and Node.js backend.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ installed
- AWS Account with programmatic access
- AWS CLI configured (optional but recommended)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure AWS Credentials

#### Option A: Environment Variables (Recommended)
1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit `.env` and add your AWS credentials:
```env
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_REGION=us-east-1
```

#### Option B: AWS CLI Profile
If you have AWS CLI configured, the application will automatically use your default profile.

### 3. Create AWS IAM User (If you don't have one)

1. Go to [AWS IAM Console](https://console.aws.amazon.com/iam/)
2. Click "Users" → "Add User"
3. Choose "Programmatic access"
4. Attach the following policies:
   - `AmazonEC2FullAccess`
   - `AmazonVPCFullAccess` (optional, for advanced networking)
5. Save the Access Key ID and Secret Access Key

### 4. Start the Application
```bash
npm run dev
```

The application will start on:
- Frontend: http://localhost:5173
- Backend: http://localhost:3001

## 🔧 AWS Permissions Required

Your IAM user needs the following permissions:

### Minimum Required Permissions:
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ec2:RunInstances",
                "ec2:TerminateInstances",
                "ec2:StartInstances",
                "ec2:StopInstances",
                "ec2:DescribeInstances",
                "ec2:DescribeInstanceTypes",
                "ec2:DescribeRegions",
                "ec2:DescribeAvailabilityZones",
                "ec2:DescribeSecurityGroups",
                "ec2:DescribeKeyPairs",
                "ec2:DescribeVolumes",
                "ec2:CreateTags",
                "ec2:DescribeTags"
            ],
            "Resource": "*"
        }
    ]
}
```

### For Full Functionality (Recommended):
- `AmazonEC2FullAccess` - Complete EC2 management
- `AmazonVPCReadOnlyAccess` - View VPC information

## 🛡️ Security Best Practices

1. **Use IAM Roles in Production**: For production deployments, use IAM roles instead of access keys
2. **Least Privilege**: Only grant the minimum permissions needed
3. **Rotate Keys**: Regularly rotate your access keys
4. **Environment Variables**: Never commit credentials to version control
5. **VPC Configuration**: Use private subnets for production instances

## 🌍 Supported AWS Regions

The application supports all AWS regions. Popular regions include:
- `us-east-1` - US East (N. Virginia)
- `us-west-2` - US West (Oregon)
- `eu-west-1` - Europe (Ireland)
- `ap-southeast-1` - Asia Pacific (Singapore)

## 📊 Features

### ✅ Currently Available:
- Launch EC2 instances with custom configuration
- Start/Stop/Terminate instances
- View instance details and status
- Support for Spot instances
- EBS volume configuration
- Security group selection
- SSH key pair management
- Multi-region support

### 🚧 Coming Soon:
- Security group management
- Key pair creation/upload
- Volume management
- Cost estimation
- Instance monitoring
- Auto-scaling groups

## 🐛 Troubleshooting

### "AWS credentials not found" Error
1. Verify your `.env` file exists and has correct credentials
2. Check that credentials have proper permissions
3. Test credentials with AWS CLI: `aws sts get-caller-identity`

### "Instance launch failed" Error
1. Check if you have sufficient EC2 limits in your AWS account
2. Verify the selected region supports the instance type
3. Ensure security groups and key pairs exist in the selected region

### "Permission denied" Errors
1. Review IAM permissions for your user/role
2. Check if you have EC2 service limits
3. Verify you're not trying to launch in a restricted region

## 💰 Cost Considerations

- **Instance Costs**: You'll be charged for running EC2 instances
- **Storage Costs**: EBS volumes incur storage charges
- **Data Transfer**: Outbound data transfer may incur charges
- **Spot Instances**: Use spot instances for up to 90% savings

## 🔄 Development Mode

The application automatically detects if AWS credentials are configured:
- **With Credentials**: Real AWS operations
- **Without Credentials**: Mock mode for development

## 📝 Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `AWS_ACCESS_KEY_ID` | AWS Access Key | Yes* | - |
| `AWS_SECRET_ACCESS_KEY` | AWS Secret Key | Yes* | - |
| `AWS_REGION` | Default AWS Region | No | `us-east-1` |
| `PORT` | Server Port | No | `3001` |
| `NODE_ENV` | Environment | No | `development` |

*Required for real AWS operations. Optional for mock mode.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.