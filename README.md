# Repository Specification — AWS Transcription Workflow

**Tech Stack:** Terraform + JavaScript (Node.js)
**Goal:** Automate video upload → splitting → transcription → subtitle storage (English & Spanish)

---

## 🧩 1. Overview

This repository provisions and orchestrates an automated workflow on AWS that:

1. Uploads a video file to an S3 bucket.
2. Detects new uploads via an S3 event trigger.
3. Checks the file size.

   * If **≤100 MB**, process directly.
   * If **>100 MB**, split it into smaller parts (≤100 MB each).
4. Sends each resulting file (or segment) to **Amazon Transcribe** to generate subtitles in **English** and **Spanish**.
5. Stores the resulting `.srt` or `.vtt` subtitle files back into S3.

---

## 🏗️ 2. Repository Structure

```
aws-transcribe-pipeline/
├── terraform/
│   ├── main.tf
│   ├── s3.tf
│   ├── lambda.tf
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
│   └── storeSubtitles.js
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
  /{original_filename}/spanish.vtt
  ```

---

### 3.2 Lambda Functions (Node.js)

| Function              | Trigger                                      | Description                                                                                                  |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **onUploadHandler**   | S3 (ObjectCreated)                           | Receives event from upload bucket. Checks file size and orchestrates logic.                                  |
| **splitVideo**        | Invoked by `onUploadHandler`                 | Uses `ffmpeg` to split videos >100 MB into multiple parts. Each part uploaded back to S3 (temporary folder). |
| **startTranscribe**   | Invoked by `onUploadHandler` or `splitVideo` | Starts Transcribe jobs for English and Spanish.                                                              |
| **monitorTranscribe** | CloudWatch Event or Step Function task       | Monitors job completion and triggers `storeSubtitles`.                                                       |
| **storeSubtitles**    | Invoked after transcription completes        | Downloads subtitles, stores them in `video-subtitles` bucket.                                                |

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

A second job with `LanguageCode: "es-ES"` is started after the English job, or in parallel.

---

### 3.5 Step Function (optional but recommended)

Instead of chaining Lambdas manually, define a **State Machine** that manages the workflow:

```
S3 Upload Event
    ↓
Check file size
    ↓
[ <100MB ] ───► Start Transcribe (en + es)
[ >100MB ] ───► Split Video → Start Transcribe (per chunk)
    ↓
Wait for all jobs to complete
    ↓
Merge subtitles if split
    ↓
Store in S3
```

Terraform module can define this using `aws_sfn_state_machine`.

---

## 🧠 4. Function Details

### 4.1 `onUploadHandler.js`

**Responsibilities:**

* Receive S3 event
* Check file metadata and size
* Branch:

  * If ≤100 MB → call `startTranscribe` directly
  * If >100 MB → call `splitVideo` and process each chunk

**Example:**

```js
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { startTranscribe } from "./startTranscribe.js";
import { splitVideo } from "./splitVideo.js";

export const handler = async (event) => {
  const s3 = new S3Client();
  const { bucket, key } = extractS3Info(event);

  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const fileSizeMB = head.ContentLength / (1024 * 1024);

  if (fileSizeMB > 100) {
    await splitVideo(bucket, key);
  } else {
    await startTranscribe(bucket, key);
  }
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

Then upload each chunk and call `startTranscribe` for each.

---

### 4.3 `startTranscribe.js`

**Responsibilities:**

* Submit transcription job(s) to Amazon Transcribe
* One job for English, one for Spanish
* Save job metadata to DynamoDB or pass to Step Function

---

### 4.4 `monitorTranscribe.js`

**Responsibilities:**

* Poll job status
* On completion, trigger `storeSubtitles`

---

### 4.5 `storeSubtitles.js`

**Responsibilities:**

* Read output subtitles from S3 Transcribe output bucket
* Rename/move to `video-subtitles/{file}/`
* Optionally merge multiple chunks into one `.vtt` file

---

## 🧱 5. Terraform Modules Summary

| File           | Purpose                                                       |
| -------------- | ------------------------------------------------------------- |
| `provider.tf`  | AWS provider and region setup                                 |
| `variables.tf` | Bucket names, prefixes, Lambda configs                        |
| `s3.tf`        | Create input/output buckets and configure event notifications |
| `lambda.tf`    | Define Lambda functions, environment variables, and triggers  |
| `iam.tf`       | Create IAM roles and attach policies                          |
| `main.tf`      | Optional Step Function + outputs                              |
| `outputs.tf`   | Export ARNs, bucket names, etc.                               |

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

```
INPUT_BUCKET=video-uploads
OUTPUT_BUCKET=video-subtitles
TRANSCRIBE_ROLE_ARN=...
```

---

## 🧩 7. Optional Enhancements

* ✅ **SNS notification** on transcript completion
* ✅ **DynamoDB table** for job tracking (status, timestamps, results)
* ✅ **Step Function visual workflow** for better observability
* ✅ **Add translation layer** if you want to automatically translate the English transcript into Spanish instead of dual transcription jobs
* ✅ **Integrate Amazon Translate + Subtitle merger** for multilingual subtitle generation

---

## 🚀 8. Deployment Outcome

After deployment:

* Uploading a video to `video-uploads` bucket automatically:

  1. Triggers the workflow
  2. Splits large files
  3. Starts Transcribe jobs in English and Spanish
  4. Stores final subtitles in `video-subtitles` bucket
* No manual intervention needed.
