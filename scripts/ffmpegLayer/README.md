# FFmpeg Lambda Layer

This directory is for creating a Lambda Layer with FFmpeg for video processing.

## Note

The `splitVideo` Lambda function requires FFmpeg to split videos. You have two options:

1. **Use a pre-built FFmpeg Lambda Layer**:
   - Search for public FFmpeg Lambda Layers on AWS Lambda Layers or GitHub
   - Example: `arn:aws:lambda:us-east-1:770693421928:layer:Klayers-p310-ffmpeg:1`
   - Update `terraform/lambda.tf` to include the layer ARN

2. **Build your own FFmpeg Layer**:
   - Download FFmpeg static binary for Linux x86_64
   - Create a layer with the structure:
     ```
     layer.zip
     ├── bin/
     │   └── ffmpeg
     └── lib/
         └── (required libraries)
     ```
   - Upload as a Lambda Layer and reference it in `terraform/lambda.tf`

## Current Implementation

The current Terraform configuration does not include an FFmpeg layer. You'll need to:
1. Create or find an FFmpeg Lambda Layer
2. Uncomment and update the `layers` attribute in `terraform/lambda.tf` for the `split_video` function

