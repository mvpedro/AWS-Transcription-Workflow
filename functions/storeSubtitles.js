import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
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
async function uploadSubtitle(bucket, key, content, contentType = "text/srt") {
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
      // This is a simplified approach - a real implementation would parse and adjust SRT timestamps
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
async function findSubtitleFile(bucket, jobName, format = "srt") {
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

/**
 * Find all files related to a job (JSON, SRT, temp files)
 */
async function findJobFiles(bucket, jobName) {
  const prefix = `${jobName}.`;
  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
  });

  const response = await s3.send(command);
  return (response.Contents || []).map((obj) => obj.Key);
}

/**
 * Find temp files in the bucket (write_access_check_file.temp and temp)
 */
async function findTempFiles(bucket) {
  const tempFiles = [];
  
  // Search for exact temp file names and files that start with these patterns
  const tempFilePatterns = [
    ".write_access_check_file.temp",
    "temp",
    ".write_access_check_file",
  ];

  try {
    // List all objects and filter for temp files
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      MaxKeys: 1000, // Adjust if you have more files
    });

    const response = await s3.send(command);
    if (response.Contents) {
      for (const obj of response.Contents) {
        const key = obj.Key;
        // Check for exact matches or files starting with temp patterns
        // Exclude job files (contain "job_" or end with .srt/.json)
        const isTempFile = (
          key === ".write_access_check_file.temp" ||
          key === "temp" ||
          key.startsWith(".write_access_check_file") ||
          (key === "temp" || key.endsWith("/temp"))
        ) && !key.includes("job_") && !key.endsWith(".srt") && !key.endsWith(".json");
        
        if (isTempFile) {
          tempFiles.push(key);
        }
      }
    }

    // Handle pagination if there are more than 1000 files
    let continuationToken = response.NextContinuationToken;
    while (continuationToken) {
      const nextCommand = new ListObjectsV2Command({
        Bucket: bucket,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      });
      const nextResponse = await s3.send(nextCommand);
      if (nextResponse.Contents) {
        for (const obj of nextResponse.Contents) {
          const key = obj.Key;
          const isTempFile = (
            key === ".write_access_check_file.temp" ||
            key === "temp" ||
            key.startsWith(".write_access_check_file") ||
            (key === "temp" || key.endsWith("/temp"))
          ) && !key.includes("job_") && !key.endsWith(".srt") && !key.endsWith(".json");
          
          if (isTempFile) {
            tempFiles.push(key);
          }
        }
      }
      continuationToken = nextResponse.NextContinuationToken;
    }
  } catch (error) {
    console.warn(`Error searching for temp files:`, error.message);
  }

  return tempFiles;
}

/**
 * Delete a file from S3
 */
async function deleteFile(bucket, key) {
  try {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    await s3.send(command);
    console.log(`Deleted ${bucket}/${key}`);
    return true;
  } catch (error) {
    console.warn(`Failed to delete ${bucket}/${key}:`, error.message);
    return false;
  }
}

/**
 * Clean up job files and temp files after processing
 */
async function cleanupFiles(sourceBucket, jobId, deleteOriginalJobFiles = true) {
  const deletedFiles = [];

  try {
    // Find and delete temp files (write_access_check_file.temp and temp)
    const tempFiles = await findTempFiles(sourceBucket);
    for (const tempFile of tempFiles) {
      if (await deleteFile(sourceBucket, tempFile)) {
        deletedFiles.push(tempFile);
      }
    }

    // Delete original job files (JSON and SRT) if requested
    if (deleteOriginalJobFiles) {
      const jobFiles = await findJobFiles(sourceBucket, jobId);
      for (const jobFile of jobFiles) {
        // Only delete JSON and SRT files, not other formats
        if (jobFile.endsWith('.json') || jobFile.endsWith('.srt')) {
          if (await deleteFile(sourceBucket, jobFile)) {
            deletedFiles.push(jobFile);
          }
        }
      }
    }

    console.log(`Cleanup completed. Deleted ${deletedFiles.length} files:`, deletedFiles);
    return deletedFiles;
  } catch (error) {
    console.error("Error during cleanup:", error);
    // Don't throw - cleanup failures shouldn't break the main flow
    return deletedFiles;
  }
}

