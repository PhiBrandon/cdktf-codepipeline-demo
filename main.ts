import { Construct } from "constructs";
import { App, TerraformOutput, TerraformStack } from "cdktf";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import {
  codepipeline,
  iamRole,
  s3Bucket,
  codestarconnectionsConnection,
  codebuildProject,
} from "@cdktf/provider-aws";

class MyStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);

    // Create AWS Provider configuration for this stack
    new AwsProvider(this, "AWS", { region: "us-east-1" });

    // Create S3 Bucket to store artifacts
    const pipelineBucket = new s3Bucket.S3Bucket(this, "pipeline-bucket", {
      bucket: "pipelinebucket" + Math.floor(Math.random() * 1000),
      forceDestroy: true,
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
                Action: ["codestar-connections:*", "codestar:*", "s3:*", "codebuild:*"],
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
                Action: ["codestar-connections:*", "codestar:*", "s3:*", "logs:*"],
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
                PrimarySource: "source_output`"
              },
            },
          ],
        },
      ],
    });

    new TerraformOutput(this, "pipeline-arn", { value: pipeline.arn });
  }
}

const app = new App();
new MyStack(app, "code-pipeline-section");
app.synth();
