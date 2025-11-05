import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { exec } from "child_process";
import { promisify } from "util";
import { createWriteStream, unlinkSync, readdirSync, mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { pipeline } from "stream/promises";

const execAsync = promisify(exec);
const s3 = new S3Client();
const lambda = new LambdaClient();

const INPUT_BUCKET = process.env.INPUT_BUCKET;
const START_TRANSCRIBE_FUNCTION = process.env.START_TRANSCRIBE_FUNCTION;
const TMP_DIR = "/tmp";
const MAX_CHUNK_SIZE_MB = 100;

/**
 * Download file from S3 to local filesystem
 */
async function downloadFromS3(bucket, key, localPath) {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response = await s3.send(command);
  const fileStream = createWriteStream(localPath);

  await pipeline(response.Body, fileStream);
  return localPath;
}

/**
 * Upload file to S3
 */
async function uploadToS3(bucket, key, localPath) {
  const fileContent = readFileSync(localPath);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fileContent,
  });

  await s3.send(command);
}

/**
 * Split video using ffmpeg
 */
async function splitVideo(inputPath, outputDir) {
  // Use ffmpeg to split by size (approximately 100MB chunks)
  // This is a simplified approach - you may want to adjust based on codec
  const segmentTime = 300; // 5 minutes per segment (adjust based on your video)
  const command = `ffmpeg -i ${inputPath} -f segment -segment_time ${segmentTime} -reset_timestamps 1 -c copy ${join(outputDir, "chunk_%03d.mp4")}`;

  console.log(`Executing: ${command}`);
  await execAsync(command);

  // Get list of created chunks
  const chunks = readdirSync(outputDir)
    .filter((file) => file.startsWith("chunk_") && file.endsWith(".mp4"))
    .sort();

  return chunks.map((chunk) => join(outputDir, chunk));
}

/**
 * Invoke Lambda function
 */
async function invokeLambda(functionName, payload) {
  const command = new InvokeCommand({
    FunctionName: functionName,
    Payload: JSON.stringify(payload),
  });

  await lambda.send(command);
}

/**
 * Clean up temporary files
 */
function cleanup(files) {
  files.forEach((file) => {
    try {
      unlinkSync(file);
    } catch (error) {
      console.warn(`Failed to delete ${file}:`, error.message);
    }
  });
}

export const handler = async (event) => {
  console.log("splitVideo event:", JSON.stringify(event, null, 2));

  const { bucket, key, originalKey } = event;
  const inputPath = join(TMP_DIR, `input_${Date.now()}.mp4`);
  const outputDir = join(TMP_DIR, `output_${Date.now()}`);
  const chunksDir = join(outputDir, "chunks");

  // Create output directory
  mkdirSync(chunksDir, { recursive: true });

  try {
    // Download video from S3
    console.log(`Downloading ${bucket}/${key} to ${inputPath}`);
    await downloadFromS3(bucket, key, inputPath);

    // Split video
    console.log("Splitting video...");
    const chunkPaths = await splitVideo(inputPath, chunksDir);

    console.log(`Created ${chunkPaths.length} chunks`);

    // Upload chunks and start transcription for each
    const baseFileName = originalKey || key;
    const baseName = baseFileName.replace(/\.mp4$/, "");

    const transcriptionPromises = chunkPaths.map(async (chunkPath, index) => {
      const chunkKey = `chunks/${baseName}/chunk_${String(index + 1).padStart(3, "0")}.mp4`;
      
      console.log(`Uploading chunk ${index + 1} to ${chunkKey}`);
      await uploadToS3(bucket, chunkKey, chunkPath);

      // Start transcription for this chunk
      await invokeLambda(START_TRANSCRIBE_FUNCTION, {
        bucket,
        key: chunkKey,
        originalKey: baseFileName,
        chunkIndex: index + 1,
        totalChunks: chunkPaths.length,
      });
    });

    await Promise.all(transcriptionPromises);

    // Cleanup
    cleanup([inputPath, ...chunkPaths]);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Video split successfully",
        chunks: chunkPaths.length,
        originalKey: baseFileName,
      }),
    };
  } catch (error) {
    console.error("Error in splitVideo:", error);
    
    // Cleanup on error
    try {
      cleanup([inputPath]);
      if (existsSync(chunksDir)) {
        rmSync(chunksDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      console.warn("Cleanup error:", cleanupError);
    }

    throw error;
  }
};

