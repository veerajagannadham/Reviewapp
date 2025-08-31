#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ReviewAppStack } from '../lib/review_app-stack';



const app = new cdk.App();
new ReviewAppStack(app, 'ReviewAppStack', {});

