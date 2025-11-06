import { TranscribeClient, GetTranscriptionJobCommand } from "@aws-sdk/client-transcribe";
import { DynamoDBClient, ScanCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

const transcribe = new TranscribeClient();
const dynamodb = new DynamoDBClient();

const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET;
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
 * Check if all jobs for a video/chunk are complete
 */
async function checkAllJobsComplete(originalKey, chunkIndex, totalChunks) {
  if (totalChunks === 1) {
    // Single file, check English job only
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
    return (response.Items || []).length >= 1; // Only English
  } else {
    // Multiple chunks - check if all chunks are complete
    const scanCommand = new ScanCommand({
      TableName: JOBS_TABLE,
      FilterExpression: "originalKey = :key AND totalChunks = :total",
      ExpressionAttributeValues: {
        ":key": { S: originalKey },
        ":total": { N: String(totalChunks) },
      },
    });

    const response = await dynamodb.send(scanCommand);
    const completedJobs = (response.Items || []).filter(
      (item) => item.status?.S === "COMPLETED"
    );
    // For each chunk, we need 1 job (English only) = totalChunks
    return completedJobs.length >= totalChunks;
  }
}

export const handler = async (event) => {
  console.log("monitorTranscribe event:", JSON.stringify(event, null, 2));

  try {
    // Extract event data - handle both direct input and body-wrapped input
    const eventData = event.body ? JSON.parse(event.body) : event;
    
    // If specific job info is provided, check that job
    if (eventData.jobs && eventData.originalKey) {
      const { originalKey, jobs, chunkIndex, totalChunks } = eventData;
      
      // Check English job only
      const englishJob = await checkJobStatus(jobs.english.jobName);
      
      let allComplete = true;
      const completedJobs = [];
      
      if (englishJob.TranscriptionJobStatus === "COMPLETED") {
        const transcriptUri = englishJob.Transcript?.TranscriptFileUri;
        await updateJobStatus(jobs.english.jobName, "COMPLETED", transcriptUri);
        completedJobs.push({
          language: "english",
          jobId: jobs.english.jobName,
          transcriptUri,
        });
        allComplete = true;
      } else if (englishJob.TranscriptionJobStatus === "FAILED") {
        await updateJobStatus(jobs.english.jobName, "FAILED");
        allComplete = false;
      } else {
        allComplete = false;
      }
      
      // Return object directly for Step Functions compatibility
      return {
        message: allComplete ? "Job completed" : "Job still in progress",
        allComplete,
        completedJobs,
        originalKey,
        chunkIndex,
        totalChunks,
      };
    }

    // Otherwise, scan for all in-progress jobs (fallback for scheduled monitoring)
    const inProgressJobs = await getInProgressJobs();

    if (inProgressJobs.length === 0) {
      console.log("No in-progress jobs found");
      return { 
        message: "No jobs to monitor",
        allComplete: true,
      };
    }

    console.log(`Monitoring ${inProgressJobs.length} jobs`);

    // Check status of each job
    const jobChecks = inProgressJobs.map(async (job) => {
      const jobId = job.jobId.S;
      try {
        const jobStatus = await checkJobStatus(jobId);

        if (jobStatus.TranscriptionJobStatus === "COMPLETED") {
          console.log(`Job ${jobId} completed`);
          const transcriptUri = jobStatus.Transcript?.TranscriptFileUri;
          await updateJobStatus(jobId, "COMPLETED", transcriptUri);
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
      message: "Job monitoring completed",
      jobsChecked: inProgressJobs.length,
      allComplete: false, // Continue monitoring
    };
  } catch (error) {
    console.error("Error in monitorTranscribe:", error);
    throw error;
  }
};

