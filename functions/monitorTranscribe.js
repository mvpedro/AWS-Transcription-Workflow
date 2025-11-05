import { TranscribeClient, GetTranscriptionJobCommand } from "@aws-sdk/client-transcribe";
import { DynamoDBClient, ScanCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const transcribe = new TranscribeClient();
const dynamodb = new DynamoDBClient();
const lambda = new LambdaClient();

const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET;
const STORE_SUBTITLES_FUNCTION = process.env.STORE_SUBTITLES_FUNCTION;
const JOBS_TABLE = process.env.JOBS_TABLE || "transcription-jobs-dev";

/**
 * Get all in-progress jobs from DynamoDB
 */
async function getInProgressJobs() {
  const command = new ScanCommand({
    TableName: JOBS_TABLE,
    FilterExpression: "#status = :status",
    ExpressionAttributeNames: {
      "#status": "status",
    },
    ExpressionAttributeValues: {
      ":status": { S: "IN_PROGRESS" },
    },
  });

  const response = await dynamodb.send(command);
  return response.Items || [];
}

/**
 * Check job status
 */
async function checkJobStatus(jobName) {
  const command = new GetTranscriptionJobCommand({
    TranscriptionJobName: jobName,
  });

  const response = await transcribe.send(command);
  return response.TranscriptionJob;
}

/**
 * Update job status in DynamoDB
 */
async function updateJobStatus(jobId, status, transcriptUri = null) {
  const updateExpression = "SET #status = :status, updatedAt = :updatedAt";
  const expressionAttributeValues = {
    ":status": { S: status },
    ":updatedAt": { S: new Date().toISOString() },
  };

  if (transcriptUri) {
    expressionAttributeValues[":transcriptUri"] = { S: transcriptUri };
    const updateCommand = new UpdateItemCommand({
      TableName: JOBS_TABLE,
      Key: { jobId: { S: jobId } },
      UpdateExpression: `${updateExpression}, transcriptUri = :transcriptUri`,
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: expressionAttributeValues,
    });
    await dynamodb.send(updateCommand);
  } else {
    const updateCommand = new UpdateItemCommand({
      TableName: JOBS_TABLE,
      Key: { jobId: { S: jobId } },
      UpdateExpression,
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues,
    });
    await dynamodb.send(updateCommand);
  }
}

/**
 * Invoke storeSubtitles Lambda
 */
async function invokeStoreSubtitles(payload) {
  const command = new InvokeCommand({
    FunctionName: STORE_SUBTITLES_FUNCTION,
    Payload: JSON.stringify(payload),
  });

  await lambda.send(command);
}

/**
 * Check if all jobs for a video/chunk are complete
 */
async function checkAllJobsComplete(originalKey, chunkIndex, totalChunks) {
  if (totalChunks === 1) {
    // Single file, check both English and Spanish jobs
    const scanCommand = new ScanCommand({
      TableName: JOBS_TABLE,
      FilterExpression: "originalKey = :key AND #status = :status",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":key": { S: originalKey },
        ":status": { S: "COMPLETED" },
      },
    });

    const response = await dynamodb.send(scanCommand);
    return (response.Items || []).length >= 2; // Both English and Spanish
  } else {
    // Multiple chunks - for simplicity, we'll process each chunk independently
    // In a more sophisticated implementation, you'd wait for all chunks
    return true;
  }
}

export const handler = async (event) => {
  console.log("monitorTranscribe event:", JSON.stringify(event, null, 2));

  try {
    // Get all in-progress jobs
    const inProgressJobs = await getInProgressJobs();

    if (inProgressJobs.length === 0) {
      console.log("No in-progress jobs found");
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "No jobs to monitor" }),
      };
    }

    console.log(`Monitoring ${inProgressJobs.length} jobs`);

    // Check status of each job
    const jobChecks = inProgressJobs.map(async (job) => {
      const jobId = job.jobId.S;
      const originalKey = job.originalKey.S;
      const chunkIndex = job.chunkIndex ? parseInt(job.chunkIndex.N) : null;
      const totalChunks = job.totalChunks ? parseInt(job.totalChunks.N) : 1;
      const language = job.language.S;

      try {
        const jobStatus = await checkJobStatus(jobId);

        if (jobStatus.TranscriptionJobStatus === "COMPLETED") {
          console.log(`Job ${jobId} completed`);

          // Update DynamoDB
          const transcriptUri = jobStatus.Transcript?.TranscriptFileUri;
          await updateJobStatus(jobId, "COMPLETED", transcriptUri);

          // Check if all jobs for this video/chunk are complete
          const allComplete = await checkAllJobsComplete(originalKey, chunkIndex, totalChunks);

          if (allComplete) {
            // Trigger storeSubtitles
            await invokeStoreSubtitles({
              originalKey,
              chunkIndex,
              totalChunks,
              language,
              transcriptUri,
              jobId,
            });
          }
        } else if (jobStatus.TranscriptionJobStatus === "FAILED") {
          console.error(`Job ${jobId} failed:`, jobStatus.FailureReason);
          await updateJobStatus(jobId, "FAILED");
        } else {
          console.log(`Job ${jobId} still in progress: ${jobStatus.TranscriptionJobStatus}`);
        }
      } catch (error) {
        console.error(`Error checking job ${jobId}:`, error.message);
      }
    });

    await Promise.all(jobChecks);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Job monitoring completed",
        jobsChecked: inProgressJobs.length,
      }),
    };
  } catch (error) {
    console.error("Error in monitorTranscribe:", error);
    throw error;
  }
};

