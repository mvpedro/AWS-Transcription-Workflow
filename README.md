# Repository Specification — AWS Transcription Workflow

**Tech Stack:** Terraform + JavaScript (Node.js)
**Goal:** Automate video upload → splitting → transcription → subtitle storage (English)

---

## 🧩 1. Overview

This repository provisions and orchestrates an automated workflow on AWS that:

1. Uploads a video file to an S3 bucket.
2. Detects new uploads via an S3 event trigger.
3. Checks the file size.

   * If **≤100 MB**, process directly.
   * If **>100 MB**, split it into smaller parts (300s each).
4. Sends each resulting file (or segment) to **Amazon Transcribe** to generate subtitles in **English**.
5. Stores the resulting `.srt` or `.vtt` subtitle files back into S3.

---

## 🏗️ 2. Repository Structure

```
aws-transcribe-pipeline/
├── terraform/
│   ├── main.tf
│   ├── s3.tf
│   ├── lambda.tf
│   ├── stepfunctions.tf
│   ├── iam.tf
│   ├── outputs.tf
│   ├── variables.tf
│   └── provider.tf
│
├── functions/
│   ├── onUploadHandler.js
│   ├── splitVideo.js
│   ├── startTranscribe.js
│   ├── monitorTranscribe.js
│   ├── storeSubtitles.js
│   └── mergeSubtitles.js
│
├── scripts/
│   ├── ffmpegLayer/
│   └── build.sh
│
├── package.json
├── README.md
└── .gitignore
```

---

## ☁️ 3. AWS Resources (Terraform)

### 3.1 S3 Buckets

* **`video-uploads`**
  Receives the raw uploaded videos (from users or frontend).

  * Event: triggers Lambda `onUploadHandler` on new `.mp4` file.
  * Bucket policy grants `s3:GetObject`, `s3:PutObject` to Lambda roles.

* **`video-subtitles`**
  Stores generated subtitle files (`.vtt` or `.srt`) in structured folders:

  ```
  /{original_filename}/english.vtt
  ```

---

### 3.2 Lambda Functions (Node.js)

| Function              | Trigger                           | Description                                                                                                  |
| --------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **onUploadHandler**   | Step Functions (via EventBridge)  | Checks file size and returns metadata for Step Functions workflow orchestration.                            |
| **splitVideo**        | Step Functions task               | Uses `ffmpeg` to split videos >100 MB into multiple parts. Each part uploaded back to S3 (temporary folder). |
| **startTranscribe**   | Step Functions task               | Starts Transcribe job for English.                                                              |
| **monitorTranscribe** | Step Functions task (polling)     | Monitors transcription job completion status and returns completion information.                           |
| **storeSubtitles**    | Step Functions task               | Downloads subtitles from Transcribe output and stores them in `video-subtitles` bucket.                     |
| **mergeSubtitles**    | Step Functions task (optional)    | Merges subtitle files from multiple chunks into a single subtitle file.                                      |

---

### 3.3 IAM Roles & Policies

Each Lambda function gets an execution role with:

* `AmazonS3FullAccess` (scoped to relevant buckets)
* `AmazonTranscribeFullAccess`
* `AWSLambdaBasicExecutionRole`
* Optionally: `CloudWatchLogsFullAccess`

---

### 3.4 AWS Transcribe Jobs

Created via AWS SDK (`@aws-sdk/client-transcribe`).
Each job includes:

```js
{
  TranscriptionJobName: `job-${fileId}-en`,
  LanguageCode: "en-US",
  Media: { MediaFileUri: s3FileUri },
  OutputBucketName: "video-subtitles",
  Subtitles: { Formats: ["vtt"], OutputStartIndex: 1 }
}
```

The job uses `LanguageCode: "en-US"` for English transcription.

---

### 3.5 Step Functions (Current Architecture)

The workflow uses **AWS Step Functions** to orchestrate the entire process. The state machine manages the workflow:

```
S3 Upload Event
    ↓
EventBridge (transforms event)
    ↓
Step Functions State Machine
    ↓
CheckFileSize (Lambda)
    ↓
Choice: Split or Transcribe?
    │
    ├─→ [Split Path]
    │   ├─→ SplitVideo (Lambda)
    │   ├─→ ProcessChunks (Map State - parallel)
    │   │   ├─→ StartTranscribe (Lambda) - per chunk
    │   │   ├─→ MonitorTranscription (Lambda) - polls until complete
    │   │   └─→ StoreSubtitles (Lambda) - per chunk
    │   └─→ MergeSubtitles (Lambda) - optional
    │
    └─→ [Direct Path]
        ├─→ StartTranscribe (Lambda)
        ├─→ MonitorTranscription (Lambda) - polls until complete
        └─→ StoreSubtitles (Lambda)
```

