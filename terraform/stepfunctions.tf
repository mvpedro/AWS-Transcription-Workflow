# Step Functions State Machine for Video Transcription Workflow

# IAM Role for Step Functions
resource "aws_iam_role" "step_functions_role" {
  name = "step-functions-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "states.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "step_functions_policy" {
  name = "step-functions-policy-${var.environment}"
  role = aws_iam_role.step_functions_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogDelivery",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = [
          aws_lambda_function.on_upload_handler.arn,
          aws_lambda_function.split_video.arn,
          aws_lambda_function.start_transcribe.arn,
          aws_lambda_function.monitor_transcribe.arn,
          aws_lambda_function.store_subtitles.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "transcribe:GetTranscriptionJob"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Scan",
          "dynamodb:Query"
        ]
        Resource = aws_dynamodb_table.transcription_jobs.arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:HeadObject"
        ]
        Resource = [
          "${aws_s3_bucket.video_uploads.arn}/*"
        ]
      }
    ]
  })
}

# Step Functions State Machine Definition
resource "aws_sfn_state_machine" "transcription_workflow" {
  name     = "transcription-workflow-${var.environment}"
  role_arn = aws_iam_role.step_functions_role.arn

  definition = jsonencode({
    Comment = "Video Transcription Workflow using Step Functions"
    StartAt = "CheckFileSize"
    States = {
      CheckFileSize = {
        Type       = "Task"
        Resource   = aws_lambda_function.on_upload_handler.arn
        ResultPath = "$.sizeCheck"
        Next       = "CheckSizeDecision"
        Retry = [
          {
            ErrorEquals     = ["States.ALL"]
            IntervalSeconds = 2
            MaxAttempts     = 3
            BackoffRate     = 2.0
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            ResultPath  = "$.error"
            Next        = "FailureState"
          }
        ]
      }
      CheckSizeDecision = {
        Type = "Choice"
        Choices = [
          {
            Variable     = "$.sizeCheck.action"
            StringEquals = "split"
            Next         = "SplitVideo"
          }
        ]
        Default = "StartTranscribe"
      }
      SplitVideo = {
        Type       = "Task"
        Resource   = aws_lambda_function.split_video.arn
        ResultPath = "$.splitResult"
        InputPath  = "$.sizeCheck"
        Next       = "ProcessChunks"
        Retry = [
          {
            ErrorEquals     = ["States.ALL"]
            IntervalSeconds = 2
            MaxAttempts     = 3
            BackoffRate     = 2.0
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            ResultPath  = "$.error"
            Next        = "FailureState"
          }
        ]
      }
      ProcessChunks = {
        Type           = "Map"
        ItemsPath      = "$.splitResult.chunks"
        MaxConcurrency = 3
        Iterator = {
          StartAt = "StartChunkTranscribe"
          States = {
            StartChunkTranscribe = {
              Type       = "Task"
              Resource   = aws_lambda_function.start_transcribe.arn
              ResultPath = "$.transcribeResult"
              Next       = "MonitorChunkTranscription"
            }
            MonitorChunkTranscription = {
              Type       = "Task"
              Resource   = aws_lambda_function.monitor_transcribe.arn
              InputPath  = "$.transcribeResult"
              ResultPath = "$.monitorResult"
              Next       = "CheckChunkComplete"
              Retry = [
                {
                  ErrorEquals     = ["States.ALL"]
                  IntervalSeconds = 2
                  MaxAttempts     = 2
                  BackoffRate     = 2.0
                }
              ]
            }
            CheckChunkComplete = {
              Type = "Choice"
              Choices = [
                {
                  Variable      = "$.monitorResult.allComplete"
                  BooleanEquals = true
                  Next          = "StoreChunkSubtitles"
                }
              ]
              Default = "WaitChunk"
            }
            WaitChunk = {
              Type    = "Wait"
              Seconds = 30
              Next    = "MonitorChunkTranscription"
            }
            StoreChunkSubtitles = {
              Type     = "Task"
              Resource = aws_lambda_function.store_subtitles.arn
              Parameters = {
                "originalKey.$"   = "$.originalKey"
                "chunkIndex.$"    = "$.chunkIndex"
                "totalChunks.$"   = "$.totalChunks"
                "language.$"      = "$.monitorResult.completedJobs[0].language"
                "transcriptUri.$" = "$.monitorResult.completedJobs[0].transcriptUri"
                "jobId.$"         = "$.monitorResult.completedJobs[0].jobId"
              }
              ResultPath = "$.storeResult"
              End        = true
              Retry = [
                {
                  ErrorEquals     = ["States.ALL"]
                  IntervalSeconds = 2
                  MaxAttempts     = 3
                  BackoffRate     = 2.0
                }
              ]
            }
          }
        }
        Next = "SuccessState"
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            ResultPath  = "$.error"
            Next        = "FailureState"
          }
        ]
      }
      StartTranscribe = {
        Type       = "Task"
        Resource   = aws_lambda_function.start_transcribe.arn
        InputPath  = "$.sizeCheck"
        ResultPath = "$.transcribeResult"
        Next       = "MonitorTranscription"
        Retry = [
          {
            ErrorEquals     = ["States.ALL"]
            IntervalSeconds = 2
            MaxAttempts     = 3
            BackoffRate     = 2.0
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            ResultPath  = "$.error"
            Next        = "FailureState"
          }
        ]
      }
      MonitorTranscription = {
        Type       = "Task"
        Resource   = aws_lambda_function.monitor_transcribe.arn
        InputPath  = "$.transcribeResult"
        ResultPath = "$.monitorResult"
        Next       = "CheckMonitoringResult"
        Retry = [
          {
            ErrorEquals     = ["States.ALL"]
            IntervalSeconds = 2
            MaxAttempts     = 2
            BackoffRate     = 2.0
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            ResultPath  = "$.error"
            Next        = "FailureState"
          }
        ]
      }
      CheckMonitoringResult = {
        Type = "Choice"
        Choices = [
          {
            Variable      = "$.monitorResult.allComplete"
            BooleanEquals = true
            Next          = "StoreSubtitles"
          }
        ]
        Default = "WaitBeforeRetry"
      }
      WaitBeforeRetry = {
        Type    = "Wait"
        Seconds = 30
        Next    = "MonitorTranscription"
      }
      StoreSubtitles = {
        Type = "Parallel"
        Branches = [
          {
            StartAt = "StoreEnglishSubtitles"
            States = {
              StoreEnglishSubtitles = {
                Type     = "Task"
                Resource = aws_lambda_function.store_subtitles.arn
                Parameters = {
                  "originalKey.$"   = "$.monitorResult.originalKey"
                  "chunkIndex.$"    = "$.monitorResult.chunkIndex"
                  "totalChunks.$"   = "$.monitorResult.totalChunks"
                  language          = "english"
                  "transcriptUri.$" = "$.monitorResult.completedJobs[0].transcriptUri"
                  "jobId.$"         = "$.monitorResult.completedJobs[0].jobId"
                }
                End = true
                Retry = [
                  {
                    ErrorEquals     = ["States.ALL"]
                    IntervalSeconds = 2
                    MaxAttempts     = 3
                    BackoffRate     = 2.0
                  }
                ]
              }
            }
          },
          {
            StartAt = "StoreSpanishSubtitles"
            States = {
              StoreSpanishSubtitles = {
                Type     = "Task"
                Resource = aws_lambda_function.store_subtitles.arn
                Parameters = {
                  "originalKey.$"   = "$.monitorResult.originalKey"
                  "chunkIndex.$"    = "$.monitorResult.chunkIndex"
                  "totalChunks.$"   = "$.monitorResult.totalChunks"
                  language          = "spanish"
                  "transcriptUri.$" = "$.monitorResult.completedJobs[1].transcriptUri"
                  "jobId.$"         = "$.monitorResult.completedJobs[1].jobId"
                }
                End = true
                Retry = [
                  {
                    ErrorEquals     = ["States.ALL"]
                    IntervalSeconds = 2
                    MaxAttempts     = 3
                    BackoffRate     = 2.0
                  }
                ]
              }
            }
          }
        ]
        Next = "SuccessState"
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            ResultPath  = "$.error"
            Next        = "FailureState"
          }
        ]
      }
      SuccessState = {
        Type = "Succeed"
      }
      FailureState = {
        Type  = "Fail"
        Error = "WorkflowFailed"
        Cause = "$.error"
      }
    }
  })

  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.step_functions_logs.arn}:*"
    include_execution_data = true
    level                  = "ALL"
  }

  tags = {
    Environment = var.environment
    Name        = "Transcription Workflow"
  }
}

