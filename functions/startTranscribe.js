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
  const mediaFileUri = `s3://${bucket}/${key}`;

  const params = {
    TranscriptionJobName: jobName,
    LanguageCode: languageCode,
    Media: {
      MediaFileUri: mediaFileUri,
    },
    OutputBucketName: OUTPUT_BUCKET,
    Subtitles: {
      Formats: ["vtt", "srt"],
      OutputStartIndex: 1,
    },
    Settings: {
      ShowSpeakerLabels: false,
      MaxAlternatives: 1,
    },
  };

  console.log(`Starting transcription job: ${jobName} for ${language}`);
  const command = new StartTranscriptionJobCommand(params);
  const response = await transcribe.send(command);

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
  } catch (dbError) {
    console.warn("Failed to store job metadata in DynamoDB:", dbError.message);
    // Continue even if DynamoDB write fails
  }

  return response.TranscriptionJob;
}

export const handler = async (event) => {
  console.log("startTranscribe event:", JSON.stringify(event, null, 2));

  try {
    const { bucket, key, originalKey, chunkIndex, totalChunks } = event;

    const jobMetadata = {
      originalKey: originalKey || key,
      chunkIndex: chunkIndex || null,
      totalChunks: totalChunks || 1,
    };

    // Start transcription jobs for both English and Spanish
    const [englishJob, spanishJob] = await Promise.all([
      startTranscriptionJob(bucket, key, "english", "en-US", jobMetadata),
      startTranscriptionJob(bucket, key, "spanish", "es-ES", jobMetadata),
    ]);

    console.log(`Started jobs: ${englishJob.TranscriptionJobName}, ${spanishJob.TranscriptionJobName}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Transcription jobs started",
        jobs: {
          english: {
            jobName: englishJob.TranscriptionJobName,
            status: englishJob.TranscriptionJobStatus,
          },
          spanish: {
            jobName: spanishJob.TranscriptionJobName,
            status: spanishJob.TranscriptionJobStatus,
          },
        },
        metadata: jobMetadata,
      }),
    };
  } catch (error) {
    console.error("Error in startTranscribe:", error);
    throw error;
  }
};