See `STEP_FUNCTIONS_ARCHITECTURE.md` for detailed architecture documentation.

---

## 🧠 4. Function Details

### 4.1 `onUploadHandler.js`

**Responsibilities:**

* Receive event from Step Functions (via EventBridge from S3)
* Check file metadata and size
* Return file information for Step Functions to make workflow decisions

**Note:** This function is now invoked by Step Functions rather than directly by S3. It returns file metadata for Step Functions to use in workflow decisions.

**Example:**

```js
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";

export const handler = async (event) => {
  const s3 = new S3Client();
  const bucket = event.bucket || event.Records?.[0]?.s3?.bucket?.name;
  const key = event.key || event.Records?.[0]?.s3?.object?.key;

  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const fileSizeMB = head.ContentLength / (1024 * 1024);

  return {
    bucket,
    key,
    fileSizeMB,
    needsSplit: fileSizeMB > 100
  };
};
```

---

### 4.2 `splitVideo.js`

**Responsibilities:**

* Download file (stream)
* Use `ffmpeg` (from Lambda Layer or Fargate container) to split by size or duration
* Upload each chunk to a `/chunks/` prefix in S3

**Example Split Command:**

```bash
ffmpeg -i input.mp4 -f segment -segment_time 300 -reset_timestamps 1 chunk_%03d.mp4
```

Then upload each chunk. Step Functions will process each chunk in parallel.

---

### 4.3 `startTranscribe.js`

**Responsibilities:**

* Submit transcription job to Amazon Transcribe
* Creates one job for English transcription
* Save job metadata to DynamoDB or pass to Step Function

---

### 4.4 `monitorTranscribe.js`

**Responsibilities:**

* Poll transcription job status
* Return completion status to Step Functions
* Step Functions handles retries and polling logic

---

### 4.5 `storeSubtitles.js`

**Responsibilities:**

* Read output subtitles from S3 Transcribe output bucket
* Rename/move to `video-subtitles/{file}/`
* Stores English subtitle files

### 4.6 `mergeSubtitles.js`

**Responsibilities:**

* Merge subtitle files from multiple video chunks into a single subtitle file
* Used when videos were split due to size constraints
* Maintains proper timing and sequence across chunks

---

## 🧱 5. Terraform Modules Summary

| File              | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `provider.tf`     | AWS provider and region setup                                 |
| `variables.tf`    | Bucket names, prefixes, Lambda configs                        |
| `s3.tf`           | Create input/output buckets and configure event notifications |
| `lambda.tf`       | Define Lambda functions, environment variables               |
| `stepfunctions.tf`| Define Step Functions state machine and EventBridge rules     |
| `iam.tf`          | Create IAM roles and attach policies                          |
| `main.tf`         | DynamoDB table for job tracking                              |
| `outputs.tf`      | Export ARNs, bucket names, state machine ARN, etc.           |

---

## 🧪 6. Local Development & Deployment

**Build & Deploy**

```bash
# Build Lambdas (zip)
npm run build

# Initialize Terraform
cd terraform
terraform init
terraform apply
```

**Environment Variables (Lambda)**

These are configured in Terraform and automatically set for each Lambda function:

```
INPUT_BUCKET=video-uploads
OUTPUT_BUCKET=video-subtitles
DYNAMODB_TABLE=transcription-jobs-{environment}
```

Note: Transcribe jobs are created with IAM roles configured in Terraform, not via environment variables.

---

## 🧩 7. Optional Enhancements

* ✅ **SNS notification** on transcript completion
* ✅ **DynamoDB table** for job tracking (status, timestamps, results)
* ✅ **Step Function visual workflow** for better observability
* ✅ **Add translation layer** if you want to automatically translate the English transcript into other languages
* ✅ **Integrate Amazon Translate + Subtitle merger** for multilingual subtitle generation

---

## 🚀 8. Deployment Outcome

After deployment:

* Uploading a video to `video-uploads` bucket automatically:

  1. Triggers the workflow
  2. Splits large files
  3. Starts Transcribe job in English
  4. Stores final subtitles in `video-subtitles` bucket
* No manual intervention needed.
