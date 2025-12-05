# GitHub Issue Monitor AI Agent

An AI-powered GitHub Actions workflow that monitors [umbraco/Umbraco.Cloud.Issues](https://github.com/umbraco/Umbraco.Cloud.Issues) for new issues daily, analyzes them with Claude, and sends notifications to Slack and Email.

## Features

- **Daily Monitoring**: Runs at 8am UTC to check for new issues
- **AI Analysis**: Uses Claude to analyze each issue and provide:
  - Priority (Critical/High/Medium/Low)
  - Category (Bug/Feature Request/Question/etc.)
  - Summary
  - Suggested action
  - Estimated effort
- **Dual Notifications**: Sends formatted notifications to both Slack and Email

## Setup

### 1. Copy to Your Repository

Copy the following files to your GitHub repository:
- `.github/workflows/issue-monitor.yml`
- `scripts/analyze-issues.js`
- `package.json`

### 2. Configure Secrets

Go to your repository **Settings > Secrets and variables > Actions** and add:

| Secret | Description |
|--------|-------------|
| `ANTHROPIC_API_KEY` | Your Claude API key from [console.anthropic.com](https://console.anthropic.com) |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL (see below) |
| `SENDGRID_API_KEY` | SendGrid API key for email notifications |

### 3. Configure Variables

Go to **Settings > Secrets and variables > Actions > Variables** and add:

| Variable | Description |
|----------|-------------|
| `NOTIFY_EMAIL` | Email address to receive notifications |
| `SENDER_EMAIL` | Verified sender email in SendGrid |

### 4. Set Up Slack Webhook

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** > **From scratch**
3. Name it (e.g., "Issue Monitor") and select your workspace
4. Go to **Incoming Webhooks** > Enable it
5. Click **Add New Webhook to Workspace**
6. Select the channel for notifications
7. Copy the webhook URL and add it as `SLACK_WEBHOOK_URL` secret

### 5. Set Up SendGrid

1. Create account at [sendgrid.com](https://sendgrid.com)
2. Go to **Settings > API Keys** > Create API Key
3. Select **Restricted Access** > Enable **Mail Send**
4. Copy the API key and add it as `SENDGRID_API_KEY` secret
5. Go to **Settings > Sender Authentication**
6. Verify a sender email address (use this as `SENDER_EMAIL`)

## Testing

Trigger the workflow manually to test:

1. Go to **Actions** tab in your repository
2. Select **Daily Issue Monitor**
3. Click **Run workflow**

## Customization

### Change Target Repository

Edit `.github/workflows/issue-monitor.yml` to monitor a different repository:
```yaml
REPO_OWNER: umbraco
REPO_NAME: Umbraco.Cloud.Issues
```

**Note**: The target repository is public, so the default `GITHUB_TOKEN` works. For private repositories, you'd need a Personal Access Token with `repo` scope.

### Change Schedule

Edit `.github/workflows/issue-monitor.yml`:
```yaml
schedule:
  - cron: '0 8 * * *'  # 8am UTC
```

Common schedules:
- `0 8 * * 1-5` - 8am UTC, weekdays only
- `0 9 * * *` - 9am UTC daily
- `0 */6 * * *` - Every 6 hours

### Modify AI Analysis

Edit the prompt in `scripts/analyze-issues.js` in the `analyzeIssue()` function to customize what Claude analyzes.

## Cost Estimates

- **GitHub Actions**: Free for public repos, 2000 min/month for private
- **Claude API**: ~$0.01-0.05 per issue (depends on issue length)
- **SendGrid**: Free tier includes 100 emails/day
- **Slack**: Free (incoming webhooks)
