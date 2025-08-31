import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as custom from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { generateBatch } from "../shared/util";
import { reviews } from "../seed/reviews";

export interface ReviewsTableProps {
  tableName: string;
}

export class ReviewsTable extends Construct {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: ReviewsTableProps) {
    super(scope, id);

    // DynamoDB Review Table
    this.table = new dynamodb.Table(this, "ReviewsTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "movieId", type: dynamodb.AttributeType.NUMBER },
      sortKey: { name: "reviewId", type: dynamodb.AttributeType.NUMBER },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: props.tableName,
    });
    
// const tmdbReview = new dynamodb.Table(this, "FrontendReviewsTable", {
//       partitionKey: { name: "ReviewId", type: dynamodb.AttributeType.STRING },
//       billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
//       removalPolicy: cdk.RemovalPolicy.DESTROY,
//       tableName: "FrontendReviewsTable",
//       // Change to RETAIN for production
//     });
    
    // Initialize data in DynamoDB
    new custom.AwsCustomResource(this, "reviewsddbInitData", {
      onCreate: {
        service: "DynamoDB",
        action: "batchWriteItem",
        parameters: {
          RequestItems: {
            [this.table.tableName]: generateBatch(reviews),
          },
        },
        physicalResourceId: custom.PhysicalResourceId.of("reviewsddbInitData"),
      },
      policy: custom.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [this.table.tableArn],
      }),
    });
  }
}