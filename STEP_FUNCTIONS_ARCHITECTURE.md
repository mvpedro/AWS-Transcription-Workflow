# Step Functions Architecture

This document describes the refactored architecture using AWS Step Functions instead of standalone Lambda functions.

## Overview

The workflow has been refactored from a Lambda-to-Lambda invocation pattern to a Step Functions orchestrated workflow. This provides better observability, error handling, and workflow management.

## Architecture Flow

```
S3 Upload Event
    ↓
EventBridge (transforms event)
    ↓
Step Functions State Machine
    ↓
    ├─→ CheckFileSize (Lambda)
    ↓
    ├─→ Choice: Split or Transcribe?
    │
    ├─→ [Split Path]
    │   ├─→ SplitVideo (Lambda)
    │   ├─→ ProcessChunks (Map State)
    │   │   ├─→ StartTranscribe (Lambda) - per chunk
    │   │   ├─→ MonitorTranscription (Lambda) - polls until complete
    │   │   └─→ StoreSubtitles (Lambda) - per chunk
    │
    └─→ [Direct Path]
        ├─→ StartTranscribe (Lambda)
        ├─→ MonitorTranscription (Lambda) - polls until complete
        └─→ StoreSubtitles (Lambda) - parallel for English & Spanish
```

## Key Changes

### 1. Event Trigger
- **Before**: S3 directly triggered `onUploadHandler` Lambda
- **After**: S3 sends events to EventBridge, which triggers Step Functions

### 2. Lambda Orchestration
- **Before**: Lambda functions invoked each other using `LambdaClient.invoke()`
- **After**: Step Functions orchestrates Lambda invocations as tasks

### 3. Monitoring
- **Before**: CloudWatch Event Rule scheduled `monitorTranscribe` every 2 minutes
- **After**: Step Functions polls `monitorTranscribe` in a loop until jobs complete

### 4. Error Handling
- **Before**: Manual error handling in each Lambda
- **After**: Step Functions provides built-in retry logic and error handling

## Step Functions State Machine

### States

1. **CheckFileSize**: Lambda task that checks file size
2. **CheckSizeDecision**: Choice state that routes based on file size
3. **SplitVideo**: Lambda task that splits large videos (if needed)
4. **ProcessChunks**: Map state that processes each chunk in parallel
5. **StartTranscribe**: Lambda task that starts transcription jobs
6. **MonitorTranscription**: Lambda task that polls job status
7. **StoreSubtitles**: Lambda task that stores completed subtitles

### Retry Logic

All Lambda tasks have retry configuration:
- Max Attempts: 2-3
- Interval: 2 seconds
- Backoff Rate: 2.0

### Monitoring Pattern

The workflow uses a polling pattern:
1. Call `monitorTranscribe` Lambda
2. Check if `allComplete` is true
3. If false, wait 30 seconds and retry
4. If true, proceed to store subtitles

## Lambda Function Changes

### onUploadHandler
- Removed: `invokeLambda()` calls
- Changed: Returns result for Step Functions to use
- Input: Supports both S3 event format and direct properties

### splitVideo
- Removed: `invokeLambda()` call to `startTranscribe`
- Changed: Returns chunk information for Step Functions to process
- Output: Array of chunk objects with metadata

### startTranscribe
- Removed: No direct changes (was already independent)
- Behavior: Still starts both English and Spanish jobs

### monitorTranscribe
- Removed: `invokeLambda()` call to `storeSubtitles`
- Changed: Returns completion status and job information
- Output: `allComplete` boolean and `completedJobs` array

### storeSubtitles
- Removed: No direct changes (was already independent)
- Behavior: Receives job information from Step Functions

## Infrastructure Changes

### Removed Resources
- Lambda-to-Lambda invoke permissions
- CloudWatch Event Rule for scheduled monitoring
- S3 direct Lambda trigger

### Added Resources
- Step Functions state machine
- Step Functions IAM role
- EventBridge rule for S3 → Step Functions
- EventBridge IAM role
- CloudWatch Log Group for Step Functions

## Deployment

The deployment process remains the same:
1. Build Lambda functions: `npm run build`
2. Deploy Terraform: `terraform apply`

## Benefits

1. **Better Observability**: Step Functions provides visual workflow execution
2. **Centralized Error Handling**: Built-in retry and error handling
3. **Easier Debugging**: Step Functions execution history shows exactly where failures occur
4. **Cost Optimization**: No unnecessary Lambda invocations for orchestration
5. **Scalability**: Step Functions handles concurrent executions better

## Migration Notes

- All Lambda functions remain compatible with both old and new patterns
- EventBridge input transformer formats S3 events for Step Functions
- DynamoDB table structure remains unchanged
- No changes to S3 bucket structure or policies