# CloudWatch Log Group for Step Functions
resource "aws_cloudwatch_log_group" "step_functions_logs" {
  name              = "/aws/vendedlogs/states/transcription-workflow-${var.environment}"
  retention_in_days = 7

  tags = {
    Environment = var.environment
  }
}

# EventBridge Rule to trigger Step Functions from S3 events
resource "aws_cloudwatch_event_rule" "s3_to_stepfunctions" {
  name        = "s3-to-stepfunctions-${var.environment}"
  description = "Trigger Step Functions workflow when video is uploaded to S3"

  event_pattern = jsonencode({
    source      = ["aws.s3"]
    detail-type = ["Object Created"]
    detail = {
      bucket = {
        name = [aws_s3_bucket.video_uploads.id]
      }
      object = {
        key = [{
          suffix = ".mp4"
        }]
      }
    }
  })
}

resource "aws_cloudwatch_event_target" "s3_to_stepfunctions_target" {
  rule      = aws_cloudwatch_event_rule.s3_to_stepfunctions.name
  target_id = "TriggerStepFunctions"
  arn       = aws_sfn_state_machine.transcription_workflow.arn
  role_arn  = aws_iam_role.eventbridge_stepfunctions_role.arn

  input_transformer {
    input_paths = {
      bucket = "$.detail.bucket.name"
      key    = "$.detail.object.key"
    }
    input_template = "{\"Records\": [{\"s3\": {\"bucket\": {\"name\": <bucket>}, \"object\": {\"key\": <key>}}}]}"
  }
}

# IAM Role for EventBridge to invoke Step Functions
resource "aws_iam_role" "eventbridge_stepfunctions_role" {
  name = "eventbridge-stepfunctions-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "events.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "eventbridge_stepfunctions_policy" {
  name = "eventbridge-stepfunctions-policy-${var.environment}"
  role = aws_iam_role.eventbridge_stepfunctions_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "states:StartExecution"
        ]
        Resource = aws_sfn_state_machine.transcription_workflow.arn
      }
    ]
  })
}

