output "input_bucket_name" {
  description = "Name of the input S3 bucket"
  value       = aws_s3_bucket.video_uploads.id
}

output "output_bucket_name" {
  description = "Name of the output S3 bucket"
  value       = aws_s3_bucket.video_subtitles.id
}

output "on_upload_handler_arn" {
  description = "ARN of the onUploadHandler Lambda function"
  value       = aws_lambda_function.on_upload_handler.arn
}

output "split_video_arn" {
  description = "ARN of the splitVideo Lambda function"
  value       = aws_lambda_function.split_video.arn
}

output "start_transcribe_arn" {
  description = "ARN of the startTranscribe Lambda function"
  value       = aws_lambda_function.start_transcribe.arn
}

output "monitor_transcribe_arn" {
  description = "ARN of the monitorTranscribe Lambda function"
  value       = aws_lambda_function.monitor_transcribe.arn
}

output "store_subtitles_arn" {
  description = "ARN of the storeSubtitles Lambda function"
  value       = aws_lambda_function.store_subtitles.arn
}

output "dynamodb_table_name" {
  description = "Name of the DynamoDB table for job tracking"
  value       = aws_dynamodb_table.transcription_jobs.name
}

