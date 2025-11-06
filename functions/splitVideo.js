import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { exec } from "child_process";
import { promisify } from "util";
import { createWriteStream, unlinkSync, readdirSync, mkdirSync, rmSync, existsSync, readFileSync, accessSync, constants } from "fs";
import { join } from "path";
import { pipeline } from "stream/promises";

const execAsync = promisify(exec);
const s3 = new S3Client();

const INPUT_BUCKET = process.env.INPUT_BUCKET;
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
 * Find ffmpeg executable path
 * Lambda Layers typically place binaries in /opt/bin
 */
function findFFmpegPath() {
  // Common paths where ffmpeg might be located
  const possiblePaths = [
    "/opt/bin/ffmpeg",  // Lambda Layer path
    "/var/task/bin/ffmpeg",  // If bundled in function
    "/usr/local/bin/ffmpeg",  // System path
    "ffmpeg"  // In PATH
  ];

  for (const path of possiblePaths) {
    try {
      if (path === "ffmpeg") {
        // Check if it's in PATH - try to access it
        // We'll return "ffmpeg" and let exec handle PATH lookup
        return "ffmpeg";
      }
      if (existsSync(path)) {
        // Verify we can access it
        accessSync(path, constants.F_OK);
        return path;
      }
    } catch (error) {
      // Continue to next path
      continue;
    }
  }

  // Default to ffmpeg (assumes it's in PATH from layer)
  return "ffmpeg";
}

/**
 * Split video using ffmpeg
 */
async function splitVideo(inputPath, outputDir) {
  // Use ffmpeg to split by size (approximately 100MB chunks)
  // This is a simplified approach - you may want to adjust based on codec
  const segmentTime = 300; // 5 minutes per segment (adjust based on your video)
  const ffmpegPath = findFFmpegPath();
  const command = `${ffmpegPath} -i ${inputPath} -f segment -segment_time ${segmentTime} -reset_timestamps 1 -c copy ${join(outputDir, "chunk_%03d.mp4")}`;

  console.log(`Executing: ${command}`);
  console.log(`Using ffmpeg at: ${ffmpegPath}`);
  await execAsync(command);

  // Get list of created chunks
  const chunks = readdirSync(outputDir)
    .filter((file) => file.startsWith("chunk_") && file.endsWith(".mp4"))
    .sort();

  return chunks.map((chunk) => join(outputDir, chunk));
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

  // Extract event data - handle both direct input and body-wrapped input
  const eventData = event.body ? JSON.parse(event.body) : event;
  const { bucket, key, originalKey } = eventData;
  
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

    // Upload chunks - Step Functions will handle transcription
    const baseFileName = originalKey || key;
    const baseName = baseFileName.replace(/\.mp4$/, "");

    const chunks = await Promise.all(
      chunkPaths.map(async (chunkPath, index) => {
        const chunkKey = `chunks/${baseName}/chunk_${String(index + 1).padStart(3, "0")}.mp4`;
        
        console.log(`Uploading chunk ${index + 1} to ${chunkKey}`);
        await uploadToS3(bucket, chunkKey, chunkPath);

        return {
          bucket,
          key: chunkKey,
          originalKey: baseFileName,
          chunkIndex: index + 1,
          totalChunks: chunkPaths.length,
        };
      })
    );

    // Cleanup
    cleanup([inputPath, ...chunkPaths]);

    // Return object directly for Step Functions compatibility
    return {
      message: "Video split successfully",
      chunks: chunks,
      originalKey: baseFileName,
      totalChunks: chunkPaths.length,
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