export const handler = async (event) => {
  console.log("storeSubtitles event:", JSON.stringify(event, null, 2));

  try {
    // Handle both direct object and potentially stringified input (defensive)
    const eventData = typeof event === 'string' ? JSON.parse(event) : event;
    const { originalKey, chunkIndex, totalChunks, language, transcriptUri, jobId } = eventData;

    if (!originalKey) {
      throw new Error(`Missing required field: originalKey. Event data: ${JSON.stringify(eventData)}`);
    }

    // Get the base filename without extension
    const baseFileName = originalKey.replace(/\.mp4$/, "").replace(/^.*\//, "");

    // If transcriptUri is provided, use it directly
    if (transcriptUri) {
      let sourceBucket, sourceKey;
      
      // Handle both s3:// and https:// URLs
      // s3:// format: s3://bucket/key
      const s3UriMatch = transcriptUri.match(/s3:\/\/([^\/]+)\/(.+)/);
      if (s3UriMatch) {
        [, sourceBucket, sourceKey] = s3UriMatch;
      } else {
        // HTTPS format: https://s3.region.amazonaws.com/bucket/key
        // Example: https://s3.us-east-1.amazonaws.com/video-subtitles-dev-92ca3b3b/job_xxx.json
        const httpsUriMatch = transcriptUri.match(/https?:\/\/s3\.[^\/]+\/([^\/]+)\/(.+)/);
        if (httpsUriMatch) {
          sourceBucket = httpsUriMatch[1];
          sourceKey = httpsUriMatch[2];
        } else {
          // Try alternative format: https://bucket.s3.region.amazonaws.com/key
          const altUriMatch = transcriptUri.match(/https?:\/\/([^.]+)\.s3\.[^\/]+\/(.+)/);
          if (altUriMatch) {
            sourceBucket = altUriMatch[1];
            sourceKey = altUriMatch[2];
          } else {
            throw new Error(`Invalid transcript URI format: ${transcriptUri}`);
          }
        }
      }

      console.log(`Extracted bucket: ${sourceBucket}, key: ${sourceKey} from URI: ${transcriptUri}`);

      // The transcriptUri points to the JSON file, but we need the SRT file
      // Transcribe outputs SRT files with the same base name
      // If sourceKey is a JSON file, replace extension with .srt
      let subtitleKey;
      if (sourceKey.endsWith('.json')) {
        subtitleKey = sourceKey.replace(/\.json$/, '.srt');
      } else {
        // Otherwise, use jobId to construct the SRT filename
        subtitleKey = `${jobId}.srt`;
      }

      console.log(`Looking for subtitle file: ${subtitleKey}`);

      // Verify the subtitle file exists
      try {
        const subtitleContent = await downloadSubtitle(sourceBucket, subtitleKey);

        // Determine final storage location
        const finalKey = totalChunks > 1
          ? `${baseFileName}/chunk_${String(chunkIndex).padStart(3, "0")}/${language}.srt`
          : `${baseFileName}/${language}.srt`;

        // Upload to final location
        await uploadSubtitle(OUTPUT_BUCKET, finalKey, subtitleContent);

        console.log(`Stored subtitle at ${OUTPUT_BUCKET}/${finalKey}`);

        // Clean up temp files and original job files after successful copy
        const deletedFiles = await cleanupFiles(sourceBucket, jobId, true);

        // Return object directly for Step Functions compatibility
        return {
          message: "Subtitle stored successfully",
          location: `${OUTPUT_BUCKET}/${finalKey}`,
          language,
          cleanedUp: deletedFiles.length,
        };
      } catch (downloadError) {
        // If direct download fails, try to find the subtitle file
        console.warn(`Direct download failed, trying to find subtitle file: ${downloadError.message}`);
        const foundSubtitleKey = await findSubtitleFile(sourceBucket, jobId, "srt");
        
        if (!foundSubtitleKey) {
          console.warn(`Subtitle file not found for job ${jobId} in bucket ${sourceBucket}`);
          return {
            message: "Subtitle file not found",
            statusCode: 404,
          };
        }
        
        // Download subtitle using found key
        const subtitleContent = await downloadSubtitle(sourceBucket, foundSubtitleKey);
        
        // Determine final storage location
        const finalKey = totalChunks > 1
          ? `${baseFileName}/chunk_${String(chunkIndex).padStart(3, "0")}/${language}.srt`
          : `${baseFileName}/${language}.srt`;

        // Upload to final location
        await uploadSubtitle(OUTPUT_BUCKET, finalKey, subtitleContent);

        console.log(`Stored subtitle at ${OUTPUT_BUCKET}/${finalKey}`);

        // Clean up temp files and original job files after successful copy
        const deletedFiles = await cleanupFiles(sourceBucket, jobId, true);

        return {
          message: "Subtitle stored successfully",
          location: `${OUTPUT_BUCKET}/${finalKey}`,
          language,
          cleanedUp: deletedFiles.length,
        };
      }
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
            const subtitleKey = await findSubtitleFile(sourceBucket, job.jobId.S, "srt");
            if (!subtitleKey) return null;

            return await downloadSubtitle(sourceBucket, subtitleKey);
          })
        );

        const validContents = subtitleContents.filter((c) => c !== null);
        if (validContents.length > 0) {
          const mergedContent = mergeSubtitles(validContents);
          const finalKey = `${baseFileName}/${language}.srt`;
          await uploadSubtitle(OUTPUT_BUCKET, finalKey, mergedContent);
        }
      }

      // Clean up temp files for all jobs (don't delete job files in fallback mode)
      // We'll clean up temp files from the output bucket
      const deletedFiles = await cleanupFiles(OUTPUT_BUCKET, null, false);

      return {
        message: "Subtitles processed",
        language,
        cleanedUp: deletedFiles.length,
      };
    }
  } catch (error) {
    console.error("Error in storeSubtitles:", error);
    throw error;
  }
};

