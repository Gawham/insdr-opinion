# Gotham Platform Deployment Guide

## Contract Deployment

### Working Deployment Script

**ONLY USE THIS SCRIPT:**
```bash
node scripts/deploy-gotham-simple.js
```

This is the **only deployment script that works correctly**. Other deployment scripts in the `scripts/` directory are outdated or incomplete.

### What Gets Deployed

The `deploy-gotham-simple.js` script deploys the **GothamFactory** contract.

**Contract:** `contracts/GothamFactory.sol`

The GothamFactory is a factory pattern contract that:
- Creates new ProjectEscrow contracts for each project
- Manages multiple client-developer projects
- Coordinates the AI audit consensus system
- Tracks project relationships and escrow addresses

### How It Works

When you deploy with `deploy-gotham-simple.js`:

1. **Deploys GothamFactory** to Etherlink Shadownet
2. **Automatically tests** by creating a test project
3. **Outputs the contract address** to add to your `.env` file

### Prerequisites

Before deploying, ensure you have:

1. **Funded wallet** - Get XTZ from https://shadownet.faucet.etherlink.com/
2. **Environment configured** - Set `PRIVATE_KEY` in `backend/.env`
3. **Contracts compiled** - Run `npx hardhat compile` first

### Deployment Steps

```bash
# 1. Navigate to backend directory
cd backend

# 2. Compile contracts (if not already done)
npx hardhat compile

# 3. Run the deployment script
node scripts/deploy-gotham-simple.js

# 4. Copy the output contract address to your .env file
# Example output: GOTHAM_FACTORY_ADDRESS=0x123...
```

### After Deployment

1. Add `GOTHAM_FACTORY_ADDRESS` to `backend/.env`
2. Start the backend server: `npm start`
3. The backend will use the Factory to create ProjectEscrow contracts dynamically

---

## Contract Architecture

### Active Contracts (Used by the system)

1. **GothamFactory.sol** - Deployed via `deploy-gotham-simple.js`
   - Creates and manages projects
   - Deploys ProjectEscrow contracts on-demand
   
2. **ProjectEscrow.sol** - Created dynamically by the Factory
   - One contract per project
   - Handles payment escrow
   - Manages AI audit results (3-auditor consensus)
   - Controls fund release based on consensus

---

## Payment vs Consensus on Blockchain

### Payment Confirmation
- **Function:** `fundEscrow()` on ProjectEscrow contract
- **Type:** Value transfer (XTZ cryptocurrency)
- **Transactions:** 1 transaction
- **Stores:** Escrow amount in the contract

### Consensus Confirmation  
- **Function:** `submitAuditResult()` on ProjectEscrow contract
- **Type:** Data storage (cryptographic hashes + pass/fail votes)
- **Transactions:** 3 transactions (one per AI auditor)
- **Stores:** Audit result hashes and boolean pass/fail votes

**Consensus requires all 3 auditors to vote PASS for approval.**

---

## Troubleshooting

### Deployment Fails
- Check wallet balance: https://shadownet.explorer.etherlink.com/
- Verify `PRIVATE_KEY` is set in `.env`
- Ensure contracts are compiled: `npx hardhat compile`

### Contract Not Found Error
- Verify `GOTHAM_FACTORY_ADDRESS` is set in `.env`
- Check the contract was deployed: visit the explorer URL from deployment output

---

## Network Information

**Chain:** Etherlink Shadownet
**Chain ID:** 127823
**RPC:** https://node.shadownet.etherlink.com
**Explorer:** https://shadownet.explorer.etherlink.com
**Faucet:** https://shadownet.faucet.etherlink.com/

---

## Google Cloud App Engine Deployment

### Prerequisites

1. **Google Cloud SDK installed**
   ```bash
   # Install gcloud CLI
   # Visit: https://cloud.google.com/sdk/docs/install
   ```

2. **Authenticate with Google Cloud**
   ```bash
   gcloud auth login
   gcloud config set project secret-willow-427111-e1
   ```

3. **Configure app.yaml**
   - Copy `app.yaml.example` to `app.yaml`
   - Fill in your actual environment variables
   - **IMPORTANT:** `app.yaml` is gitignored - never commit it with secrets

### Deployment Steps

```bash
# 1. Ensure you're in the backend directory
cd backend

# 2. Deploy to App Engine
gcloud app deploy app.yaml --project=secret-willow-427111-e1

# 3. View your deployed service
gcloud app browse --service=gotham
```

### Service Configuration

- **Service Name:** gotham
- **Runtime:** Node.js 22
- **Port:** 8080 (App Engine default)
- **Scaling:** Automatic (1-10 instances)
- **URL:** `https://gotham-dot-secret-willow-427111-e1.appspot.com`

### Environment Variables in App Engine

The `app.yaml` file contains all environment variables:
- Blockchain private keys
- Contract addresses
- Google Cloud Storage configuration
- Gemini API key

**Note:** For production, migrate secrets to Google Secret Manager:
```yaml
env_variables:
  GEMINI_API_KEY: "sm://projects/PROJECT_ID/secrets/gemini-api-key/versions/latest"
```

### Storage Permissions

Ensure the App Engine default service account has access to your GCS bucket:

```bash
# Get the service account email
gcloud iam service-accounts list

# Grant storage permissions
gsutil iam ch serviceAccount:SERVICE_ACCOUNT_EMAIL:objectAdmin gs://brainjs-brain
```

### View Logs

```bash
# Stream logs
gcloud app logs tail --service=gotham

# View in Cloud Console
https://console.cloud.google.com/logs/query
```

### Update Deployment

```bash
# Deploy updates
gcloud app deploy app.yaml

# No downtime - App Engine handles rolling updates automatically
```
