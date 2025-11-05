# AWS CLI Setup Guide

## Current Status
- ✅ AWS CLI is installed (version 2.31.29)
- ⚠️ Credentials need to be configured or updated

## Step 1: Get Your AWS Credentials

You'll need:
1. **AWS Access Key ID** - A 20-character identifier
2. **AWS Secret Access Key** - A 40-character secret key
3. **Default region** - e.g., `us-east-1`, `us-west-2`, `eu-west-1`
4. **Default output format** - `json` (recommended)

### How to Get Credentials:

1. **Log in to AWS Console**: https://console.aws.amazon.com/
2. **Go to IAM**: Click on your username → "Security credentials"
3. **Create Access Key**: 
   - Scroll to "Access keys"
   - Click "Create access key"
   - Choose "CLI" as the use case
   - Download or copy both the Access Key ID and Secret Access Key
   - ⚠️ **IMPORTANT**: Save the Secret Access Key immediately - you won't be able to see it again!

## Step 2: Configure AWS CLI

Run the following command and provide the information when prompted:

```bash
aws configure
```

You'll be asked for:
1. **AWS Access Key ID**: Paste your Access Key ID
2. **AWS Secret Access Key**: Paste your Secret Access Key
3. **Default region name**: Enter your preferred region (e.g., `us-east-1`)
4. **Default output format**: Enter `json`

## Step 3: Verify Configuration

Test your configuration:

```bash
# Check your identity
aws sts get-caller-identity

# List S3 buckets (to verify permissions)
aws s3 ls
```

## Step 4: Set Region for This Project (Optional)

If you want to use a different region for this project, you can set it:

```bash
# Set region in environment variable
export AWS_DEFAULT_REGION=us-east-1

# Or update your config
aws configure set region us-east-1
```

## Alternative: Using AWS Profiles

If you have multiple AWS accounts, you can use profiles:

```bash
# Configure a named profile
aws configure --profile my-profile

# Use the profile
export AWS_PROFILE=my-profile

# Or use it in commands
aws s3 ls --profile my-profile
```

## Troubleshooting

### Error: "SignatureDoesNotMatch"
- Your credentials are invalid or expired
- Re-run `aws configure` with correct credentials

### Error: "AccessDenied"
- Your credentials don't have sufficient permissions
- Ensure your IAM user has the necessary permissions for:
  - S3 (CreateBucket, PutObject, GetObject)
  - Lambda (CreateFunction, InvokeFunction)
  - IAM (CreateRole, AttachRolePolicy)
  - DynamoDB (CreateTable, PutItem, GetItem)
  - Transcribe (StartTranscriptionJob, GetTranscriptionJob)
  - CloudWatch Events

### Error: "Could not locate credentials"
- Run `aws configure` to set up credentials
- Check that `~/.aws/credentials` file exists

## Security Best Practices

1. **Never commit credentials** to Git
2. **Use IAM roles** when possible (for EC2 instances, Lambda, etc.)
3. **Rotate access keys** regularly
4. **Use least privilege** - only grant necessary permissions
5. **Enable MFA** for your AWS account
6. **Use temporary credentials** when possible (AWS SSO, AssumeRole)

## Next Steps

Once AWS CLI is configured, you can proceed with:
1. `npm install` - Install project dependencies
2. `npm run build` - Build Lambda functions
3. `cd terraform && terraform init` - Initialize Terraform
4. `terraform plan` - Review changes
5. `terraform apply` - Deploy infrastructure

