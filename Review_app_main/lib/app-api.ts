import { Aws } from "aws-cdk-lib";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as apig from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as node from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import { ReviewsTable } from "./data-construct"; 
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
type AppApiProps = {
  userPoolId: string;
  userPoolClientId: string;
};

export class AppApi extends Construct {
  constructor(scope: Construct, id: string, props: AppApiProps) {
    super(scope, id);

    // Use the custom construct to create the DynamoDB table
    const reviewsTable = new ReviewsTable(this, "ReviewsTable", {
      tableName: "ReviewsTable",
    }).table;
    
     
const tmdbReview = new dynamodb.Table(this, "FrontendReviewsTable", {
      partitionKey: { name: "ReviewId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "FrontendReviewsTable",
      
    });

    const appApi = new apig.RestApi(this, "AppApi", {
      description: "App RestApi",
      endpointTypes: [apig.EndpointType.REGIONAL],
      defaultCorsPreflightOptions: {
        allowOrigins: apig.Cors.ALL_ORIGINS,
      },
    });

    const appCommonFnProps = {
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "handler",
      environment: {
        USER_POOL_ID: props.userPoolId,
        CLIENT_ID: props.userPoolClientId,
        REGION: cdk.Aws.REGION,
        TABLE_NAME: reviewsTable.tableName,
      },
    };

    // Get review lambda
    const getReviews = new node.NodejsFunction(this, "getReviews", {
      ...appCommonFnProps,
      entry: `${__dirname}/../lambdas/getMovieReview.ts`,
    });

    // Get translation lambda
    const getTranslation = new node.NodejsFunction(this, "getTranslation", {
      ...appCommonFnProps,
      entry: `${__dirname}/../lambdas/getTranslations.ts`,
    });

    // Update Review lambda
    const updateReview = new node.NodejsFunction(this, "updateReview", {
      ...appCommonFnProps,
      entry: `${__dirname}/../lambdas/updateReviews.ts`,
    });

    // Add Review lambda
    const addReview = new node.NodejsFunction(this, "addReview", {
      ...appCommonFnProps,
      entry: `${__dirname}/../lambdas/addReviews.ts`,
    });

    // Authorizer Lambda Function
    const authorizerFn = new node.NodejsFunction(this, "AuthorizerFn", {
      ...appCommonFnProps,
      entry: `${__dirname}/../lambdas/auth/authorizer.ts`,
    });

    const addFrontendReview = new node.NodejsFunction(this, "AddFrontendReview", {
      ...appCommonFnProps,
      entry: `${__dirname}/../lambdas/addtmdbreview.ts`,
      environment: {
        TMDB_TABLE_NAME: tmdbReview.tableName, 
      },
    });

    const retrieveMovieReviews = new node.NodejsFunction(this, "retrieveMovieReviews", {
      ...appCommonFnProps,
      entry: `${__dirname}/../lambdas/getTmdbReviews.ts`,
      environment: {
        REVIEWS_TABLE_NAME: tmdbReview.tableName,
      },
    });

    // Request Authorizer
    const requestAuthorizer = new apig.RequestAuthorizer(this, "RequestAuthorizer", {
      identitySources: [apig.IdentitySource.header("Cookie")],
      handler: authorizerFn,
      resultsCacheTtl: cdk.Duration.minutes(0),
    });

    // Get Review Endpoint
    const moviesEndpoint = appApi.root.addResource("movies");
    const moviesreviewsEndpoint = moviesEndpoint.addResource("reviews");
    const moviesreviewsmovieidEndpoint = moviesreviewsEndpoint.addResource("{movieId}");
    moviesreviewsmovieidEndpoint.addMethod("GET", new apig.LambdaIntegration(getReviews, { proxy: true }));

    // Get Translation Endpoint
    const reviewsEndpoint = appApi.root.addResource("reviews");
    const reviewsreviewIdEndpoint = reviewsEndpoint.addResource("{reviewId}");
    const reviewsreviewIdmovieidEndpoint = reviewsreviewIdEndpoint.addResource("{movieId}");
    const translationEndpoint = reviewsreviewIdmovieidEndpoint.addResource("translation");
    translationEndpoint.addMethod("GET", new apig.LambdaIntegration(getTranslation, { proxy: true }));

    // Update Review Endpoint (with Authorization)
    const moviesmovieIdEndpoint = moviesEndpoint.addResource("{movieId}");
    const moviesmovieIdreviewsEndpoint = moviesmovieIdEndpoint.addResource("reviews");
    const reviewsResource = appApi.root.addResource("frontendreviews");
    const moviesmovieIdreviewsreviewIdEndpoint = moviesmovieIdreviewsEndpoint.addResource("{reviewId}");
    moviesmovieIdreviewsreviewIdEndpoint.addMethod(
      "PUT",
      new apig.LambdaIntegration(updateReview, { proxy: true },),
      {
        authorizer: requestAuthorizer,
        authorizationType: apig.AuthorizationType.CUSTOM,
      }
    );

    // Add Review Endpoint (with Authorization)
    moviesreviewsEndpoint.addMethod(
      "POST",
      new apig.LambdaIntegration(addReview, { proxy: true }),
      {
        authorizer: requestAuthorizer,
        authorizationType: apig.AuthorizationType.CUSTOM,
      }
    );

    reviewsResource.addMethod(
      "POST",
      new apig.LambdaIntegration(addFrontendReview, { proxy: true })
    );
    reviewsResource.addMethod(
      "GET",
      new apig.LambdaIntegration(retrieveMovieReviews, { proxy: true })
    );

    // Permissions
    reviewsTable.grantReadData(getReviews);
    reviewsTable.grantReadWriteData(getTranslation);
    reviewsTable.grantReadWriteData(updateReview);
    reviewsTable.grantReadWriteData(addReview);
    tmdbReview.grantWriteData(addFrontendReview);
    tmdbReview.grantReadData(retrieveMovieReviews);

    // Add TranslateText permission to the getTranslation Lambda
    getTranslation.role?.attachInlinePolicy(
      new iam.Policy(this, "TranslateTextPolicy", {
        statements: [
          new iam.PolicyStatement({
            actions: ["translate:TranslateText"],
            resources: ["*"],
          }),
        ],
      })
    );

    // Grant the Authorizer Lambda permissions to access Cognito
    authorizerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:GetUser"],
        resources: ["*"],
      })
    );
  }
}