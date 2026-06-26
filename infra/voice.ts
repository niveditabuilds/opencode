import { domain } from "./stage"

const voiceVpc = new sst.aws.Vpc("VoiceVpc")
const voiceCluster = new sst.aws.Cluster("VoiceCluster", { vpc: voiceVpc })

const xaiApiKey = new sst.Secret("XAI_API_KEY")
const opencodeServerPassword = new sst.Secret("OPENCODE_SERVER_PASSWORD")

export const opencodeServer = new sst.aws.Service("VoiceOpencodeServer", {
  cluster: voiceCluster,
  architecture: "arm64",
  cpu: "1 vCPU",
  memory: "2 GB",
  image: {
    context: ".",
    dockerfile: "packages/opencode/Dockerfile.server",
  },
  environment: {
    OPENCODE_PORT: "4096",
    OPENCODE_SERVER_PASSWORD: opencodeServerPassword.value,
    XAI_API_KEY: xaiApiKey.value,
    OPENCODE_MODEL_PROVIDER: "opencode",
    OPENCODE_MODEL_ID: "big-pickle",
  },
  loadBalancer: {
    domain: {
      name: $interpolate`server.${domain}`,
      dns: sst.cloudflare.dns(),
    },
    rules: [
      { listen: "80/http", redirect: "443/https" },
      { listen: "443/https", forward: "4096/http" },
    ],
    health: {
      "4096/http": {
        path: "/global/health",
        successCodes: "200-299",
      },
    },
  },
  scaling: {
    min: 1,
    max: 1,
  },
  dev: {
    command: "bun run --conditions=browser ./src/index.ts serve --hostname 0.0.0.0 --port 4096",
    directory: "packages/opencode",
    url: "http://localhost:4096",
  },
})

export const appUrl = $interpolate`https://app.${domain}`
