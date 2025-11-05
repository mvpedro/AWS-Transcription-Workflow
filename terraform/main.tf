# Optional: DynamoDB table for job tracking
resource "aws_dynamodb_table" "transcription_jobs" {
  name           = "transcription-jobs-${var.environment}"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "jobId"

  attribute {
    name = "jobId"
    type = "S"
  }

  tags = {
    Environment = var.environment
    Name        = "Transcription Jobs"
  }
}

# CloudWatch Event Rule to periodically check transcription jobs
resource "aws_cloudwatch_event_rule" "monitor_transcribe_schedule" {
  name                = "monitor-transcribe-schedule-${var.environment}"
  description         = "Periodically check transcription job status"
  schedule_expression = "rate(2 minutes)"
}

resource "aws_cloudwatch_event_target" "monitor_transcribe_target" {
  rule      = aws_cloudwatch_event_rule.monitor_transcribe_schedule.name
  target_id = "MonitorTranscribeTarget"
  arn       = aws_lambda_function.monitor_transcribe.arn
}

resource "aws_lambda_permission" "allow_cloudwatch_invoke_monitor" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.monitor_transcribe.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.monitor_transcribe_schedule.arn
}

