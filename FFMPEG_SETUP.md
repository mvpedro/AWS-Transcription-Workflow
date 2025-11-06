# FFmpeg Lambda Layer Setup

The `split-video` Lambda function requires FFmpeg to split large video files. This guide explains how to set up the FFmpeg Lambda Layer.

## Quick Fix

The error you're seeing (`ffmpeg: command not found`) occurs because FFmpeg is not available in the Lambda runtime by default. You need to add an FFmpeg Lambda Layer.

## Option 1: Use a Pre-built Public Layer (Recommended)

### Using Klayers (Public FFmpeg Layer)

1. Find an FFmpeg layer for Node.js 20.x in your region:
   - Visit: https://api.klayers.cloud/api/v2/p3.10/layers/latest/us-east-1/
   - Search for "ffmpeg" layers
   - Or use a known layer ARN (may vary by region)

2. Update your Terraform configuration:

   Create or edit `terraform/terraform.tfvars`:
   ```hcl
   ffmpeg_layer_arn = "arn:aws:lambda:us-east-1:770693421928:layer:Klayers-p320-ffmpeg:1"
   ```

3. Apply the changes:
   ```bash
   cd terraform
   terraform apply
   ```

## Option 2: Build Your Own Layer

1. Build the FFmpeg layer:
   ```bash
   ./scripts/build-ffmpeg-layer.sh
   ```

2. Upload the layer to AWS:
   ```bash
   aws lambda publish-layer-version \
     --layer-name ffmpeg-layer \
     --zip-file fileb://ffmpeg-layer.zip \
     --compatible-runtimes nodejs20.x \
     --region us-east-1
   ```

3. Copy the `LayerVersionArn` from the output and add it to `terraform/terraform.tfvars`:
   ```hcl
   ffmpeg_layer_arn = "arn:aws:lambda:us-east-1:YOUR_ACCOUNT:layer:ffmpeg-layer:1"
   ```

4. Apply Terraform:
   ```bash
   cd terraform
   terraform apply
   ```

## Verification

After applying the changes:

1. Check the Lambda function configuration:
   ```bash
   aws lambda get-function-configuration \
     --function-name split-video-dev \
     --region us-east-1
   ```

2. Verify the layer is attached (check the `Layers` field in the output)

3. Test by uploading a large video file (>100MB) to your S3 input bucket

## Troubleshooting

### Layer Not Found Error

If you get an error about the layer not existing:
- Verify the layer ARN is correct
- Ensure the layer is in the same region as your Lambda function
- Check that the layer is compatible with `nodejs20.x` runtime

### FFmpeg Still Not Found

If you still see "ffmpeg: command not found" after adding the layer:
- The code automatically checks `/opt/bin/ffmpeg` (standard Lambda Layer path)
- Verify the layer structure: it should have `bin/ffmpeg` at the root
- Check CloudWatch logs to see which path is being used

### Alternative: Bundle FFmpeg in Function Package

If layers don't work for your use case, you can bundle FFmpeg directly:
1. Download a static FFmpeg binary
2. Place it in `functions/bin/ffmpeg`
3. The code will automatically find it at `/var/task/bin/ffmpeg`

## Notes

- FFmpeg layers can be large (50-100MB+)
- Lambda has a 250MB unzipped size limit for layers
- The `split-video` function is configured with 2048MB memory for video processing
- Make sure your Lambda timeout is sufficient for large files (default is 15 minutes)

