import { Construct } from "constructs";
import {
  App,
  AssetType,
  TerraformAsset,
  TerraformOutput,
  TerraformStack,
} from "cdktf";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import {
  codepipeline,
  iamRole,
  s3Bucket,
  codestarconnectionsConnection,
  codebuildProject,
  lambdaFunction,
  cloudwatchEventRule,
  cloudwatchEventTarget,
  cloudwatchLogGroup,
  lambdaPermission,
} from "@cdktf/provider-aws";
import { S3Bucket } from "@cdktf/provider-aws/lib/s3-bucket";
import { S3Object } from "@cdktf/provider-aws/lib/s3-object";

class MyStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);

    // Create AWS Provider configuration for this stack
    new AwsProvider(this, "AWS", { region: "us-east-1" });

    // Create compiled asset for Discord Lambda Function
    const discordFnAsset = new TerraformAsset(this, "discord-fn-asset", {
      path: "./discordFn",
      type: AssetType.ARCHIVE,
    });

    // Create bucket to store Lambda code artifact
    const discordFnAssetBucket = new S3Bucket(
      this,
      "discord-lambda-asset-bucket",
      {
        bucket: "discordnotibucket1234",
      }
    );

    new TerraformOutput(this, "discordFnBucketOutput", {
      value: discordFnAssetBucket.bucket,
    });
    // Create the artifact key and source AKA Architec
    const discordFnArchive = new S3Object(this, "discord-fn-archive", {
      bucket: discordFnAssetBucket.bucket,
      key: discordFnAsset.fileName,
      source: discordFnAsset.path,
    });

    // Create S3 Bucket to store artifacts
    const pipelineBucket = new s3Bucket.S3Bucket(this, "pipeline-bucket", {
      bucket: "pipelinebucket" + Math.floor(Math.random() * 1000),
      forceDestroy: true,
    });
    // Create role for Lambda Function
    const discordFuncRole = new iamRole.IamRole(this, "discordFn-iam-role", {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Sid: "",
            Principal: {
              Service: "lambda.amazonaws.com",
            },
          },
        ],
      }),
      inlinePolicy: [
        {
          name: "lambdaMonitoring",
          policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: ["logs:*"],
                Resource: "*",
              },
            ],
          }),
        },
      ],
    });
    const discordLogGroup = new cloudwatchLogGroup.CloudwatchLogGroup(
      this,
      "discordFnLogGroup",
      {
        name: "/aws/lambda/discordPipelineNotification",
        retentionInDays: 1,
      }
    );
    // Create Lambda Function to notify Discord
    // Permissions: ParameterStore
    const discordFunction = new lambdaFunction.LambdaFunction(
      this,
      "discordFunction",
      {
        role: discordFuncRole.arn,
        functionName: "discordPipelineNotification",
        runtime: "nodejs16.x",
        handler: "index.handler",
        s3Bucket: discordFnAssetBucket.bucket,
        publish: true,
        s3Key: discordFnArchive.key,
        sourceCodeHash: discordFnArchive.key,
        dependsOn: [discordLogGroup],
      }
    );

    // Create discord Function Log group

    new TerraformOutput(this, "discordFnOutput", {
      value: discordFunction.arn,
    });
    // Create Role for CodePipeline
    // Permissions required for pipeline using S3 for artifact store and Codestar connections for Github: codestar-connections:* , s3:*
    // -- Required if using CodeBuild: codebuild:*
    const pipelineRole = new iamRole.IamRole(this, "pipeline-iam-role", {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Sid: "",
            Principal: {
              Service: "codepipeline.amazonaws.com",
            },
          },
        ],
      }),
      inlinePolicy: [
        {
          name: "allow-codestar-connection",
          policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: [
                  "codestar-connections:*",
                  "codestar:*",
                  "s3:*",
                  "codebuild:*",
                  "events:*",
                ],
                Resource: "*",
              },
            ],
          }),
        },
      ],
    });

    // Create Codestar Connection to Github. You need to MANUALLY auth/approve the connection in the AWS Console.
    const codeStarGithub =
      new codestarconnectionsConnection.CodestarconnectionsConnection(
        this,
        "codeStarConnection",
        { name: "github-connection-1", providerType: "GitHub" }
      );
    // Create Codebuild Service Role
    // Permission to create logs via Cloudformation required
    const codeBuildRole = new iamRole.IamRole(this, "code-build-role", {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Sid: "",
            Principal: {
              Service: "codebuild.amazonaws.com",
            },
          },
        ],
      }),
      inlinePolicy: [
        {
          name: "allow-build-success",
          policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: [
                  "codestar-connections:*",
                  "codestar:*",
                  "s3:*",
                  "logs:*",
                ],
                Resource: "*",
              },
            ],
          }),
        },
      ],
    });

    // Create Codebuild Project
    // Artifacts and Source need to both be specified to CODEPIPELINE to utilize in codepipeline
    // Must have a buildspec in the Source Artifacts root directory for it to succeed
    const codeBuildProjectPipeline = new codebuildProject.CodebuildProject(
      this,
      "code-build-project",
      {
        name: "devopsProBuilder",
        description: "Example of IAAC for DevOpsPro Exam",
        buildTimeout: 5,
        serviceRole: codeBuildRole.arn,
        artifacts: { type: "CODEPIPELINE" },
        environment: {
          computeType: "BUILD_GENERAL1_SMALL",
          image: "aws/codebuild/standard:1.0",
          type: "LINUX_CONTAINER",
          imagePullCredentialsType: "CODEBUILD",
        },
        source: { type: "CODEPIPELINE" },
      }
    );
    // Create CodePipeline utilizing the Bucket and Codestar-Connection Above
    // MUST have at least 2 stages
    // Pieline Structure and Action structure Resource Links:
    // https://docs.aws.amazon.com/codepipeline/latest/userguide/reference-pipeline-structure.html
    // https://docs.aws.amazon.com/codepipeline/latest/userguide/action-reference.html
    const pipeline = new codepipeline.Codepipeline(this, "code-pipeline-pro", {
      roleArn: pipelineRole.arn,
      name: "devops-pro-pipes",
      artifactStore: [{ location: pipelineBucket.bucket, type: "S3" }],
      stage: [
        {
          name: "Source",
          action: [
            {
              category: "Source",
              owner: "AWS",
              name: "sourcing",
              provider: "CodeStarSourceConnection",
              version: "1",
              outputArtifacts: ["source_output"],
              configuration: {
                ConnectionArn: codeStarGithub.arn,
                FullRepositoryId: "PhiBrandon/production-cu",
                BranchName: "main",
              },
            },
          ],
        },
        {
          name: "Build",
          action: [
            {
              category: "Build",
              owner: "AWS",
              name: "BuildAction",
              provider: "CodeBuild",
              version: "1",
              inputArtifacts: ["source_output"],
              outputArtifacts: ["build_output"],
              configuration: {
                ProjectName: codeBuildProjectPipeline.name,
                PrimarySource: "source_output`",
              },
            },
          ],
        },
      ],
    });
    // Create IAM Role to invoke the lambda Function
    const pipelineEventRole = new iamRole.IamRole(this, "pipelineEventRole", {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Sid: "",
            Principal: {
              Service: "events.amazonaws.com",
            },
          },
        ],
      }),
      inlinePolicy: [
        {
          name: "notify-discord-pipeline",
          policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: ["lambda:*", "codepipeline:*"],
                Resource: "*",
              },
            ],
          }),
        },
      ],
    });
    // Configure EventBridge Rules for notification system
    // In order for a lambda to be triggered, you must use the LambdaPermission resource in terraform to link event bridge to Lambda
    const discordRule = new cloudwatchEventRule.CloudwatchEventRule(
      this,
      "pipeline-Events",
      {
        eventPattern: JSON.stringify({
          source: [
            "aws.codebuild",
            "aws.codecommit",
            "aws.codedeploy",
            "aws.codepipeline",
          ],
          "detail-type": ["CodePipeline Stage Execution State Change"],
          detail: {
            state: ["STARTED", "SUCCEEDED", "FAILED"],
          },
        }),
        roleArn: pipelineEventRole.arn,
        dependsOn: [discordFunction],
      }
    );
    new cloudwatchEventTarget.CloudwatchEventTarget(
      this,
      "discordLambdaEventTarget",
      {
        rule: discordRule.name,
        targetId: discordFunction.functionName,
        arn: discordFunction.arn,
      }
    );
    new lambdaPermission.LambdaPermission(
      this,
      "discord-function-invoke-permission",
      {
        functionName: discordFunction.functionName,
        action: "lambda:InvokeFunction",
        principal: "events.amazonaws.com",
        sourceArn: discordRule.arn,
      }
    );

    new TerraformOutput(this, "pipeline-arn", { value: pipeline.arn });
  }
}

const app = new App();
new MyStack(app, "code-pipeline-section");
app.synth();
