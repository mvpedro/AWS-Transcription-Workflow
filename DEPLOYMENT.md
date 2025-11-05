# Deployment Guide

## Prerequisites

1. **AWS CLI** configured with appropriate credentials
2. **Terraform** >= 1.0 installed
3. **Node.js** >= 18.x and npm installed
4. **AWS Account** with permissions to create:
   - S3 buckets
   - Lambda functions
   - IAM roles and policies
   - DynamoDB tables
   - CloudWatch Events
   - Transcribe jobs

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Build Lambda Functions

```bash
npm run build
```

This will:
- Install npm dependencies
- Create a `functions.zip` file with all Lambda function code

## Step 3: Configure Terraform (Optional)

If you want to customize the deployment, edit `terraform/variables.tf` or create a `terraform/terraform.tfvars` file:

```hcl
aws_region = "us-east-1"
environment = "dev"
max_file_size_mb = 100
```

## Step 4: Initialize Terraform

```bash
cd terraform
terraform init
```

## Step 5: Review Terraform Plan

```bash
terraform plan
```

Review the changes that will be made to your AWS account.

## Step 6: Deploy Infrastructure

```bash
terraform apply
```

Type `yes` when prompted to confirm.

## Step 7: Note Important Outputs

After deployment, Terraform will output:
- Input bucket name (for uploading videos)
- Output bucket name (where subtitles are stored)
- Lambda function ARNs

## Step 8: Configure FFmpeg Layer (Required for splitVideo)

The `splitVideo` Lambda function requires FFmpeg. You have two options:

### Option A: Use a Pre-built Layer

1. Find a public FFmpeg Lambda Layer (e.g., from AWS Lambda Layers or GitHub)
2. Uncomment and update the `layers` attribute in `terraform/lambda.tf`:

```hcl
resource "aws_lambda_function" "split_video" {
  # ... other config ...
  layers = ["arn:aws:lambda:us-east-1:770693421928:layer:Klayers-p310-ffmpeg:1"]
}
```

3. Run `terraform apply` again

### Option B: Build Your Own Layer

See `scripts/ffmpegLayer/README.md` for instructions.

## Step 9: Test the Workflow

1. Upload a video file (`.mp4`) to the input bucket:

```bash
aws s3 cp test-video.mp4 s3://<input-bucket-name>/test-video.mp4
```

2. Monitor CloudWatch Logs for the Lambda functions
3. Check the output bucket for generated subtitle files

## Troubleshooting

### Lambda Function Errors

- Check CloudWatch Logs for each Lambda function
- Verify IAM permissions are correctly attached
- Ensure environment variables are set correctly

### Video Splitting Not Working

- Verify FFmpeg Lambda Layer is attached
- Check Lambda function has sufficient memory (2048 MB recommended)
- Verify timeout is set appropriately (900 seconds = 15 minutes)

### Transcription Jobs Not Starting

- Verify Transcribe service permissions
- Check that the video file is in a supported format
- Ensure S3 bucket policies allow Transcribe to access files

## Cleanup

To remove all resources:

```bash
cd terraform
terraform destroy
```

## Cost Considerations

- Lambda: Pay per invocation and execution time
- S3: Storage and request costs
- Transcribe: Per-minute of audio transcribed
- DynamoDB: Pay-per-request pricing
- CloudWatch: Log storage and ingestion costs

Monitor your AWS costs regularly, especially during testing.

