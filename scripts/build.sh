#!/bin/bash

# Build script for AWS Transcription Workflow
# This script prepares the Lambda function deployment package

set -e

echo "Building Lambda functions..."

# Create functions directory if it doesn't exist
mkdir -p functions

# Install dependencies
echo "Installing dependencies..."
npm install

# Create deployment package
echo "Creating deployment package..."
cd functions

# Copy all function files
# The functions are already in the functions directory

# Create zip file (excluding node_modules that should be in Lambda Layer or bundled)
cd ..

# Remove old zip if exists
rm -f functions.zip

# Create zip with all function files
zip -r functions.zip functions/ -x "*.git*" "*.DS_Store*"

echo "Build complete! Created functions.zip"
echo "File size: $(du -h functions.zip | cut -f1)"

