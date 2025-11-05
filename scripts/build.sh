#!/bin/bash

# Build script for AWS Transcription Workflow
# This script prepares the Lambda function deployment package

set -e

# Check if zip command is available
if ! command -v zip &> /dev/null; then
    echo "Error: 'zip' command not found."
    echo "Please install it using: sudo apt-get update && sudo apt-get install -y zip"
    exit 1
fi

echo "Building Lambda functions..."

# Create functions directory if it doesn't exist
mkdir -p functions

# Install dependencies
echo "Installing dependencies..."
npm install

# Create deployment package
echo "Creating deployment package..."

# Copy node_modules to functions directory for Lambda deployment
echo "Copying dependencies to functions directory..."
cp -r node_modules functions/ 2>/dev/null || true

# Create zip file
echo "Creating zip archive..."
rm -f functions.zip
zip -r functions.zip functions/ -x "*.git*" "*.DS_Store*"

# Clean up copied node_modules from functions directory
echo "Cleaning up..."
rm -rf functions/node_modules

echo "Build complete! Created functions.zip"
echo "File size: $(du -h functions.zip | cut -f1)"

