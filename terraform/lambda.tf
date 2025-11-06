# Lambda function: onUploadHandler
resource "aws_lambda_function" "on_upload_handler" {
  filename         = "../functions.zip"
  function_name    = "on-upload-handler-${var.environment}"
  role            = aws_iam_role.on_upload_handler_role.arn
  handler         = "onUploadHandler.handler"
  runtime         = var.lambda_runtime
  timeout         = var.lambda_timeout
  memory_size     = var.lambda_memory_size
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      INPUT_BUCKET     = aws_s3_bucket.video_uploads.id
      OUTPUT_BUCKET    = aws_s3_bucket.video_subtitles.id
      MAX_FILE_SIZE_MB = var.max_file_size_mb
    }
  }
}

# S3 direct Lambda trigger permission removed - Step Functions handles the workflow
# Uncomment if you need direct S3->Lambda triggering for testing
# resource "aws_lambda_permission" "s3_trigger_on_upload" {
#   statement_id  = "AllowS3Invoke"
#   action        = "lambda:InvokeFunction"
#   function_name = aws_lambda_function.on_upload_handler.function_name
#   principal     = "s3.amazonaws.com"
#   source_arn    = aws_s3_bucket.video_uploads.arn
# }

# Lambda function: splitVideo
resource "aws_lambda_function" "split_video" {
  filename         = "../functions.zip"
  function_name    = "split-video-${var.environment}"
  role            = aws_iam_role.split_video_role.arn
  handler         = "splitVideo.handler"
  runtime         = var.lambda_runtime
  timeout         = var.lambda_timeout
  memory_size     = 2048 # More memory for video processing
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      INPUT_BUCKET     = aws_s3_bucket.video_uploads.id
      OUTPUT_BUCKET    = aws_s3_bucket.video_subtitles.id
    }
  }

  # Use ffmpeg layer if provided
  # To use a public layer, set ffmpeg_layer_arn in terraform.tfvars or via -var
  # Example: ffmpeg_layer_arn = "arn:aws:lambda:us-east-1:770693421928:layer:Klayers-p320-ffmpeg:1"
  # Or build your own using: ./scripts/build-ffmpeg-layer.sh
  layers = var.ffmpeg_layer_arn != "" ? [var.ffmpeg_layer_arn] : []
}

# Lambda function: startTranscribe
resource "aws_lambda_function" "start_transcribe" {
  filename         = "../functions.zip"
  function_name    = "start-transcribe-${var.environment}"
  role            = aws_iam_role.start_transcribe_role.arn
  handler         = "startTranscribe.handler"
  runtime         = var.lambda_runtime
  timeout         = var.lambda_timeout
  memory_size     = var.lambda_memory_size
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      INPUT_BUCKET     = aws_s3_bucket.video_uploads.id
      OUTPUT_BUCKET    = aws_s3_bucket.video_subtitles.id
      JOBS_TABLE = aws_dynamodb_table.transcription_jobs.name
    }
  }
}

# Lambda function: monitorTranscribe
resource "aws_lambda_function" "monitor_transcribe" {
  filename         = "../functions.zip"
  function_name    = "monitor-transcribe-${var.environment}"
  role            = aws_iam_role.monitor_transcribe_role.arn
  handler         = "monitorTranscribe.handler"
  runtime         = var.lambda_runtime
  timeout         = var.lambda_timeout
  memory_size     = var.lambda_memory_size
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      OUTPUT_BUCKET    = aws_s3_bucket.video_subtitles.id
      JOBS_TABLE = aws_dynamodb_table.transcription_jobs.name
    }
  }
}

# Lambda function: storeSubtitles
resource "aws_lambda_function" "store_subtitles" {
  filename         = "../functions.zip"
  function_name    = "store-subtitles-${var.environment}"
  role            = aws_iam_role.store_subtitles_role.arn
  handler         = "storeSubtitles.handler"
  runtime         = var.lambda_runtime
  timeout         = var.lambda_timeout
  memory_size     = var.lambda_memory_size
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      OUTPUT_BUCKET = aws_s3_bucket.video_subtitles.id
      JOBS_TABLE = aws_dynamodb_table.transcription_jobs.name
    }
  }
}

# Archive Lambda functions
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "../functions"
  output_path = "../functions.zip"
  depends_on  = [null_resource.build_functions]
}

# Build functions before creating zip
resource "null_resource" "build_functions" {
  triggers = {
    always_run = timestamp()
  }

  provisioner "local-exec" {
    command = "cd .. && npm run build"
  }
}

# Lambda permissions are now handled by Step Functions
# Step Functions will invoke Lambda functions directly, so we don't need
# Lambda-to-Lambda invoke permissions anymore

