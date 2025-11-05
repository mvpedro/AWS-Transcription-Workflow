import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";

const s3 = new S3Client();
const dynamodb = new DynamoDBClient();

const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET;
const JOBS_TABLE = process.env.JOBS_TABLE || "transcription-jobs-dev";

/**
 * Download subtitle file from S3
 */
async function downloadSubtitle(bucket, key) {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response = await s3.send(command);
  const bodyContents = await streamToString(response.Body);
  return bodyContents;
}

/**
 * Convert stream to string
 */
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Upload subtitle to final location
 */
async function uploadSubtitle(bucket, key, content, contentType = "text/vtt") {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: content,
    ContentType: contentType,
  });

  await s3.send(command);
}

/**
 * Merge multiple subtitle files
 */
function mergeSubtitles(subtitleContents) {
  // Simple merge - concatenate all subtitles
  // In a production system, you'd want to properly merge timestamps
  let merged = "";
  let timeOffset = 0;

  subtitleContents.forEach((content, index) => {
    if (index > 0) {
      // Adjust timestamps for subsequent chunks
      // This is a simplified approach - a real implementation would parse and adjust VTT timestamps
      merged += "\n\n";
    }
    merged += content;
  });

  return merged;
}

/**
 * Get all completed jobs for a video
 */
async function getCompletedJobs(originalKey) {
  const command = new ScanCommand({
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

  const response = await dynamodb.send(command);
  return response.Items || [];
}

/**
 * Find subtitle file in Transcribe output bucket
 */
async function findSubtitleFile(bucket, jobName, format = "vtt") {
  const prefix = `${jobName}.`;
  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
  });

  const response = await s3.send(command);
  const subtitleFile = response.Contents?.find((obj) =>
    obj.Key.endsWith(`.${format}`)
  );

  return subtitleFile?.Key;
}

export const handler = async (event) => {
  console.log("storeSubtitles event:", JSON.stringify(event, null, 2));

  try {
    const { originalKey, chunkIndex, totalChunks, language, transcriptUri, jobId } = event;

    // Get the base filename without extension
    const baseFileName = originalKey.replace(/\.mp4$/, "").replace(/^.*\//, "");

    // If transcriptUri is provided, use it directly
    if (transcriptUri) {
      // Extract bucket and key from URI (format: s3://bucket/key)
      const uriMatch = transcriptUri.match(/s3:\/\/([^\/]+)\/(.+)/);
      if (!uriMatch) {
        throw new Error(`Invalid transcript URI: ${transcriptUri}`);
      }

      const [, sourceBucket, sourceKey] = uriMatch;

      // Find the subtitle file (Transcribe outputs .vtt files)
      const subtitleKey = await findSubtitleFile(sourceBucket, jobId, "vtt");

      if (!subtitleKey) {
        console.warn(`Subtitle file not found for job ${jobId}`);
        return {
          statusCode: 404,
          body: JSON.stringify({ message: "Subtitle file not found" }),
        };
      }

      // Download subtitle
      const subtitleContent = await downloadSubtitle(sourceBucket, subtitleKey);

      // Determine final storage location
      const finalKey = totalChunks > 1
        ? `${baseFileName}/chunk_${String(chunkIndex).padStart(3, "0")}/${language}.vtt`
        : `${baseFileName}/${language}.vtt`;

      // Upload to final location
      await uploadSubtitle(OUTPUT_BUCKET, finalKey, subtitleContent);

      console.log(`Stored subtitle at ${OUTPUT_BUCKET}/${finalKey}`);

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "Subtitle stored successfully",
          location: `${OUTPUT_BUCKET}/${finalKey}`,
          language,
        }),
      };
    } else {
      // Fallback: query DynamoDB for job info
      const jobs = await getCompletedJobs(originalKey);
      const languageJobs = jobs.filter((job) => job.language?.S === language);

      if (languageJobs.length === 0) {
        throw new Error(`No completed jobs found for ${originalKey} (${language})`);
      }

      // For multiple chunks, merge subtitles
      if (totalChunks > 1 && languageJobs.length > 1) {
        const subtitleContents = await Promise.all(
          languageJobs.map(async (job) => {
            const jobTranscriptUri = job.transcriptUri?.S;
            if (!jobTranscriptUri) return null;

            const uriMatch = jobTranscriptUri.match(/s3:\/\/([^\/]+)\/(.+)/);
            if (!uriMatch) return null;

            const [, sourceBucket, sourceKey] = uriMatch;
            const subtitleKey = await findSubtitleFile(sourceBucket, job.jobId.S, "vtt");
            if (!subtitleKey) return null;

            return await downloadSubtitle(sourceBucket, subtitleKey);
          })
        );

        const validContents = subtitleContents.filter((c) => c !== null);
        if (validContents.length > 0) {
          const mergedContent = mergeSubtitles(validContents);
          const finalKey = `${baseFileName}/${language}.vtt`;
          await uploadSubtitle(OUTPUT_BUCKET, finalKey, mergedContent);
        }
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "Subtitles processed",
          language,
        }),
      };
    }
  } catch (error) {
    console.error("Error in storeSubtitles:", error);
    throw error;
  }
};

