#!/bin/bash

# Build script for FFmpeg Lambda Layer
# This script downloads FFmpeg static binary and creates a Lambda Layer

set -e

LAYER_DIR="ffmpeg-layer"
LAYER_ZIP="ffmpeg-layer.zip"
REGION="${AWS_REGION:-us-east-1}"

echo "Building FFmpeg Lambda Layer..."

# Create layer directory structure
mkdir -p "${LAYER_DIR}/bin"

# Download FFmpeg static binary for Lambda (Amazon Linux 2 compatible)
# Using serverlesspub's ffmpeg static build which is known to work with Lambda
echo "Downloading FFmpeg static binary..."
FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
TEMP_DIR=$(mktemp -d)

# Download and extract
curl -L "${FFMPEG_URL}" -o "${TEMP_DIR}/ffmpeg.tar.xz"
tar -xf "${TEMP_DIR}/ffmpeg.tar.xz" -C "${TEMP_DIR}"

# Find the ffmpeg binary in the extracted directory
FFMPEG_BIN=$(find "${TEMP_DIR}" -name "ffmpeg" -type f | head -n 1)

if [ -z "${FFMPEG_BIN}" ]; then
    echo "Error: Could not find ffmpeg binary in downloaded archive"
    echo "Trying alternative method..."
    
    # Alternative: Use a pre-built static binary
    FFMPEG_URL_ALT="https://github.com/serverlesspub/ffmpeg-aws-lambda-layer/raw/master/ffmpeg"
    curl -L "${FFMPEG_URL_ALT}" -o "${LAYER_DIR}/bin/ffmpeg"
else
    # Copy the binary
    cp "${FFMPEG_BIN}" "${LAYER_DIR}/bin/ffmpeg"
fi

# Clean up temp directory
rm -rf "${TEMP_DIR}"

# Make ffmpeg executable
chmod +x "${LAYER_DIR}/bin/ffmpeg"

# Create zip file
echo "Creating layer zip file..."
rm -f "${LAYER_ZIP}"
cd "${LAYER_DIR}"
zip -r "../${LAYER_ZIP}" .
cd ..

# Clean up
rm -rf "${LAYER_DIR}"

echo ""
echo "✓ FFmpeg layer created: ${LAYER_ZIP}"
echo ""
echo "To deploy this layer:"
echo "1. Upload to AWS Lambda Layers:"
echo "   aws lambda publish-layer-version \\"
echo "     --layer-name ffmpeg-layer-${REGION} \\"
echo "     --zip-file fileb://${LAYER_ZIP} \\"
echo "     --compatible-runtimes nodejs20.x \\"
echo "     --region ${REGION}"
echo ""
echo "2. Copy the LayerVersionArn from the output"
echo "3. Update terraform.tfvars or set the variable:"
echo "   ffmpeg_layer_arn = \"arn:aws:lambda:${REGION}:YOUR_ACCOUNT:layer:ffmpeg-layer-${REGION}:1\""
echo ""
echo "Alternatively, you can use a public layer like Klayers:"
echo "  Search for 'ffmpeg' layers in your region at:"
echo "  https://api.klayers.cloud/api/v2/p3.10/layers/latest/us-east-1/"

