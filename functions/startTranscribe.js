import { TranscribeClient, StartTranscriptionJobCommand } from "@aws-sdk/client-transcribe";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const transcribe = new TranscribeClient();
const dynamodb = new DynamoDBClient();

const INPUT_BUCKET = process.env.INPUT_BUCKET;
const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET;
const JOBS_TABLE = process.env.JOBS_TABLE || "transcription-jobs-dev";

/**
 * Generate unique job name
 */
function generateJobName(fileKey, language, chunkIndex = null) {
  const baseName = fileKey.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
  const chunkSuffix = chunkIndex ? `_chunk${chunkIndex}` : "";
  const timestamp = Date.now();
  return `job_${baseName}_${language}_${timestamp}${chunkSuffix}`;
}

/**
 * Start transcription job for a language
 */
async function startTranscriptionJob(bucket, key, language, languageCode, jobMetadata) {
  const jobName = generateJobName(key, language, jobMetadata.chunkIndex);
  // URL encode the key for the S3 URI
  const encodedKey = encodeURIComponent(key).replace(/%2F/g, '/');
  const mediaFileUri = `s3://${bucket}/${encodedKey}`;

  const params = {
    TranscriptionJobName: jobName,
    LanguageCode: languageCode,
    Media: {
      MediaFileUri: mediaFileUri,
    },
    OutputBucketName: OUTPUT_BUCKET,
    Subtitles: {
      Formats: ["srt"],
      OutputStartIndex: 1,
    },
    Settings: {
      ShowSpeakerLabels: false,
    },
  };

  console.log(`Starting transcription job: ${jobName} for ${language}`);
  console.log(`Media URI: ${mediaFileUri}`);
  console.log(`Output bucket: ${OUTPUT_BUCKET}`);
  
  try {
    const command = new StartTranscriptionJobCommand(params);
    const response = await transcribe.send(command);
    console.log(`Transcribe job started successfully: ${jobName}`);

    // Store job metadata in DynamoDB
    try {
      const putCommand = new PutItemCommand({
        TableName: JOBS_TABLE,
        Item: {
          jobId: { S: jobName },
          originalKey: { S: jobMetadata.originalKey || key },
          chunkIndex: { N: String(jobMetadata.chunkIndex || 0) },
          totalChunks: { N: String(jobMetadata.totalChunks || 1) },
          language: { S: language },
          languageCode: { S: languageCode },
          status: { S: response.TranscriptionJob.TranscriptionJobStatus || "IN_PROGRESS" },
          createdAt: { S: new Date().toISOString() },
          inputBucket: { S: bucket },
          inputKey: { S: key },
          outputBucket: { S: OUTPUT_BUCKET },
        },
      });

      await dynamodb.send(putCommand);
      console.log(`Job metadata stored in DynamoDB: ${jobName}`);
    } catch (dbError) {
      console.warn("Failed to store job metadata in DynamoDB:", dbError.message);
      console.warn("DynamoDB error details:", JSON.stringify(dbError, null, 2));
      // Continue even if DynamoDB write fails
    }

    return response.TranscriptionJob;
  } catch (error) {
    console.error(`Error starting transcription job ${jobName}:`, error);
    console.error(`Error details:`, {
      message: error.message,
      name: error.name,
      code: error.code,
      stack: error.stack,
    });
    throw error;
  }
}

export const handler = async (event) => {
  console.log("startTranscribe event:", JSON.stringify(event, null, 2));

  try {
    // Validate required fields
    if (!event.bucket) {
      throw new Error("Missing required field: bucket");
    }
    if (!event.key) {
      throw new Error("Missing required field: key");
    }

    const { bucket, key, originalKey, chunkIndex, totalChunks } = event;

    // Validate environment variables
    if (!INPUT_BUCKET) {
      throw new Error("Missing environment variable: INPUT_BUCKET");
    }
    if (!OUTPUT_BUCKET) {
      throw new Error("Missing environment variable: OUTPUT_BUCKET");
    }

    const jobMetadata = {
      originalKey: originalKey || key,
      chunkIndex: chunkIndex || null,
      totalChunks: totalChunks || 1,
    };

    // Start transcription job for English only
    console.log(`Starting transcription job for bucket: ${bucket}, key: ${key}`);
    const englishJob = await startTranscriptionJob(bucket, key, "english", "en-US", jobMetadata);

    console.log(`Started job: ${englishJob.TranscriptionJobName}`);

    // Return object directly for Step Functions compatibility
    return {
      message: "Transcription job started",
      jobs: {
        english: {
          jobName: englishJob.TranscriptionJobName,
          status: englishJob.TranscriptionJobStatus,
        },
      },
      originalKey: jobMetadata.originalKey,
      chunkIndex: jobMetadata.chunkIndex,
      totalChunks: jobMetadata.totalChunks,
    };
  } catch (error) {
    console.error("Error in startTranscribe:", error);
    throw error;
  }
};

