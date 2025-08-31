import {AutoScalingGroup} from 'aws-cdk-lib/aws-autoscaling';
import {
  Vpc,
  SubnetType,
  SecurityGroup,
  UserData,
  InstanceClass,
  LaunchTemplate,
  InstanceSize,
  AmazonLinuxImage,
  AmazonLinuxGeneration,
  InstanceType,
  Peer,
  Port,
} from 'aws-cdk-lib/aws-ec2';
import {App, CfnOutput, Duration, Stack, StackProps} from 'aws-cdk-lib';
// import {readFileSync} from 'fs';
import {
  ApplicationProtocol,
  ApplicationLoadBalancer,
  ListenerCondition,
  ListenerAction,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export class CdkStack extends Stack {
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'vpc', {
      natGateways: 1,
    });

    const serverSG = new SecurityGroup(this, 'webserver-sg', {
      vpc,
      allowAllOutbound: true,
    });

    // serverSG.addIngressRule(
    //   Peer.anyIpv4(),
    //   Port.tcp(22),
    //   'allow SSH access from anywhere',
    // );
    const alb = new ApplicationLoadBalancer(this, 'alb', {
      vpc,
      internetFacing: true,
    });

    const listener = alb.addListener('Listener', {
      port: 80,
      open: true,
    });

    const userData = UserData.forLinux();
    userData.addCommands(
      'sudo su',
      'yum install -y httpd',
      'systemctl start httpd',
      'systemctl enable httpd',
      'echo "<h1>Hello World from $(hostname -f)</h1>" > /var/www/html/index.html',
    );

    const launchTemplate = new LaunchTemplate(this,"ASGLaunchTemplate", {
      instanceType: InstanceType.of(
        InstanceClass.BURSTABLE2,
        InstanceSize.MICRO,
      ),
      machineImage: new AmazonLinuxImage({
        generation: AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      userData,
      securityGroup: serverSG
    })

    const asg = new AutoScalingGroup(this, 'asg', {
      vpc,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
      launchTemplate: launchTemplate,
      minCapacity: 2,
      maxCapacity: 3,
    });

    listener.addTargets('default-targets', {
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      targets: [asg],
      healthCheck: {
        path: '/',
        unhealthyThresholdCount: 2,
        healthyThresholdCount: 5,
        interval: Duration.seconds(30),
      },
    });

    asg.scaleOnRequestCount('requests-per-minute', {
      targetRequestsPerMinute: 60,
    });

    asg.scaleOnCpuUtilization('cpu-util-scaling', {
      targetUtilizationPercent: 75,
    });

    new CfnOutput(this, 'albDNS', {
      value: alb.loadBalancerDnsName,
    });
  }
}
