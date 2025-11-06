# Data source to get current AWS account ID
data "aws_caller_identity" "current" {}

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

# CloudWatch Event Rule for monitoring is removed
# Step Functions now handles the workflow orchestration and monitoring
# The monitorTranscribe Lambda is called by Step Functions as needed

